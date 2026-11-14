import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishingCadence, upcomingVideoSlots} from '../src/publishing/cadence.js';

test('ordinary Pacific day has twelve ordered video slots, two hours apart at minute 22',()=>{
    const slots=upcomingVideoSlots(new Date('2026-10-05T06:59:59Z'),12);
    assert.equal(slots[0]!.toISOString(),'2026-10-05T07:22:00.000Z');
    assert.equal(slots[11]!.toISOString(),'2026-10-06T05:22:00.000Z');
    assert.equal(new Set(slots.map(d=>d.toISOString())).size,12);
    for(let i=1;i<slots.length;i++)assert.equal(slots[i]!.getTime()-slots[i-1]!.getTime(),2*60*60_000);
    assert.deepEqual([...publishingCadence.platforms],['instagram','facebook','youtube','tiktok']);
});

test('elapsed slots are excluded and winter slots stay on Pacific time',()=>{
    assert.equal(upcomingVideoSlots(new Date('2026-10-05T07:22:00Z'),1)[0]!.toISOString(),'2026-10-05T09:22:00.000Z');
    assert.equal(upcomingVideoSlots(new Date('2026-11-03T07:59:59Z'),1)[0]!.toISOString(),'2026-11-03T08:22:00.000Z');
});
