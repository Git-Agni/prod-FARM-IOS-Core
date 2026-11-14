import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseWorkerHealth } from '../src/publishing/worker-health.js';
import { startReleaseLoop } from '../src/publishing/release-loop.js';
import { startWorker } from '../src/scheduler/worker.js';
import { PluginRegistry } from '../src/registry.js';

test('release health reports a running worker separately from blocked publication', () => {
    const now = new Date('2026-10-05T18:00:00Z');
    const row = {last_tick:now,control_mode:'mirroring',state:'blocked',blockers:['Publisher missing']};
    const status = releaseWorkerHealth(row,now);
    assert.equal(status.healthy,true);
    assert.equal(status.automaticPostingRequested,true);
    assert.equal(status.videoPostingRunning,false);
    assert.equal(status.state,'blocked');
    assert.equal(releaseWorkerHealth({...row,state:'running'},now).videoPostingRunning,false);
    assert.equal(releaseWorkerHealth({...row,state:'running',blockers:[]},now).videoPostingRunning,true);
    assert.equal(releaseWorkerHealth(row,new Date(now.getTime()+90_000)).state,'stopped');
    assert.equal(releaseWorkerHealth(row,new Date(now.getTime()-1)).healthy,false);
    assert.equal(releaseWorkerHealth(null,now).automaticPostingRequested,false);
});

test('Mirroring schedule checks never read a due release, claim Share or load a WDA driver', async () => {
    const oldMode = process.env.PHONE_FARM_CONTROL_MODE;
    process.env.PHONE_FARM_CONTROL_MODE='mirroring';
    const queries:string[]=[];
    const pool = {query:async (sql:string)=>{queries.push(sql);return {rows:[],rowCount:0};}} as any;
    try {
        const loop = await startReleaseLoop(pool);
        await loop.close();
        assert.ok(queries.some(sql=>sql.includes('INSERT INTO scheduler.publishing_worker_health')));
        assert.equal(queries.some(sql=>sql.includes("WHERE r.state='armed'")),false);
        assert.equal(queries.some(sql=>sql.includes('share_claimed_at=now()')),false);
        await assert.rejects(startWorker(new PluginRegistry([])),/no XCTest fallback/);
    } finally {
        if(oldMode===undefined)delete process.env.PHONE_FARM_CONTROL_MODE;
        else process.env.PHONE_FARM_CONTROL_MODE=oldMode;
    }
});
