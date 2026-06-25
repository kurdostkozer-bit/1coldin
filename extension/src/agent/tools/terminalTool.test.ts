/**
 * Property-based tests for terminalTool.ts
 *
 * Feature: kurdbox-agent
 *
 * Property 3  (Task 4.1): output truncation invariant
 * Property 4.2 (Task 4.2): inactive-mode always rejects
 *
 * NOTE: Node 24 made child_process.exec a getter-only property, so the
 * standard `(childProcess as any).exec = stub` pattern throws at runtime.
 * Instead we intercept at the module-loader level via Module._load so that
 * the terminalTool module picks up the mock when it is first imported.
 *
 * Validates: Requirements 4.5 (Property 3), 4.6 (Property 4.2)
 */

import * as fc from 'fast-check';
import * as assert from 'assert';

// ---------------------------------------------------------------------------
// Module-level mock for child_process.exec
// Must be set up BEFORE terminalTool is imported so the import sees the mock.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as {
    _load: (req: string, ...a: unknown[]) => unknown;
};

const origLoad = Module._load.bind(Module);
let execCalled = false;
// Use a type-cast-friendly container to avoid TS narrowing issues.
const mockExecHolder: { fn: ((...args: unknown[]) => unknown) | null } = { fn: null };

Module._load = function (req: string, ...a: unknown[]): unknown {
    if (req === 'child_process') {
        const real = origLoad(req, ...a) as Record<string, unknown>;
        return {
            ...real,
            exec: (...args: unknown[]) => {
                execCalled = true;
                const current = mockExecHolder.fn;
                if (current) {
                    return current(...args);
                }
                return (real.exec as (...a: unknown[]) => unknown)(...args);
            },
        };
    }
    return origLoad(req, ...a);
};

// Import terminalTool NOW so it binds to our mocked child_process.exec.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeRunCommand, applyOutputCap } = require('./terminalTool') as {
    executeRunCommand: typeof import('./terminalTool').executeRunCommand;
    applyOutputCap: typeof import('./terminalTool').applyOutputCap;
};

// Restore the original Module._load after our import is done.
Module._load = origLoad;

// ---------------------------------------------------------------------------
// Property 3 — Output Truncation Invariant
//
// For any string output from a command:
//   - If byteLength(output) <= 50 KB  →  applyOutputCap returns it unchanged
//   - If byteLength(output) >  50 KB  →  result includes a truncation notice
//                                         AND resultBytes <= 50 KB + notice overhead
//
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

describe('applyOutputCap — Property 3: output truncation invariant', function () {
    this.timeout(30_000);

    it('result bytes ≤ 50 KB + notice overhead; notice present when over limit', () => {
        // Feature: kurdbox-agent, Property 3: terminal output truncation invariant
        fc.assert(
            fc.property(
                fc.string({ maxLength: 200_000 }),
                (output) => {
                    const result = applyOutputCap(output);
                    const inputBytes = Buffer.byteLength(output, 'utf8');
                    const resultBytes = Buffer.byteLength(result, 'utf8');
                    const LIMIT = 50 * 1024;
                    const NOTICE = '[output truncated: exceeded 50 KB limit]';

                    if (inputBytes > LIMIT) {
                        assert.ok(
                            result.includes(NOTICE),
                            `Truncation notice missing for input of ${inputBytes} bytes`
                        );
                        // Allow up to the limit plus the notice string plus a newline plus a small
                        // multi-byte character boundary fudge factor (≤ 3 bytes).
                        const maxAllowed =
                            LIMIT + Buffer.byteLength('\n' + NOTICE, 'utf8') + 3;
                        assert.ok(
                            resultBytes <= maxAllowed,
                            `Result (${resultBytes} bytes) exceeds allowed max (${maxAllowed} bytes)`
                        );
                    } else {
                        assert.strictEqual(
                            result,
                            output,
                            'Short output should not be modified'
                        );
                    }
                }
            ),
            { numRuns: 200 }
        );
    });

    it('exactly 50 KB input is NOT truncated', () => {
        const input = 'a'.repeat(50 * 1024);
        assert.strictEqual(applyOutputCap(input), input);
    });

    it('empty string returns empty string', () => {
        assert.strictEqual(applyOutputCap(''), '');
    });
});

// ---------------------------------------------------------------------------
// Property 4.2 — Inactive-Mode Always Rejects
//
// For any arbitrary command string, when agentModeActive=false:
//   - executeRunCommand returns a ToolResult with isError=true
//   - result content mentions "inactive" (or equivalent rejection wording)
//   - child_process.exec is NEVER invoked
//
// Validates: Requirements 4.6
// ---------------------------------------------------------------------------

describe('executeRunCommand — Property 4.2: inactive-mode always rejects', function () {
    this.timeout(30_000);

    it('returns isError=true and never calls exec for any command when agentModeActive=false', async () => {
        // Feature: kurdbox-agent, Property 4.2: inactive-mode always rejects
        await fc.assert(
            fc.asyncProperty(
                fc.string(), // arbitrary command
                async (command) => {
                    execCalled = false;

                    const result = await executeRunCommand(
                        { command },
                        {
                            workspaceRoot: '/workspace',
                            agentModeActive: false,
                            requireConfirmation: false,
                            toolCallId: 'test-id',
                        }
                    );

                    assert.strictEqual(
                        result.isError,
                        true,
                        `Expected isError=true for command=${JSON.stringify(command)}, got false`
                    );

                    assert.strictEqual(
                        execCalled,
                        false,
                        `exec should NOT be called when agentModeActive=false, command=${JSON.stringify(command)}`
                    );

                    // Content should signal that the tool is inactive.
                    assert.ok(
                        result.content.toLowerCase().includes('inactive') ||
                            result.content.toLowerCase().includes('not available') ||
                            result.content.toLowerCase().includes('agent mode'),
                        `Expected content to mention inactive state, got: ${JSON.stringify(result.content)}`
                    );
                }
            ),
            { numRuns: 100 }
        );
    });
});
