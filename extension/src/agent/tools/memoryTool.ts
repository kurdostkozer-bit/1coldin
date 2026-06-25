/**
 * Memory System Tool — stores and retrieves contextual information.
 * Uses LowDB for persistent local storage.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Conditionally import lowdb and uuid
let Low: any = null;
let JSONFile: any = null;
let uuidv4: any = null;

try {
    const lowdb = require('lowdb');
    Low = lowdb.Low;
    JSONFile = lowdb.JSONFile;
} catch (e) {
    // lowdb not available
}

try {
    uuidv4 = require('uuid').v4;
} catch (e) {
    // uuid not available
}

interface MemoryItem {
    id: string;
    key: string;
    value: string;
    tags: string[];
    timestamp: number;
}

interface MemoryData {
    memories: MemoryItem[];
}

// In-memory database instance (per session)
let db: any = null;
const DB_PATH = '.kurdbox-memory.json';

function getDatabase(): any {
    if (!db) {
        const adapter = new JSONFile(DB_PATH);
        db = new Low(adapter, { memories: [] });
    }
    return db;
}

export async function saveMemory(
    args: {
        key: string;
        value: string;
        tags?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        if (!Low || !JSONFile || !uuidv4) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'Memory system libraries (lowdb, uuid) are not available',
                isError: true
            };
        }

        const database = getDatabase();
        await database.read();

        const tags = args.tags ? args.tags.split(',').map(t => t.trim()) : [];
        const memoryItem: MemoryItem = {
            id: uuidv4(),
            key: args.key,
            value: args.value,
            tags,
            timestamp: Date.now()
        };
        
        database.data.memories.push(memoryItem);
        await database.write();
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                success: true,
                id: memoryItem.id,
                key: memoryItem.key,
                tags: memoryItem.tags
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Memory save error: ${e.message}`,
            isError: true
        };
    }
}

export async function retrieveMemory(
    args: { 
        key?: string;
        tags?: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const database = getDatabase();
        await database.read();
        
        let memories = database.data.memories;
        
        // Filter by key if provided
        if (args.key) {
            memories = memories.filter((m: any) => m.key === args.key);
        }

        // Filter by tags if provided
        if (args.tags) {
            const searchTags = args.tags.split(',').map(t => t.trim());
            memories = memories.filter((m: any) =>
                searchTags.some((tag: any) => m.tags.includes(tag))
            );
        }

        // Sort by timestamp (newest first)
        memories.sort((a: any, b: any) => b.timestamp - a.timestamp);
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                count: memories.length,
                memories: memories.map((m: any) => ({
                    id: m.id,
                    key: m.key,
                    value: m.value,
                    tags: m.tags,
                    timestamp: new Date(m.timestamp).toISOString()
                }))
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Memory retrieval error: ${e.message}`,
            isError: true
        };
    }
}

export async function deleteMemory(
    args: { 
        id: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        const database = getDatabase();
        await database.read();
        
        const index = database.data.memories.findIndex((m: any) => m.id === args.id);
        if (index === -1) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: `Memory with id ${args.id} not found`,
                isError: true
            };
        }
        
        const deleted = database.data.memories.splice(index, 1)[0];
        await database.write();
        
        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                success: true,
                deleted: {
                    id: deleted.id,
                    key: deleted.key
                }
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Memory deletion error: ${e.message}`,
            isError: true
        };
    }
}

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'save_memory',
            description: 'Store contextual information in memory for future reference. Useful for remembering project-specific details, user preferences, or important decisions.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'A unique key to identify this memory'
                    },
                    value: {
                        type: 'string',
                        description: 'The content to store in memory'
                    },
                    tags: {
                        type: 'string',
                        description: 'Comma-separated tags for categorization (e.g., "project,preference,decision")'
                    }
                },
                required: ['key', 'value']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'retrieve_memory',
            description: 'Retrieve stored memories by key or tags. Returns all memories if no filters provided.',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Optional key to filter memories'
                    },
                    tags: {
                        type: 'string',
                        description: 'Optional comma-separated tags to filter memories'
                    }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_memory',
            description: 'Delete a memory item by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The ID of the memory to delete'
                    }
                },
                required: ['id']
            }
        }
    }
];
