/**
 * ChatController — chat session logic. UI updates via renderChat only (single source of truth).
 */

import * as vscode from 'vscode';
import { ApiClient } from '../api/ApiClient';
import { UiBridge } from '../ui/UiBridge';
import { ChatMessage } from '../api/types';
import { selectModel } from './ModelSelector';
import { collectWorkspaceContext } from '../workspace/WorkspaceContext';
import { analyzeRequest } from './IntelligentRouter';
import { AgentController } from '../agent/AgentController';
import { ChatHistoryManager } from './ChatHistoryManager';
import { safeErrorMessage } from '../utils/safeError';

export type UiChatMessage = { role: 'user' | 'assistant' | 'error'; text: string };

const CHAT_SYSTEM_PROMPT =
    'You are KurdBox AI, a helpful coding assistant inside VS Code. ' +
    'Reply in the same language the user writes. ' +
    'Do not invent or assume project files, bots, or code the user has not shared in this message. ' +
    'If the user only greets you, reply with one short friendly sentence only.';

const CHAT_GREETING_PROMPT =
    'You are KurdBox AI. The user sent a greeting only. ' +
    'Reply with ONE short friendly sentence in the same language. ' +
    'Do NOT mention files, projects, code, bots, or workspace context.';

function isSimpleGreeting(text: string): boolean {
    return /^(مرحبا|مرحباً|سلام|هلا|أهلا|أهلاً|hello|hi|hey|سلاو|سڵاو|چۆنی|باشی|صباح|مساء)[\s!.,؟?]*$/iu.test(text.trim());
}

function sanitizeUserContent(content: string | null): string {
    if (!content) { return ''; }
    const sep = '\n\n---\n\n';
    const idx = content.lastIndexOf(sep);
    if (idx > 0) { return content.slice(idx + sep.length).trim(); }
    return content;
}

function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(m =>
        m.role === 'user' ? { ...m, content: sanitizeUserContent(m.content) } : m
    );
}

function historyToUi(messages: ChatMessage[]): UiChatMessage[] {
    return messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
            role: m.role as 'user' | 'assistant',
            text: m.role === 'user' ? sanitizeUserContent(m.content) : (m.content ?? ''),
        }))
        .filter(m => m.text.trim());
}

export class ChatController {

    private _history: ChatMessage[] = [];
    private _uiMessages: UiChatMessage[] = [];
    private _streaming = false;
    private _pending = false;
    private _thinking = false;
    private _agentController: AgentController | null = null;
    private _currentConversationId: string | null = null;
    private _renderTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly _client: ApiClient,
        private readonly _bridge: UiBridge,
        private readonly _context: vscode.ExtensionContext,
    ) {
        this._agentController = new AgentController(_client, _bridge);
    }

    // ── UI sync (single message type) ─────────────────────────────────────────

    private renderUi(force = false): void {
        if (!force && this._streaming) {
            if (this._renderTimer) { clearTimeout(this._renderTimer); }
            this._renderTimer = setTimeout(() => this._flushRender(), 80);
            return;
        }
        this._flushRender();
    }

    private _flushRender(): void {
        if (this._renderTimer) {
            clearTimeout(this._renderTimer);
            this._renderTimer = undefined;
        }
        this._bridge.send({
            type: 'renderChat',
            messages: this._uiMessages,
            thinking: this._thinking,
        });
    }

    /** Called when webview loads — restore visible messages from controller memory. */
    syncUiToWebview(): void {
        if (this._pending || this._streaming) { return; }
        this.renderUi();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async handleUserMessage(
        text: string,
        model: string,
        provider: string,
        stream: boolean,
    ): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) { return; }

        if (this._streaming || this._pending) {
            this._bridge.send({ type: 'renderChat', messages: this._uiMessages, thinking: this._thinking });
            this._bridge.send({ type: 'error', text: 'يرجى انتظار انتهاء الرد الحالي...' });
            return;
        }

        this._pending = true;
        this._thinking = true;

        const greeting = isSimpleGreeting(trimmed);
        if (greeting) {
            this._history = [];
            this._currentConversationId = null;
            this._uiMessages = [{ role: 'user', text: trimmed }];
        } else {
            this._uiMessages.push({ role: 'user', text: trimmed });
        }
        this.renderUi(true);

        try {
            const resolvedModel = model || selectModel(trimmed);
            const autoAgent = vscode.workspace
                .getConfiguration('kurdbox')
                .get<boolean>('chat.autoAgentRouting', false);
            const decision = analyzeRequest(trimmed, autoAgent);

            if (decision.mode === 'agent') {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                this._bridge.send({ type: 'agentModeChange', active: true, workspaceRoot: root });
                try {
                    if (this._agentController) {
                        await this._agentController.startRun(trimmed, resolvedModel, provider);
                    }
                } finally {
                    this._bridge.send({ type: 'agentModeChange', active: false, workspaceRoot: '' });
                }
            } else {
                this._bridge.send({ type: 'agentModeChange', active: false, workspaceRoot: '' });

                const includeContext = vscode.workspace
                    .getConfiguration('kurdbox')
                    .get<boolean>('chat.includeWorkspaceContext', false);

                let messageContent = trimmed;
                if (includeContext && !greeting) {
                    try {
                        const context = await collectWorkspaceContext();
                        const parts: string[] = [];
                        if (context.activeFilePath) {
                            parts.push(`الملف النشط: ${context.activeFilePath}`);
                        }
                        if (context.activeFileContent && context.activeFileContent.length <= 4000) {
                            parts.push(`محتوى الملف:\n${context.activeFileContent}`);
                        }
                        if (parts.length > 0) {
                            messageContent = `${parts.join('\n\n')}\n\n---\n\n${trimmed}`;
                        }
                    } catch (err) {
                        console.warn('Failed to collect workspace context:', err);
                    }
                }

                const systemPrompt = greeting ? CHAT_GREETING_PROMPT : CHAT_SYSTEM_PROMPT;
                const apiMessages: ChatMessage[] = [
                    { role: 'system', content: systemPrompt },
                    ...this._history.slice(-20),
                    { role: 'user', content: messageContent },
                ];

                try {
                    await this._executeRequest(resolvedModel, provider, stream, apiMessages, trimmed);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('انتهت الجلسة') || msg.includes('401')) {
                        try {
                            await this._client.getToken();
                            await this._executeRequest(resolvedModel, provider, stream, apiMessages, trimmed);
                            return;
                        } catch (retryErr: unknown) {
                            this._failUi(retryErr);
                            return;
                        }
                    }
                    this._failUi(err);
                }
            }
        } finally {
            this._pending = false;
            this._thinking = false;
            // ✅ الإصلاح: حذف renderUi(true) من هنا لتجنب ظهور الرسائل مرتين.
            // _streamResponse و _singleResponse يستدعيان renderUi بأنفسهما.
            this._bridge.send({ type: 'requestEnd' });
        }
    }

    async handleDebug(errorText: string): Promise<void> {
        const prompt = `أنت خبير debugging. حلّل هذا الخطأ وأعطني الحل مباشرة بدون مقدمات:\n\n${errorText}`;
        await this.handleUserMessage(prompt, 'best-70b', '', false);
    }

    fetchAndSendProviders(): void {
        void this._client.fetchProviders()
            .then(p => this._bridge.send({ type: 'providers', data: p }))
            .catch(err => console.warn('[KurdBox] fetchProviders:', safeErrorMessage(err)));
    }

    async clear(): Promise<void> {
        if (this._history.length > 0) {
            await this.saveHistory();
        }
        this._history = [];
        this._uiMessages = [];
        this._currentConversationId = null;
        this.renderUi(true);
    }

    async saveHistory(): Promise<void> {
        if (this._history.length > 0) {
            const clean = sanitizeHistory(this._history);
            await ChatHistoryManager.saveConversation(
                this._context, clean, undefined, this._currentConversationId || undefined,
            );
            if (!this._currentConversationId) {
                const history = await this.getHistory();
                this._currentConversationId = history[0]?.id || null;
            }
        }
    }

    async getHistory(): Promise<any[]> {
        return ChatHistoryManager.getHistory(this._context);
    }

    async loadConversation(id: string): Promise<void> {
        const conversation = await ChatHistoryManager.loadConversation(this._context, id);
        if (conversation) {
            this._history = sanitizeHistory(conversation.messages);
            this._currentConversationId = id;
            this._uiMessages = historyToUi(this._history);
            this.renderUi(true);
        }
    }

    async deleteConversation(id: string): Promise<void> {
        await ChatHistoryManager.deleteConversation(this._context, id);
    }

    async clearHistory(): Promise<void> {
        await ChatHistoryManager.clearHistory(this._context);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _failUi(err: unknown): void {
        this._thinking = false;
        this._uiMessages.push({ role: 'error', text: safeErrorMessage(err) });
        this.renderUi(true);
    }

    private async _executeRequest(
        model: string, provider: string, stream: boolean,
        apiMessages: ChatMessage[], originalText: string,
    ): Promise<void> {
        if (stream) {
            await this._streamResponse(model, provider, apiMessages, originalText);
        } else {
            await this._singleResponse(model, provider, apiMessages, originalText);
        }
    }

    private async _streamResponse(
        model: string, provider: string, apiMessages: ChatMessage[], originalText: string,
    ): Promise<void> {
        this._streaming = true;
        this._thinking = false;
        this._uiMessages.push({ role: 'assistant', text: '' });
        this.renderUi(true);

        let full = '';
        const assistantIdx = this._uiMessages.length - 1;

        try {
            await this._client.streamChat(
                { model, messages: apiMessages, stream: true, provider_hint: provider || undefined },
                (chunk) => {
                    full += chunk;
                    this._uiMessages[assistantIdx].text = full;
                    this.renderUi();
                },
            );
            this._history.push({ role: 'user', content: originalText });
            this._history.push({ role: 'assistant', content: full });
            await this.saveHistory();
        } catch (err: unknown) {
            if (!full.trim()) {
                this._uiMessages.pop();
            }
            this._failUi(err);
        } finally {
            this._streaming = false;
            // ✅ render نهائي بعد انتهاء الـ streaming
            this.renderUi(true);
        }
    }

    private async _singleResponse(
        model: string, provider: string, apiMessages: ChatMessage[], originalText: string,
    ): Promise<void> {
        this._thinking = false;
        const reply = await this._client.chat({
            model,
            messages: apiMessages,
            stream: false,
            provider_hint: provider || undefined,
        });
        this._history.push({ role: 'user', content: originalText });
        this._history.push({ role: 'assistant', content: reply });
        this._uiMessages.push({ role: 'assistant', text: reply });
        this.renderUi(true);
        await this.saveHistory();
    }
}