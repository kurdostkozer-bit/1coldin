/**
 * Test Runner Tool — runs tests using various testing frameworks.
 * Supports Jest, pytest, and go test.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';
import { executeRunCommand } from './terminalTool';

export async function executeTests(
    args: { 
        framework: 'jest' | 'pytest' | 'go test' | 'npm test';
        path?: string;
        pattern?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        let command: string;
        
        switch (args.framework) {
            case 'jest':
                command = 'npx jest';
                if (args.path) {
                    command += ` ${args.path}`;
                }
                if (args.pattern) {
                    command += ` --testNamePattern="${args.pattern}"`;
                }
                command += ' --no-coverage';
                break;

            case 'pytest':
                command = 'python -m pytest';
                if (args.path) {
                    command += ` ${args.path}`;
                }
                if (args.pattern) {
                    command += ` -k "${args.pattern}"`;
                }
                command += ' -v';
                break;

            case 'go test':
                command = 'go test';
                if (args.path) {
                    command += ` ${args.path}`;
                }
                if (args.pattern) {
                    command += ` -run "${args.pattern}"`;
                }
                command += ' -v';
                break;

            case 'npm test':
                command = 'npm test';
                if (args.path) {
                    command += ` -- ${args.path}`;
                }
                break;

            default:
                return {
                    tool_call_id: callId,
                    role: 'tool',
                    content: `Unsupported test framework: ${args.framework}. Supported: jest, pytest, go test, npm test`,
                    isError: true
                };
        }

        // Execute the test command using terminal tool
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
            content: `Test execution error: ${e.message}`,
            isError: true
        };
    }
}

export const TEST_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'run_tests',
            description: 'Run tests using various testing frameworks. Supports Jest, pytest, go test, and npm test.',
            parameters: {
                type: 'object',
                properties: {
                    framework: {
                        type: 'string',
                        description: 'Testing framework: jest, pytest, go test, or npm test'
                    },
                    path: {
                        type: 'string',
                        description: 'Optional path to specific test file or directory'
                    },
                    pattern: {
                        type: 'string',
                        description: 'Optional pattern to filter tests (e.g., test name pattern)'
                    }
                },
                required: ['framework']
            }
        }
    }
];
