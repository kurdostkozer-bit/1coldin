/**
 * InlineCompletionProvider — debounced inline code completions.
 * Uses ApiClient singleton injected via setClient().
 */

import * as vscode from 'vscode';
import { ApiClient } from '../api/ApiClient';

export class KurdBoxInlineProvider implements vscode.InlineCompletionItemProvider {
    private _client?: ApiClient;
    private _debounceTimer: NodeJS.Timeout | undefined;

    setClient(client: ApiClient) { this._client = client; }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        cancelToken: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | null> {
        if (!vscode.workspace.getConfiguration('kurdbox').get('inlineCompletions', true)) { return null; }
        if (!this._client) { return null; }

        const startLine = Math.max(0, position.line - 20);
        const contextText = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
        if (contextText.trim().length < 3) { return null; }

        await new Promise<void>((resolve, reject) => {
            if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
            this._debounceTimer = setTimeout(resolve, 600);
            cancelToken.onCancellationRequested(reject);
        }).catch(() => null);

        if (cancelToken.isCancellationRequested) { return null; }

        const model = vscode.workspace.getConfiguration('kurdbox').get<string>('defaultModel', 'best-8b');
        const lang = document.languageId;
        const prompt = `Language: ${lang}\n\`\`\`${lang}\n${contextText}`;

        const completion = await this._client.complete(prompt, model);
        if (!completion || cancelToken.isCancellationRequested) { return null; }

        const clean = completion.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trimEnd();
        if (!clean) { return null; }

        return { items: [new vscode.InlineCompletionItem(clean, new vscode.Range(position, position))] };
    }
}
