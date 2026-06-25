/**
 * Property-based tests for fileSystemTool.ts
 *
 * Feature: kurdbox-agent
 *
 * Property 3.1: read_file round-trip
 * Property 3.2: create_file preserves existing content
 * Property 2:   write-after-reject leaves file unchanged
 * Property 3.4: successful ops return absolute affectedPath
 *
 * NOTE: fileSystemTool.ts imports vscode. We intercept Module._load BEFORE
 * importing the tool so it picks up the in-memory-filesystem mock.
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 5.3, 5.4, 3.8
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import * as fc from 'fast-check';
import * as assert from 'assert';

// ---------------------------------------------------------------------------
// Module-level mock for vscode
// Must be set up BEFORE fileSystemTool is imported so the import sees the mock.
// ---------------------------------------------------------------------------

const Module = require('module') as {
    _load: (req: string, ...a: unknown[]) => unknown;
};
const origLoad = Module._load.bind(Module);

// In-memory filesystem: absolute path → Uint8Array
const memFs = new Map<string, Uint8Array>();

// vscode stub with in-memory filesystem
const vscodeStub = {
    Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (base: { fsPath: string }, ...parts: string[]) => {
            const path = require('path');
            return { fsPath: path.join(base.fsPath, ...parts) };
        },
    },
    FileType: { Directory: 2, File: 1, Unknown: 0, SymbolicLink: 64 },
    FileSystemError: class FileSystemError extends Error {
        code: string;
        static FileNotFound(msg: string) {
            const e = new FileSystemError(msg);
            e.code = 'FileNotFound';
            return e;
        }
        constructor(msg: string) {
            super(msg);
            this.code = 'Unknown';
        }
    },
    workspace: {
        fs: {
            readFile: async (uri: { fsPath: string }) => {
                const data = memFs.get(uri.fsPath);
                if (!data) {
                    const e = new vscodeStub.FileSystemError(`FileNotFound: ${uri.fsPath}`);
                    e.code = 'FileNotFound';
                    throw e;
                }
                return data;
            },
            writeFile: async (uri: { fsPath: string }, content: Uint8Array) => {
                memFs.set(uri.fsPath, content);
            },
            stat: async (uri: { fsPath: string }) => {
                if (!memFs.has(uri.fsPath)) {
                    const e = new vscodeStub.FileSystemError(`FileNotFound: ${uri.fsPath}`);
                    e.code = 'FileNotFound';
                    throw e;
                }
                return {
                    type: 1,
                    ctime: 0,
                    mtime: 0,
                    size: memFs.get(uri.fsPath)!.length,
                };
            },
            delete: async (uri: { fsPath: string }) => {
                if (!memFs.has(uri.fsPath)) {
                    const e = new vscodeStub.FileSystemError(`FileNotFound: ${uri.fsPath}`);
                    e.code = 'FileNotFound';
                    throw e;
                }
                memFs.delete(uri.fsPath);
            },
            readDirectory: async (_uri: { fsPath: string }) => {
                return [];
            },
        },
    },
};

Module._load = function (req: string, ...a: unknown[]): unknown {
    if (req === 'vscode') return vscodeStub;
    return origLoad(req, ...a);
};

// Import fileSystemTool NOW so it binds to our mocked vscode.
const {
    executeReadFile,
    executeWriteFile,
    executeCreateFile,
    executeDeleteFile,
} = require('./fileSystemTool') as {
    executeReadFile: typeof import('./fileSystemTool').executeReadFile;
    executeWriteFile: typeof import('./fileSystemTool').executeWriteFile;
    executeCreateFile: typeof import('./fileSystemTool').executeCreateFile;
    executeDeleteFile: typeof import('./fileSystemTool').executeDeleteFile;
};

// Restore original Module._load after our import is done.
Module._load = origLoad;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = '/workspace/root';
const workspaceRootUri = vscodeStub.Uri.file(WORKSPACE_ROOT) as unknown as import('vscode').Uri;

function resetFs() {
    memFs.clear();
}

function fsPath(rel: string): string {
    const path = require('path');
    return path.join(WORKSPACE_ROOT, rel);
}

function seedFile(rel: string, content: string): void {
    memFs.set(fsPath(rel), Buffer.from(content, 'utf8'));
}

function readMemFile(rel: string): string | undefined {
    const data = memFs.get(fsPath(rel));
    return data ? Buffer.from(data).toString('utf8') : undefined;
}

// Normalised workspace root for platform-safe path prefix checks.
// On Windows, path.join turns forward slashes into backslashes so we
// normalise WORKSPACE_ROOT the same way for assertions.
const { normalize: pathNormalize, sep: pathSep } = require('path') as typeof import('path');
const WORKSPACE_ROOT_NORM = pathNormalize(WORKSPACE_ROOT);

// ---------------------------------------------------------------------------
// Property 3.1 — read_file round-trip
//
// For any UTF-8 string seeded directly into memFs, reading it back via
// executeReadFile should return exactly the same content.
//
// Validates: Requirements 3.1, 3.3
// ---------------------------------------------------------------------------

describe('executeReadFile — Property 3.1: read_file round-trip', function () {
    this.timeout(60_000);

    it('content read back equals content written into memFs', async () => {
        // Feature: kurdbox-agent, Property 3.1: read_file round-trip
        // **Validates: Requirements 3.1, 3.3**
        await fc.assert(
            fc.asyncProperty(
                // Use printable + common Unicode to keep round-trip behaviour deterministic.
                // Avoid null bytes which UTF-8 encode fine but Buffer.toString can mutate.
                fc.string({ minLength: 0, maxLength: 2000 }),
                async (content) => {
                    resetFs();
                    const relPath = 'test-roundtrip.txt';
                    seedFile(relPath, content);

                    const result = await executeReadFile(
                        { path: relPath },
                        workspaceRootUri,
                        'tid-3.1'
                    );

                    assert.strictEqual(result.isError, false,
                        `Expected isError=false but got: ${result.content}`);
                    assert.strictEqual(result.content, content,
                        `Round-trip mismatch for content of length ${content.length}`);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 3.2 — create_file preserves existing content
//
// If a file already exists, calling executeCreateFile with different content
// must leave the original content unchanged (create_file must not overwrite).
//
// Validates: Requirements 3.4
// ---------------------------------------------------------------------------

describe('executeCreateFile — Property 3.2: create_file preserves existing content', function () {
    this.timeout(60_000);

    it('existing file content is unchanged after a create_file call', async () => {
        // Feature: kurdbox-agent, Property 3.2: create_file preserves existing content
        // **Validates: Requirements 3.4**
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 500 }), // originalContent (non-empty so file is visibly present)
                fc.string({ minLength: 0, maxLength: 500 }), // newContent to attempt writing
                async (originalContent, newContent) => {
                    resetFs();
                    const relPath = 'test-preserve.txt';

                    // Seed the file with originalContent
                    seedFile(relPath, originalContent);

                    // Attempt to create the same file — must be rejected
                    const result = await executeCreateFile(
                        { path: relPath, content: newContent },
                        workspaceRootUri,
                        'tid-3.2'
                    );

                    // create_file must return an error (file already exists)
                    assert.strictEqual(result.isError, true,
                        `Expected isError=true when creating existing file, got content: ${result.content}`);

                    // Content in memFs must be unchanged
                    const actual = readMemFile(relPath);
                    assert.strictEqual(actual, originalContent,
                        `File content was mutated by a rejected create_file`);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2 — write-after-reject leaves file unchanged
//
// If executeWriteFile is called with an onApprovalRequired callback that returns
// false, the file must remain unchanged.
//
// Validates: Requirements 5.3, 5.4
// ---------------------------------------------------------------------------

describe('executeWriteFile — Property 2: write-after-reject leaves file unchanged', function () {
    this.timeout(60_000);

    it('file content is unchanged after a rejected write', async () => {
        // Feature: kurdbox-agent, Property 2: write-after-reject leaves file unchanged
        // **Validates: Requirements 5.3, 5.4**
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 0, maxLength: 500 }), // originalContent
                fc.string({ minLength: 0, maxLength: 500 }), // proposedContent
                async (originalContent, proposedContent) => {
                    resetFs();
                    const relPath = 'test-reject.txt';

                    // Seed the file with original content
                    seedFile(relPath, originalContent);

                    // Rejection callback — always rejects
                    const rejectAll = async () => false;

                    const result = await executeWriteFile(
                        { path: relPath, content: proposedContent },
                        workspaceRootUri,
                        'tid-p2',
                        rejectAll
                    );

                    // Write must be rejected (isError=true)
                    assert.strictEqual(result.isError, true,
                        `Expected isError=true for rejected write, got: ${result.content}`);

                    // File content in memFs must be unchanged
                    const actual = readMemFile(relPath);
                    assert.strictEqual(actual, originalContent,
                        `File content was mutated despite rejection`);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 3.4 — successful ops return absolute affectedPath
//
// For write, create, and delete operations that succeed, result.affectedPath
// must be defined and must start with WORKSPACE_ROOT.
//
// Validates: Requirements 3.8
// ---------------------------------------------------------------------------

describe('FileSystem tools — Property 3.4: successful ops return absolute affectedPath', function () {
    this.timeout(60_000);

    it('write_file: affectedPath is defined and starts with workspaceRoot', async () => {
        // Feature: kurdbox-agent, Property 3.4: successful ops return absolute affectedPath
        // **Validates: Requirements 3.8**
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.txt'),
                fc.string({ minLength: 0, maxLength: 200 }),
                async (fileName, content) => {
                    resetFs();

                    // Approval always succeeds
                    const approveAll = async () => true;

                    const result = await executeWriteFile(
                        { path: fileName, content },
                        workspaceRootUri,
                        'tid-3.4-write',
                        approveAll
                    );

                    assert.strictEqual(result.isError, false,
                        `Expected isError=false for approved write, got: ${result.content}`);
                    assert.ok(result.affectedPath !== undefined,
                        `affectedPath should be defined after successful write`);
                    assert.ok(
                        result.affectedPath!.startsWith(WORKSPACE_ROOT_NORM),
                        `affectedPath "${result.affectedPath}" does not start with "${WORKSPACE_ROOT_NORM}"`
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    it('create_file: affectedPath is defined and starts with workspaceRoot', async () => {
        // Feature: kurdbox-agent, Property 3.4: successful ops return absolute affectedPath
        // **Validates: Requirements 3.8**
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.txt'),
                fc.string({ minLength: 0, maxLength: 200 }),
                async (fileName, content) => {
                    resetFs();
                    // File must NOT exist for create_file to succeed

                    const result = await executeCreateFile(
                        { path: fileName, content },
                        workspaceRootUri,
                        'tid-3.4-create'
                    );

                    assert.strictEqual(result.isError, false,
                        `Expected isError=false for create_file on new file, got: ${result.content}`);
                    assert.ok(result.affectedPath !== undefined,
                        `affectedPath should be defined after successful create`);
                    assert.ok(
                        result.affectedPath!.startsWith(WORKSPACE_ROOT_NORM),
                        `affectedPath "${result.affectedPath}" does not start with "${WORKSPACE_ROOT_NORM}"`
                    );
                }
            ),
            { numRuns: 100 }
        );
    });

    it('delete_file: affectedPath is defined and starts with workspaceRoot', async () => {
        // Feature: kurdbox-agent, Property 3.4: successful ops return absolute affectedPath
        // **Validates: Requirements 3.8**
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.txt'),
                fc.string({ minLength: 0, maxLength: 200 }),
                async (fileName, content) => {
                    resetFs();
                    // Seed the file so delete can succeed
                    seedFile(fileName, content);

                    // Approval always succeeds
                    const approveAll = async () => true;

                    const result = await executeDeleteFile(
                        { path: fileName },
                        workspaceRootUri,
                        'tid-3.4-delete',
                        approveAll
                    );

                    assert.strictEqual(result.isError, false,
                        `Expected isError=false for approved delete, got: ${result.content}`);
                    assert.ok(result.affectedPath !== undefined,
                        `affectedPath should be defined after successful delete`);
                    assert.ok(
                        result.affectedPath!.startsWith(WORKSPACE_ROOT_NORM),
                        `affectedPath "${result.affectedPath}" does not start with "${WORKSPACE_ROOT_NORM}"`
                    );
                }
            ),
            { numRuns: 100 }
        );
    });
});
