/**
 * ChatHistoryManager — manages conversation history using VSCode globalState.
 * Saves and loads chat sessions with timestamps.
 */

import * as vscode from 'vscode';
import { ChatMessage } from '../api/types';

export interface Conversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

export class ChatHistoryManager {
    private static readonly STORAGE_KEY = 'kurdbox.chatHistory';
    private static readonly MAX_HISTORY = 50;

    static async saveConversation(
        context: vscode.ExtensionContext,
        messages: ChatMessage[],
        title?: string,
        conversationId?: string
    ): Promise<void> {
        try {
            const history = await this.getHistory(context);
            
            // If conversationId is provided, update existing conversation
            if (conversationId) {
                const existingIndex = history.findIndex(conv => conv.id === conversationId);
                if (existingIndex !== -1) {
                    history[existingIndex].messages = messages;
                    history[existingIndex].updatedAt = Date.now();
                    // Move to top
                    const updated = history.splice(existingIndex, 1)[0];
                    history.unshift(updated);
                    await context.globalState.update(this.STORAGE_KEY, history);
                    return;
                }
            }
            
            // Generate title from first user message if not provided
            const conversationTitle = title || this.generateTitle(messages);
            
            const conversation: Conversation = {
                id: Date.now().toString(),
                title: conversationTitle,
                messages: messages,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            // Add to history (newest first)
            history.unshift(conversation);

            // Limit history size
            if (history.length > this.MAX_HISTORY) {
                history.splice(this.MAX_HISTORY);
            }

            await context.globalState.update(this.STORAGE_KEY, history);
        } catch (error) {
            console.error('Failed to save conversation:', error);
        }
    }

    static async getHistory(context: vscode.ExtensionContext): Promise<Conversation[]> {
        try {
            return context.globalState.get<Conversation[]>(this.STORAGE_KEY, []);
        } catch (error) {
            console.error('Failed to get history:', error);
            return [];
        }
    }

    static async loadConversation(
        context: vscode.ExtensionContext,
        id: string
    ): Promise<Conversation | null> {
        try {
            const history = await this.getHistory(context);
            return history.find(conv => conv.id === id) || null;
        } catch (error) {
            console.error('Failed to load conversation:', error);
            return null;
        }
    }

    static async deleteConversation(
        context: vscode.ExtensionContext,
        id: string
    ): Promise<void> {
        try {
            const history = await this.getHistory(context);
            const filtered = history.filter(conv => conv.id !== id);
            await context.globalState.update(this.STORAGE_KEY, filtered);
        } catch (error) {
            console.error('Failed to delete conversation:', error);
        }
    }

    static async clearHistory(context: vscode.ExtensionContext): Promise<void> {
        try {
            await context.globalState.update(this.STORAGE_KEY, []);
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    }

    private static generateTitle(messages: ChatMessage[]): string {
        const firstUserMsg = messages.find(msg => msg.role === 'user');
        if (firstUserMsg && firstUserMsg.content) {
            const text = firstUserMsg.content.substring(0, 50);
            return text + (firstUserMsg.content.length > 50 ? '...' : '');
        }
        return 'محادثة جديدة';
    }
}
