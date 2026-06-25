/**
 * Context-Aware Suggestions Tool — provides intelligent suggestions based on workspace analysis and memory.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';
import { retrieveMemory } from './memoryTool';

export async function getContextSuggestions(
    args: { 
        task: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        // Retrieve relevant memories
        const memoryResult = await retrieveMemory({}, root, callId);
        let memories: any[] = [];
        
        try {
            const memoryData = JSON.parse(memoryResult.content);
            memories = memoryData.memories || [];
        } catch {
            memories = [];
        }
        
        // Analyze task to provide context-aware suggestions
        const suggestions: string[] = [];
        
        // Suggest using memory if relevant memories exist
        if (memories.length > 0) {
            suggestions.push(`Found ${memories.length} stored memories. Consider retrieving relevant memories using retrieve_memory with appropriate tags or keys.`);
        }
        
        // Suggest based on task keywords
        const taskLower = args.task.toLowerCase();
        
        if (taskLower.includes('test') || taskLower.includes('testing')) {
            suggestions.push('Consider using run_tests to verify your changes work correctly.');
        }
        
        if (taskLower.includes('fix') || taskLower.includes('bug') || taskLower.includes('error')) {
            suggestions.push('Use search to find related code and analyze_ast to understand the structure before fixing.');
            suggestions.push('After fixing, use run_lint to check code quality.');
        }
        
        if (taskLower.includes('refactor') || taskLower.includes('optimize')) {
            suggestions.push('Use analyze_dependencies to understand module relationships before refactoring.');
            suggestions.push('Use multi_edit for making multiple related changes efficiently.');
        }
        
        if (taskLower.includes('api') || taskLower.includes('http') || taskLower.includes('fetch')) {
            suggestions.push('Use http_request to test API endpoints.');
        }
        
        if (taskLower.includes('database') || taskLower.includes('sql') || taskLower.includes('query')) {
            suggestions.push('Use database_query to interact with databases.');
        }
        
        if (taskLower.includes('style') || taskLower.includes('format') || taskLower.includes('lint')) {
            suggestions.push('Use run_lint to check and fix code style issues.');
        }
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                task: args.task,
                suggestions,
                memoryCount: memories.length
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Context suggestions error: ${e.message}`,
            isError: true
        };
    }
}

export const CONTEXT_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'get_context_suggestions',
            description: 'Get context-aware suggestions based on the current task and available tools. Helps identify which tools to use and provides relevant workflow guidance.',
            parameters: {
                type: 'object',
                properties: {
                    task: {
                        type: 'string',
                        description: 'The task or problem description'
                    }
                },
                required: ['task']
            }
        }
    }
];
