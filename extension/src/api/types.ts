/**
 * Shared TypeScript types for KurdBox VSCode Extension.
 * Single source of truth — all modules import from here.
 */

// ── Provider ──────────────────────────────────────────────────────────────────

export interface Provider {
    id: string;
    name: string;
    models: string[];
    status: 'active' | 'limited' | 'cooldown' | 'inactive';
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ChatRequest {
    model: string;
    messages: ChatMessage[] | OpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    provider_hint?: string;
    strategy?: string;
    stream?: boolean;
    tools?: ToolDefinition[];
    tool_choice?: string;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, { type: string; description: string }>;
            required: string[];
        };
    };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface ToolResult {
    tool_call_id: string;
    role: 'tool';
    content: string;
    isError: boolean;
    affectedPath?: string;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export type AgentEventType =
    | 'step_update'
    | 'tool_call'
    | 'tool_result'
    | 'approval_required'
    | 'final_answer'
    | 'task_summary'
    | 'error'
    | 'stopped';

export interface AgentEvent {
    type: AgentEventType;
    [key: string]: unknown;
}

export interface ApprovalRequest {
    type: 'write_file' | 'delete_file' | 'run_command' | 'multi_edit';
    toolCallId: string;
    path?: string;
    content?: string;
    diff?: string;
    command?: string;
}

export interface TaskSummary {
    iterations: number;
    toolsUsed: string[];
    filesChanged: string[];
    stoppedByUser: boolean;
    hitIterationLimit: boolean;
}

// ── UI Messages ───────────────────────────────────────────────────────────────

export type UiMessage =
    | { type: 'send'; text: string; model: string; provider: string; stream: boolean }
    | { type: 'agentRun'; text: string; model: string; provider: string }
    | { type: 'agentToggle' }
    | { type: 'approve'; callId: string; approved: boolean }
    | { type: 'stopLoop' }
    | { type: 'clear' }
    | { type: 'ready' }
    | { type: 'debug'; text: string }
    | { type: 'providers'; data: Provider[] }
    | { type: 'renderChat'; messages: Array<{ role: 'user' | 'assistant' | 'error'; text: string }>; thinking?: boolean }
    | { type: 'streamStart' }
    | { type: 'streamChunk'; chunk: string }
    | { type: 'streamEnd' }
    | { type: 'streamFailed' }
    | { type: 'requestEnd' }
    | { type: 'stepUpdate'; step: number; max: number }
    | { type: 'toolCallLog'; name: string; args: unknown; status: 'pending' | 'done' | 'error' }
    | { type: 'approvalRequest'; reqType: string; path?: string; command?: string; diff?: string; callId: string }
    | { type: 'getHistory' }
    | { type: 'historyData'; data: any[] }
    | { type: 'loadConversation'; id: string }
    | { type: 'deleteConversation'; id: string }
    | { type: 'clearHistory' }
    | { type: 'finalAnswer'; text: string }
    | { type: 'taskSummary'; iterations: number; toolsUsed: string[]; filesChanged: string[] }
    | { type: 'agentModeChange'; active: boolean; workspaceRoot: string }
    | { type: 'loopStopped' }
    | { type: 'agentError'; message: string }
    | { type: 'error'; text: string }
    | { type: 'debugInject'; text: string }
    | { type: 'login'; username: string; password: string }
    | { type: 'register'; username: string; password: string }
    | { type: 'addProviderKey'; provider: string; apiKey: string }
    | { type: 'logout' }
    | { type: 'authStatus'; loggedIn: boolean; username?: string; isAdmin?: boolean }
    | { type: 'authError'; message: string }
    | { type: 'authSuccess'; username: string; isAdmin: boolean }
    | { type: 'setupComplete' }
    | { type: 'supportedProviders'; data: Array<{ id: string; name: string; key_hint: string }> }
    | { type: 'keyAdded'; provider: string }
    | { type: 'keyError'; message: string };

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceContextData {
    workspaceRoot: string;
    fileTree: string;
    activeFileContent?: string;
    activeFilePath?: string;
    openFilePaths: string[];
    gitDiff?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecurityError';
    }
}

export class NoWorkspaceError extends Error {
    constructor() {
        super('No workspace folder is open');
        this.name = 'NoWorkspaceError';
    }
}

// ── OpenAI message format (used by AgentController) ──────────────────────────

export type OpenAIMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };
