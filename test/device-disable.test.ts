import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { activeDevices, saveRegisteredDevices } from '../src/devices/registry.js';
import { DeviceConnectionManager } from '../src/devices/connection-manager.js';

test('activeDevices drops the disabled entries', () => {
    const devices = [
        { name: 'A', udid: 'a', pluginData: {} },
        { name: 'B', udid: 'b', disabled: true, pluginData: {} },
    ];
    assert.deepEqual(activeDevices(devices).map((d) => d.udid), ['a']);
});

test('saveRegisteredDevices only keeps disabled when it is exactly true', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pf-disable-save-'));
    const configPath = path.join(directory, 'devices.json');
    await saveRegisteredDevices([
        { name: 'On', udid: 'on', disabled: false as unknown as undefined, pluginData: {} },
        { name: 'Off', udid: 'off', disabled: true, pluginData: {} },
    ], configPath);
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Array<{ udid: string; disabled?: boolean }>;
    assert.equal(saved.find((d) => d.udid === 'on')!.disabled, undefined);
    assert.equal(saved.find((d) => d.udid === 'off')!.disabled, true);
});

test('DeviceConnectionManager stops supervising a device once it is disabled', async () => {
    let devices = [{ name: 'One', udid: 'udid-1', pluginData: {} }] as Array<{ name: string; udid: string; disabled?: boolean; pluginData: object }>;
    const spawned: string[] = [];
    const killed: string[] = [];
    const manager = new DeviceConnectionManager({
        loadDevices: async () => devices as never,
        connectedUdids: async () => ['udid-1'],
        endpointReady: async () => false,
        spawnSupervisor: (device) => {
            spawned.push(device.udid);
            const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
            const child = {
                exitCode: null as number | null, killed: false, stdout: null, stderr: null,
                once(event: string, callback: (...args: unknown[]) => void) { (handlers[event] ??= []).push(callback); },
                kill() {
                    child.killed = true; child.exitCode = 0; killed.push(device.udid);
                    setImmediate(() => handlers.exit?.forEach((fn) => fn(0, null)));
                },
            };
            return child as unknown as import('node:child_process').ChildProcess;
        },
        now: () => 0,
    });

    await manager.reconcile();
    assert.deepEqual(spawned, ['udid-1']);
    assert.deepEqual(manager.statuses().map((s) => s.udid), ['udid-1']);

    devices = [{ name: 'One', udid: 'udid-1', disabled: true, pluginData: {} }];
    await manager.reconcile();
    assert.deepEqual(killed, ['udid-1']);
    assert.deepEqual(manager.statuses(), []);
});
