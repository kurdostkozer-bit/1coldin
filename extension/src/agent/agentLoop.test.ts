/**
 * AgentLoop property-based and integration tests.
 *
 * Tasks 7.1, 7.2, 7.3, 10.1, 10.2
 * Feature: kurdbox-agent
 *
 * Property 4: Iteration Count Monotonicity    (Task 7.1)
 * Property 5: Tool Error Continuation         (Task 7.2)
 * Property 7.3: Task Summary Completeness     (Task 7.3)
 * Integration: Approval gate blocks write     (Task 10.1)
 * Integration: Stop button halts loop         (Task 10.2)
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 5.2, 5.3
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import * as fc from 'fast-check';
import * as assert from 'assert';

// ---------------------------------------------------------------------------
// Module-level mocks — must be installed BEFORE importing AgentLoop
// ---------------------------------------------------------------------------

const Module = require('module') as {
    _load: (req: string, ...a: any[]) => any;
};
const origLoad = Module._load.bind(Module);

// Mutable mock LLM — tests control what chatWithTools returns
type MockResponse = { content: string | null; tool_calls?: any[]; finishReason: string };
let mockResponses: MockResponse[] = [];
let chatCallCount = 0;

function nextResponse(): MockResponse {
    const r = mockResponses.shift();
    if (!r) { return { content: 'done', tool_calls: undefined, finishReason: 'stop' }; }
    return r;
}

// Tool execution mock — control whether tools succeed or error
let mockToolError = false;

// Per-call error control: list of booleans, one per tool invocation
let perCallErrors: boolean[] = [];
let toolInvocationCount = 0;

function shouldErrorThisCall(): boolean {
    if (perCallErrors.length > 0) {
        const shouldErr = perCallErrors[toolInvocationCount] ?? mockToolError;
        toolInvocationCount++;
        return shouldErr;
    }
    return mockToolError;
}

const vscodeStub = {
    Uri: { file: (p: string) => ({ fsPath: p }) },
    FileType: { Directory: 2, File: 1 },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/ws' } }],
        fs: {
            writeFile: async () => {},
            readFile: async () => Buffer.from(''),
            stat: async () => { throw Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' }); },
            delete: async () => {},
            readDirectory: async () => [],
        },
    },
};

const kurdostClientStub = {
    chatWithTools: async (..._args: any[]) => {
        chatCallCount++;
        return nextResponse();
    },
};

// Tool stubs — return error or success based on mockToolError / perCallErrors
const fsToolStub = {
    executeReadFile: async (_a: any, _r: any, id: string) => {
        const isError = shouldErrorThisCall();
        return {
            tool_call_id: id,
            role: 'tool' as const,
            content: isError ? 'Error: fail' : 'ok',
            isError,
            affectedPath: isError ? undefined : '/ws/file.ts',
        };
    },
    executeWriteFile: async (_a: any, _r: any, id: string, cb: ((req: any) => Promise<boolean>) | undefined) => {
        // Honour the real approval callback if provided
        if (cb) {
            const approved = await cb({ type: 'write_file', toolCallId: id, path: '/ws/file.ts', content: '' });
            if (!approved) {
                return {
                    tool_call_id: id,
                    role: 'tool' as const,
                    content: 'Write to "file.ts" was rejected by the user.',
                    isError: true,
                    affectedPath: undefined,
                };
            }
        }
        const isError = shouldErrorThisCall();
        return {
            tool_call_id: id,
            role: 'tool' as const,
            content: isError ? 'Error: fail' : 'written',
            isError,
            affectedPath: isError ? undefined : '/ws/file.ts',
        };
    },
    executeCreateFile: async (_a: any, _r: any, id: string) => {
        const isError = shouldErrorThisCall();
        return {
            tool_call_id: id,
            role: 'tool' as const,
            content: isError ? 'Error: fail' : 'created',
            isError,
            affectedPath: isError ? undefined : '/ws/file.ts',
        };
    },
    executeDeleteFile: async (_a: any, _r: any, id: string, cb: ((req: any) => Promise<boolean>) | undefined) => {
        if (cb) {
            const approved = await cb({ type: 'delete_file', toolCallId: id, path: '/ws/file.ts' });
            if (!approved) {
                return {
                    tool_call_id: id,
                    role: 'tool' as const,
                    content: 'Deletion rejected.',
                    isError: true,
                    affectedPath: undefined,
                };
            }
        }
        const isError = shouldErrorThisCall();
        return {
            tool_call_id: id,
            role: 'tool' as const,
            content: isError ? 'Error: fail' : 'deleted',
            isError,
            affectedPath: isError ? undefined : '/ws/file.ts',
        };
    },
    executeListDirectory: async (_a: any, _r: any, id: string) => ({
        tool_call_id: id,
        role: 'tool' as const,
        content: 'dir entries',
        isError: false,
    }),
    FILE_SYSTEM_TOOL_DEFINITIONS: [],
};

const terminalToolStub = {
    executeRunCommand: async (_a: any, opts: any) => {
        const isError = shouldErrorThisCall();
        return {
            tool_call_id: opts.toolCallId,
            role: 'tool' as const,
            content: isError ? 'Error: fail' : 'ran',
            isError,
        };
    },
    TERMINAL_TOOL_DEFINITION: {
        type: 'function',
        function: {
            name: 'run_command',
            description: '',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
};

Module._load = function (req: string, ...a: any[]): any {
    if (req === 'vscode') { return vscodeStub; }
    if (req === '../api/kurdostClient' || req === './kurdostClient') { return kurdostClientStub; }
    if (req === './tools/fileSystemTool' || req === '../agent/tools/fileSystemTool') { return fsToolStub; }
    if (req === './tools/terminalTool' || req === '../agent/tools/terminalTool') { return terminalToolStub; }
    return origLoad(req, ...a);
};

// Import AgentLoop with mocks in place
const { AgentLoop } = require('./agentLoop') as { AgentLoop: typeof import('./agentLoop').AgentLoop };

// Restore original loader
Module._load = origLoad;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolCallResponse(toolName: string, args: object = {}, callId = 'tc1'): MockResponse {
    return {
        content: null,
        tool_calls: [{ id: callId, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
        finishReason: 'tool_calls',
    };
}

function finalAnswer(text = 'Task complete'): MockResponse {
    return { content: text, tool_calls: undefined, finishReason: 'stop' };
}

// Context data stub
const ctxData = {
    workspaceRoot: '/ws',
    fileTree: 'tree',
    openFilePaths: [],
    activeFilePath: undefined,
    activeFileContent: undefined,
    gitDiff: undefined,
} as any;

// Dummy tool definitions (empty — we don't test LLM tool schema here)
const noTools: any[] = [];

// Reset helpers called in beforeEach
function resetMocks() {
    chatCallCount = 0;
    mockResponses = [];
    mockToolError = false;
    perCallErrors = [];
    toolInvocationCount = 0;
}

// ---------------------------------------------------------------------------
// Task 7.1 — Property 4: Iteration Count Monotonicity
// ---------------------------------------------------------------------------

describe('AgentLoop — Property 4: Iteration Count Monotonicity (Task 7.1)', function () {
    this.timeout(120_000);

    beforeEach(resetMocks);

    it('step values are monotonically increasing and count ≤ maxIterations', async () => {
        // Feature: kurdbox-agent, Property 4: iteration count monotonicity
        // **Validates: Requirements 6.3, 6.5**
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 20 }),
                async (maxIter) => {
                    resetMocks();

                    // Set up 25 tool-call responses (more than any maxIter ≤ 20) + a safety final answer
                    const infiniteResponses: MockResponse[] = [];
                    for (let i = 0; i < 25; i++) {
                        infiniteResponses.push(toolCallResponse('read_file', { path: 'foo.ts' }, `tc${i}`));
                    }
                    infiniteResponses.push(finalAnswer());
                    mockResponses = infiniteResponses;

                    const steps: number[] = [];

                    const loop = new AgentLoop({
                        maxIterations: maxIter,
                        onStepUpdate: (step: number) => { steps.push(step); },
                    });

                    await loop.run('test task', ctxData, noTools, 'token', 'model');

                    // step count must not exceed maxIterations
                    assert.ok(
                        steps.length <= maxIter,
                        `steps.length=${steps.length} exceeds maxIter=${maxIter}`
                    );

                    // steps must be strictly increasing
                    for (let i = 1; i < steps.length; i++) {
                        assert.ok(
                            steps[i] > steps[i - 1],
                            `steps not strictly increasing: steps[${i - 1}]=${steps[i - 1]}, steps[${i}]=${steps[i]}`
                        );
                    }

                    // steps must be 1-based sequential (1, 2, 3, ...)
                    for (let i = 0; i < steps.length; i++) {
                        assert.strictEqual(
                            steps[i],
                            i + 1,
                            `steps[${i}] should be ${i + 1} but got ${steps[i]}`
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Task 7.2 — Property 5: Tool Error Continuation
// ---------------------------------------------------------------------------

describe('AgentLoop — Property 5: Tool Error Continuation (Task 7.2)', function () {
    this.timeout(120_000);

    beforeEach(resetMocks);

    it('loop never aborts when all tool calls return errors — always reaches final answer', async () => {
        // Feature: kurdbox-agent, Property 5: tool error continuation
        // **Validates: Requirements 6.6**
        //
        // Worst-case simplification: ALL tool calls error. The loop must still
        // forward each error as a tool message to the LLM and continue.
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (numToolRounds) => {
                    resetMocks();
                    mockToolError = true; // every tool returns isError=true

                    // N tool-call rounds followed by a final answer
                    for (let i = 0; i < numToolRounds; i++) {
                        mockResponses.push(toolCallResponse('read_file', { path: 'foo.ts' }, `tc${i}`));
                    }
                    mockResponses.push(finalAnswer('done'));

                    let finalAnswerCalled = false;

                    const loop = new AgentLoop({
                        maxIterations: numToolRounds + 5, // plenty of headroom
                        onFinalAnswer: () => { finalAnswerCalled = true; },
                    });

                    await loop.run('test task', ctxData, noTools, 'token', 'model');

                    assert.strictEqual(
                        finalAnswerCalled,
                        true,
                        `onFinalAnswer was not called after ${numToolRounds} error round(s)`
                    );

                    // chatWithTools should be called numToolRounds + 1 (final answer round)
                    assert.strictEqual(
                        chatCallCount,
                        numToolRounds + 1,
                        `Expected chatCallCount=${numToolRounds + 1}, got ${chatCallCount}`
                    );
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// Task 7.3 — Property: Task Summary Completeness
// ---------------------------------------------------------------------------

describe('AgentLoop — Property: Task Summary Completeness (Task 7.3)', function () {
    this.timeout(120_000);

    beforeEach(resetMocks);

    it('all used tool names appear in summary.toolsUsed, all written files in summary.filesChanged', async () => {
        // Feature: kurdbox-agent, Property 7.3: task summary completeness
        // **Validates: Requirements 6.7**
        const availableTools = ['write_file', 'create_file', 'delete_file', 'read_file'] as const;

        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.constantFrom(...availableTools),
                    { minLength: 1, maxLength: 8 }
                ),
                async (toolSequence) => {
                    resetMocks();
                    mockToolError = false;

                    // Build mock responses: one tool call per entry + final answer
                    for (let i = 0; i < toolSequence.length; i++) {
                        mockResponses.push(toolCallResponse(toolSequence[i], { path: 'file.ts', content: 'x' }, `tc${i}`));
                    }
                    mockResponses.push(finalAnswer());

                    let capturedSummary: any = null;

                    const loop = new AgentLoop({
                        maxIterations: toolSequence.length + 5,
                        onFinalAnswer: (_text: string, summary: any) => { capturedSummary = summary; },
                        // Approve all write/delete operations
                        onApprovalRequired: async () => true,
                    });

                    await loop.run('test task', ctxData, noTools, 'token', 'model');

                    assert.ok(capturedSummary !== null, 'onFinalAnswer was never called');

                    // All unique tool names from the sequence must appear in toolsUsed
                    const uniqueTools = [...new Set(toolSequence)];
                    for (const toolName of uniqueTools) {
                        assert.ok(
                            capturedSummary.toolsUsed.includes(toolName),
                            `summary.toolsUsed is missing "${toolName}": ${JSON.stringify(capturedSummary.toolsUsed)}`
                        );
                    }

                    // File mutation tools that succeeded must have /ws/file.ts in filesChanged
                    const mutationTools = new Set(['write_file', 'create_file', 'delete_file']);
                    const hasMutation = toolSequence.some(t => mutationTools.has(t));
                    if (hasMutation) {
                        assert.ok(
                            capturedSummary.filesChanged.includes('/ws/file.ts'),
                            `summary.filesChanged missing "/ws/file.ts": ${JSON.stringify(capturedSummary.filesChanged)}`
                        );
                    }

                    // Iterations equals the number of tool-call rounds
                    assert.strictEqual(
                        capturedSummary.iterations,
                        toolSequence.length,
                        `summary.iterations=${capturedSummary.iterations} expected=${toolSequence.length}`
                    );
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// Task 10.1 — Integration: Approval Gate Blocks Write Until Resolved
// ---------------------------------------------------------------------------

describe('AgentLoop — Integration: Approval Gate Blocks Write (Task 10.1)', function () {
    this.timeout(30_000);

    beforeEach(resetMocks);

    it('rejected approval produces isError=true tool result, but loop continues to final answer', async () => {
        // Feature: kurdbox-agent, integration: approval gate blocks write
        // **Validates: Requirements 5.2, 5.3**
        mockResponses = [
            toolCallResponse('write_file', { path: 'file.ts', content: 'hello' }, 'tc-write'),
            finalAnswer('done'),
        ];

        let approvalCalled = false;
        const toolResults: any[] = [];
        let finalAnswerCalled = false;

        const loop = new AgentLoop({
            maxIterations: 5,
            onApprovalRequired: async (_req: any) => {
                approvalCalled = true;
                return false; // REJECT
            },
            onToolResult: (result: any) => { toolResults.push(result); },
            onFinalAnswer: () => { finalAnswerCalled = true; },
        });

        await loop.run('write something', ctxData, noTools, 'token', 'model');

        assert.strictEqual(approvalCalled, true, 'onApprovalRequired should have been called');
        assert.ok(toolResults.length > 0, 'should have at least one tool result');

        const writeResult = toolResults.find((r: any) => r.tool_call_id === 'tc-write');
        assert.ok(writeResult, 'write_file tool result not found');
        assert.strictEqual(
            writeResult.isError,
            true,
            'rejected write should produce isError=true'
        );

        assert.strictEqual(finalAnswerCalled, true, 'loop should continue to final answer after rejection');
    });

    it('approved write produces isError=false tool result and loop completes', async () => {
        // Feature: kurdbox-agent, integration: approval gate allows write when approved
        // **Validates: Requirements 5.2, 5.3**
        mockResponses = [
            toolCallResponse('write_file', { path: 'file.ts', content: 'hello' }, 'tc-write'),
            finalAnswer('done'),
        ];

        let approvalCalled = false;
        const toolResults: any[] = [];
        let finalAnswerCalled = false;

        const loop = new AgentLoop({
            maxIterations: 5,
            onApprovalRequired: async (_req: any) => {
                approvalCalled = true;
                return true; // APPROVE
            },
            onToolResult: (result: any) => { toolResults.push(result); },
            onFinalAnswer: () => { finalAnswerCalled = true; },
        });

        await loop.run('write something', ctxData, noTools, 'token', 'model');

        assert.strictEqual(approvalCalled, true, 'onApprovalRequired should have been called');

        const writeResult = toolResults.find((r: any) => r.tool_call_id === 'tc-write');
        assert.ok(writeResult, 'write_file tool result not found');
        assert.strictEqual(
            writeResult.isError,
            false,
            'approved write should produce isError=false'
        );

        assert.strictEqual(finalAnswerCalled, true, 'loop should complete after approved write');
    });
});

// ---------------------------------------------------------------------------
// Task 10.2 — Integration: Stop Button Halts Loop
// ---------------------------------------------------------------------------

describe('AgentLoop — Integration: Stop Button Halts Loop (Task 10.2)', function () {
    this.timeout(30_000);

    beforeEach(resetMocks);

    it('calling stop() halts the loop — status becomes stopped, finalAnswer not called', async () => {
        // Feature: kurdbox-agent, integration: stop button halts loop
        // **Validates: Requirements 6.4**

        // Provide 10 tool-call responses so the loop would keep going if not stopped
        for (let i = 0; i < 10; i++) {
            mockResponses.push(toolCallResponse('read_file', { path: 'foo.ts' }, `tc${i}`));
        }
        mockResponses.push(finalAnswer());

        const statusChanges: string[] = [];
        let toolCallCount = 0;
        let finalAnswerCalled = false;
        let firstStepFired = false;

        const loop = new AgentLoop({
            maxIterations: 20,
            onStatusChange: (status: string) => { statusChanges.push(status); },
            onToolCall: () => { toolCallCount++; },
            onStepUpdate: (_step: number) => {
                // Stop after the first step fires (first iteration starts)
                if (!firstStepFired) {
                    firstStepFired = true;
                    loop.stop();
                }
            },
            onFinalAnswer: () => { finalAnswerCalled = true; },
        });

        // run() will eventually resolve (either stopped or completed)
        await loop.run('do lots of work', ctxData, noTools, 'token', 'model');

        // The loop should have stopped
        assert.ok(
            statusChanges.includes('stopped'),
            `Expected "stopped" in statusChanges, got: ${JSON.stringify(statusChanges)}`
        );

        // Very few tool calls should have been made (stop is checked before tool execution)
        assert.ok(
            toolCallCount <= 2,
            `Expected toolCallCount ≤ 2 (stop before execution), got ${toolCallCount}`
        );

        // Final answer should NOT have been called
        assert.strictEqual(
            finalAnswerCalled,
            false,
            'onFinalAnswer should not be called when loop is stopped'
        );
    });
});
