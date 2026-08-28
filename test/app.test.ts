import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/api/app.js';
import { defaultDashboardTheme } from '../src/dashboard-theme.js';
import type { DeviceRegistrationManager, RegistrationSnapshot } from '../src/devices/registration.js';
import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

const device = { name: 'Test iPhone', osVersion: '16.7', udid: 'test-device', productType: 'iPhone10,1' };

function snapshot(): RegistrationSnapshot {
    const passed = { state: 'passed' as const, message: 'Ready', updatedAt: new Date(0).toISOString() };
    return {
        id: device.udid, device, name: device.name, coordinateProfile: 'iphone8',
        availableProfiles: [{ name: 'iphone8', displayName: 'iPhone 8', screenSize: { width: 375, height: 667 } }],
        recommendedProfile: 'iphone8', wdaLocalPort: 8100, mjpegLocalPort: 9100,
        tiktokAccounts: [], hasPasscode: false, busy: false,
        checks: {
            host: passed, connection: passed, signing: passed, developer: passed, wda: passed,
            appium: passed, video: passed, touch: passed, tiktok: passed, accounts: passed,
        },
        logs: [], canFinalize: true, finalized: false,
    };
}

function registrations(): DeviceRegistrationManager {
    let current = snapshot();
    return {
        async start() {}, async close() {},
        async candidates() { return [device]; },
        async create() { return current; },
        async get() { return current; },
        async update(_id, input) { current = { ...current, name: input.name ?? current.name }; return current; },
        async run(_id, action) {
            if (action === 'finalize') current = { ...current, finalized: true };
            return current;
        },
        async cancel() {},
    };
}

test('a configured auth provider adds a Log out link to the nav', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
        authProvider: {
            id: 'test', logoutPath: '/auth/logout',
            registerRoutes() {},
            async authenticate() { return { id: 'u', roles: [] }; },
            isPublicPath() { return false; },
        },
    });
    context.after(() => app.close());

    for (const url of ['/', '/tasks', '/devices/register']) {
        const res = await inject(app, { method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
        assert.match(res.body, /href="\/auth\/logout"[^>]*>Log out</, url);
        assert.doesNotMatch(res.body, /__AUTH_NAV__/, url);
        assert.match(res.body, /\/assets\/styles\.css\?v=[\w-]+/, url);
    }

    const css = await inject(app, { method: 'GET', url: '/assets/styles.css?v=x' });
    assert.match(String(css.headers['cache-control']), /immutable/);
    const cssBare = await inject(app, { method: 'GET', url: '/assets/styles.css' });
    assert.match(String(cssBare.headers['cache-control']), /no-cache/);
});

test('a plugin can contribute nav links and register its own routes', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([{
            id: 'com.example.stats', version: '1.0.0', displayName: 'Stats', tasks: [],
            navLinks: [{ label: 'Stats', href: '/stats' }],
            registerRoutes({ app: instance }) {
                instance.get('/stats', async (_request, reply) => reply.type('text/html').send('<h1>stats</h1>'));
            },
        }]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    for (const url of ['/', '/tasks', '/devices/register']) {
        const res = await inject(app, { method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
        assert.match(res.body, /href="\/stats"[^>]*>Stats</, url);
        assert.doesNotMatch(res.body, /__PLUGIN_NAV__/, url);
    }

    const stats = await inject(app, { method: 'GET', url: '/stats' });
    assert.equal(stats.statusCode, 200);
    assert.match(stats.body, /<h1>stats<\/h1>/);
});

test('the CSRF guard rejects cross-origin writes even with no auth provider', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    // no Origin at all — a classic form-POST CSRF shape
    const noOrigin = await app.inject({ method: 'POST', url: '/api/device-registrations', payload: { udid: device.udid } });
    assert.equal(noOrigin.statusCode, 403);

    // a foreign Origin
    const foreign = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { origin: 'https://evil.example' }, payload: { udid: device.udid },
    });
    assert.equal(foreign.statusCode, 403);

    // same-origin (what the dashboard sends) goes through
    const same = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { origin: 'http://localhost:80' }, payload: { udid: device.udid },
    });
    assert.equal(same.statusCode, 201);

    // a Bearer client is a real API caller, not a browser form
    const bearer = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { authorization: 'Bearer x' }, payload: { udid: device.udid },
    });
    assert.notEqual(bearer.statusCode, 403);
});

test('serves and drives the public registration wizard', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    const page = await inject(app, { method: 'GET', url: '/devices/register' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Register an? (?:iOS )?device/i);

    const candidates = await inject(app, { method: 'GET', url: '/api/device-registrations/candidates' });
    assert.equal(candidates.statusCode, 200);
    assert.deepEqual(candidates.json().devices, [device]);

    const created = await inject(app, { method: 'POST', url: '/api/device-registrations', payload: { udid: device.udid } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, device.udid);

    const finalized = await inject(app, {
        method: 'POST', url: `/api/device-registrations/${device.udid}/actions/finalize`, payload: {},
    });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().finalized, true);
});
