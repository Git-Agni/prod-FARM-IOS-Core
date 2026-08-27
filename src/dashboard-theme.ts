import { fileURLToPath } from 'node:url';

import type { DashboardTheme } from './api/app.js';
import type { RegisteredDevice } from './devices/registry.js';

const pluginId = 'com.git-agni.tiktok';

function accounts(device: RegisteredDevice): string[] {
    const value = device.pluginData[pluginId]?.accounts;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export const defaultDashboardTheme: DashboardTheme = {
    rootDirectory: fileURLToPath(new URL('../static/dashboard/', import.meta.url)),
    renderDevice(template, device) {
        const configured = accounts(device);
        const options = configured.map((account) => `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`).join('');
        return template.replaceAll('__TIKTOK_ACCOUNT_OPTIONS__', options)
            .replaceAll('__TIKTOK_ACCOUNTS_VALUE__', escapeHtml(configured.join(', ')))
            .replaceAll('__DEVICE_HASPASSCODE__', device.passcode ? '· set' : '· not set');
    },
};
