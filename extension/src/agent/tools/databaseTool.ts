/**
 * Database Query Tool — executes SQL queries against databases.
 * Supports SQLite, MySQL, and PostgreSQL.
 */

import * as vscode from 'vscode';
import { ToolDefinition, ToolResult } from '../../api/types';

// Note: Database libraries are conditionally imported to avoid errors if not available
let Database: any = null;
let mysql: any = null;
let pg: any = null;

try {
    Database = require('better-sqlite3');
} catch (e) {
    // SQLite not available
}

try {
    mysql = require('mysql2/promise');
} catch (e) {
    // MySQL not available
}

try {
    pg = require('pg');
} catch (e) {
    // PostgreSQL not available
}

export async function executeDatabaseQuery(
    args: {
        type: 'sqlite' | 'mysql' | 'postgres';
        connectionString: string;
        query: string;
    },
    root: vscode.Uri,
    callId: string
): Promise<ToolResult> {
    try {
        // Check if any database library is available
        if (!Database && !mysql && !pg) {
            return {
                tool_call_id: callId,
                role: 'tool',
                content: 'No database libraries are available. Install better-sqlite3, mysql2, or pg to use database queries.',
                isError: true
            };
        }

        let results: any[] = [];

        switch (args.type) {
            case 'sqlite':
                if (!Database) {
                    return {
                        tool_call_id: callId,
                        role: 'tool',
                        content: 'SQLite library (better-sqlite3) is not available',
                        isError: true
                    };
                }
                results = await executeSQLiteQuery(args.connectionString, args.query);
                break;

            case 'mysql':
                if (!mysql) {
                    return {
                        tool_call_id: callId,
                        role: 'tool',
                        content: 'MySQL library (mysql2) is not available',
                        isError: true
                    };
                }
                results = await executeMySQLQuery(args.connectionString, args.query);
                break;

            case 'postgres':
                if (!pg) {
                    return {
                        tool_call_id: callId,
                        role: 'tool',
                        content: 'PostgreSQL library (pg) is not available',
                        isError: true
                    };
                }
                results = await executePostgresQuery(args.connectionString, args.query);
                break;

            default:
                return {
                    tool_call_id: callId,
                    role: 'tool',
                    content: `Unsupported database type: ${args.type}. Supported: sqlite, mysql, postgres`,
                    isError: true
                };
        }

        return {
            tool_call_id: callId,
            role: 'tool',
            content: JSON.stringify({
                type: args.type,
                rowCount: results.length,
                results
            }, null, 2),
            isError: false
        };
    } catch (e: any) {
        return {
            tool_call_id: callId,
            role: 'tool',
            content: `Database query error: ${e.message}`,
            isError: true
        };
    }
}

async function executeSQLiteQuery(dbPath: string, query: string): Promise<any[]> {
    const db = new Database(dbPath);
    try {
        const stmt = db.prepare(query);
        const results = stmt.all();
        return results;
    } finally {
        db.close();
    }
}

async function executeMySQLQuery(connectionString: string, query: string): Promise<any[]> {
    const connection = await mysql.createConnection(connectionString);
    try {
        const [rows] = await connection.execute(query);
        return rows;
    } finally {
        await connection.end();
    }
}

async function executePostgresQuery(connectionString: string, query: string): Promise<any[]> {
    const { Client } = pg;
    const client = new Client(connectionString);
    try {
        await client.connect();
        const result = await client.query(query);
        return result.rows;
    } finally {
        await client.end();
    }
}

export const DATABASE_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'database_query',
            description: 'Execute SQL queries against databases. Supports SQLite, MySQL, and PostgreSQL. Connection string format varies by database type.',
            parameters: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        description: 'Database type: sqlite, mysql, or postgres'
                    },
                    connectionString: {
                        type: 'string',
                        description: 'Connection string or file path. For SQLite: file path. For MySQL/Postgres: connection string like "host=localhost user=pass password=secret database=mydb"'
                    },
                    query: {
                        type: 'string',
                        description: 'SQL query to execute'
                    }
                },
                required: ['type', 'connectionString', 'query']
            }
        }
    }
];
