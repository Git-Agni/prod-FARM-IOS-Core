import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mirroringConnectionBlocker} from '../src/devices/mirroring/controller.js';
test('a visible Mirroring window does not prove a connected phone',()=>{
    assert.match(mirroringConnectionBlocker('Unlock Your iPhone\nFollow the instructions on iPhone')!,/one-time iPhone unlock/);
    assert.match(mirroringConnectionBlocker('Error\nAn error occurred. Please try again.')!,/disconnected/);
    assert.match(mirroringConnectionBlocker('Connecting to iPhone 15 Pro Max')!,/still connecting/);
    assert.match(mirroringConnectionBlocker('iPhone in Use')!,/Lock the physical/);
    assert.equal(mirroringConnectionBlocker('12:20 Search Instagram Facebook'),undefined);
});
