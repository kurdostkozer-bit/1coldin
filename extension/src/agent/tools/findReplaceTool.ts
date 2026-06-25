/**
 * Find and Replace Tool — intelligent text replacement across multiple files.
 * Supports regex, case sensitivity, and file patterns.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

export async function executeFindReplace(
    args: { 
        query: string; 
        replacement: string; 
        files: string;
        regex?: boolean;
        caseSensitive?: boolean;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        // Parse files parameter (JSON array or comma-separated string)
        let filePaths: string[];
        try {
            filePaths = JSON.parse(args.files);
        } catch {
            filePaths = args.files.split(',').map(f => f.trim());
        }

        if (!filePaths || filePaths.length === 0) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'No files provided',
                isError: true
            };
        }

        const results: any[] = [];
        const regexFlags = args.caseSensitive ? 'g' : 'gi';
        const searchRegex = args.regex ? new RegExp(args.query, regexFlags) : null;
        const searchText = args.caseSensitive ? args.query : args.query.toLowerCase();

        for (const filePath of filePaths) {
            try {
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

                // Perform replacement
                let updatedContent: string;
                let matchCount = 0;

                if (searchRegex) {
                    const matches = content.matchAll(searchRegex);
                    matchCount = Array.from(matches).length;
                    updatedContent = content.replace(searchRegex, args.replacement);
                } else {
                    const searchContent = args.caseSensitive ? content : content.toLowerCase();
                    const matches = searchContent.split(searchText).length - 1;
                    matchCount = matches;
                    
                    if (args.caseSensitive) {
                        updatedContent = content.split(searchText).join(args.replacement);
                    } else {
                        // Case-insensitive replacement - need to preserve original case
                        const regex = new RegExp(escapeRegExp(searchText), 'gi');
                        updatedContent = content.replace(regex, args.replacement);
                    }
                }

                // Write back if changes were made
                if (content !== updatedContent) {
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));
                    results.push({
                        path: filePath,
                        success: true,
                        matches: matchCount,
                        changed: true
                    });
                } else {
                    results.push({
                        path: filePath,
                        success: true,
                        matches: matchCount,
                        changed: false
                    });
                }
            } catch (e: any) {
                results.push({
                    path: filePath,
                    success: false,
                    error: e.message
                });
            }
        }

        const totalMatches = results.reduce((sum, r) => sum + (r.matches || 0), 0);
        const totalChanged = results.filter(r => r.changed).length;

        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                totalFiles: results.length,
                totalMatches,
                filesChanged: totalChanged,
                results
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Error in find-replace: ${e.message}`,
            isError: true
        };
    }
}

// Helper function to escape regex special characters
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const FIND_REPLACE_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'find_replace',
            description: 'Find and replace text across multiple files. Supports regex and case sensitivity. The files parameter should be a JSON string array or comma-separated list of file paths.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The text or regex pattern to search for.'
                    },
                    replacement: {
                        type: 'string',
                        description: 'The replacement text.'
                    },
                    files: {
                        type: 'string',
                        description: 'JSON string array or comma-separated list of file paths to search in.'
                    },
                    regex: {
                        type: 'boolean',
                        description: 'Whether the query is a regex pattern. Default: false'
                    },
                    caseSensitive: {
                        type: 'boolean',
                        description: 'Whether the search should be case sensitive. Default: false'
                    }
                },
                required: ['query', 'replacement', 'files']
            }
        }
    }
];
