/**
 * Linting Tool — runs code quality checks using various linters.
 * Supports ESLint, Pylint, and GoLint.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';
import { executeRunCommand } from './terminalTool';

export async function executeLint(
    args: { 
        tool: 'eslint' | 'pylint' | 'golint' | 'flake8' | 'ruff';
        path?: string;
        fix?: boolean;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        let command: string;
        
        switch (args.tool) {
            case 'eslint':
                command = 'npx eslint';
                if (args.fix) {
                    command += ' --fix';
                }
                if (args.path) {
                    command += ` ${args.path}`;
                } else {
                    command += ' .';
                }
                command += ' --format json';
                break;

            case 'pylint':
                command = 'pylint';
                if (args.path) {
                    command += ` ${args.path}`;
                } else {
                    command += ' .';
                }
                command += ' --output-format json';
                break;

            case 'golint':
                command = 'golint';
                if (args.path) {
                    command += ` ${args.path}`;
                } else {
                    command += ' ./...';
                }
                break;

            case 'flake8':
                command = 'flake8';
                if (args.path) {
                    command += ` ${args.path}`;
                } else {
                    command += ' .';
                }
                command += ' --format json';
                break;

            case 'ruff':
                command = 'ruff check';
                if (args.fix) {
                    command += ' --fix';
                }
                if (args.path) {
                    command += ` ${args.path}`;
                } else {
                    command += ' .';
                }
                command += ' --output-format json';
                break;

            default:
                return {
                    tool_call_id: callId,
                    role: 'tool',
                    content: `Unsupported linting tool: ${args.tool}. Supported: eslint, pylint, golint, flake8, ruff`,
                    isError: true
                };
        }

        // Execute the lint command using terminal tool
        const result = await executeRunCommand(
            { command },
            {
                workspaceRoot: root.fsPath,
                agentModeActive: true,
                requireConfirmation: false,
                onApprovalRequired: async () => true,
                toolCallId: callId
            }
        );

        return result;
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Linting error: ${e.message}`,
            isError: true
        };
    }
}

export const LINT_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'run_lint',
            description: 'Run code quality checks using various linting tools. Supports ESLint, Pylint, GoLint, Flake8, and Ruff.',
            parameters: {
                type: 'object',
                properties: {
                    tool: {
                        type: 'string',
                        description: 'Linting tool: eslint, pylint, golint, flake8, or ruff'
                    },
                    path: {
                        type: 'string',
                        description: 'Optional path to specific file or directory to lint'
                    },
                    fix: {
                        type: 'boolean',
                        description: 'Whether to automatically fix issues (for eslint and ruff). Default: false'
                    }
                },
                required: ['tool']
            }
        }
    }
];
