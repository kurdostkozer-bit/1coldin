/**
 * UiBridge — typed postMessage abstraction.
 * Single interface between controllers and the WebView.
 * Controllers never call view.webview.postMessage directly.
 */

import * as vscode from 'vscode';
import { UiMessage } from '../api/types';
import { safeErrorMessage, toSerializable } from '../utils/safeError';

export class UiBridge {
    private _view: vscode.WebviewView | undefined;

    setView(view: vscode.WebviewView): void {
        this._view = view;
    }

    send(msg: UiMessage): void {
        if (!this._view) { return; }
        try {
            this._view.webview.postMessage(toSerializable(msg));
        } catch (err) {
            console.error('[KurdBox UiBridge] postMessage failed:', safeErrorMessage(err));
        }
    }

    onMessage(handler: (msg: UiMessage) => void): vscode.Disposable | undefined {
        return this._view?.webview.onDidReceiveMessage(handler);
    }
}
