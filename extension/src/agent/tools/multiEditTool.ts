/**
 * Multi-Edit Tool — performs multiple file edits in a single operation.
 * Supports text replacement across multiple files with approval for mutations.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult, ApprovalRequest } from '../../api/types';

interface EditOperation {
    path: string;
    old: string;
    new: string;
}

export async function executeMultiEdit(
    args: { edits: string },
    root: vscode.Uri,
    callId: string,
    onApproval?: (req: ApprovalRequest) => Promise<boolean>
): Promise<ToolResult> {
    try {
        // Parse JSON string
        let edits: EditOperation[];
        try {
            edits = JSON.parse(args.edits);
        } catch (e) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'Invalid JSON format for edits parameter',
                isError: true
            };
        }

        if (!edits || edits.length === 0) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'No edits provided',
                isError: true
            };
        }

        const results: any[] = [];
        const mutationEdits = edits.filter(edit => edit.old !== edit.new);

        // Request approval if there are mutation edits
        if (mutationEdits.length > 0 && onApproval) {
            const ok = await onApproval({
                type: 'multi_edit',
                toolCallId: callId,
                path: mutationEdits.map(e => e.path).join(', '),
                diff: `Editing ${mutationEdits.length} files`
            });
            if (!ok) {
                return {
                    tool_call_id: callId,
                    role: 'tool',
                    content: 'Multi-edit rejected by user',
                    isError: true
                };
            }
        }

        // Process each edit
        for (const edit of edits) {
            try {
                const filePath = edit.path;
                const fileUri = vscode.Uri.file(filePath);

                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(fileUri);
                } catch {
                    results.push({
                        path: filePath,
                        success: false,
                        error: 'File not found'
                    });
                    continue;
                }

                // Read file content
                const contentBytes = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(contentBytes).toString('utf8');

                // Check if old string exists
                if (!content.includes(edit.old)) {
                    results.push({
                        path: filePath,
                        success: false,
                        error: 'Old string not found in file'
                    });
                    continue;
                }

                // Replace old with new
                const updatedContent = content.replace(edit.old, edit.new);

                // Write back
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));

                results.push({
                    path: filePath,
                    success: true,
                    changes: content !== updatedContent
                });
            } catch (e: any) {
                results.push({
                    path: edit.path,
                    success: false,
                    error: e.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;

        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                total: results.length,
                successful: successCount,
                failed: failureCount,
                results
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Error in multi-edit: ${e.message}`,
            isError: true
        };
    }
}

export const MULTI_EDIT_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'multi_edit',
            description: 'Perform multiple file edits in a single operation. Each edit replaces an old string with a new string in a specific file. Requires user approval for mutations. The edits parameter should be a JSON string array of edit objects.',
            parameters: {
                type: 'object',
                properties: {
                    edits: {
                        type: 'string',
                        description: 'JSON string array of edit objects. Each object has: path (string), old (string), new (string). Example: [{"path":"file.ts","old":"old text","new":"new text"}]'
                    }
                },
                required: ['edits']
            }
        }
    }
];
