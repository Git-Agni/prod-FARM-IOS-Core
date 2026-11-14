import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseWdaLaunchFailure,wdaFailureNeedsRepair} from '../src/devices/wda/diagnostics.js';
test('permanent signing errors stop relaunches while transient failures remain recoverable',()=>{
 for(const message of ['Timed out while enabling automation mode','No profiles for example were found','No signing certificate found','Developer Mode is disabled','license agreement must be accepted']) assert.equal(wdaFailureNeedsRepair(diagnoseWdaLaunchFailure(message)),true);
 assert.equal(wdaFailureNeedsRepair(diagnoseWdaLaunchFailure('device is locked')),false);
 assert.equal(wdaFailureNeedsRepair(undefined),false);
});
