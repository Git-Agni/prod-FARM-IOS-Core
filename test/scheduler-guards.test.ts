import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { scheduleTransitionAllowed } from '../src/scheduler/repository.js';
import { mutateRegisteredDevices } from '../src/devices/registry.js';

test('scheduleTransitionAllowed blocks resuming a finished schedule', () => {
    assert.equal(scheduleTransitionAllowed('active', 'paused'), true);
    assert.equal(scheduleTransitionAllowed('paused', 'active'), true);
    assert.equal(scheduleTransitionAllowed('active', 'cancelled'), true);
    assert.equal(scheduleTransitionAllowed('completed', 'cancelled'), true);
    assert.equal(scheduleTransitionAllowed('completed', 'active'), false);
    assert.equal(scheduleTransitionAllowed('cancelled', 'active'), false);
    assert.equal(scheduleTransitionAllowed('cancelled', 'paused'), false);
});

test('mutateRegisteredDevices serializes overlapping writes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pf-registry-lock-'));
    const configPath = path.join(dir, 'devices.json');

    // fire 20 concurrent independent mutations; each appends one entry
    await Promise.all(
        Array.from({ length: 20 }, (_, i) => mutateRegisteredDevices(
            (devices) => { devices.push({ name: `d${i}`, udid: `udid-${i}`, pluginData: {} }); },
            configPath,
        )),
    );

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Array<{ udid: string }>;
    assert.equal(saved.length, 20, 'no write was lost to a race');
    assert.equal(new Set(saved.map((d) => d.udid)).size, 20);
});
