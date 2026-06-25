/**
 * Dependency Analysis Tool — analyzes imports/requires in code files.
 * Supports TypeScript, JavaScript, Python, and Go.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

interface ImportPattern {
    pattern: RegExp;
    language: string;
}

const IMPORT_PATTERNS: ImportPattern[] = [
    // TypeScript/JavaScript
    { pattern: /import\s+.*?from\s+['"]([^'"]+)['"]/g, language: 'typescript' },
    { pattern: /import\s+['"]([^'"]+)['"]/g, language: 'typescript' },
    { pattern: /require\(['"]([^'"]+)['"]\)/g, language: 'javascript' },
    // Python
    { pattern: /from\s+([^\s]+)\s+import/g, language: 'python' },
    { pattern: /import\s+([^\s]+)/g, language: 'python' },
    // Go
    { pattern: /"([^"]+)"/g, language: 'go' },
];

function detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'js':
        case 'jsx':
            return 'javascript';
        case 'py':
            return 'python';
        case 'go':
            return 'go';
        default:
            return 'unknown';
    }
}

function extractImports(content: string, language: string): string[] {
    const imports: Set<string> = new Set();
    
    for (const { pattern, language: lang } of IMPORT_PATTERNS) {
        if (lang === language || lang === 'typescript' && language === 'javascript') {
            let match;
            const regex = new RegExp(pattern.source, pattern.flags);
            while ((match = regex.exec(content)) !== null) {
                if (match[1]) {
                    imports.add(match[1]);
                }
            }
        }
    }
    
    return Array.from(imports);
}

export async function analyzeDependencies(
    args: { path: string },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const filePath = args.path;
        const fileUri = vscode.Uri.file(filePath);
        
        // Check if file exists
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: `File not found: "${filePath}"`,
                isError: true
            };
        }
        
        // Read file content
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf8');
        
        // Detect language
        const language = detectLanguage(filePath);
        
        // Extract imports
        const imports = extractImports(content, language);
        
        // Categorize imports
        const externalImports: string[] = [];
        const localImports: string[] = [];
        const nodeModules: string[] = [];
        
        for (const imp of imports) {
            if (imp.startsWith('node:') || imp.startsWith('@types/')) {
                externalImports.push(imp);
            } else if (imp.startsWith('.')) {
                localImports.push(imp);
            } else if (imp.includes('/') || imp.includes('\\')) {
                // Could be local or external
                if (imp.startsWith('@') || /^[a-z]/.test(imp)) {
                    externalImports.push(imp);
                } else {
                    localImports.push(imp);
                }
            } else {
                externalImports.push(imp);
            }
        }
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                file: filePath,
                language,
                totalImports: imports.length,
                externalImports,
                localImports,
                allImports: imports
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Error analyzing dependencies: ${e.message}`,
            isError: true
        };
    }
}

export const DEPENDENCY_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'analyze_dependencies',
            description: 'Analyze imports and dependencies in a code file. Supports TypeScript, JavaScript, Python, and Go.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file to analyze.'
                    }
                },
                required: ['path']
            }
        }
    }
];
