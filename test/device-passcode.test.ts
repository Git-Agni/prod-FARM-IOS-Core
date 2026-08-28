import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

// One devices.json path for the whole file — `src/devices/registry.ts` resolves
// DEVICES_CONFIG_PATH once, at first import, so it must be set before any of the
// dynamic imports below and shared by every test here.
const configPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'pf-passcode-')), 'devices.json');
process.env.DEVICES_CONFIG_PATH = configPath;
delete process.env.IOS_PASSCODE;

const seed = (devices: unknown[]) => writeFile(configPath, JSON.stringify(devices));
const onDisk = async () => JSON.parse(await readFile(configPath, 'utf8')) as Array<{ udid: string; passcode?: string }>;

const scheduler = {
    async activeExecution() { return null; },
    async listSchedules() { return []; },
} as unknown as SchedulerRepository;

test('the passcode lives in devices.json and never leaves through the API', async (context) => {
    await seed([{ name: 'Phone', udid: 'udid-1', wdaLocalPort: 8100, mjpegLocalPort: 9100, pluginData: {} }]);
    const { createApp } = await import('../src/api/app.js');
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler });
    context.after(() => app.close());

    const set = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-1',
        payload: { passcode: '123456' }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(set.statusCode, 200);
    assert.equal(set.json().passcode, undefined);
    assert.equal(set.json().hasPasscode, true);
    assert.equal((await onDisk())[0]!.passcode, '123456');

    const list = await inject(app, { method: 'GET', url: '/api/devices' });
    assert.equal(list.json()[0].passcode, undefined);
    assert.equal(list.json()[0].hasPasscode, true);

    const short = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-1',
        payload: { passcode: '12' }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(short.statusCode, 400);

    const cleared = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-1',
        payload: { passcode: '' }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(cleared.json().hasPasscode, false);
    assert.equal((await onDisk())[0]!.passcode, undefined);
});

test('passcodeForDevice reads devices.json, then the deprecated env fallback', async () => {
    await seed([{ name: 'Phone', udid: 'udid-1', pluginData: {} }]);
    const { passcodeForDevice, setDevicePasscode } = await import('../src/devices/secrets.js');

    assert.equal(await passcodeForDevice('udid-1'), undefined);

    process.env.IOS_PASSCODE = '999999';
    assert.equal(await passcodeForDevice('udid-1'), '999999');
    assert.equal(await passcodeForDevice('udid-1', { allowLegacyFallback: false }), undefined);
    delete process.env.IOS_PASSCODE;

    await setDevicePasscode('udid-1', '424242');
    assert.equal((await onDisk())[0]!.passcode, '424242');
    assert.equal(await passcodeForDevice('udid-1'), '424242');

    await assert.rejects(setDevicePasscode('udid-1', 'abc'), /at least four digits/);
    await assert.rejects(setDevicePasscode('missing', '111111'), /not registered/);
});
