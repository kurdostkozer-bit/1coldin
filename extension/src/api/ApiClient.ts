/**
 * ApiClient — single point of contact with the KurdBox Backend.
 * Owns: token management (stored in VSCode SecretStorage), login/register, request/response typing.
 * Does NOT use demo-token. Requires real credentials.
 */

import * as vscode from 'vscode';
import {
    ChatRequest, Provider, WorkspaceContextData, AgentEvent
} from './types';

import { ChatWithToolsOptions, LLMToolResponse } from '../agent/types';
import { safeErrorMessage } from '../utils/safeError';

const TOKEN_SECRET_KEY = 'kurdbox.access_token';

function parseApiError(rawText: string, status: number): string {
    try {
        const data = JSON.parse(rawText);
        const detail = data?.detail;
        if (typeof detail === 'string') { return detail; }
        if (Array.isArray(detail) && detail.length > 0) {
            return detail.map((d: { msg?: string }) => d.msg ?? safeErrorMessage(d)).join('; ');
        }
    } catch { /* not JSON */ }
    return rawText.trim().slice(0, 300) || `طلب فاشل (${status})`;
}

function extractChatContent(data: unknown): string | null {
    const d = data as Record<string, unknown>;
    const result = d?.result as Record<string, unknown> | undefined;
    const choices = (result?.choices ?? d?.choices) as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
}

/** Standalone wrapper used by AgentLoop (stateless, token passed per call). */
export async function chatWithTools(options: ChatWithToolsOptions): Promise<LLMToolResponse> {
    const { token, messages, model, provider, tools, toolChoice } = options;

    const detectUrl = async (): Promise<string> => {
        const configuredUrl = (() => {
            try {
                const vscode = require('vscode');
                return vscode.workspace.getConfiguration('kurdbox').get('serverUrl', 'http://localhost:5001');
            } catch { return 'http://localhost:5001'; }
        })();
        if (await testUrl(configuredUrl)) { return configuredUrl; }
        const commonPorts = [5001, 5000, 5002, 8000, 3000];
        for (const port of commonPorts) {
            const candidateUrl = `http://localhost:${port}`;
            if (candidateUrl !== configuredUrl && await testUrl(candidateUrl)) { return candidateUrl; }
        }
        return configuredUrl;
    };

    const testUrl = async (url: string): Promise<boolean> => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${url}/api/v1/health`, { method: 'GET', signal: controller.signal });
            clearTimeout(timeout);
            return res.ok;
        } catch { return false; }
    };

    const baseUrl = await detectUrl();
    const body: Record<string, unknown> = {
        model, messages, temperature: 0.7, max_tokens: 4096,
        provider_hint: provider || undefined, stream: false,
    };
    if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = toolChoice ?? 'auto'; }
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const rawText = await res.text();
    if (!res.ok) { throw new Error(`chatWithTools failed (${res.status}): ${rawText.slice(0, 200)}`); }
    const data = JSON.parse(rawText);
    const message = data?.result?.choices?.[0]?.message ?? data?.choices?.[0]?.message;
    if (!message) { throw new Error(`Unexpected response shape: ${rawText.slice(0, 200)}`); }
    return {
        content: message.content ?? null,
        tool_calls: message.tool_calls,
        finishReason: data?.result?.choices?.[0]?.finish_reason ?? 'stop',
    };
}

export class ApiClient {

    private _token: string = '';
    private _detectedUrl: string | null = null;
    private _secretStorage: vscode.SecretStorage | null = null;

    setSecretStorage(storage: vscode.SecretStorage): void {
        this._secretStorage = storage;
    }

    private async detectServerUrl(): Promise<string> {
        if (this._detectedUrl) { return this._detectedUrl; }
        const configuredUrl = vscode.workspace
            .getConfiguration('kurdbox')
            .get<string>('serverUrl', 'http://localhost:5001');
        if (await this.testUrl(configuredUrl)) {
            this._detectedUrl = configuredUrl;
            return configuredUrl;
        }
        const commonPorts = [5001, 5000, 5002, 8000, 3000];
        for (const port of commonPorts) {
            const testUrl = `http://localhost:${port}`;
            if (testUrl !== configuredUrl && await this.testUrl(testUrl)) {
                this._detectedUrl = testUrl;
                await vscode.workspace.getConfiguration('kurdbox')
                    .update('serverUrl', testUrl, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`KurdBox: اكتشف السيرفر تلقائياً على ${testUrl}`);
                return testUrl;
            }
        }
        return configuredUrl;
    }

    private async testUrl(url: string): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${url}/api/v1/health`, { method: 'GET', signal: controller.signal });
            clearTimeout(timeout);
            return res.ok;
        } catch { return false; }
    }

    private get baseUrl(): string {
        return vscode.workspace
            .getConfiguration('kurdbox')
            .get<string>('serverUrl', 'http://localhost:5001');
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    /** Load stored token from SecretStorage. Returns true if found. */
    async loadStoredToken(): Promise<boolean> {
        if (!this._secretStorage) { return false; }
        const stored = await this._secretStorage.get(TOKEN_SECRET_KEY);
        if (stored) {
            this._token = stored;
            return true;
        }
        return false;
    }

    /** Persist token to SecretStorage. */
    private async saveToken(token: string): Promise<void> {
        this._token = token;
        if (this._secretStorage) {
            await this._secretStorage.store(TOKEN_SECRET_KEY, token);
        }
    }

    /** Clear stored token (logout). */
    async clearToken(): Promise<void> {
        this._token = '';
        if (this._secretStorage) {
            await this._secretStorage.delete(TOKEN_SECRET_KEY);
        }
    }

    isAuthenticated(): boolean {
        return !!this._token;
    }

    /** Login with username + password. Throws on error. */
    async login(username: string, password: string): Promise<{ username: string; isAdmin: boolean }> {
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const rawText = await res.text();
        if (!res.ok) {
            throw new Error(parseApiError(rawText, res.status));
        }
        const data = JSON.parse(rawText) as { access_token?: string };
        if (!data.access_token) { throw new Error('لم يُرجع السيرفر توكناً.'); }
        await this.saveToken(data.access_token);
        const payload = this._decodeJwtPayload(data.access_token);
        return { username: String(payload.username ?? username), isAdmin: !!payload.is_admin };
    }

    /** Register new account. Throws on error. First user becomes admin. */
    async register(username: string, password: string): Promise<{ username: string; isAdmin: boolean }> {
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const rawText = await res.text();
        if (!res.ok) {
            throw new Error(parseApiError(rawText, res.status));
        }
        const data = JSON.parse(rawText) as { access_token?: string };
        if (!data.access_token) { throw new Error('لم يُرجع السيرفر توكناً.'); }
        await this.saveToken(data.access_token);
        const payload = this._decodeJwtPayload(data.access_token);
        return { username: String(payload.username ?? username), isAdmin: !!payload.is_admin };
    }

    /** Decode JWT payload (base64) without verifying signature. */
    private _decodeJwtPayload(token: string): Record<string, unknown> {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) { return {}; }
            const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = Buffer.from(padded, 'base64').toString('utf8');
            return JSON.parse(json);
        } catch { return {}; }
    }

    /** Legacy: getToken is now a no-op alias to loadStoredToken. */
    async getToken(): Promise<string> {
        if (!this._token) { await this.loadStoredToken(); }
        return this._token;
    }

    private async ensureToken(): Promise<string> {
        if (!this._token) { await this.loadStoredToken(); }
        return this._token;
    }

    // ── Supported Providers ───────────────────────────────────────────────────

    async fetchSupportedProviders(): Promise<Array<{ id: string; name: string; key_hint: string }>> {
        try {
            const url = await this.detectServerUrl();
            const res = await fetch(`${url}/api/v1/providers/supported`);
            if (!res.ok) { return []; }
            return await res.json() as any[];
        } catch { return []; }
    }

    // ── Providers ─────────────────────────────────────────────────────────────

    async fetchProviders(): Promise<Provider[]> {
        const token = await this.ensureToken();
        if (!token) { return []; }
        try {
            const url = await this.detectServerUrl();
            const res = await fetch(`${url}/api/v1/providers`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) { return []; }
            const data = await res.json() as any[];
            return data.map(p => ({
                id: p.id ?? '',
                name: p.name ?? p.id ?? '',
                models: Array.isArray(p.models) ? p.models : [],
                status: String(p.status ?? 'active').toLowerCase() as Provider['status'],
            }));
        } catch { return []; }
    }

    /** Add a provider API key. Requires admin token. */
    async addProviderKey(providerType: string, apiKey: string): Promise<void> {
        const token = await this.ensureToken();
        if (!token) { throw new Error('غير مسجّل دخول.'); }
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/providers`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider_type: providerType, api_key: apiKey }),
        });
        if (!res.ok) {
            const raw = await res.text();
            throw new Error(parseApiError(raw, res.status));
        }
    }

    // ── Chat ──────────────────────────────────────────────────────────────────

    async chat(request: ChatRequest): Promise<string> {
        const token = await this.ensureToken();
        if (!token) { throw new Error('يرجى تسجيل الدخول أولاً.'); }
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/chat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, stream: false }),
        });
        const rawText = await res.text();
        if (res.status === 401) {
            await this.clearToken();
            throw new Error('انتهت الجلسة — يرجى تسجيل الدخول مجدداً.');
        }
        if (!res.ok) {
            const msg = parseApiError(rawText, res.status);
            if (res.status === 503) {
                throw new Error(`${msg} — تأكد من إضافة مفتاح API لأحد المزودين.`);
            }
            throw new Error(msg);
        }
        let data: unknown;
        try { data = JSON.parse(rawText); } catch {
            throw new Error(`استجابة غير متوقعة من السيرفر: ${rawText.slice(0, 200)}`);
        }
        const content = extractChatContent(data);
        if (content === null || content === '') {
            throw new Error('السيرفر أرجع رداً فارغاً. تحقق من المزودين والنموذج المختار.');
        }
        return content;
    }

    async streamChat(
        request: ChatRequest,
        onChunk: (chunk: string) => void
    ): Promise<void> {
        const token = await this.ensureToken();
        if (!token) { throw new Error('يرجى تسجيل الدخول أولاً.'); }
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/chat/stream`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, stream: true }),
        });

        if (res.status === 401) {
            await this.clearToken();
            throw new Error('انتهت الجلسة — يرجى تسجيل الدخول مجدداً.');
        }
        if (!res.ok) {
            const errBody = await res.text();
            const msg = parseApiError(errBody, res.status);
            if (res.status === 503) {
                throw new Error(`${msg} — تأكد من إضافة مفتاح API لأحد المزودين.`);
            }
            throw new Error(msg);
        }

        if (!res.body) {
            throw new Error('Stream body is null — the server may have closed the connection unexpectedly.');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedContent = false;
        let streamError: string | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) { break; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) { continue; }
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') { break; }
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.type === 'start' || parsed.type === 'done') { continue; }
                    if (parsed.error) { streamError = String(parsed.error); continue; }
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) { receivedContent = true; onChunk(delta); }
                } catch { /* skip malformed */ }
            }
        }

        if (streamError && !receivedContent) {
            throw new Error(
                streamError === 'All providers failed'
                    ? 'فشلت كل المزودين. أضف مفتاح API أو تحقق من صلاحيته.'
                    : streamError
            );
        }
        if (!receivedContent && !streamError) {
            throw new Error('لم يصل أي محتوى من السيرفر.');
        }
    }

    // ── Completion (inline) ───────────────────────────────────────────────────

    async complete(prompt: string, model: string): Promise<string> {
        try {
            return await this.chat({
                model,
                messages: [
                    { role: 'system', content: 'You are a code completion assistant. Complete the code snippet. Return ONLY the completion, no explanation.' },
                    { role: 'user', content: prompt },
                ],
                stream: false,
            });
        } catch { return ''; }
    }

    // ── chatWithTools (used by AgentController) ───────────────────────────────

    async chatWithTools(request: ChatRequest): Promise<{
        content: string | null;
        tool_calls?: any[];
        finishReason: string;
    }> {
        const token = await this.ensureToken();
        if (!token) { throw new Error('يرجى تسجيل الدخول أولاً.'); }
        const url = await this.detectServerUrl();
        const res = await fetch(`${url}/api/v1/chat`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, stream: false }),
        });
        if (res.status === 401) {
            await this.clearToken();
            throw new Error('انتهت الجلسة — يرجى تسجيل الدخول مجدداً.');
        }
        const rawText = await res.text();
        if (!res.ok) { throw new Error(`chatWithTools failed (${res.status}): ${rawText.slice(0, 200)}`); }
        const data = JSON.parse(rawText);
        const message = data?.result?.choices?.[0]?.message ?? data?.choices?.[0]?.message;
        if (!message) { throw new Error(`Unexpected response shape: ${rawText.slice(0, 200)}`); }
        return {
            content: message.content ?? null,
            tool_calls: message.tool_calls,
            finishReason: data?.result?.choices?.[0]?.finish_reason ?? 'stop',
        };
    }
}
