/**
 * WorkspaceContext collector for kurdbox-agent.
 * Gathers file tree, active file content, git diff, and open file paths.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { WorkspaceContextData, NoWorkspaceError } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEPTH = 3;
const MAX_ENTRIES = 200;
const MAX_ACTIVE_FILE_BYTES = 102400;   // 100 KB
const MAX_GIT_DIFF_CHARS = 10240;       // 10 KB
const GIT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// File tree helpers
// ---------------------------------------------------------------------------

/**
 * Recursively builds an ASCII file tree using vscode.workspace.fs.
 * Stops at MAX_DEPTH levels deep and caps at MAX_ENTRIES total entries.
 */
async function buildFileTree(
    uri: vscode.Uri,
    prefix: string,
    depth: number,
    counter: { count: number }
): Promise<string> {
    if (depth > MAX_DEPTH || counter.count >= MAX_ENTRIES) {
        return '';
    }

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
        return '';
    }

    // Sort: directories first, then files, alphabetically within each group
    entries.sort(([aName, aType], [bName, bType]) => {
        const aIsDir = (aType & vscode.FileType.Directory) !== 0;
        const bIsDir = (bType & vscode.FileType.Directory) !== 0;
        if (aIsDir !== bIsDir) {
            return aIsDir ? -1 : 1;
        }
        return aName.localeCompare(bName);
    });

    const lines: string[] = [];

    for (let i = 0; i < entries.length; i++) {
        if (counter.count >= MAX_ENTRIES) {
            lines.push(`${prefix}└── ... (truncated at ${MAX_ENTRIES} entries)`);
            break;
        }

        const [name, type] = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';
        const isDir = (type & vscode.FileType.Directory) !== 0;

        counter.count++;
        lines.push(`${prefix}${connector}${name}${isDir ? '/' : ''}`);

        if (isDir && depth < MAX_DEPTH) {
            const childUri = vscode.Uri.joinPath(uri, name);
            const subtree = await buildFileTree(childUri, childPrefix, depth + 1, counter);
            if (subtree) {
                lines.push(subtree);
            }
        }
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Git diff helper
// ---------------------------------------------------------------------------

/**
 * Runs `git diff HEAD` in the given directory with a 5s timeout.
 * Returns undefined on any error (git not found, not a repo, timeout, etc.).
 */
function getGitDiff(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const child = exec(
            'git diff HEAD',
            { cwd, timeout: GIT_TIMEOUT_MS },
            (error, stdout) => {
                if (error) {
                    resolve(undefined);
                    return;
                }
                const diff = stdout.slice(0, MAX_GIT_DIFF_CHARS);
                resolve(diff || undefined);
            }
        );

        // Belt-and-suspenders: if exec itself throws synchronously
        child.on('error', () => resolve(undefined));
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Collects workspace context for injection into the agent system prompt.
 * Throws NoWorkspaceError if no workspace folder is open.
 * All other collection steps (active file, git diff, open files) are
 * individually wrapped in try/catch — errors silently omit that item.
 */
export async function collectWorkspaceContext(): Promise<WorkspaceContextData> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new NoWorkspaceError();
    }

    const rootUri = folders[0].uri;
    const workspaceRoot = rootUri.fsPath;

    // ---- File tree --------------------------------------------------------
    let fileTree = '';
    try {
        const counter = { count: 0 };
        const subtree = await buildFileTree(rootUri, '', 1, counter);
        fileTree = workspaceRoot + '/\n' + subtree;
    } catch {
        fileTree = workspaceRoot + '/';
    }

    // ---- Active file ------------------------------------------------------
    let activeFileContent: string | undefined;
    let activeFilePath: string | undefined;
    try {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            const text = doc.getText();
            if (text.length <= MAX_ACTIVE_FILE_BYTES) {
                activeFileContent = text;
            }
            activeFilePath = doc.uri.fsPath;
        }
    } catch {
        // omit active file on error
    }

    // ---- Git diff ---------------------------------------------------------
    let gitDiff: string | undefined;
    try {
        gitDiff = await getGitDiff(workspaceRoot);
    } catch {
        // omit git diff on error
    }

    // ---- Open files -------------------------------------------------------
    let openFilePaths: string[] = [];
    try {
        openFilePaths = vscode.workspace.textDocuments
            .filter(doc => doc.uri.scheme === 'file')
            .map(doc => doc.uri.fsPath);
    } catch {
        openFilePaths = [];
    }

    return {
        workspaceRoot,
        fileTree,
        activeFileContent,
        activeFilePath,
        openFilePaths,
        gitDiff,
    };
}
