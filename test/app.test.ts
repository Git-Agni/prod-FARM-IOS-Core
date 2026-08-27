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
        const res = await app.inject({ method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
        assert.match(res.body, /href="\/auth\/logout"[^>]*>Log out</, url);
        assert.doesNotMatch(res.body, /__AUTH_NAV__/, url);
        assert.match(res.body, /\/assets\/styles\.css\?v=[\w-]+/, url);
    }

    const css = await app.inject({ method: 'GET', url: '/assets/styles.css?v=x' });
    assert.match(String(css.headers['cache-control']), /immutable/);
    const cssBare = await app.inject({ method: 'GET', url: '/assets/styles.css' });
    assert.match(String(cssBare.headers['cache-control']), /no-cache/);
});

test('serves and drives the public registration wizard', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    const page = await app.inject({ method: 'GET', url: '/devices/register' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Register an? (?:iOS )?device/i);

    const candidates = await app.inject({ method: 'GET', url: '/api/device-registrations/candidates' });
    assert.equal(candidates.statusCode, 200);
    assert.deepEqual(candidates.json().devices, [device]);

    const created = await app.inject({ method: 'POST', url: '/api/device-registrations', payload: { udid: device.udid } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, device.udid);

    const finalized = await app.inject({
        method: 'POST', url: `/api/device-registrations/${device.udid}/actions/finalize`, payload: {},
    });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().finalized, true);
});
