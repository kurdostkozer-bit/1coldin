/**
 * AgentLoop — orchestrates the tool-calling loop for kurdbox-agent.
 *
 * Responsibilities:
 *  - Build the system prompt from workspace context + tool schemas
 *  - Call chatWithTools iteratively, executing tool_calls each round
 *  - Enforce maxIterations; emit step/tool/answer/error events via callbacks
 *  - Provide stop() and reset() lifecycle methods
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 1.3, 1.5
 */

import * as vscode from 'vscode';
import {
    AgentLoopOptions,
    ApprovalRequest,
    LoopStatus,
    OpenAIMessage,
    TaskSummary,
    ToolCall,
    ToolDefinition,
    ToolResult,
    WorkspaceContextData,
} from './types';
import { chatWithTools } from '../api/ApiClient';
import {
    executeReadFile,
    executeWriteFile,
    executeCreateFile,
    executeDeleteFile,
    executeListDirectory,
} from './tools/fileSystemTool';
import { executeRunCommand } from './tools/terminalTool';

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 20;

/** Names of tools that mutate the filesystem or run commands and require approval. */
const APPROVAL_REQUIRED_TOOLS = new Set(['write_file', 'delete_file', 'run_command']);

/** Names of tools that change files — tracked for the task summary. */
const FILE_MUTATION_TOOLS = new Set(['write_file', 'create_file', 'delete_file']);

export class AgentLoop {
    private _messages: OpenAIMessage[] = [];
    private _status: LoopStatus = 'idle';
    private _stopRequested = false;
    private _currentIteration = 0;
    private _toolsUsed: string[] = [];
    private _filesChanged: string[] = [];

    constructor(private options: AgentLoopOptions) {}

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    get status(): LoopStatus {
        return this._status;
    }

    /**
     * Runs the tool-calling loop.
     *
     * @param userMessage    The user's task text.
     * @param contextData    Workspace context collected before the call.
     * @param tools          Tool definitions to expose to the LLM.
     */
    async run(
        userMessage: string,
        contextData: WorkspaceContextData,
        tools: ToolDefinition[],
        token: string,
        model: string,
        provider?: string
    ): Promise<void> {
        const maxIterations = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

        // Initialise state
        this._stopRequested = false;
        this._currentIteration = 0;
        this._toolsUsed = [];
        this._filesChanged = [];
        this._messages = [];

        this._setStatus('running');

        // Build initial message history
        const systemPrompt = this._buildSystemPrompt(contextData, tools);
        this._messages.push({ role: 'system', content: systemPrompt });
        this._messages.push({ role: 'user', content: userMessage });

        // ---- Main loop --------------------------------------------------------
        while (this._currentIteration < maxIterations) {
            // Requirement 6.4: check stop flag at top of each iteration
            if (this._stopRequested) {
                this._setStatus('stopped');
                return;
            }

            this._currentIteration++;

            // Requirement 6.5: emit step counter
            this.options.onStepUpdate?.(this._currentIteration, maxIterations);

            // Call LLM
            let response;
            try {
                response = await chatWithTools({
                    token,
                    messages: this._messages,
                    model,
                    provider,
                    tools,
                    toolChoice: 'auto',
                });
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                this._setStatus('error');
                this.options.onError?.(error);
                return;
            }

            // Requirement 6.2: no tool_calls → final answer
            if (!response.tool_calls || response.tool_calls.length === 0) {
                this._setStatus('complete');
                this.options.onFinalAnswer?.(response.content ?? '', this._buildSummary(false, false));
                return;
            }

            // Requirement 6.1: execute each tool call, collect results
            const toolResults: ToolResult[] = [];

            for (const toolCall of response.tool_calls) {
                // Requirement 6.4: check stop flag before each tool execution
                if (this._stopRequested) {
                    this._setStatus('stopped');
                    return;
                }

                // Fire onToolCall callback
                this.options.onToolCall?.(toolCall);

                // Execute
                const result = await this._executeTool(toolCall, contextData);

                // Fire onToolResult callback
                this.options.onToolResult?.(result);

                toolResults.push(result);
            }

            // Append assistant message (with tool_calls) + all tool results
            this._messages.push({
                role: 'assistant',
                content: response.content ?? null,
                tool_calls: response.tool_calls,
            });

            for (const result of toolResults) {
                this._messages.push({
                    role: 'tool',
                    tool_call_id: result.tool_call_id,
                    content: result.content,
                });
            }

            // Trim message history to avoid exceeding context window.
            // Always keep: system (index 0) + first user message (index 1) + last 20 messages.
            const KEEP_TAIL = 20;
            if (this._messages.length > 2 + KEEP_TAIL) {
                this._messages = [
                    this._messages[0],
                    this._messages[1],
                    ...this._messages.slice(-KEEP_TAIL),
                ];
            }
        }

        // Requirement 6.3: iteration limit reached
        this._setStatus('error');
        this.options.onError?.(new Error('Iteration limit reached'));
        // Still provide partial summary so caller can display what happened
        this.options.onFinalAnswer?.(
            '',
            this._buildSummary(false, true)
        );
    }

    /**
     * Requests the loop to stop after the current in-flight tool call completes.
     * Requirement 6.4
     */
    stop(): void {
        this._stopRequested = true;
    }

    /**
     * Clears all in-memory state; called by AgentPanel.dispose().
     * Requirement 8.6
     */
    reset(): void {
        this._messages = [];
        this._status = 'idle';
        this._stopRequested = false;
        this._currentIteration = 0;
        this._toolsUsed = [];
        this._filesChanged = [];
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private _setStatus(status: LoopStatus): void {
        this._status = status;
        this.options.onStatusChange?.(status);
    }

    private _buildSummary(stoppedByUser: boolean, hitIterationLimit: boolean): TaskSummary {
        return {
            iterations: this._currentIteration,
            toolsUsed: [...this._toolsUsed],
            filesChanged: [...this._filesChanged],
            stoppedByUser,
            hitIterationLimit,
        };
    }

    /**
     * Builds the system prompt injected at the start of every agent session.
     * Requirement 1.5
     */
    private _buildSystemPrompt(contextData: WorkspaceContextData, tools: ToolDefinition[]): string {
        const {
            workspaceRoot,
            openFilePaths,
            activeFilePath,
            fileTree,
            activeFileContent,
            gitDiff,
        } = contextData;

        const openFilesList =
            openFilePaths.length > 0
                ? openFilePaths.join('\n')
                : '(none)';

        const activeFileSection =
            activeFileContent !== undefined
                ? activeFileContent
                : '(no active file or content exceeds limit)';

        const gitDiffSection = gitDiff ?? '(no git diff available)';

        const toolsJson = JSON.stringify(tools, null, 2);

        return `You are KurdBox Agent, an AI coding assistant with direct access to the user's workspace.

## Workspace
Root: ${workspaceRoot}
Open files: ${openFilesList}
Active file: ${activeFilePath ?? '(none)'}

## File Tree
${fileTree}

## Active File Content
${activeFileSection}

## Git Diff
${gitDiffSection}

## Available Tools
${toolsJson}

## Rules
- Always use relative paths; they will be resolved against the workspace root.
- Before writing or deleting files, the user must approve.
- After completing the task, summarize what you changed.`;
    }

    /**
     * Dispatches a single tool call to the appropriate executor.
     * Handles approval gating for write/delete/command tools.
     * Requirement 6.6: errors are returned as ToolResult, never abort the loop.
     */
    private async _executeTool(
        toolCall: ToolCall,
        contextData: WorkspaceContextData
    ): Promise<ToolResult> {
        const toolName = toolCall.function.name;
        const toolCallId = toolCall.id;

        // Track tool usage for summary
        if (!this._toolsUsed.includes(toolName)) {
            this._toolsUsed.push(toolName);
        }

        // Parse arguments safely
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch {
            return {
                tool_call_id: toolCallId,
                role: 'tool',
                content: `Error: Could not parse tool arguments as JSON: ${toolCall.function.arguments}`,
                isError: true,
            };
        }

        const workspaceRootUri = vscode.Uri.file(contextData.workspaceRoot);
        const onApprovalRequired = this.options.onApprovalRequired;

        let result: ToolResult;

        try {
            switch (toolName) {
                case 'read_file':
                    result = await executeReadFile(
                        args as { path: string },
                        workspaceRootUri,
                        toolCallId
                    );
                    break;

                case 'write_file':
                    result = await executeWriteFile(
                        args as { path: string; content: string },
                        workspaceRootUri,
                        toolCallId,
                        onApprovalRequired
                    );
                    break;

                case 'create_file':
                    result = await executeCreateFile(
                        args as { path: string; content: string },
                        workspaceRootUri,
                        toolCallId
                    );
                    break;

                case 'delete_file':
                    result = await executeDeleteFile(
                        args as { path: string },
                        workspaceRootUri,
                        toolCallId,
                        onApprovalRequired
                    );
                    break;

                case 'list_directory':
                    result = await executeListDirectory(
                        args as { path: string },
                        workspaceRootUri,
                        toolCallId
                    );
                    break;

                case 'run_command':
                    result = await executeRunCommand(
                        args as { command: string },
                        {
                            workspaceRoot: contextData.workspaceRoot,
                            agentModeActive: true,
                            requireConfirmation: this.options.requireCommandConfirmation ?? false,
                            onApprovalRequired,
                            toolCallId,
                        }
                    );
                    break;

                default:
                    result = {
                        tool_call_id: toolCallId,
                        role: 'tool',
                        content: `Error: Unknown tool "${toolName}"`,
                        isError: true,
                    };
            }
        } catch (err) {
            // Requirement 6.6: never abort loop on tool error
            const msg = err instanceof Error ? err.message : String(err);
            result = {
                tool_call_id: toolCallId,
                role: 'tool',
                content: `Error executing tool "${toolName}": ${msg}`,
                isError: true,
            };
        }

        // Track files changed for summary (only successful file mutations)
        if (!result.isError && FILE_MUTATION_TOOLS.has(toolName) && result.affectedPath) {
            if (!this._filesChanged.includes(result.affectedPath)) {
                this._filesChanged.push(result.affectedPath);
            }
        }

        return result;
    }
}
