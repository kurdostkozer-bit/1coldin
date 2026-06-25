# Implementation Plan: kurdbox-agent

## Overview

Build a full AI coding agent on top of the existing KurdBox VS Code extension. Work proceeds in layers: shared types → tools → workspace context → agent loop → client extension → agent panel → extension wiring. Each layer is integrated before moving to the next.

## Task Dependency Graph

```
1 → 2 → 3 → 6 → 7 → 9 → 10 → 11 → 13
        ↓                          ↑
        4 ─────────────────────────┘
        ↓
        5 ─────────────────────────┘
8 (checkpoint after 2,3,4,5,6,7)
12 → 11
```

## Tasks

- [x] 1. Create shared agent types
  - Create `src/agent/types.ts` with `ToolDefinition`, `ToolCall`, `ToolResult`, `OpenAIMessage` union type, `ApprovalRequest`, `TaskSummary`, `LoopStatus`, and `AgentLoopOptions` interfaces
  - All tool execution and loop code imports from this single file — no duplicate type declarations
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. Implement path security utility
  - Create `src/agent/pathSecurity.ts` with `resolveSecurePath(relativePath: string, workspaceRoot: vscode.Uri): vscode.Uri`
  - Normalize separators, resolve `..` segments, reject any path whose `fsPath` does not start with `workspaceRoot.fsPath`
  - Throw a typed `SecurityError` when path escapes the workspace root
  - _Requirements: 3.7, 8.1, 8.2_

  - [x] 2.1 Write property test for path security (Property 1)
    - **Property 1: Path Containment Invariant**
    - Use fast-check to generate arbitrary strings including `../`, absolute paths, unicode
    - Assert: result is within root OR SecurityError thrown — never silently returns an out-of-root path
    - **Validates: Requirements 3.7, 8.1, 8.2**

- [x] 3. Implement FileSystem tools
  - Create `src/agent/tools/fileSystemTool.ts` implementing `read_file`, `write_file`, `create_file`, `delete_file`, `list_directory`
  - All path resolution goes through `resolveSecurePath`; all file I/O uses `vscode.workspace.fs`
  - `write_file` and `delete_file` call an injected `onApprovalRequired` callback and await result before touching filesystem
  - Successful operations return `ToolResult` with `affectedPath` set to the absolute path
  - `create_file` returns descriptive error (without overwriting) if target file already exists
  - Export `FILE_SYSTEM_TOOL_DEFINITIONS: ToolDefinition[]` for use in system prompt
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 3.1 Write property test: read_file round-trip (Property ties to 3.1/3.3)
    - Generate random UTF-8 content strings; write file via mock fs; read back via tool; assert equality
    - **Validates: Requirements 3.1, 3.3**

  - [x] 3.2 Write property test: create_file preserves existing content
    - For any existing file content, calling create_file should leave content unchanged
    - **Validates: Requirements 3.4**

  - [x] 3.3 Write property test: write-after-reject leaves file unchanged (Property 2)
    - **Property 2: Write-After-Reject Leaves File Unchanged**
    - Generate arbitrary file content + proposed content; mock rejection; assert original content unchanged
    - **Validates: Requirements 5.3, 5.4**

  - [x] 3.4 Write property test: successful ops return absolute affectedPath (Property ties to 3.8)
    - For any valid write/create/delete operation, assert `result.affectedPath` is defined and starts with workspaceRoot
    - **Validates: Requirements 3.8**

- [x] 4. Implement Terminal tool
  - Create `src/agent/tools/terminalTool.ts` implementing `run_command`
  - Use `child_process.exec` with `cwd` set to workspace root and a 30-second timeout via `{ timeout: 30000 }`
  - Combine stdout + stderr; if combined byte length > 51200, truncate to 50 KB and append `\n[output truncated: exceeded 50 KB limit]`
  - When `requireCommandConfirmation` is true, call `onApprovalRequired` before executing
  - If `agentModeActive` is false, return error ToolResult without calling exec
  - Export `TERMINAL_TOOL_DEFINITION: ToolDefinition` for use in system prompt
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.1 Write property test: output truncation invariant (Property 3)
    - **Property 3: Terminal Output Truncation Invariant**
    - Generate output strings from 0 to 200,000 chars; assert result ≤ 50 KB + notice overhead; assert notice present when over limit
    - **Validates: Requirements 4.5**

  - [x] 4.2 Write property test: inactive-mode always rejects (ties to 4.6)
    - Generate arbitrary command strings with mode=false; assert exec never called
    - **Validates: Requirements 4.6**

- [x] 5. Implement WorkspaceContext collector
  - Create `src/agent/workspaceContext.ts` exporting `collectWorkspaceContext(): Promise<WorkspaceContextData>`
  - File tree: recursive `vscode.workspace.fs.readDirectory()`, max depth 3, max 200 entries; format as ASCII tree
  - Active file: include content only if `document.getText().length <= 102400` (100 KB)
  - Git diff: spawn `git diff HEAD` via `child_process.exec` with 5s timeout; truncate to 10 KB; omit on any error without throwing
  - Open files: `vscode.workspace.textDocuments` filtered to `file:` scheme
  - If `vscode.workspace.workspaceFolders` is undefined or empty, throw a typed `NoWorkspaceError`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 5.1 Write property test: file tree depth and count limits
    - Generate mock fs trees with depth 1–10 and 0–500 entries; assert output never exceeds depth 3 or 200 entries
    - **Validates: Requirements 2.1**

  - [x] 5.2 Write property test: active file size threshold
    - Generate file content of random byte length; assert inclusion when ≤ 100 KB, exclusion when > 100 KB
    - **Validates: Requirements 2.2**

  - [x] 5.3 Write property test: partial error omission (ties to 2.6)
    - Randomly inject errors into individual collector steps; assert non-erroring items still present in context
    - **Validates: Requirements 2.6**

- [x] 6. Extend KurdostClient with tool-calling support
  - In `src/api/kurdostClient.ts`, add `chatWithTools(options: ChatWithToolsOptions): Promise<LLMToolResponse>` function
  - POST to `/api/v1/chat` (non-streaming) with `tools` and `tool_choice: 'auto'` fields in body
  - Parse `choices[0].message`: extract `content` and `tool_calls`; set `finishReason` from `choices[0].finish_reason`
  - If response is not ok or body is malformed, throw a descriptive `Error` with the raw body in the message
  - Existing `chat()` function signature and behavior MUST remain unchanged
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 6.1 Write property test: conversation history serialization (Property ties to 7.2)
    - Generate random OpenAIMessage arrays; serialize to JSON; assert valid JSON and schema conformance (role field present, tool messages have tool_call_id)
    - **Validates: Requirements 7.2**

  - [x] 6.2 Write property test: malformed response handling (Property ties to 7.4)
    - Generate arbitrary malformed JSON strings as mock LLM responses; assert descriptive Error thrown (never silent)
    - **Validates: Requirements 7.4**

- [x] 7. Implement AgentLoop
  - Create `src/agent/agentLoop.ts` with class `AgentLoop` accepting `AgentLoopOptions`
  - `run(userMessage, contextData, tools)` method implements the loop: build system prompt with workspace context + tool schemas → call `chatWithTools` → execute tool_calls → append messages → repeat
  - Enforce `maxIterations` (default 20); emit `onStepUpdate(step, max)` at start of each iteration
  - `stop()` method sets `_stopRequested = true`; loop checks flag before each iteration and before each tool execution
  - On each tool call: fire `onToolCall`; for write/delete/command calls fire `onApprovalRequired` and await response; fire `onToolResult`
  - On final answer (no tool_calls): call `onFinalAnswer(text, buildSummary())`
  - On iteration limit: call `onError(new Error('Iteration limit reached'))` with partial summary
  - `reset()` method clears messages array and sets status to idle (called on dispose)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 1.3, 1.5_

  - [-] 7.1 Write property test: iteration count monotonicity (Property 4)
    - **Property 4: Iteration Count Monotonicity**
    - Test with varying maxIterations (1–20) and mock infinite-tool-call LLM; assert step values are monotone and count ≤ maxIterations
    - **Validates: Requirements 6.3, 6.5**

  - [-] 7.2 Write property test: tool error continuation (Property 5)
    - **Property 5: Tool Error Continuation**
    - Generate boolean error patterns (which iterations error); assert loop never stops early on error, always forwards error as tool message
    - **Validates: Requirements 6.6**

  - [-] 7.3 Write property test: task summary completeness (Property ties to 6.7)
    - For any set of tool calls and files touched, assert all appear in final TaskSummary
    - **Validates: Requirements 6.7**

- [x] 8. Checkpoint — unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Build diff utility
  - Create `src/agent/diffUtil.ts` with `computeDiff(original: string, proposed: string): string` returning a unified diff string
  - Implement a line-level diff using a simple LCS approach (no external packages)
  - Handle both unified-diff patch input (pass through) and full-file replacement (compute diff from current vs proposed)
  - _Requirements: 5.1, 5.5, 5.6_

  - [~] 9.1 Write property test: full-file replacement always shows diff (Property 8)
    - **Property 8: Full-File Replacement Always Shows Diff**
    - For any (original, proposed) content pair, assert `computeDiff` returns a non-empty string and diff is presented before write
    - **Validates: Requirements 5.5, 5.6**

- [x] 10. Build AgentPanel WebView
  - Create `src/agent/agentPanel.ts` implementing `vscode.WebviewViewProvider`
  - Embed existing chat UI HTML/CSS/JS as base; add agent-specific UI elements:
    - Mode toggle button (Chat / Agent) with visual active indicator
    - Workspace root badge in toolbar (visible in agent mode)
    - Step counter (`Step N / 20`) visible during active loop
    - Collapsible tool call log (shows tool name, status: pending/done/error)
    - Diff preview pane with Approve / Reject buttons (shown when `approvalRequest` received)
    - Stop button (visible when loop is running)
    - Task summary block (shown on loop completion)
  - Wire `AgentLoop` callbacks to `postMessage` calls using the message protocol defined in design
  - Approval flow: `approvalRequest` → WebView renders diff + buttons → user clicks → `approvalResponse` → resolves pending Promise in loop
  - `dispose()` calls `agentLoop.reset()` to clear in-memory state
  - Retain `retainContextWhenHidden: true` to persist mode state across hide/show cycles
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 5.3, 6.4, 6.5, 8.5, 8.6_

  - [-] 10.1 Write integration test: approval gate blocks write until resolved
    - Assert that write_file does not execute until approvalResponse with approved=true is received
    - **Validates: Requirements 5.2, 5.3**

  - [ ] 10.2 Write integration test: stop button halts loop
    - Assert that calling stop() (simulated via stopLoop message) results in loopStopped message and no further tool executions
    - **Validates: Requirements 6.4**

- [x] 11. Update extension.ts to register agent panel and commands
  - Register `AgentPanel` as a second `WebviewViewProvider` for view id `kurdbox.agentView`
  - Add `kurdbox.openAgent` command that executes `workbench.view.extension.kurdbox` and switches to agent view
  - Add `kurdbox.agent.requireCommandConfirmation` configuration property (boolean, default: false) to `package.json`
  - Add `kurdbox.agentView` to the `views.kurdbox` array in `package.json` with `name: "Agent"`
  - Register `kurdbox.openAgent` command in `package.json` contributes.commands
  - Existing chat panel registration and all existing commands remain unchanged
  - _Requirements: 1.1, 4.3, 8.4_

- [x] 12. Add security configuration to package.json
  - Add `kurdbox.agent.requireCommandConfirmation` boolean config (default: false)
  - Add keybinding `ctrl+shift+a` / `cmd+shift+a` for `kurdbox.openAgent`
  - _Requirements: 8.3, 8.4_

- [x] 13. Final checkpoint — full build and integration tests pass
  - Run `npm run compile` to ensure no TypeScript errors
  - Ensure all unit and property tests pass, ask the user if questions arise.

## Task Dependency Graph

```
1 (types)
├── 2 (path security) → 3 (FS tools) → 6 (client) → 7 (agent loop) → 8 (checkpoint) → 9 (diff) → 10 (agent panel) → 11 (extension) → 12 (config) → 13 (final)
└── 4 (terminal tool) ──────────────────────────────────────┘
└── 5 (workspace context) ──────────────────────────────────┘
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP build
- `fast-check` must be added as a dev dependency before running property tests: `npm install --save-dev fast-check`
- All FileSystem tool operations use `vscode.workspace.fs` exclusively — no `fs` module from Node
- Terminal tool uses `child_process.exec` (Node built-in) — no new runtime dependencies
- Diff utility has no external dependencies — pure TypeScript LCS implementation
- The existing `ChatPanel` and `chat()` function are not modified; all agent code is additive
- Property tests run against pure TypeScript functions with mocked VS Code APIs — no VS Code runtime needed
- Each property test must include the tag comment: `// Feature: kurdbox-agent, Property N: <property text>`
