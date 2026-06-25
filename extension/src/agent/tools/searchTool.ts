/**
 * Search Tool — advanced code search using file system API.
 * Supports regex, case sensitivity, and file patterns.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';
import { resolveSecurePath } from '../../security/PathSecurity';

export async function executeSearch(
    args: { 
        query: string; 
        pattern?: string; 
        caseSensitive?: boolean;
        regex?: boolean;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const searchPattern = args.pattern || '**';
        const includePattern = new vscode.RelativePattern(root.fsPath, searchPattern);
        
        // Find all matching files
        const files = await vscode.workspace.findFiles(includePattern, '**/node_modules/**', 100);
        
        const results: any[] = [];
        const regexFlags = args.caseSensitive ? 'g' : 'gi';
        const searchRegex = args.regex ? new RegExp(args.query, regexFlags) : null;
        const searchText = args.caseSensitive ? args.query : args.query.toLowerCase();
        
        for (const file of files) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(content).toString('utf8');
                const lines = text.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const searchLine = args.caseSensitive ? line : line.toLowerCase();
                    
                    let match = false;
                    if (searchRegex) {
                        match = searchRegex.test(line);
                    } else {
                        match = searchLine.includes(searchText);
                    }
                    
                    if (match) {
                        results.push({
                            file: file.fsPath,
                            line: i,
                            text: line.trim()
                        });
                        
                        // Limit results to avoid overwhelming response
                        if (results.length >= 100) {
                            break;
                        }
                    }
                }
                
                if (results.length >= 100) {
                    break;
                }
            } catch (e) {
                // Skip files that can't be read
                continue;
            }
        }

        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                count: results.length,
                results: results,
                truncated: results.length >= 100
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Error searching: ${e.message}`,
            isError: true
        };
    }
}

export const SEARCH_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'search',
            description: 'Search for text patterns across files in the workspace. Supports regex and case sensitivity.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The text or regex pattern to search for.'
                    },
                    pattern: {
                        type: 'string',
                        description: 'File pattern (e.g., "**/*.ts", "src/**/*.py"). Default: "**"'
                    },
                    caseSensitive: {
                        type: 'boolean',
                        description: 'Whether the search should be case sensitive. Default: false'
                    },
                    regex: {
                        type: 'boolean',
                        description: 'Whether the query is a regex pattern. Default: false'
                    }
                },
                required: ['query']
            }
        }
    }
];
