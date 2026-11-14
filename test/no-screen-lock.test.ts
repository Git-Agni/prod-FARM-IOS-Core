import test from 'node:test';
import assert from 'node:assert/strict';
import {WdaRemoteControl} from '../src/devices/wda-remote.js';

test('owner screen-lock prohibition sends no phone request',async()=>{
 let requests=0;
 const remote=new WdaRemoteControl({deviceUdid:'test-phone',fetchImpl:async()=>{requests++;throw Error('No network expected');}});
 await assert.rejects(remote.performAction('test-phone',{type:'lock'}),/Screen locking is disabled/);
 assert.equal(requests,0);
});
