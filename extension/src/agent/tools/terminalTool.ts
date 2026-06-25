/**
 * Terminal tool — execute shell commands in workspace root.
 * 30s timeout, 50KB output cap.
 */

import { exec } from 'child_process';
import { ToolDefinition, ToolResult, ApprovalRequest } from '../../api/types';

const MAX_OUTPUT_BYTES = 50 * 1024;
const TIMEOUT_MS = 30000;

export function applyOutputCap(output: string, limit = MAX_OUTPUT_BYTES): string {
    if (Buffer.byteLength(output, 'utf8') <= limit) { return output; }
    return Buffer.from(output, 'utf8').slice(0, limit).toString('utf8') + '\n[output truncated: exceeded 50 KB limit]';
}

export async function executeRunCommand(
    args: { command: string },
    options: {
        workspaceRoot: string;
        agentModeActive: boolean;
        requireConfirmation: boolean;
        onApprovalRequired?: (req: ApprovalRequest) => Promise<boolean>;
        toolCallId: string;
    }
): Promise<ToolResult> {
    const { command } = args;
    const { workspaceRoot, agentModeActive, requireConfirmation, onApprovalRequired, toolCallId } = options;

    if (!agentModeActive) {
        return { tool_call_id: toolCallId, role: 'tool', content: 'Error: agent mode inactive', isError: true };
    }
    if (requireConfirmation) {
        const ok = onApprovalRequired
            ? await onApprovalRequired({ type: 'run_command', toolCallId, command })
            : false;
        if (!ok) {
            return { tool_call_id: toolCallId, role: 'tool', content: `Command rejected: ${command}`, isError: true };
        }
    }
    return new Promise<ToolResult>((resolve) => {
        exec(command, { cwd: workspaceRoot, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
            if (error?.killed) {
                resolve({ tool_call_id: toolCallId, role: 'tool', content: `Timed out after 30s: ${command}`, isError: true });
                return;
            }
            resolve({
                tool_call_id: toolCallId, role: 'tool',
                content: applyOutputCap((stdout || '') + (stderr || '')),
                isError: !!(error && !error.killed),
            });
        });
    });
}

export const TERMINAL_TOOL_DEFINITION: ToolDefinition = {
    type: 'function',
    function: {
        name: 'run_command',
        description: 'Execute a shell command in the workspace root. 30s timeout, 50KB output cap.',
        parameters: {
            type: 'object',
            properties: { command: { type: 'string', description: 'Shell command to execute.' } },
            required: ['command'],
        },
    },
};
