/**
 * UpdateChecker - Checks for extension updates
 * Compares current version with latest version from GitHub releases
 */

import * as vscode from 'vscode';

export class UpdateChecker {
    private static readonly CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    private static readonly GITHUB_API = 'https://api.github.com/repos/kurdost/kurdbox/releases/latest';
    private static readonly STORAGE_KEY = 'kurdbox.lastUpdateCheck';

    static async checkForUpdates(context: vscode.ExtensionContext, force: boolean = false): Promise<void> {
        const now = Date.now();
        const lastCheck = context.globalState.get<number>(this.STORAGE_KEY, 0);

        // Skip if not forced and checked recently
        if (!force && (now - lastCheck) < this.CHECK_INTERVAL) {
            return;
        }

        try {
            const currentVersion = vscode.extensions.getExtension('kurdost.kurdbox')?.packageJSON.version || '0.0.0';

            const response = await fetch(this.GITHUB_API);
            if (!response.ok) {
                throw new Error('Failed to fetch release info');
            }

            const release = await response.json();
            const latestVersion = release.tag_name.replace('v', '');

            if (this.isNewerVersion(latestVersion, currentVersion)) {
                this.showUpdateNotification(latestVersion, release.html_url);
            }

            // Update last check time
            await context.globalState.update(this.STORAGE_KEY, now);
        } catch (error) {
            console.error('Update check failed:', error);
        }
    }

    private static isNewerVersion(latest: string, current: string): boolean {
        const latestParts = latest.split('.').map(Number);
        const currentParts = current.split('.').map(Number);

        for (let i = 0; i < 3; i++) {
            const l = latestParts[i] || 0;
            const c = currentParts[i] || 0;
            if (l > c) return true;
            if (l < c) return false;
        }
        return false;
    }

    private static showUpdateNotification(version: string, url: string): void {
        const message = `🎉 KurdBox AI ${version} متاح!`;
        const install = 'تحديث الآن';
        const later = 'لاحقاً';

        vscode.window.showInformationMessage(message, install, later).then(selection => {
            if (selection === install) {
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        });
    }

    static async scheduleAutoCheck(context: vscode.ExtensionContext): Promise<void> {
        // Disabled auto-check since extension is not published on Marketplace
        // Users can manually check via "KurdBox: Check for Updates" command
        // await this.checkForUpdates(context, false);

        // Schedule periodic checks
        // setInterval(() => {
        //     this.checkForUpdates(context, false);
        // }, this.CHECK_INTERVAL);
    }
}
