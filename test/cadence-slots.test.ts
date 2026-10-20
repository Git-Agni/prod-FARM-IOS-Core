import test from 'node:test';
import assert from 'node:assert/strict';
import {slotsFrom,publishingCadence as c} from '../src/publishing/cadence.js';

const pt=(ms:number)=>new Date(ms).toLocaleString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hour12:false,day:'numeric'});
test('Hourly slots run 07 to 23 PT across the Nov 1 clock change',()=>{
    const slots=slotsFrom(Date.parse('2026-10-31T07:00:00Z'),c.tiktokHours,2);
    const day=(d:string)=>slots.map(pt).filter(x=>x.startsWith(d+','));
    for(const d of ['31','1']){
        assert.equal(day(d)[0],`${d}, 07`);
        assert.equal(day(d).at(-1),`${d}, 23`);
        assert.equal(day(d).length,17);
    }
});
test('17 hourly slots a day on every lane',()=>{
    const day=Date.parse('2026-10-16T07:00:00Z');
    assert.equal(slotsFrom(day,c.instagramHours,0).length,17);
    assert.equal(slotsFrom(day,c.tiktokHours,0).length,17);
    assert.equal(slotsFrom(day,c.youtubeHours,0).length,17);
});
