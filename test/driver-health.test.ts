import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Pool } from 'pg';
import { nativeDriverReady, nativeDriverStatus,withSupervisorReason } from '../src/publishing/driver-health.js';
import { TimedReleaseStore } from '../src/publishing/timed-release.js';
test('an offline driver shows the supervisor repair without granting readiness',()=>{
 const native={ready:false,serviceReady:false,unlocked:false,reason:'Phone control is unavailable.'};
 assert.deepEqual(withSupervisorReason(native,{wda:'error',message:'Check the unlocked iPhone for an automation approval prompt'}),{...native,reason:'Check the unlocked iPhone for an automation approval prompt'});
 assert.equal(withSupervisorReason(native,{wda:'ready',message:'Ready'}),native);
 assert.equal(withSupervisorReason({...native,serviceReady:true},{wda:'error',message:'Stale error'}).reason,native.reason);
});
test('only a successful WDA ready response admits native work',async()=>{
 let status=200,body:unknown={value:{ready:true}},locked:unknown=false;
 const server=createServer((req,res)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/wda/locked'?{value:locked}:body));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 try {
  assert.equal(await nativeDriverReady(base,new AbortController().signal),true);
  locked=true;
  assert.deepEqual(await nativeDriverStatus(base,new AbortController().signal),{ready:false,serviceReady:true,unlocked:false,reason:'Unlock the iPhone to allow posting.'});
  locked={error:'unknown command'};assert.equal(await nativeDriverReady(base,new AbortController().signal),false);
  locked=false;
  body={value:{ready:false}};assert.equal(await nativeDriverReady(base,new AbortController().signal),false);
  body={value:{ready:true,error:'locked'}};assert.equal(await nativeDriverReady(base,new AbortController().signal),false);
  status=503;body={value:{ready:true}};assert.equal(await nativeDriverReady(base,new AbortController().signal),false);
 } finally {await new Promise<void>(r=>server.close(()=>r()));}
 assert.equal(await nativeDriverReady(base,new AbortController().signal),false);
});
test('offline phone leaves due release untouched and never opens a connection or driver',async()=>{
 let connects=0,drivers=0;
 const pool={query:async()=>({rows:[{item_id:'due',input:{deviceUdid:'offline'}}]}),connect:async()=>{connects++;throw new Error('Should not consume release');}} as unknown as Pool;
 await new TimedReleaseStore(pool).tick(async()=>{drivers++;throw new Error('Should not touch phone');},()=>false);
 assert.equal(connects,0);assert.equal(drivers,0);
});
test('a pilot allowlist excludes unrelated due releases before any claim or phone connection',async()=>{
 let connects=0,drivers=0,parameters:unknown;
 const pool={query:async(_sql:string,values:unknown)=>{parameters=values;return {rows:[{item_id:'unrelated',input:{deviceUdid:'online'}}]};},
  connect:async()=>{connects++;throw new Error('Unrelated item must remain armed');}} as unknown as Pool;
 await new TimedReleaseStore(pool).tick(async()=>{drivers++;throw new Error('No phone input');},()=>true,['reviewed-pilot']);
 assert.deepEqual(parameters,[['reviewed-pilot']]);assert.equal(connects,0);assert.equal(drivers,0);
});
test('an empty pilot allowlist does not query or touch the phone',async()=>{
 const pool={query:async()=>{throw new Error('No items are admitted');}} as unknown as Pool;
 await new TimedReleaseStore(pool).tick(async()=>{throw new Error('No driver');},()=>true,[]);
});
