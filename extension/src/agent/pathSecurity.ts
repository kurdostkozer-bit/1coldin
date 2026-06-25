/**
 * Path security utility for kurdbox-agent.
 * Resolves a relative path against the workspace root and rejects any path
 * whose resolved fsPath does not start with the workspace root fsPath.
 * Requirements: 3.7, 8.1, 8.2
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SecurityError } from './types';

/**
 * Resolves `relativePath` against `workspaceRoot`, normalising separators and
 * resolving all `..` segments, then verifies the result is contained within
 * the workspace root.
 *
 * @param relativePath - A relative (or potentially malicious) path string.
 * @param workspaceRoot - The workspace root URI used as the security boundary.
 * @returns A `vscode.Uri` pointing to the resolved path inside the workspace.
 * @throws {SecurityError} When the resolved path escapes the workspace root.
 */
export function resolveSecurePath(
    relativePath: string,
    workspaceRoot: vscode.Uri
): vscode.Uri {
    const rootFsPath = workspaceRoot.fsPath;

    // 1. Normalize separators to forward slashes so path.resolve handles
    //    both Windows back-slashes and forward-slashes consistently.
    const normalized = relativePath.replace(/\\/g, '/');

    // 2. Join with workspaceRoot.fsPath and resolve all '..' segments.
    const resolved = path.resolve(rootFsPath, normalized);

    // 3. Build a root sentinel that always ends with the platform separator so
    //    a resolved path of "/workspace-root-extra" does NOT match "/workspace-root".
    const rootWithSep = rootFsPath.endsWith(path.sep)
        ? rootFsPath
        : rootFsPath + path.sep;

    // 4. The resolved path is allowed only when it equals the root itself or
    //    starts with the root-plus-separator prefix.
    if (resolved !== rootFsPath && !resolved.startsWith(rootWithSep)) {
        throw new SecurityError(
            `Path "${relativePath}" escapes the workspace root`
        );
    }

    return vscode.Uri.file(resolved);
}
