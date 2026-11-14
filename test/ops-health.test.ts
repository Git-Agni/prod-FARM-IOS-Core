import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBattery, deviceIssues, type DeviceProbe } from '../scripts/lib/device-health.js';

const ok: DeviceProbe = { usbConnected: true, wdaReady: true, locked: false, serviceMessage: '', battery: { pct: 80, charging: true, external: true } };

test('battery parser reads ideviceinfo output', () => {
    assert.deepEqual(parseBattery('BatteryCurrentCapacity: 12\nBatteryIsCharging: false\nExternalConnected: true\n'), { pct: 12, charging: false, external: true });
    assert.equal(parseBattery(''), null);
});
test('healthy phone raises nothing', () => assert.deepEqual(deviceIssues(ok), []));
test('unplugged phone raises one alert', () => assert.deepEqual(deviceIssues({ ...ok, usbConnected: false, wdaReady: false, battery: null }).map(i => i.key), ['device:unplugged']));
test('WDA down distinguishes the passcode prompt', () => {
    assert.deepEqual(deviceIssues({ ...ok, wdaReady: false, locked: null, serviceMessage: 'Waiting for the automation approval prompt' }).map(i => i.key), ['device:wda:passcode']);
    assert.deepEqual(deviceIssues({ ...ok, wdaReady: false, locked: null, serviceMessage: 'boom' }).map(i => i.key), ['device:wda:other']);
});
test('locked phone raises one alert', () => assert.deepEqual(deviceIssues({ ...ok, locked: true }).map(i => i.key), ['device:locked']));
test('battery alert needs under 15% and falling', () => {
    const low = { ...ok, battery: { pct: 12, charging: false, external: false } };
    assert.deepEqual(deviceIssues(low, 14).map(i => i.key), ['device:battery']);
    assert.deepEqual(deviceIssues({ ...low, battery: { pct: 12, charging: true, external: true } }, 14), []);
    assert.deepEqual(deviceIssues({ ...ok, battery: { pct: 40, charging: false, external: false } }, 50), []);
});
