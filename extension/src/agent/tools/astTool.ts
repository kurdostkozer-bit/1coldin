/**
 * AST Analysis Tool — analyzes code structure using TypeScript Compiler API.
 * Supports TypeScript and JavaScript files.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Conditionally import typescript - if not available, the tool will return an error
let ts: any = null;
try {
    ts = require('typescript');
} catch (e) {
    // TypeScript not available
}

interface FunctionInfo {
    name: string;
    line: number;
    parameters: string[];
    returnType?: string;
}

interface ClassInfo {
    name: string;
    line: number;
    methods: FunctionInfo[];
    properties: string[];
}

interface ASTAnalysisResult {
    file: string;
    language: string;
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports: string[];
    exports: string[];
}

function detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'js':
        case 'jsx':
            return 'javascript';
        default:
            return 'unknown';
    }
}

export async function analyzeAST(
    args: { path: string },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        if (!ts) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'TypeScript library is not available. AST analysis requires TypeScript to be installed.',
                isError: true
            };
        }

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
        
        if (language !== 'typescript' && language !== 'javascript') {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: `AST analysis not supported for language: ${language}. Only TypeScript and JavaScript are supported.`,
                isError: true
            };
        }
        
        // Parse using TypeScript Compiler API
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );
        
        const result: ASTAnalysisResult = {
            file: filePath,
            language,
            functions: [],
            classes: [],
            imports: [],
            exports: []
        };
        
        // Traverse AST
        function visit(node: any) {
            // Extract functions
            if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
                const name = ts.isFunctionDeclaration(node) && node.name ? node.name.getText() : 'anonymous';
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                const parameters = node.parameters.map((p: any) => p.name.getText());
                const returnType = node.type ? node.type.getText() : undefined;
                
                result.functions.push({ name, line, parameters, returnType });
            }
            
            // Extract classes
            if (ts.isClassDeclaration(node) && node.name) {
                const className = node.name.getText();
                const classLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                const methods: FunctionInfo[] = [];
                const properties: string[] = [];
                
                node.members.forEach((member: any) => {
                    if (ts.isMethodDeclaration(member)) {
                        const methodName = member.name?.getText() || 'anonymous';
                        const methodLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
                        const params = member.parameters.map((p: any) => p.name.getText());
                        const returnType = member.type ? member.type.getText() : undefined;
                        methods.push({ name: methodName, line: methodLine, parameters: params, returnType });
                    } else if (ts.isPropertyDeclaration(member)) {
                        const propName = member.name?.getText() || '';
                        properties.push(propName);
                    }
                });
                
                result.classes.push({ name: className, line: classLine, methods, properties });
            }
            
            // Extract imports
            if (ts.isImportDeclaration(node)) {
                const importText = node.moduleSpecifier.getText();
                result.imports.push(importText.replace(/['"]/g, ''));
            }
            
            // Extract exports
            if (ts.isExportDeclaration(node)) {
                const exportText = node.moduleSpecifier?.getText() || '';
                if (exportText) {
                    result.exports.push(exportText.replace(/['"]/g, ''));
                }
            }
            
            ts.forEachChild(node, visit);
        }
        
        visit(sourceFile);
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify(result, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Error analyzing AST: ${e.message}`,
            isError: true
        };
    }
}

export const AST_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'analyze_ast',
            description: 'Analyze the Abstract Syntax Tree (AST) of a TypeScript or JavaScript file to extract functions, classes, imports, and exports.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the TypeScript or JavaScript file to analyze.'
                    }
                },
                required: ['path']
            }
        }
    }
];
