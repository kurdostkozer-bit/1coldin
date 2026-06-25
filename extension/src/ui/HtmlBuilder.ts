/**
 * HtmlBuilder — shared utility for building WebView HTML.
 * Inlines shared.css and shared.js into the HTML template.
 * Used by both ChatPanel and AgentPanel — single source of truth.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function buildPanelHtml(
    extensionUri: vscode.Uri,
    templateName: 'chatView.html' | 'agentView.html',
): string {
    const base = extensionUri.fsPath;
    const htmlPath = path.join(base, 'src', 'ui', 'html', templateName);
    const cssPath  = path.join(base, 'src', 'ui', 'assets', 'shared.css');
    const jsPath   = path.join(base, 'src', 'ui', 'assets', 'shared.js');

    const css = fs.readFileSync(cssPath, 'utf8');
    const js  = fs.readFileSync(jsPath,  'utf8');
    let html  = fs.readFileSync(htmlPath, 'utf8');

    html = html.replace(/<link[^>]*\{\{STYLE_URI\}\}[^>]*>/g,  `<style>${css}</style>`);
    html = html.replace(/<script[^>]*src="\{\{SCRIPT_URI\}\}"[^>]*><\/script>/g, `<script>${js}</script>`);
    html = html.replace(
        /content="default-src 'none';[^"]*"/,
        `content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' https: http:; img-src 'self' https: http: data:;"`,
    );
    return html;
}
