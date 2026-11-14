import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneControlMode, requireWdaControl } from '../src/devices/control-mode.js';
import { WdaApp } from '../src/publishing/wda-app.js';

test('control modes are explicit and unknown values fail closed',()=>{
    assert.equal(phoneControlMode('wda'),'wda');
    assert.equal(phoneControlMode('mirroring'),'mirroring');
    assert.throws(()=>phoneControlMode('unknown'),/must be/);
});
test('Mirroring mode cannot construct a posting WDA driver or silently fall back',()=>{
    const previous=process.env.PHONE_FARM_CONTROL_MODE;
    process.env.PHONE_FARM_CONTROL_MODE='mirroring';
    try {
        assert.throws(()=>requireWdaControl(),/no XCTest fallback/);
        assert.throws(()=>new WdaApp('http://127.0.0.1:8100',new AbortController().signal),/no XCTest fallback/);
    } finally {
        if(previous===undefined)delete process.env.PHONE_FARM_CONTROL_MODE;else process.env.PHONE_FARM_CONTROL_MODE=previous;
    }
});
