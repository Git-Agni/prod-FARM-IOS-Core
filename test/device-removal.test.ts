import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

test('DELETE /api/devices/:udid forgets the device and cancels its schedules', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pf-device-removal-'));
    const configPath = path.join(directory, 'devices.json');
    await writeFile(configPath, JSON.stringify([
        { name: 'Keep', udid: 'udid-keep', pluginData: {} },
        { name: 'Drop', udid: 'udid-drop', pluginData: {} },
    ]));
    process.env.DEVICES_CONFIG_PATH = configPath;

    const { createApp } = await import('../src/api/app.js');

    const statusChanges: Array<[string, string]> = [];
    const scheduler = {
        async activeExecution(udid: string) { return udid === 'udid-busy' ? { id: 'x' } : null; },
        async listSchedules() {
            return [
                { id: 'active-1', status: 'active' },
                { id: 'done-1', status: 'completed' },
            ];
        },
        async setScheduleStatus(id: string, status: string) { statusChanges.push([id, status]); return null; },
    } as unknown as SchedulerRepository;

    const app = await createApp({ plugins: new PluginRegistry([]), scheduler });
    context.after(() => app.close());

    const missing = await app.inject({ method: 'DELETE', url: '/api/devices/udid-unknown' });
    assert.equal(missing.statusCode, 404);

    const removed = await app.inject({ method: 'DELETE', url: '/api/devices/udid-drop' });
    assert.equal(removed.statusCode, 204);
    assert.deepEqual(statusChanges, [['active-1', 'cancelled']]);

    const remaining = JSON.parse(await readFile(configPath, 'utf8')) as Array<{ udid: string }>;
    assert.deepEqual(remaining.map((entry) => entry.udid), ['udid-keep']);
});
