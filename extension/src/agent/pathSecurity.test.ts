// Feature: kurdbox-agent, Property 1: path containment invariant

/**
 * Property-based tests for pathSecurity.ts
 *
 * Property 1 — Path Containment Invariant:
 *   For any relative path string, resolveSecurePath() SHALL either:
 *   (a) return a URI whose fsPath is within the workspace root, OR
 *   (b) throw a SecurityError — it MUST never silently return an out-of-root path.
 *
 * Validates: Requirements 3.7, 8.1, 8.2
 */

/* eslint-disable @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// All setup uses require() (not import) because:
//   1. Mocha 11 on Node 24 uses require() to load .ts files via ts-node (CJS mode).
//   2. We need Module._load override to run BEFORE pathSecurity is loaded.
//   3. Static `import` statements would be hoisted and run before our mock code.
// ---------------------------------------------------------------------------

import * as fc from 'fast-check';
import * as assert from 'assert';
import * as nodePath from 'path';

// ---------------------------------------------------------------------------
// Mock vscode BEFORE requiring pathSecurity.
// We intercept Module._load so any require('vscode') returns our stub.
// ---------------------------------------------------------------------------

const mockVscode = {
    Uri: {
        file: (p: string) => ({ fsPath: p, toString: () => p }),
        joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
            fsPath: nodePath.join(base.fsPath, ...parts),
        }),
    },
    FileType: { Directory: 2, File: 1, Unknown: 0, SymbolicLink: 64 },
    FileSystemError: class VscodeFileSystemError extends Error {
        code: string;
        constructor(msg: string) { super(msg); this.code = 'Unknown'; }
    },
};

// Patch Module._load before requiring pathSecurity so that any
// require('vscode') inside pathSecurity.ts returns our stub.
const Module = require('module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'vscode') {
        return mockVscode;
    }
    return originalLoad.call(Module, request, parent, isMain);
};

// Now safe to require pathSecurity — it will pick up the mocked vscode.
const { resolveSecurePath } = require('./pathSecurity') as typeof import('./pathSecurity');
const { SecurityError } = require('./types') as typeof import('./types');

// Restore original Module._load after our modules are loaded.
Module._load = originalLoad;

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** Stable workspace root — absolute path on the current platform. */
const WORKSPACE_ROOT = nodePath.resolve('C:\\workspace\\project');

/** Mock vscode.Uri pointing at our workspace root. */
const workspaceRoot = mockVscode.Uri.file(WORKSPACE_ROOT) as unknown as import('vscode').Uri;

// ---------------------------------------------------------------------------
// Property 1 — Path Containment Invariant
// ---------------------------------------------------------------------------

describe('resolveSecurePath — Property 1: Path Containment Invariant', function () {
    // Generous timeout for 500 PBT iterations.
    this.timeout(30_000);

    it('Property 1: for any arbitrary string, result is within root OR SecurityError is thrown', () => {
        // Feature: kurdbox-agent, Property 1: path containment invariant
        // **Validates: Requirements 3.7, 8.1, 8.2**
        fc.assert(
            fc.property(
                fc.string(), // arbitrary relative path — may contain .., unicode, absolute refs
                (relativePath: string) => {
                    let result: { fsPath: string } | undefined;
                    try {
                        result = resolveSecurePath(relativePath, workspaceRoot) as unknown as { fsPath: string };
                    } catch (err) {
                        // The ONLY acceptable error type is SecurityError.
                        assert.ok(
                            err instanceof SecurityError,
                            `Expected SecurityError but got ${(err as Error).constructor?.name ?? 'unknown'}: ${(err as Error).message}`
                        );
                        return; // SecurityError thrown — property satisfied.
                    }

                    // No error thrown — returned path MUST be inside the workspace root.
                    const rootWithSep = WORKSPACE_ROOT.endsWith(nodePath.sep)
                        ? WORKSPACE_ROOT
                        : WORKSPACE_ROOT + nodePath.sep;

                    assert.ok(
                        result!.fsPath === WORKSPACE_ROOT || result!.fsPath.startsWith(rootWithSep),
                        `resolveSecurePath("${relativePath}") returned "${result!.fsPath}" ` +
                        `which is outside workspace root "${WORKSPACE_ROOT}"`
                    );
                }
            ),
            { numRuns: 500 }
        );
    });

    // -------------------------------------------------------------------------
    // Edge case / example tests
    // -------------------------------------------------------------------------

    it('rejects path traversal "../../etc/passwd" — must throw SecurityError', () => {
        assert.throws(
            () => resolveSecurePath('../../etc/passwd', workspaceRoot),
            SecurityError
        );
    });

    it('rejects Unix absolute path "/etc/passwd" — must throw SecurityError', () => {
        assert.throws(
            () => resolveSecurePath('/etc/passwd', workspaceRoot),
            SecurityError
        );
    });

    it('rejects Windows absolute path "C:\\\\Windows\\\\System32" — must throw SecurityError', () => {
        assert.throws(
            () => resolveSecurePath('C:\\Windows\\System32', workspaceRoot),
            SecurityError
        );
    });

    it('"." resolves to the workspace root itself (success)', () => {
        const result = resolveSecurePath('.', workspaceRoot) as unknown as { fsPath: string };
        assert.strictEqual(result.fsPath, WORKSPACE_ROOT);
    });

    it('"src/foo.ts" resolves to a path inside the workspace root (success)', () => {
        const result = resolveSecurePath('src/foo.ts', workspaceRoot) as unknown as { fsPath: string };
        const rootWithSep = WORKSPACE_ROOT + nodePath.sep;
        assert.ok(
            result.fsPath.startsWith(rootWithSep),
            `Expected path inside root, got "${result.fsPath}"`
        );
    });

    it('"./src/../src/foo.ts" resolves to a path inside the workspace root (success)', () => {
        const result = resolveSecurePath('./src/../src/foo.ts', workspaceRoot) as unknown as { fsPath: string };
        const rootWithSep = WORKSPACE_ROOT + nodePath.sep;
        assert.ok(
            result.fsPath.startsWith(rootWithSep),
            `Expected path inside root, got "${result.fsPath}"`
        );
    });
});
