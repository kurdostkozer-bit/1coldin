# Requirements Document

## Introduction

The `kurdbox-agent` feature upgrades the existing KurdBox VS Code extension from a simple chat interface into a full AI coding agent — comparable to Cursor, Copilot Agent, or Cline. The agent can autonomously read and write files, run shell commands, analyze the workspace, preview and apply code changes, and execute multi-step tool-calling loops until a task is complete. All actions are routed through the existing KurdBox FastAPI LLM gateway at `localhost:5000` and are performed exclusively via the VS Code extension API (`vscode.workspace.fs`, `vscode.window.createTerminal`, etc.).

---

## Glossary

- **Agent**: The kurdbox-agent subsystem that orchestrates tool calls, sends requests to the LLM gateway, and applies results to the workspace.
- **Tool**: A discrete capability the Agent exposes to the LLM (e.g., `read_file`, `write_file`, `run_command`).
- **Tool_Call**: A structured request from the LLM to invoke a named Tool with specified arguments.
- **Tool_Result**: The structured response returned by a Tool after execution, sent back to the LLM.
- **Tool_Loop**: The iterative cycle of LLM → Tool_Call → Tool_Result → LLM until the LLM signals task completion or the iteration limit is reached.
- **WorkspaceContext**: Aggregated information about the current workspace sent as system context with every agent request (file tree, open files, active file content, git diff).
- **Diff**: A unified diff string representing proposed changes to one or more files.
- **ApprovalStep**: The interactive UI step presented to the user before the Agent applies any file mutation.
- **FileSystem_Tool**: The group of Tools that read, write, create, delete, or list files via `vscode.workspace.fs`.
- **Terminal_Tool**: The Tool that runs shell commands and captures stdout/stderr via a VS Code terminal.
- **AgentPanel**: The upgraded WebView panel that replaces the plain chat panel when agent mode is active.
- **KurdostClient**: The existing HTTP client module (`src/api/kurdostClient.ts`) connecting to the FastAPI gateway.
- **LLM_Gateway**: The KurdBox FastAPI backend at `localhost:5000` that proxies requests to 20+ LLM providers.
- **Iteration_Limit**: The maximum number of Tool_Loop cycles the Agent is allowed before stopping and reporting to the user.
- **Workspace_Root**: The root directory of the currently open VS Code workspace folder.

---

## Requirements

### Requirement 1: Agent Mode Activation

**User Story:** As a developer, I want to switch the KurdBox panel into agent mode, so that I can ask the AI to perform multi-step coding tasks autonomously.

#### Acceptance Criteria

1. WHEN a user clicks the "Agent" mode button in the AgentPanel toolbar, THE AgentPanel SHALL switch from plain chat mode to agent mode and display a visual indicator that agent mode is active.
2. WHEN agent mode is active, THE AgentPanel SHALL display the current Workspace_Root path in the toolbar.
3. WHEN the AgentPanel is not in agent mode, THE Agent SHALL NOT execute any Tool_Calls or mutate any files.
4. THE AgentPanel SHALL persist the agent mode state across WebView hide/show cycles using `vscode.WebviewView` retained context.
5. WHEN the user submits a task in agent mode, THE Agent SHALL include the WorkspaceContext in the first LLM request for that task.

---

### Requirement 2: Workspace Context Collection

**User Story:** As a developer, I want the agent to understand my workspace automatically, so that it can make relevant suggestions without me pasting file contents manually.

#### Acceptance Criteria

1. WHEN the Agent prepares a request, THE Agent SHALL collect a file tree of the Workspace_Root limited to 3 levels of depth and 200 entries maximum.
2. WHEN the Agent prepares a request, THE Agent SHALL include the content of the currently active editor file if its size is 100 KB or less.
3. WHEN the Agent prepares a request and a git repository is present, THE Agent SHALL include the output of `git diff HEAD` limited to 10 KB.
4. WHEN the Agent prepares a request, THE Agent SHALL include the list of currently open editor file paths.
5. IF the Workspace_Root is undefined (no folder open), THEN THE Agent SHALL cancel the request and attempt to notify the user with an error message. THE Agent SHALL cancel the request regardless of whether the error notification is successfully delivered.
6. WHEN workspace context collection encounters an error for a specific item (e.g., git is not installed), THE Agent SHALL omit that item from the WorkspaceContext and continue without error.

---

### Requirement 3: File System Tools

**User Story:** As a developer, I want the agent to read, write, create, and delete files in my workspace, so that it can implement code changes on my behalf.

#### Acceptance Criteria

1. WHEN the LLM issues a `read_file` Tool_Call with a valid relative path, THE FileSystem_Tool SHALL return the UTF-8 content of that file as a Tool_Result.
2. WHEN the LLM issues a `read_file` Tool_Call with a path that does not exist and the path is within the Workspace_Root, THE FileSystem_Tool SHALL return a Tool_Result containing a descriptive file-not-found error message. IF the path resolves outside the Workspace_Root, THEN THE FileSystem_Tool SHALL return a security error message.
3. WHEN the LLM issues a `write_file` Tool_Call with a valid relative path and content, THE FileSystem_Tool SHALL write the content to that path, creating parent directories as needed, after the user approves the ApprovalStep.
4. WHEN the LLM issues a `create_file` Tool_Call with a path that already exists, THE FileSystem_Tool SHALL return a Tool_Result containing a descriptive error message without overwriting the file.
5. WHEN the LLM issues a `delete_file` Tool_Call, THE FileSystem_Tool SHALL delete the file after the user approves the ApprovalStep.
6. WHEN the LLM issues a `list_directory` Tool_Call with a valid relative path, THE FileSystem_Tool SHALL return a structured list of file and directory names at that path as a Tool_Result.
7. THE FileSystem_Tool SHALL reject any path that resolves outside the Workspace_Root and return a Tool_Result containing a descriptive security error message.
8. WHEN a file operation completes successfully, THE FileSystem_Tool SHALL return a Tool_Result that includes the absolute path of the affected file.

---

### Requirement 4: Terminal Tool

**User Story:** As a developer, I want the agent to run shell commands and see their output, so that it can execute tests, builds, and scripts as part of a coding task.

#### Acceptance Criteria

1. WHEN the LLM issues a `run_command` Tool_Call with a shell command string, THE Terminal_Tool SHALL execute the command in the Workspace_Root directory and return stdout and stderr as a Tool_Result.
2. WHEN the LLM issues a `run_command` Tool_Call, THE AgentPanel SHALL display the command to the user before execution.
3. WHEN a `run_command` Tool_Call requires user confirmation (configurable), THE Terminal_Tool SHALL pause execution and await explicit user approval before running the command.
4. WHEN a command exceeds 30 seconds, THE Terminal_Tool SHALL terminate the command and return a timeout error in the Tool_Result, even if the command completed successfully at the boundary.
5. WHEN a command produces more than 50 KB of combined stdout/stderr output, THE Terminal_Tool SHALL truncate the output to 50 KB and append a truncation notice to the Tool_Result.
6. IF a `run_command` Tool_Call is issued while agent mode is inactive, THEN THE Terminal_Tool SHALL return a Tool_Result containing a descriptive error message without executing the command.

---

### Requirement 5: Diff and Apply

**User Story:** As a developer, I want to preview proposed code changes before they are applied, so that I can maintain control over what the agent writes to my files.

#### Acceptance Criteria

1. WHEN the LLM proposes a code change, THE Agent SHALL present the change to the user as a unified diff in the AgentPanel before writing any file.
2. WHEN the user approves a diff, THE Agent SHALL apply the change to the target file using the VS Code `vscode.workspace.fs.writeFile` API.
3. WHEN the user rejects a diff, THE Agent SHALL record the rejection as a Tool_Result and continue the Tool_Loop without modifying the file.
4. WHEN applying a diff fails (e.g., context mismatch), THE Agent SHALL report the failure as a Tool_Result and NOT silently overwrite the file with the partial change.
5. THE Agent SHALL support both unified diff format and full file replacement as valid change formats.
6. WHEN a full file replacement is proposed, THE Agent SHALL still present a diff view computed by comparing the current file content with the proposed replacement before applying.

---

### Requirement 6: Tool-Calling Loop

**User Story:** As a developer, I want the agent to chain multiple tool calls autonomously until the task is finished, so that it can complete complex coding tasks without step-by-step prompting from me.

#### Acceptance Criteria

1. WHEN the LLM returns a response containing one or more Tool_Calls, THE Agent SHALL execute each Tool_Call, collect all Tool_Results, and send them back to the LLM in the next iteration of the Tool_Loop.
2. WHEN the LLM returns a response with no Tool_Calls, THE Agent SHALL treat the response as the final answer and display it in the AgentPanel.
3. THE Agent SHALL enforce an Iteration_Limit of 20 Tool_Loop cycles per task. WHEN the Iteration_Limit is reached, THE Agent SHALL stop the loop and notify the user that the limit was reached.
4. WHEN the user clicks a "Stop" button during an active Tool_Loop, THE Agent SHALL explicitly set the loop state to STOPPED, cancel the current iteration, and halt the loop after the in-flight Tool_Call completes.
5. THE Agent SHALL display a live step counter (e.g., "Step 3 / 20") in the AgentPanel during an active Tool_Loop.
6. WHEN an individual Tool_Call returns an error Tool_Result, THE Agent SHALL include the error in the next LLM message and continue the Tool_Loop rather than aborting.
7. WHEN the Tool_Loop completes (by final answer or limit), THE Agent SHALL display a summary of all tools used and files changed during the task.

---

### Requirement 7: Agent Communication Protocol

**User Story:** As a developer, I want the agent to communicate tool capabilities to the LLM in a structured format, so that the LLM can reliably invoke tools and the agent can reliably parse responses.

#### Acceptance Criteria

1. THE Agent SHALL define each Tool as a JSON Schema object containing the tool name, description, and parameter types, and SHALL include this schema in the system prompt sent to the LLM_Gateway.
2. WHEN sending a message to the LLM_Gateway, THE Agent SHALL serialize the full Tool_Loop conversation history (user messages, assistant messages, Tool_Calls, and Tool_Results) as a valid JSON array conforming to the OpenAI function-calling message format.
3. WHEN the LLM_Gateway returns a response, THE Agent SHALL parse Tool_Calls from the response using the `tool_calls` array in the assistant message.
4. IF the LLM_Gateway returns a malformed response that cannot be parsed as a valid Tool_Call or final answer, THEN THE Agent SHALL return a descriptive error Tool_Result and continue the Tool_Loop. THE Agent SHOULD log the raw response when logging does not interfere with error handling.
5. THE Agent SHALL pass the tool schema and conversation history to the KurdostClient, which SHALL forward them to the LLM_Gateway endpoint `/api/v1/chat`.

---

### Requirement 8: Security and Safety

**User Story:** As a developer, I want the agent to operate safely within my workspace, so that it cannot accidentally destroy files or run dangerous commands outside the workspace.

#### Acceptance Criteria

1. THE Agent SHALL resolve all file paths to absolute paths and verify they are within the Workspace_Root before executing any FileSystem_Tool operation.
2. WHEN a path traversal is detected (e.g., `../../etc/passwd`), THE Agent SHALL reject the Tool_Call and return a security error Tool_Result without touching the filesystem.
3. THE Agent SHALL require explicit user confirmation before executing any `delete_file` Tool_Call when a delete_file operation is actually requested, regardless of any other configuration settings.
4. WHERE the configuration option `kurdbox.agent.requireCommandConfirmation` is enabled, THE Terminal_Tool SHALL require explicit user confirmation before executing any `run_command` Tool_Call.
5. THE Agent SHALL NOT store conversation history or Tool_Results that contain file contents to disk; all state SHALL be kept in-memory for the lifetime of the AgentPanel WebView session.
6. WHEN the AgentPanel WebView is disposed, THE Agent SHALL clear all in-memory conversation history and Tool_Results.
