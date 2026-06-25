/**
 * FileSystem tools — read/write/create/delete/list.
 * Uses resolveSecurePath from PathSecurity (single source).
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult, ApprovalRequest } from '../../api/types';
import { resolveSecurePath } from '../../security/PathSecurity';

export async function executeReadFile(
    args: { path: string }, root: vscode.Uri, callId: string
): Promise<ToolResult> {
    let resolved: vscode.Uri;
    try { resolved = resolveSecurePath(args.path, root); }
    catch (e: any) { return { tool_call_id: callId, role: 'tool', content: `Security error: ${e.message}`, isError: true }; }
    try {
        const bytes = await vscode.workspace.fs.readFile(resolved);
        return { tool_call_id: callId, role: 'tool', content: Buffer.from(bytes).toString('utf8'), isError: false, affectedPath: resolved.fsPath };
    } catch (e: any) {
        const notFound = (e as any).code === 'FileNotFound';
        return { tool_call_id: callId, role: 'tool', content: notFound ? `File not found: "${args.path}"` : `Error reading: ${e.message}`, isError: true };
    }
}

export async function executeWriteFile(
    args: { path: string; content: string }, root: vscode.Uri, callId: string,
    onApproval?: (req: ApprovalRequest) => Promise<boolean>
): Promise<ToolResult> {
    let resolved: vscode.Uri;
    try { resolved = resolveSecurePath(args.path, root); }
    catch (e: any) { return { tool_call_id: callId, role: 'tool', content: `Security error: ${e.message}`, isError: true }; }
    if (onApproval) {
        const ok = await onApproval({ type: 'write_file', toolCallId: callId, path: resolved.fsPath, content: args.content });
        if (!ok) { return { tool_call_id: callId, role: 'tool', content: `Write rejected by user`, isError: true }; }
    }
    try {
        await vscode.workspace.fs.writeFile(resolved, Buffer.from(args.content, 'utf8'));
        return { tool_call_id: callId, role: 'tool', content: `File "${args.path}" written.`, isError: false, affectedPath: resolved.fsPath };
    } catch (e: any) {
        return { tool_call_id: callId, role: 'tool', content: `Error writing: ${e.message}`, isError: true };
    }
}

export async function executeCreateFile(
    args: { path: string; content: string }, root: vscode.Uri, callId: string
): Promise<ToolResult> {
    let resolved: vscode.Uri;
    try { resolved = resolveSecurePath(args.path, root); }
    catch (e: any) { return { tool_call_id: callId, role: 'tool', content: `Security error: ${e.message}`, isError: true }; }
    try {
        await vscode.workspace.fs.stat(resolved);
        return { tool_call_id: callId, role: 'tool', content: `File already exists: "${args.path}". Use write_file to overwrite.`, isError: true };
    } catch (e: any) {
        if ((e as any).code !== 'FileNotFound') {
            return { tool_call_id: callId, role: 'tool', content: `Error checking file: ${e.message}`, isError: true };
        }
    }
    try {
        await vscode.workspace.fs.writeFile(resolved, Buffer.from(args.content, 'utf8'));
        return { tool_call_id: callId, role: 'tool', content: `File "${args.path}" created.`, isError: false, affectedPath: resolved.fsPath };
    } catch (e: any) {
        return { tool_call_id: callId, role: 'tool', content: `Error creating: ${e.message}`, isError: true };
    }
}

export async function executeDeleteFile(
    args: { path: string }, root: vscode.Uri, callId: string,
    onApproval?: (req: ApprovalRequest) => Promise<boolean>
): Promise<ToolResult> {
    let resolved: vscode.Uri;
    try { resolved = resolveSecurePath(args.path, root); }
    catch (e: any) { return { tool_call_id: callId, role: 'tool', content: `Security error: ${e.message}`, isError: true }; }
    if (onApproval) {
        const ok = await onApproval({ type: 'delete_file', toolCallId: callId, path: resolved.fsPath });
        if (!ok) { return { tool_call_id: callId, role: 'tool', content: `Delete rejected by user`, isError: true }; }
    }
    try {
        await vscode.workspace.fs.delete(resolved, { useTrash: false });
        return { tool_call_id: callId, role: 'tool', content: `File "${args.path}" deleted.`, isError: false, affectedPath: resolved.fsPath };
    } catch (e: any) {
        const notFound = (e as any).code === 'FileNotFound';
        return { tool_call_id: callId, role: 'tool', content: notFound ? `File not found: "${args.path}"` : `Error deleting: ${e.message}`, isError: true };
    }
}

export async function executeListDirectory(
    args: { path: string }, root: vscode.Uri, callId: string
): Promise<ToolResult> {
    let resolved: vscode.Uri;
    try { resolved = resolveSecurePath(args.path, root); }
    catch (e: any) { return { tool_call_id: callId, role: 'tool', content: `Security error: ${e.message}`, isError: true }; }
    try {
        const entries = await vscode.workspace.fs.readDirectory(resolved);
        const lines = entries.map(([name, type]) => {
            const label = type === vscode.FileType.Directory ? 'dir' : type === vscode.FileType.File ? 'file' : 'other';
            return `${label}  ${name}`;
        });
        return { tool_call_id: callId, role: 'tool', content: lines.length ? lines.join('\n') : '(empty directory)', isError: false, affectedPath: resolved.fsPath };
    } catch (e: any) {
        const notFound = (e as any).code === 'FileNotFound';
        return { tool_call_id: callId, role: 'tool', content: notFound ? `Directory not found: "${args.path}"` : `Error listing: ${e.message}`, isError: true };
    }
}

export const FILE_SYSTEM_TOOL_DEFINITIONS: ToolDefinition[] = [
    { type: 'function', function: { name: 'read_file', description: 'Read the UTF-8 content of a file in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path from workspace root.' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Write (overwrite) a file. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path.' }, content: { type: 'string', description: 'Full UTF-8 content.' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'create_file', description: 'Create a new file. Fails if file already exists.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path.' }, content: { type: 'string', description: 'Initial content.' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path.' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_directory', description: 'List entries in a directory.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path. Use "." for root.' } }, required: ['path'] } } },
];
