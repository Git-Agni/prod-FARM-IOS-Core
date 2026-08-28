import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// registry.ts freezes its default path at first import, so set the env before
// any src module loads and pull everything in dynamically.
test('PATCH toggles disabled, scheduling is blocked, and the fragment lists it separately', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pf-disable-api-'));
    const configPath = path.join(directory, 'devices.json');
    await writeFile(configPath, JSON.stringify([{ name: 'Phone A', udid: 'udid-a', pluginData: {} }]));
    process.env.DEVICES_CONFIG_PATH = configPath;

    const { createApp } = await import('../src/api/app.js');
    const { defaultDashboardTheme } = await import('../src/dashboard-theme.js');
    const { PluginRegistry } = await import('../src/registry.js');
    type SchedulerRepository = import('../src/scheduler/repository.js').SchedulerRepository;

    const scheduler = {
        async activeExecution() { return null; },
        async createTask() { return { id: 'sched-1' }; },
    } as unknown as SchedulerRepository;

    const app = await createApp({ plugins: new PluginRegistry([]), scheduler, dashboardTheme: defaultDashboardTheme });
    context.after(() => app.close());

    const disabled = await inject(app, { method: 'PATCH', url: '/api/devices/udid-a', payload: { disabled: true } });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().disabled, true);
    assert.equal(JSON.parse(await readFile(configPath, 'utf8'))[0].disabled, true);

    const blocked = await inject(app, {
        method: 'POST', url: '/api/schedules',
        payload: { deviceUdid: 'udid-a', runWindowMinutes: 30, timing: { kind: 'now' }, task: { pluginId: 'x', taskType: 'y', taskVersion: 1, payload: {} } },
    });
    assert.equal(blocked.statusCode, 409);

    const fragment = await inject(app, { method: 'GET', url: '/api/fragments/devices' });
    assert.match(fragment.body, /Disconnected devices \(1\)/);
    assert.match(fragment.body, /data-toggle-device="udid-a" data-disabled="false"/);

    const reenabled = await inject(app, { method: 'PATCH', url: '/api/devices/udid-a', payload: { disabled: false } });
    assert.equal(reenabled.statusCode, 200);
    assert.equal(reenabled.json().disabled, undefined);
    assert.equal(JSON.parse(await readFile(configPath, 'utf8'))[0].disabled, undefined);
});
