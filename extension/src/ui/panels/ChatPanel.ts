/**
 * UnifiedPanel — Single WebviewViewProvider for both Chat and Agent modes.
 * Handles auth flow: shows login screen if not authenticated.
 */

import * as vscode from 'vscode';
import { ChatController } from '../../chat/ChatController';
import { UiBridge } from '../UiBridge';
import { UiMessage } from '../../api/types';
import { buildPanelHtml } from '../HtmlBuilder';
import { ApiClient } from '../../api/ApiClient';

export class ChatPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'kurdbox.chatView';
    private static _instance: ChatPanel | undefined;

    private _view?: vscode.WebviewView;
    private _bridge = new UiBridge();
    private _chatCtrl?: ChatController;
    private _htmlLoaded = false;
    private _messageSub?: vscode.Disposable;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _makeChatCtrl: (bridge: UiBridge, context: vscode.ExtensionContext) => ChatController,
        private readonly _apiClient: ApiClient,
    ) {}

    public static register(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        makeChatCtrl: (bridge: UiBridge, context: vscode.ExtensionContext) => ChatController,
        apiClient: ApiClient,
    ): ChatPanel {
        const panel = new ChatPanel(extensionUri, context, makeChatCtrl, apiClient);
        ChatPanel._instance = panel;
        return panel;
    }

    public static sendDebugToPanel(errorText: string): void {
        ChatPanel._instance?._bridge.send({ type: 'debugInject', text: errorText });
    }

    public static clearChat(): void {
        void ChatPanel._instance?._chatCtrl?.clear();
    }

    public static notifyAuthChanged(loggedIn: boolean): void {
        ChatPanel._instance?._bridge.send({
            type: 'authStatus', loggedIn, username: undefined, isAdmin: undefined,
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        this._bridge.setView(webviewView);

        if (!this._chatCtrl) {
            this._chatCtrl = this._makeChatCtrl(this._bridge, this._context);
        }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        this._messageSub?.dispose();
        this._messageSub = undefined;

        if (!this._htmlLoaded) {
            webviewView.webview.html = buildPanelHtml(this._extensionUri, 'chatView.html');
            this._htmlLoaded = true;
        }

        this._messageSub = webviewView.webview.onDidReceiveMessage(
            (msg: UiMessage) => this._handleMessage(msg),
        );
        this._context.subscriptions.push(this._messageSub);

        webviewView.onDidDispose(() => {
            this._htmlLoaded = false;
            this._messageSub?.dispose();
            this._messageSub = undefined;
        });
    }

    private async _handleMessage(msg: UiMessage): Promise<void> {
        switch (msg.type) {
            case 'ready':
                await this._onReady();
                break;

            case 'login':
                await this._handleLogin(msg.username, msg.password);
                break;

            case 'register':
                await this._handleRegister(msg.username, msg.password);
                break;

            case 'logout':
                await this._apiClient.clearToken();
                this._bridge.send({ type: 'authStatus', loggedIn: false });
                break;

            case 'addProviderKey':
                await this._handleAddProviderKey(msg.provider, msg.apiKey);
                break;

            case 'send':
                void this._chatCtrl?.handleUserMessage(msg.text, msg.model, msg.provider, msg.stream)
                    ?.catch(err => console.error('[KurdBox] handleUserMessage:', err));
                break;

            case 'debug':
                void this._chatCtrl?.handleDebug(msg.text)
                    ?.catch(err => console.error('[KurdBox] handleDebug:', err));
                break;

            case 'approve':
                (this._chatCtrl as any)?._agentController?.resolveApproval(msg.callId, msg.approved);
                break;

            case 'stopLoop':
                (this._chatCtrl as any)?._agentController?.stop();
                break;

            case 'clear':
                this._chatCtrl?.clear();
                break;

            case 'getHistory':
                this._chatCtrl?.getHistory().then(history => {
                    this._bridge.send({ type: 'historyData', data: history });
                });
                break;

            case 'loadConversation':
                if (msg.id) { this._chatCtrl?.loadConversation(msg.id); }
                break;

            case 'deleteConversation':
                if (msg.id) {
                    this._chatCtrl?.deleteConversation(msg.id).then(() => {
                        this._chatCtrl?.getHistory().then(history => {
                            this._bridge.send({ type: 'historyData', data: history });
                        });
                    });
                }
                break;

            case 'clearHistory':
                this._chatCtrl?.clearHistory().then(() => {
                    this._bridge.send({ type: 'historyData', data: [] });
                });
                break;
        }
    }

    private async _onReady(): Promise<void> {
        const loggedIn = await this._apiClient.loadStoredToken();
        if (!loggedIn) {
            this._bridge.send({ type: 'authStatus', loggedIn: false });
            return;
        }
        // Already logged in — send auth status and load providers
        this._bridge.send({ type: 'authStatus', loggedIn: true });
        this._chatCtrl?.fetchAndSendProviders();
        this._chatCtrl?.syncUiToWebview();
    }

    private async _handleLogin(username: string, password: string): Promise<void> {
        try {
            const result = await this._apiClient.login(username, password);
            this._bridge.send({ type: 'authSuccess', username: result.username, isAdmin: result.isAdmin });
            this._chatCtrl?.fetchAndSendProviders();
            this._chatCtrl?.syncUiToWebview();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._bridge.send({ type: 'authError', message: msg });
        }
    }

    private async _handleRegister(username: string, password: string): Promise<void> {
        try {
            const result = await this._apiClient.register(username, password);
            this._bridge.send({ type: 'authSuccess', username: result.username, isAdmin: result.isAdmin });
            // After register, fetch supported providers list for setup screen
            if (result.isAdmin) {
                const supported = await this._apiClient.fetchSupportedProviders();
                this._bridge.send({ type: 'supportedProviders', data: supported });
            } else {
                this._chatCtrl?.fetchAndSendProviders();
                this._chatCtrl?.syncUiToWebview();
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._bridge.send({ type: 'authError', message: msg });
        }
    }

    private async _handleAddProviderKey(provider: string, apiKey: string): Promise<void> {
        try {
            await this._apiClient.addProviderKey(provider, apiKey);
            this._bridge.send({ type: 'keyAdded', provider });
            this._chatCtrl?.fetchAndSendProviders();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this._bridge.send({ type: 'keyError', message: msg });
        }
    }
}
