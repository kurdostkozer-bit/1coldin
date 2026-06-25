/**
 * HTTP Request Tool — makes HTTP requests to external APIs.
 * Supports GET, POST, PUT, DELETE methods with custom headers and body.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Use VSCode's fetch API (available in extension host environment)
// node-fetch doesn't work in VSCode extension environment

export async function executeHttpRequest(
    args: { 
        url: string; 
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        headers?: string;
        body?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const method = args.method || 'GET';
        const headers = args.headers ? JSON.parse(args.headers) : {};
        const body = args.body;

        // Validate URL
        if (!args.url || !args.url.startsWith('http://') && !args.url.startsWith('https://')) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'Invalid URL. Must start with http:// or https://',
                isError: true
            };
        }

        const response = await fetch(args.url, {
            method,
            headers,
            body: body ? body : undefined,
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value: any, key: any) => {
            responseHeaders[key] = value;
        });

        const text = await response.text();
        
        // Try to parse as JSON, fallback to text
        let responseBody: any;
        try {
            responseBody = JSON.parse(text);
        } catch {
            responseBody = text;
        }

        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body: responseBody
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `HTTP request error: ${e.message}`,
            isError: true
        };
    }
}

export const HTTP_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'http_request',
            description: 'Make HTTP requests to external APIs. Supports GET, POST, PUT, DELETE methods with custom headers and body. The headers and body parameters should be JSON strings.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to request. Must start with http:// or https://'
                    },
                    method: {
                        type: 'string',
                        description: 'HTTP method: GET, POST, PUT, or DELETE. Default: GET'
                    },
                    headers: {
                        type: 'string',
                        description: 'JSON string of headers. Example: {"Content-Type": "application/json"}'
                    },
                    body: {
                        type: 'string',
                        description: 'Request body (for POST/PUT requests)'
                    }
                },
                required: ['url']
            }
        }
    }
];
