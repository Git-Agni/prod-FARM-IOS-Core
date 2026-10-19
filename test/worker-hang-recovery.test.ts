import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseConnection} from '../src/database/client.js';
import {TimedReleaseStore} from '../src/publishing/timed-release.js';
import {tickStalled,stalledTickMs} from '../src/publishing/release-loop.js';
import {workerHeartbeatIssue,workerStaleAlertMs,workerRestartMs} from '../src/publishing/worker-health.js';

// Oct 19 09:37 PT: three pooler drops left all 4 pooled clients checked out and dead; the worker hung for five hours.

test('the pool never waits forever for a client or a query',async()=>{
    const db=createDatabaseConnection('postgres://unused@127.0.0.1:1/none');
    const o=(db.pool as any).options;
    assert.equal(o.connectionTimeoutMillis,30_000);
    assert.ok(o.query_timeout>=180_000,'attended scripts set a 180 s statement timeout for the phone lock');
    assert.equal(o.keepAlive,true);
    await db.close();
});

test('a client that dies mid-run is destroyed, not leaked, and the job still leaves running',async()=>{
    let dead=false;const releases:unknown[]=[];const poolWrites:string[]=[];
    const c={on(){},off(){},release(destroy?:unknown){releases.push(destroy);},
        query:async(sql:string)=>{
            if(dead)throw new Error('Client has encountered a connection error and is not queryable');
            if(sql.includes('SELECT * FROM scheduler.publishing_items'))return {rows:[{id:'x',status:'held',version:1,input:{deviceUdid:'p'},results:{}}]};
            if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
            if(sql.includes("SET state='running'"))return {rows:[{run_at:new Date(),item_version:1}]};
            return {rows:[]};
        }};
    const pool={connect:async()=>c,query:async(sql:string)=>{
        poolWrites.push(sql);
        if(sql.includes('r.run_at<=now()'))return {rows:[{item_id:'x',input:{deviceUdid:'p'}}]};
        if(sql.includes('SELECT share_claimed_at'))return {rows:[{share_claimed_at:null}]};
        return {rows:[]};
    }};
    const store=new TimedReleaseStore(pool as any);
    await store.tick(async()=>{dead=true;throw new Error('Connection terminated unexpectedly');});
    assert.ok(poolWrites.some(s=>s.includes("SET state='needs_review'")),'failure is recorded through a fresh client');
    assert.deepEqual(releases,[true],'released exactly once, and destroyed');
});

test('stale recovery only touches running jobs with no Share claim',async()=>{
    let sql='';
    const store=new TimedReleaseStore({query:async(s:string)=>{sql=s;return {rows:[{item_id:'a'}]};}} as any);
    assert.deepEqual(await store.recoverStale(),['a']);
    assert.match(sql,/state='running' AND share_claimed_at IS NULL/);
    assert.match(sql,/interruptedBeforeShare/);
});

test('the watchdog fires only after 40 minutes without progress',()=>{
    const now=Date.now();
    assert.equal(tickStalled(false,now-2*stalledTickMs,now),false);
    assert.equal(tickStalled(true,now-stalledTickMs+1000,now),false);
    assert.equal(tickStalled(true,now-stalledTickMs-1000,now),true);
});

test('a stale heartbeat alerts after 5 minutes and asks for a restart after 15',()=>{
    const now=Date.now();
    assert.equal(workerHeartbeatIssue(new Date(now-60_000),now),null);
    const stale=workerHeartbeatIssue(new Date(now-workerStaleAlertMs-1000),now);
    assert.equal(stale?.key,'worker:stale');assert.equal(stale?.restart,false);
    assert.equal(workerHeartbeatIssue(new Date(now-workerRestartMs-1000),now)?.restart,true);
    assert.equal(workerHeartbeatIssue(null,now)?.restart,true);
});
