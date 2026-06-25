/**
 * Shared agent types for kurdbox-agent.
 * All tool execution and loop code imports from this single file.
 * Requirements: 7.1, 7.2, 7.3
 */

// ---------------------------------------------------------------------------
// Tool schema types (sent to LLM as JSON Schema)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool call / result types (OpenAI function-calling format)
// ---------------------------------------------------------------------------

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

export interface ToolResult {
    tool_call_id: string;
    role: 'tool';
    content: string;        // JSON string or plain text result
    isError: boolean;
    affectedPath?: string;  // absolute path, if a file was touched
}

// ---------------------------------------------------------------------------
// OpenAI message union type (conversation history format)
// ---------------------------------------------------------------------------

export type OpenAIMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

// ---------------------------------------------------------------------------
// Approval gate
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
    type: 'write_file' | 'delete_file' | 'run_command' | 'multi_edit';
    toolCallId: string;
    path?: string;
    content?: string;
    diff?: string;
    command?: string;
}

// ---------------------------------------------------------------------------
// Task summary (reported at end of loop)
// ---------------------------------------------------------------------------

export interface TaskSummary {
    iterations: number;
    toolsUsed: string[];
    filesChanged: string[];
    stoppedByUser: boolean;
    hitIterationLimit: boolean;
}

// ---------------------------------------------------------------------------
// Loop status
// ---------------------------------------------------------------------------

export type LoopStatus = 'idle' | 'running' | 'stopped' | 'complete' | 'error';

// ---------------------------------------------------------------------------
// Agent loop configuration
// ---------------------------------------------------------------------------

export interface AgentLoopOptions {
    maxIterations?: number;               // default 20
    requireCommandConfirmation?: boolean;
    onStepUpdate?: (step: number, max: number) => void;
    onToolCall?: (call: ToolCall) => void;
    onToolResult?: (result: ToolResult) => void;
    onApprovalRequired?: (request: ApprovalRequest) => Promise<boolean>;
    onFinalAnswer?: (text: string, summary: TaskSummary) => void;
    onError?: (error: Error) => void;
    onStatusChange?: (status: LoopStatus) => void;
}

// ---------------------------------------------------------------------------
// Workspace context
// ---------------------------------------------------------------------------

export interface WorkspaceContextData {
    workspaceRoot: string;
    fileTree: string;           // ASCII tree, max 3 levels / 200 entries
    activeFileContent?: string; // max 100 KB
    activeFilePath?: string;
    openFilePaths: string[];
    gitDiff?: string;           // max 10 KB
}

// ---------------------------------------------------------------------------
// KurdostClient extension types (chatWithTools)
// ---------------------------------------------------------------------------

export interface ChatWithToolsOptions {
    token: string;
    messages: OpenAIMessage[];
    model: string;
    provider?: string;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'none';
}

export interface LLMToolResponse {
    content: string | null;
    tool_calls?: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

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
