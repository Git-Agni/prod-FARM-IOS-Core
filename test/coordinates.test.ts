import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CALIBRATABLE_POINTS, coordinatesForProfile, resolveDeviceCoordinates, validateCoordinateOverrides,
} from '../src/devices/coordinates.js';

test('resolveDeviceCoordinates applies single-tap overrides over the profile', () => {
    const base = coordinatesForProfile('iphone8');
    assert.equal(resolveDeviceCoordinates('iphone8', undefined), base);

    const resolved = resolveDeviceCoordinates('iphone8', { like: { x: 350, y: 320 } });
    assert.deepEqual(resolved.tiktok.like, { x: 350, y: 320 });
    assert.deepEqual(resolved.tiktok.save, base.tiktok.save, 'untouched points keep the profile value');
    assert.deepEqual(resolved.tiktok.picker, base.tiktok.picker, 'non-calibratable fields are untouched');
});

test('validateCoordinateOverrides enforces known keys, numbers and screen bounds', () => {
    assert.deepEqual(validateCoordinateOverrides({ like: { x: 10.6, y: 20.2 } }, 'iphone8'), { like: { x: 11, y: 20 } });
    assert.throws(() => validateCoordinateOverrides({ nope: { x: 1, y: 1 } }, 'iphone8'), /Unknown calibratable point/);
    assert.throws(() => validateCoordinateOverrides({ like: { x: 1, y: 999 } }, 'iphone8'), /outside the 375×667 screen/);
    assert.throws(() => validateCoordinateOverrides({ like: { x: 'a', y: 1 } }, 'iphone8'), /must be numbers/);
    assert.throws(() => validateCoordinateOverrides([], 'iphone8'), /must be an object/);
});

test('every calibratable point exists on the profile', () => {
    const tiktok = coordinatesForProfile('iphone8').tiktok as Record<string, { x: number; y: number }>;
    for (const name of CALIBRATABLE_POINTS) {
        assert.equal(typeof tiktok[name]?.x, 'number', name);
        assert.equal(typeof tiktok[name]?.y, 'number', name);
    }
});
