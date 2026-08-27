import type { AuthProvider } from './plugin.js';

export function assertSafeBind(host: string, authProvider: AuthProvider | null): void {
    const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
    if (!loopback && !authProvider) {
        throw new Error('An authentication plugin is required when binding outside the loopback interface');
    }
}
