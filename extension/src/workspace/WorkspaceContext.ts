/**
 * WorkspaceContext — collects file tree, active file, git diff, open files.
 * Stateless: create a new instance per agent run.
 * Depends on VSCode API only.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { WorkspaceContextData, NoWorkspaceError } from '../api/types';

const MAX_DEPTH = 6;
const MAX_ENTRIES = 1000;
const MAX_ACTIVE_FILE_BYTES = 512000;
const MAX_GIT_DIFF_CHARS = 50000;
const GIT_TIMEOUT_MS = 5000;

async function buildFileTree(
    uri: vscode.Uri,
    prefix: string,
    depth: number,
    counter: { count: number }
): Promise<string> {
    if (depth > MAX_DEPTH || counter.count >= MAX_ENTRIES) { return ''; }
    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(uri);
    } catch { return ''; }

    entries.sort(([aName, aType], [bName, bType]) => {
        const aIsDir = (aType & vscode.FileType.Directory) !== 0;
        const bIsDir = (bType & vscode.FileType.Directory) !== 0;
        if (aIsDir !== bIsDir) { return aIsDir ? -1 : 1; }
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
            const sub = await buildFileTree(vscode.Uri.joinPath(uri, name), childPrefix, depth + 1, counter);
            if (sub) { lines.push(sub); }
        }
    }
    return lines.join('\n');
}

function getGitDiff(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        const child = exec('git diff HEAD', { cwd, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
            if (error) { resolve(undefined); return; }
            resolve(stdout.slice(0, MAX_GIT_DIFF_CHARS) || undefined);
        });
        child.on('error', () => resolve(undefined));
    });
}

export async function collectWorkspaceContext(): Promise<WorkspaceContextData> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { throw new NoWorkspaceError(); }

    // Support multiple workspaces
    const allWorkspaces = await Promise.all(
        folders.map(async (folder) => {
            const rootUri = folder.uri;
            const workspaceRoot = rootUri.fsPath;

            let fileTree = workspaceRoot + '/';
            try {
                const counter = { count: 0 };
                const sub = await buildFileTree(rootUri, '', 1, counter);
                fileTree = workspaceRoot + '/\n' + sub;
            } catch { /* use fallback */ }

            return { workspaceRoot, fileTree };
        })
    );

    // Use first workspace as primary for compatibility
    const primaryWorkspace = allWorkspaces[0];
    const workspaceRoot = primaryWorkspace.workspaceRoot;
    let fileTree = primaryWorkspace.fileTree;

    // If multiple workspaces, combine them
    if (allWorkspaces.length > 1) {
        fileTree = allWorkspaces.map(ws => ws.fileTree).join('\n\n');
    }

    let activeFileContent: string | undefined;
    let activeFilePath: string | undefined;
    try {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const text = editor.document.getText();
            if (text.length <= MAX_ACTIVE_FILE_BYTES) { activeFileContent = text; }
            activeFilePath = editor.document.uri.fsPath;
        }
    } catch { /* omit */ }

    let gitDiff: string | undefined;
    try { gitDiff = await getGitDiff(workspaceRoot); } catch { /* omit */ }

    let openFilePaths: string[] = [];
    try {
        openFilePaths = vscode.workspace.textDocuments
            .filter(d => d.uri.scheme === 'file')
            .map(d => d.uri.fsPath);
    } catch { openFilePaths = []; }

    return { workspaceRoot, fileTree, activeFileContent, activeFilePath, openFilePaths, gitDiff };
}
