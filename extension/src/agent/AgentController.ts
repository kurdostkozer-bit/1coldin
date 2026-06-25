/**
 * AgentController — drives the tool-calling loop locally (VSCode-side).
 * Uses ApiClient.chatWithTools() for LLM calls.
 * Executes filesystem/terminal tools locally (files are on user's machine).
 * Communicates with UI only through UiBridge.
 */

import * as vscode from 'vscode';
import { ApiClient } from '../api/ApiClient';
import { UiBridge } from '../ui/UiBridge';
import { collectWorkspaceContext } from '../workspace/WorkspaceContext';
import {
    ToolDefinition, ToolCall, ToolResult, ApprovalRequest,
    OpenAIMessage, TaskSummary, WorkspaceContextData,
} from '../api/types';
import { executeReadFile, executeWriteFile, executeCreateFile, executeDeleteFile, executeListDirectory, FILE_SYSTEM_TOOL_DEFINITIONS } from './tools/fileSystemTool';
import { executeRunCommand, TERMINAL_TOOL_DEFINITION } from './tools/terminalTool';
import { executeSearch, SEARCH_TOOL_DEFINITIONS } from './tools/searchTool';
import { analyzeDependencies, DEPENDENCY_TOOL_DEFINITIONS } from './tools/dependencyTool';
import { analyzeAST, AST_TOOL_DEFINITIONS } from './tools/astTool';
import { executeMultiEdit, MULTI_EDIT_TOOL_DEFINITIONS } from './tools/multiEditTool';
import { executeFindReplace, FIND_REPLACE_TOOL_DEFINITIONS } from './tools/findReplaceTool';
import { executeHttpRequest, HTTP_TOOL_DEFINITIONS } from './tools/httpTool';
import { executeDatabaseQuery, DATABASE_TOOL_DEFINITIONS } from './tools/databaseTool';
import { executeTests, TEST_TOOL_DEFINITIONS } from './tools/testTool';
import { executeLint, LINT_TOOL_DEFINITIONS } from './tools/lintTool';
import { saveMemory, retrieveMemory, deleteMemory, MEMORY_TOOL_DEFINITIONS } from './tools/memoryTool';
import { getContextSuggestions, CONTEXT_TOOL_DEFINITIONS } from './tools/contextTool';
import { generateVisualization, VISUALIZATION_TOOL_DEFINITIONS } from './tools/visualizationTool';
import { generateDependencyGraph, DEPENDENCY_GRAPH_TOOL_DEFINITIONS } from './tools/dependencyGraphTool';

const DEFAULT_MAX_ITERATIONS = 20;
const FILE_MUTATION_TOOLS = new Set(['write_file', 'create_file', 'delete_file']);

export class AgentController {

    private _messages: OpenAIMessage[] = [];
    private _stopRequested = false;
    private _running = false;
    private _pendingApprovals = new Map<string, (approved: boolean) => void>();
    private _toolsUsed: string[] = [];
    private _filesChanged: string[] = [];
    private _iteration = 0;

    constructor(
        private readonly _client: ApiClient,
        private readonly _bridge: UiBridge,
    ) {}

    // ── Public API ────────────────────────────────────────────────────────────

    fetchAndSendProviders(): void {
        this._client.fetchProviders().then(p => this._bridge.send({ type: 'providers', data: p }));
    }

    async startRun(task: string, model: string, provider?: string): Promise<void> {
        if (this._running) { return; }

        this._stopRequested = false;
        this._running = true;
        this._messages = [];
        this._toolsUsed = [];
        this._filesChanged = [];
        this._iteration = 0;

        const tools: ToolDefinition[] = [...FILE_SYSTEM_TOOL_DEFINITIONS, TERMINAL_TOOL_DEFINITION, ...SEARCH_TOOL_DEFINITIONS, ...DEPENDENCY_TOOL_DEFINITIONS, ...AST_TOOL_DEFINITIONS, ...MULTI_EDIT_TOOL_DEFINITIONS, ...FIND_REPLACE_TOOL_DEFINITIONS, ...HTTP_TOOL_DEFINITIONS, ...DATABASE_TOOL_DEFINITIONS, ...TEST_TOOL_DEFINITIONS, ...LINT_TOOL_DEFINITIONS, ...MEMORY_TOOL_DEFINITIONS, ...CONTEXT_TOOL_DEFINITIONS, ...VISUALIZATION_TOOL_DEFINITIONS, ...DEPENDENCY_GRAPH_TOOL_DEFINITIONS];
        let ctx: WorkspaceContextData;
        try {
            ctx = await collectWorkspaceContext();
        } catch (err: any) {
            this._bridge.send({ type: 'agentError', message: err.message });
            this._exitAgentMode();
            this._running = false;
            return;
        }

        const systemPrompt = this._buildSystemPrompt(ctx, tools);
        this._messages.push({ role: 'system', content: systemPrompt });
        this._messages.push({ role: 'user', content: task });

        const maxIterations = DEFAULT_MAX_ITERATIONS;

        try {
            while (this._iteration < maxIterations) {
                if (this._stopRequested) {
                    this._bridge.send({ type: 'loopStopped' });
                    break;
                }

                this._iteration++;
                this._bridge.send({ type: 'stepUpdate', step: this._iteration, max: maxIterations });

                let response: { content: string | null; tool_calls?: ToolCall[]; finishReason: string };
                try {
                    response = await this._client.chatWithTools({
                        model: model || 'best-70b',
                        messages: this._messages,
                        tools,
                        tool_choice: 'auto',
                        stream: false,
                        provider_hint: provider,
                    });
                } catch (err: any) {
                    this._bridge.send({ type: 'agentError', message: err.message });
                    break;
                }

                if (!response.tool_calls || response.tool_calls.length === 0) {
                    this._bridge.send({ type: 'finalAnswer', text: response.content ?? '' });
                    this._bridge.send({
                        type: 'taskSummary',
                        iterations: this._iteration,
                        toolsUsed: [...this._toolsUsed],
                        filesChanged: [...this._filesChanged],
                    });
                    break;
                }

                const results: ToolResult[] = [];
                for (const call of response.tool_calls) {
                    if (this._stopRequested) { break; }
                    this._bridge.send({ type: 'toolCallLog', name: call.function.name, args: {}, status: 'pending' });
                    const result = await this._executeTool(call, ctx);
                    this._bridge.send({ type: 'toolCallLog', name: call.function.name, args: {}, status: result.isError ? 'error' : 'done' });
                    if (!this._toolsUsed.includes(call.function.name)) {
                        this._toolsUsed.push(call.function.name);
                    }
                    if (!result.isError && FILE_MUTATION_TOOLS.has(call.function.name) && result.affectedPath) {
                        if (!this._filesChanged.includes(result.affectedPath)) {
                            this._filesChanged.push(result.affectedPath);
                        }
                    }
                    results.push(result);
                }

                this._messages.push({
                    role: 'assistant',
                    content: response.content ?? null,
                    tool_calls: response.tool_calls,
                });
                for (const r of results) {
                    this._messages.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content });
                }
            }

            if (this._iteration >= maxIterations) {
                this._bridge.send({ type: 'agentError', message: 'Iteration limit reached (20)' });
            }
        } finally {
            this._running = false;
            this._exitAgentMode();
        }
    }

    private _exitAgentMode(): void {
        this._bridge.send({ type: 'agentModeChange', active: false, workspaceRoot: '' });
    }

    stop(): void {
        this._stopRequested = true;
    }

    resolveApproval(callId: string, approved: boolean): void {
        const resolver = this._pendingApprovals.get(callId);
        if (resolver) {
            this._pendingApprovals.delete(callId);
            resolver(approved);
        }
    }

    reset(): void {
        this._messages = [];
        this._stopRequested = false;
        this._running = false;
        this._pendingApprovals.clear();
        this._toolsUsed = [];
        this._filesChanged = [];
        this._iteration = 0;
    }

    // ── Tool execution ────────────────────────────────────────────────────────

    private async _executeTool(call: ToolCall, ctx: WorkspaceContextData): Promise<ToolResult> {
        const name = call.function.name;
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(call.function.arguments);
        } catch {
            return { tool_call_id: call.id, role: 'tool', content: 'Error: invalid JSON arguments', isError: true };
        }

        const rootUri = vscode.Uri.file(ctx.workspaceRoot);
        const onApproval = (req: ApprovalRequest) => this._requestApproval(req);

        try {
            switch (name) {
                case 'read_file':       return await executeReadFile(args as any, rootUri, call.id);
                case 'write_file':      return await executeWriteFile(args as any, rootUri, call.id, onApproval);
                case 'create_file':     return await executeCreateFile(args as any, rootUri, call.id);
                case 'delete_file':     return await executeDeleteFile(args as any, rootUri, call.id, onApproval);
                case 'list_directory':  return await executeListDirectory(args as any, rootUri, call.id);
                case 'search':          return await executeSearch(args as any, rootUri, call.id);
                case 'analyze_dependencies': return await analyzeDependencies(args as any, rootUri, call.id);
                case 'analyze_ast':     return await analyzeAST(args as any, rootUri, call.id);
                case 'multi_edit':      return await executeMultiEdit(args as any, rootUri, call.id, onApproval);
                case 'find_replace':    return await executeFindReplace(args as any, rootUri, call.id);
                case 'http_request':    return await executeHttpRequest(args as any, rootUri, call.id);
                case 'database_query':  return await executeDatabaseQuery(args as any, rootUri, call.id);
                case 'run_tests':       return await executeTests(args as any, rootUri, call.id);
                case 'run_lint':        return await executeLint(args as any, rootUri, call.id);
                case 'save_memory':     return await saveMemory(args as any, rootUri, call.id);
                case 'retrieve_memory': return await retrieveMemory(args as any, rootUri, call.id);
                case 'delete_memory':   return await deleteMemory(args as any, rootUri, call.id);
                case 'get_context_suggestions': return await getContextSuggestions(args as any, rootUri, call.id);
                case 'generate_visualization': return await generateVisualization(args as any, rootUri, call.id);
                case 'generate_dependency_graph': return await generateDependencyGraph(args as any, rootUri, call.id);
                case 'run_command':     return await executeRunCommand(args as any, {
                    workspaceRoot: ctx.workspaceRoot,
                    agentModeActive: true,
                    requireConfirmation: vscode.workspace
                        .getConfiguration('kurdbox')
                        .get<boolean>('agent.requireCommandConfirmation', false),
                    onApprovalRequired: onApproval,
                    toolCallId: call.id,
                });
                default:
                    return { tool_call_id: call.id, role: 'tool', content: `Unknown tool: ${name}`, isError: true };
            }
        } catch (err: any) {
            return { tool_call_id: call.id, role: 'tool', content: `Error: ${err.message}`, isError: true };
        }
    }

    private _requestApproval(req: ApprovalRequest): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            this._pendingApprovals.set(req.toolCallId, resolve);
            this._bridge.send({
                type: 'approvalRequest',
                reqType: req.type,
                path: req.path,
                command: req.command,
                diff: req.diff,
                callId: req.toolCallId,
            });
        });
    }

    // ── System prompt ─────────────────────────────────────────────────────────

    private _buildSystemPrompt(ctx: WorkspaceContextData, tools: ToolDefinition[]): string {
        return `You are KurdBox Agent, an expert AI coding assistant with deep understanding of software development and direct access to the user's workspace.

## Your Capabilities
- Read and analyze code across the entire workspace
- Understand project structure and dependencies
- Search for patterns using advanced text search
- Analyze code structure using AST (functions, classes, imports)
- Make intelligent code suggestions
- Debug complex issues
- Refactor and optimize code
- Perform multi-file edits efficiently
- Write tests and documentation
- Make HTTP requests to external APIs
- Query databases (SQLite, MySQL, PostgreSQL)
- Run tests using various frameworks (Jest, pytest, go test)
- Run code quality checks using linters (ESLint, Pylint, Ruff)
- Store and retrieve contextual information using memory system
- Get context-aware suggestions based on task analysis
- Generate visualizations (charts, graphs) for data analysis
- Create interactive dependency graphs

## Workspace Analysis
Root: ${ctx.workspaceRoot}
Active file: ${ctx.activeFilePath ?? '(none)'}
Open files: ${ctx.openFilePaths.join('\n') || '(none)'}

## File Tree
${ctx.fileTree}

## Active File Content
${ctx.activeFileContent ?? '(no active file or content exceeds limit)'}

## Git Diff
${ctx.gitDiff ?? '(no git diff available)'}

## Available Tools
${JSON.stringify(tools, null, 2)}

## Best Practices
- Follow the project's existing code style and conventions
- Use appropriate design patterns for the language/framework
- Write clean, maintainable, and well-documented code
- Add necessary error handling and validation
- Consider performance implications of your changes
- Test your changes when possible
- Explain your reasoning clearly before making changes

## Rules
- Always use relative paths resolved against the workspace root
- Before writing or deleting files, the user must approve
- Use the search tool to find relevant code before making changes
- Use analyze_dependencies to understand module relationships
- Use analyze_ast to understand code structure before refactoring
- Use multi_edit for making multiple related changes efficiently
- Use find_replace for bulk text replacements across files
- Use http_request to fetch data from external APIs
- Use database_query to interact with databases when needed
- Use run_tests to verify code changes work correctly
- Use run_lint to check code quality before committing
- Use save_memory to store important project information for future reference
- Use retrieve_memory to access previously stored contextual information
- Use get_context_suggestions to get workflow guidance based on the task
- Use generate_visualization to create charts and graphs for data analysis
- Use generate_dependency_graph to visualize module relationships
- After completing the task, provide a clear summary of what you changed and why`;
    }
}
