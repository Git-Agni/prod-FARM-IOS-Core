import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acquireDeviceLock,releaseDeviceLock} from '../src/scheduler/device-lock.js';

test('phone job does not run when another owner holds the lock',async()=>{
    let released=false,called=0;
    const pool:any={connect:async()=>({query:async()=>{called++;return {rows:[{locked:false}]};},release:()=>{released=true;}})};
    await assert.rejects(acquireDeviceLock(pool,'phone',new AbortController().signal,new Date(Date.now()+20)),/busy/);
    assert.ok(called>0);assert.equal(released,true);
});
test('aborted waiting job cannot take the phone',async()=>{
    const a=new AbortController();a.abort();let queried=false,released=false;
    const pool:any={connect:async()=>({query:async()=>{queried=true;},release:()=>{released=true;}})};
    await assert.rejects(acquireDeviceLock(pool,'phone',a.signal,new Date(Date.now()+10000)),/Stopped/);
    assert.equal(queried,false);assert.equal(released,true);
});
test('owner holds connection through work and destroys it after unlock failure',async()=>{
    let released=false;const client:any={query:async(sql:string)=>{if(sql.includes('unlock'))throw Error('lost connection');return {rows:[{locked:true}]};},release:(destroy:boolean)=>{released=destroy;}};
    const held=await acquireDeviceLock({connect:async()=>client} as any,'phone',new AbortController().signal,new Date(Date.now()+1000));
    assert.equal(released,false);await assert.rejects(releaseDeviceLock(held,'phone'));assert.equal(released,true);
});
