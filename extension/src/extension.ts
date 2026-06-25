/**
 * KurdBox Extension Entry Point — v2.0
 * Wires all services together. No business logic here.
 * Dependency injection root: creates singletons and passes them down.
 * Auth flow: check SecretStorage on startup → show login screen if not authenticated.
 */

import * as vscode from 'vscode';
import { ApiClient } from './api/ApiClient';
import { UiBridge } from './ui/UiBridge';
import { ChatController } from './chat/ChatController';
import { ChatPanel } from './ui/panels/ChatPanel';
import { KurdBoxInlineProvider } from './completion/inlineProvider';
import { UpdateChecker } from './update/UpdateChecker';

export async function activate(context: vscode.ExtensionContext) {

    // ── Singleton services ────────────────────────────────────────────────────
    const apiClient = new ApiClient();
    apiClient.setSecretStorage(context.secrets);

    // Factory: create new controller per panel (each panel has its own bridge+history)
    const makeChatCtrl = (bridge: UiBridge, ctx: vscode.ExtensionContext) => new ChatController(apiClient, bridge, ctx);

    // ── Unified Panel (Chat + Agent) ───────────────────────────────────────────
    const chatPanel = ChatPanel.register(context.extensionUri, context, makeChatCtrl, apiClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatPanel.viewType,
            chatPanel,
            { webviewOptions: { retainContextWhenHidden: true } },
        )
    );

    // ── Inline Completions ────────────────────────────────────────────────────
    const inlineProvider = new KurdBoxInlineProvider();
    inlineProvider.setClient(apiClient);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
    );

    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('kurdbox.openChat', () =>
            vscode.commands.executeCommand('workbench.view.extension.kurdbox')
        ),
        vscode.commands.registerCommand('kurdbox.openAgent', () =>
            vscode.commands.executeCommand('workbench.view.extension.kurdbox')
        ),
        vscode.commands.registerCommand('kurdbox.setServer', async () => {
            const current = vscode.workspace.getConfiguration('kurdbox').get<string>('serverUrl', 'http://localhost:5001');
            const url = await vscode.window.showInputBox({
                prompt: 'KURDOST Server URL',
                value: current,
                placeHolder: 'http://localhost:5001',
            });
            if (url) {
                await vscode.workspace.getConfiguration('kurdbox')
                    .update('serverUrl', url, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`KurdBox: Server → ${url}`);
            }
        }),
        vscode.commands.registerCommand('kurdbox.logout', async () => {
            await apiClient.clearToken();
            ChatPanel.notifyAuthChanged(false);
            vscode.window.showInformationMessage('KurdBox: تم تسجيل الخروج.');
        }),
        vscode.commands.registerCommand('kurdbox.clearChat', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.kurdbox');
            ChatPanel.clearChat();
        }),
        vscode.commands.registerCommand('kurdbox.debugError', async () => {
            const editor = vscode.window.activeTextEditor;
            let errorText = editor?.document.getText(editor.selection).trim();
            if (!errorText) {
                errorText = await vscode.window.showInputBox({
                    prompt: 'الصق نص الخطأ هنا',
                    placeHolder: 'Error: ...',
                });
            }
            if (!errorText) { return; }
            await vscode.commands.executeCommand('workbench.view.extension.kurdbox');
            setTimeout(() => ChatPanel.sendDebugToPanel(errorText!), 300);
        }),
        vscode.commands.registerCommand('kurdbox.checkUpdates', async () => {
            const currentVersion = vscode.extensions.getExtension('kurdost.kurdbox')?.packageJSON.version || 'unknown';
            vscode.window.showInformationMessage(`KurdBox Extension v${currentVersion} - Latest version installed!`);
        }),
    );

    // ── Auto Update Check ──────────────────────────────────────────────────────
    UpdateChecker.scheduleAutoCheck(context);

    vscode.window.showInformationMessage('KurdBox AI جاهز! (Ctrl+Shift+K)');
}

export function deactivate() {}
