import test from 'node:test';
import assert from 'node:assert/strict';
import {slotsFrom,publishingCadence as c} from '../src/publishing/cadence.js';

const pt=(ms:number)=>new Date(ms).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:false,day:'numeric'});
// Oct 29 evening, Antonio: 5 a day at 08, 11, 14, 17, 20 PT. Nov 3: Instagram goes to 7 a day, every 2 hours 08 to 20 PT.
test('Instagram posts every 2 hours 08 to 20 PT, TikTok and Shorts at 08, 11, 14, 17 and 20 PT, across the Nov 1 clock change',()=>{
    const ig=slotsFrom(Date.parse('2026-10-31T07:00:00Z'),c.instagramHours,2).slice(0,14);
    assert.deepEqual(ig.map(pt),['31, 08','31, 10','31, 12','31, 14','31, 16','31, 18','31, 20','1, 08','1, 10','1, 12','1, 14','1, 16','1, 18','1, 20']);
    for(const hours of [c.tiktokHours,c.youtubeHours]){
        const slots=slotsFrom(Date.parse('2026-10-31T07:00:00Z'),hours,2).slice(0,10);
        assert.deepEqual(slots.map(pt),['31, 08','31, 11','31, 14','31, 17','31, 20','1, 08','1, 11','1, 14','1, 17','1, 20']);
    }
});
test('7 Instagram slots a day, 5 TikTok and 5 Shorts',()=>{
    const day=Date.parse('2026-10-16T07:00:00Z');
    assert.equal(slotsFrom(day,c.instagramHours,0).length,7);
    assert.equal(slotsFrom(day,c.tiktokHours,0).length,5);
    assert.equal(slotsFrom(day,c.youtubeHours,0).length,5);
});
