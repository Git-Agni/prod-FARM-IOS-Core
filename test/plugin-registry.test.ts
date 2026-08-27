import assert from 'node:assert/strict';
import test from 'node:test';

import { examplePlugin } from '../src/example-plugin.js';
import { PluginRegistry } from '../src/registry.js';
import { assertSafeBind } from '../src/security.js';

test('registers and validates a versioned plugin task', () => {
    const registry = new PluginRegistry([examplePlugin]);
    const input = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: examplePlugin.id,
            taskType: 'open-app',
            taskVersion: 1,
            payload: { bundleId: 'com.example.demo', waitSeconds: 10 },
        },
        timing: { kind: 'now' },
    });
    assert.equal(input.task.payload.bundleId, 'com.example.demo');
    assert.equal(registry.task(input.task).summarize(input.task.payload), 'Open com.example.demo for 10 seconds');
});

test('rejects unavailable plugin tasks and duplicate plugins', () => {
    const registry = new PluginRegistry([examplePlugin]);
    assert.throws(() => registry.register(examplePlugin), /already registered/);
    assert.throws(() => registry.task({
        pluginId: 'missing.plugin', taskType: 'unknown', taskVersion: 1, payload: {},
    }), /unavailable/);
});

test('requires authentication when binding outside loopback', () => {
    assert.doesNotThrow(() => assertSafeBind('127.0.0.1', null));
    assert.throws(() => assertSafeBind('0.0.0.0', null), /authentication plugin is required/i);
});
