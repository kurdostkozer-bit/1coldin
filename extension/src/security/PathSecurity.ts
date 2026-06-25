/**
 * PathSecurity — single canonical implementation of secure path resolution.
 * Resolves a relative path against workspaceRoot and rejects path traversal.
 * All tools import from HERE — never duplicate this logic.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SecurityError } from '../api/types';

export function resolveSecurePath(
    relativePath: string,
    workspaceRoot: vscode.Uri
): vscode.Uri {
    const rootFsPath = workspaceRoot.fsPath;
    const normalized = relativePath.replace(/\\/g, '/');
    const resolved = path.resolve(rootFsPath, normalized);

    const rootWithSep = rootFsPath.endsWith(path.sep)
        ? rootFsPath
        : rootFsPath + path.sep;

    if (resolved !== rootFsPath && !resolved.startsWith(rootWithSep)) {
        throw new SecurityError(`Path "${relativePath}" escapes the workspace root`);
    }
    return vscode.Uri.file(resolved);
}
