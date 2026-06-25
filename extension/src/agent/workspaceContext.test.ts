/**
 * Property-based tests for workspaceContext.ts
 *
 * Feature: kurdbox-agent
 *
 * Property 5.1: file tree depth and count limits
 * Property 5.2: active file size threshold
 * Property 5.3: partial error omission
 *
 * NOTE: workspaceContext.ts imports both vscode and child_process.
 * We intercept Module._load BEFORE importing so the module picks up our stubs.
 *
 * Validates: Requirements 2.1, 2.2, 2.6
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import * as fc from 'fast-check';
import * as assert from 'assert';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Module-level mocks
// Must be installed BEFORE workspaceContext is imported.
// ---------------------------------------------------------------------------

const Module = require('module') as {
    _load: (req: string, ...a: unknown[]) => unknown;
};
const origLoad = Module._load.bind(Module);

/** Mutable state shared across test cases — each test resets what it needs. */
const mockState = {
    workspaceFolders: [
        { uri: { fsPath: '/workspace', toString: () => '/workspace' } },
    ] as any[],
    activeTextEditor: null as any,
    textDocuments: [] as any[],
    fsReadDirectory: async (_uri: any): Promise<[string, number][]> => [],
    execError: false,
};

const vscodeStub: any = {
    Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (base: any, ...parts: string[]) =>
            ({ fsPath: path.join(base.fsPath, ...parts) }),
    },
    FileType: { Directory: 2, File: 1 },
    workspace: {
        get workspaceFolders() { return mockState.workspaceFolders; },
        get textDocuments() { return mockState.textDocuments; },
        fs: {
            readDirectory: async (uri: any) => mockState.fsReadDirectory(uri),
        },
    },
    window: {
        get activeTextEditor() { return mockState.activeTextEditor; },
    },
};

const childProcessStub: any = {
    exec: (_cmd: string, _opts: any, cb: Function) => {
        if (mockState.execError) {
            cb(new Error('git not found'), '', '');
        } else {
            cb(null, '', '');
        }
        return { on: () => {} };
    },
};

Module._load = function (req: string, ...a: unknown[]): unknown {
    if (req === 'vscode') return vscodeStub;
    if (req === 'child_process') return childProcessStub;
    return origLoad(req, ...a);
};

const { collectWorkspaceContext } = require('./workspaceContext') as {
    collectWorkspaceContext: () => Promise<import('./types').WorkspaceContextData>;
};

// Restore original loader — all subsequent require() calls in test helpers
// that need Node builtins will work normally.
Module._load = origLoad;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset every mock state field to a safe default before each run. */
function resetMockState() {
    mockState.workspaceFolders = [
        { uri: { fsPath: '/workspace', toString: () => '/workspace' } },
    ];
    mockState.activeTextEditor = null;
    mockState.textDocuments = [];
    mockState.fsReadDirectory = async () => [];
    mockState.execError = false;
}

/**
 * Build a mock readDirectory function from a simple description:
 *   { depth, entriesPerLevel }
 *
 * The function is called with a uri; it returns a flat list of entries.
 * Directories at depth < maxDepth get child entries, files get none.
 *
 * We encode depth in the fsPath so the mock can decide what to return
 * without keeping extra state.
 */
function buildReadDirectory(
    maxTreeDepth: number,
    entriesPerLevel: number,
): (uri: { fsPath: string }) => Promise<[string, number][]> {
    return async (uri: { fsPath: string }) => {
        // Determine how deep this uri is by counting segments past the root.
        const root = '/workspace';
        const rel = uri.fsPath.startsWith(root)
            ? uri.fsPath.slice(root.length)
            : uri.fsPath;
        // Count path segments: empty string → depth 0, '/a' → depth 1, etc.
        const segments = rel.split('/').filter(Boolean);
        const currentDepth = segments.length; // 0 = root level

        if (currentDepth >= maxTreeDepth) {
            // At max depth: only files
            return Array.from({ length: entriesPerLevel }, (_, i): [string, number] =>
                [`file_${currentDepth}_${i}.txt`, 1 /* File */]
            );
        }

        // Mix of directories and files
        const half = Math.ceil(entriesPerLevel / 2);
        const dirs: [string, number][] = Array.from({ length: half }, (_, i): [string, number] =>
            [`dir_${currentDepth}_${i}`, 2 /* Directory */]
        );
        const files: [string, number][] = Array.from(
            { length: entriesPerLevel - half },
            (_, i): [string, number] => [`file_${currentDepth}_${i}.txt`, 1 /* File */]
        );
        return [...dirs, ...files];
    };
}

// ---------------------------------------------------------------------------
// Property 5.1 — file tree depth and count limits
// ---------------------------------------------------------------------------

describe('collectWorkspaceContext — Property 5.1: file tree depth and count limits', function () {
    this.timeout(120_000);

    it('fileTree never exceeds depth 3 or 200 entries', async () => {
        // Feature: kurdbox-agent, Property 5.1: file tree depth and count limits
        // **Validates: Requirements 2.1**
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),   // maxTreeDepth for mock fs
                fc.integer({ min: 0, max: 50 }),   // entries per level (capped to keep runs fast)
                async (treeDepth, entriesPerLevel) => {
                    resetMockState();
                    mockState.fsReadDirectory = buildReadDirectory(treeDepth, entriesPerLevel);

                    const ctx = await collectWorkspaceContext();
                    const tree = ctx.fileTree;

                    // --- Count entries (lines with ├── or └──, excluding truncation notice) ---
                    const entryLines = tree
                        .split('\n')
                        .filter(line =>
                            (line.includes('├── ') || line.includes('└── ')) &&
                            !line.includes('(truncated')
                        );

                    assert.ok(
                        entryLines.length <= 200,
                        `fileTree has ${entryLines.length} entries, expected ≤ 200.\n` +
                        `(treeDepth=${treeDepth}, entriesPerLevel=${entriesPerLevel})\n` +
                        `Tree sample:\n${tree.slice(0, 500)}`
                    );

                    // --- Check depth: max 3 levels of indentation ---
                    // Each level adds 4 characters of prefix (│   or    ).
                    // At depth 3 the prefix is 12 chars: e.g. "│   │   │   ├── name"
                    // So the longest allowed prefix before the connector is 12 chars.
                    // We measure the index of the first '├' or '└' in each entry line.
                    for (const line of entryLines) {
                        // Skip truncation notice lines
                        if (line.includes('(truncated')) continue;

                        const connectorIdx = Math.min(
                            line.includes('├── ') ? line.indexOf('├── ') : Infinity,
                            line.includes('└── ') ? line.indexOf('└── ') : Infinity,
                        );

                        // Each indent level is 4 chars wide. Max depth 3 → max 12 chars before connector.
                        // depth 1 → 0 chars prefix (root level, depth counter starts at 1 in buildFileTree)
                        // depth 2 → 4 chars prefix
                        // depth 3 → 8 chars prefix
                        // The connector itself is 4 chars (├── ), so connectorIdx ≤ 8.
                        assert.ok(
                            connectorIdx <= 8,
                            `Found a tree entry at indent depth > 3 (connectorIdx=${connectorIdx}).\n` +
                            `Line: "${line}"\n` +
                            `(treeDepth=${treeDepth}, entriesPerLevel=${entriesPerLevel})`
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 5.2 — active file size threshold
// ---------------------------------------------------------------------------

describe('collectWorkspaceContext — Property 5.2: active file size threshold', function () {
    this.timeout(120_000);

    const MAX_ACTIVE_FILE_BYTES = 102400; // 100 KB — must match workspaceContext.ts

    it('content included ≤ 100 KB and excluded > 100 KB', async () => {
        // Feature: kurdbox-agent, Property 5.2: active file size threshold
        // **Validates: Requirements 2.2**
        await fc.assert(
            fc.asyncProperty(
                // Generate strings of exactly `len` ASCII chars (len=byte-length).
                // We use fc.integer to pick the target length, then build a string of
                // that exact size so the byte-length check is deterministic.
                fc.integer({ min: 0, max: 200_000 }),
                async (len: number) => {
                    resetMockState();

                    // Build a string of exactly `len` ASCII chars ('a' repeated).
                    // ASCII characters are always 1 byte each, so length === byte length.
                    const text = 'a'.repeat(len);

                    // Set up an activeTextEditor that returns our generated text
                    mockState.activeTextEditor = {
                        document: {
                            getText: () => text,
                            uri: { fsPath: '/workspace/active.ts', scheme: 'file' },
                        },
                    };

                    const ctx = await collectWorkspaceContext();

                    if (text.length <= MAX_ACTIVE_FILE_BYTES) {
                        assert.strictEqual(
                            ctx.activeFileContent,
                            text,
                            `Content ≤ 100 KB should be included (length=${text.length})`
                        );
                    } else {
                        assert.strictEqual(
                            ctx.activeFileContent,
                            undefined,
                            `Content > 100 KB should be excluded (length=${text.length})`
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 5.3 — partial error omission
// ---------------------------------------------------------------------------

describe('collectWorkspaceContext — Property 5.3: partial error omission', function () {
    this.timeout(120_000);

    it('non-erroring collectors still return data when others fail', async () => {
        // Feature: kurdbox-agent, Property 5.3: partial error omission
        // **Validates: Requirements 2.6**
        await fc.assert(
            fc.asyncProperty(
                fc.boolean(), // gitError: should git diff fail?
                fc.boolean(), // activeFileError: should activeTextEditor getter throw?
                fc.boolean(), // textDocumentsError: should textDocuments getter throw?
                async (gitError, activeFileError, textDocumentsError) => {
                    resetMockState();

                    // --- Git error injection ---
                    mockState.execError = gitError;

                    // --- Active file error injection ---
                    if (activeFileError) {
                        // Make the activeTextEditor getter throw
                        Object.defineProperty(vscodeStub.window, 'activeTextEditor', {
                            get() { throw new Error('activeTextEditor unavailable'); },
                            configurable: true,
                        });
                    } else {
                        // Healthy: return a small text document
                        Object.defineProperty(vscodeStub.window, 'activeTextEditor', {
                            get() { return mockState.activeTextEditor; },
                            configurable: true,
                        });
                        mockState.activeTextEditor = {
                            document: {
                                getText: () => 'hello world',
                                uri: { fsPath: '/workspace/active.ts', scheme: 'file' },
                            },
                        };
                    }

                    // --- Text documents error injection ---
                    if (textDocumentsError) {
                        Object.defineProperty(vscodeStub.workspace, 'textDocuments', {
                            get() { throw new Error('textDocuments unavailable'); },
                            configurable: true,
                        });
                    } else {
                        Object.defineProperty(vscodeStub.workspace, 'textDocuments', {
                            get() { return mockState.textDocuments; },
                            configurable: true,
                        });
                        mockState.textDocuments = [
                            {
                                uri: { fsPath: '/workspace/open.ts', scheme: 'file' },
                            },
                        ];
                    }

                    // --- collectWorkspaceContext must never throw ---
                    let ctx: import('./types').WorkspaceContextData;
                    try {
                        ctx = await collectWorkspaceContext();
                    } catch (err: any) {
                        // NoWorkspaceError is allowed, everything else is a failure
                        if (err && err.name === 'NoWorkspaceError') return;
                        assert.fail(
                            `collectWorkspaceContext threw unexpectedly: ${err?.message ?? err}\n` +
                            `(gitError=${gitError}, activeFileError=${activeFileError}, textDocumentsError=${textDocumentsError})`
                        );
                    }

                    // --- Always-present fields ---
                    assert.ok(
                        typeof ctx.workspaceRoot === 'string' && ctx.workspaceRoot.length > 0,
                        'workspaceRoot must always be present'
                    );
                    assert.ok(
                        typeof ctx.fileTree === 'string',
                        'fileTree must always be a string'
                    );
                    assert.ok(
                        Array.isArray(ctx.openFilePaths),
                        'openFilePaths must always be an array'
                    );

                    // --- Non-erroring collectors must provide data ---
                    if (!gitError) {
                        // git succeeded but returned empty string → gitDiff is undefined (empty treated as undefined in impl)
                        // This is valid; we only assert the field is not present due to an error.
                        // The property: when exec succeeds, gitDiff is either a string or undefined (not an exception)
                        // We can't assert a specific value since exec returns '' in the stub.
                        // Just confirm no throw happened — already covered above.
                    }

                    if (!activeFileError) {
                        // Active editor was set with 'hello world' (11 bytes < 100 KB)
                        assert.strictEqual(
                            ctx.activeFileContent,
                            'hello world',
                            `activeFileContent should be present when no error (gitError=${gitError})`
                        );
                    }

                    if (!textDocumentsError) {
                        // textDocuments was set with one file URI
                        assert.ok(
                            ctx.openFilePaths.length >= 1,
                            `openFilePaths should contain entries when no error (textDocumentsError=${textDocumentsError})`
                        );
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});
