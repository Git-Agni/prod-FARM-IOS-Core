import type { AddressInfo } from 'node:net';

import type { AuthProvider, PhoneFarmPlugin } from '../plugin.js';
import { configuredPluginModules, loadAuthProvider, loadPlugins } from '../loader.js';
import { PluginRegistry } from '../registry.js';
import { createSchedulerRuntime } from '../scheduler/runtime.js';
import { assertSafeBind } from '../security.js';
import { createTikTokPlugin } from '../tiktok-plugin.js';
import { defaultDashboardTheme } from '../dashboard-theme.js';
import { DeviceRegistrationService } from '../devices/registration.js';
import { createApp, type DashboardTheme } from './app.js';

export interface StartServerOptions {
    plugins?: readonly PhoneFarmPlugin[];
    authProvider?: AuthProvider | null;
    host?: string;
    port?: number;
    dashboardTheme?: DashboardTheme;
}

export async function defaultPlugins(): Promise<PhoneFarmPlugin[]> {
    return [createTikTokPlugin({ bundleId: process.env.TIKTOK_BUNDLE_ID }),
        ...await loadPlugins(configuredPluginModules())];
}

export async function startServer(options: StartServerOptions = {}) {
    const loadedPlugins = options.plugins ?? await defaultPlugins();
    const authProvider = options.authProvider === undefined
        ? await loadAuthProvider(process.env.PHONE_FARM_AUTH_PLUGIN)
        : options.authProvider;
    const host = options.host ?? process.env.WEB_HOST ?? '127.0.0.1';
    const port = options.port ?? Number(process.env.WEB_PORT ?? 3000);
    assertSafeBind(host, authProvider);
    const plugins = new PluginRegistry(loadedPlugins);
    const scheduler = await createSchedulerRuntime(plugins);
    const registrations = new DeviceRegistrationService();
    await registrations.start();
    const app = await createApp({
        plugins, scheduler: scheduler.repository, authProvider,
        dashboardTheme: options.dashboardTheme ?? defaultDashboardTheme, registrations, logger: true,
    });
    await app.listen({ host, port });
    const address = app.server.address() as AddressInfo;
    console.log(`Phone Farm listening on http://${host}:${address.port}`);
    return {
        app, plugins,
        async close() { await app.close(); await registrations.close(); await scheduler.close(); },
    };
}

async function main(): Promise<void> {
    const runtime = await startServer();
    const shutdown = async () => runtime.close();
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await main();
