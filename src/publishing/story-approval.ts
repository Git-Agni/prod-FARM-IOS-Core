import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { CronExpressionParser } from 'cron-parser';
import { publishingCadence } from './cadence.js';

const root = new URL('../../static/publishing/stories/', import.meta.url);
export const storyDraftIds = ['roadmap', 'nora'] as const;
export async function storyDraftRevision(id: string) {
    if (!storyDraftIds.includes(id as any)) throw new Error('Unknown Story draft');
    const manifest = await readFile(new URL(`${id}-approval.json`, root), 'utf8');
    const data = JSON.parse(manifest);
    const hash = createHash('sha256').update(manifest);
    hash.update(await readFile(new URL('index.html', root)));
    hash.update(await readFile(new URL('../styles.css', root)));
    for (const file of data.assets) hash.update(await readFile(new URL(file, root)));
    return {id, title:data.title, revision:hash.digest('hex'), frameCount:5};
}
export function validateStoryApproval(body: any) {
    if (!body || !/^[a-f0-9]{64}$/.test(body.revision ?? '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId ?? '')) throw new Error('Reload the draft before approving');
    if (!Array.isArray(body.reviewedFrames) || new Set(body.reviewedFrames).size !== 5 || ![1,2,3,4,5].every(i=>body.reviewedFrames.includes(i))) throw new Error('Review all five Story frames first');
    if (body.confirmed !== true) throw new Error('Confirm draft approval and the pending phone review');
}
export class StoryApprovalStore {
    constructor(private pool: Pool) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.story_draft_approvals (
            id uuid PRIMARY KEY, request_id text UNIQUE NOT NULL, draft_id text NOT NULL,
            revision text NOT NULL, device_udid text NOT NULL, account text NOT NULL,
            facebook_account text NOT NULL, run_at timestamptz NOT NULL,
            approved_at timestamptz NOT NULL DEFAULT now(),
            state text NOT NULL DEFAULT 'approved_waiting_native' CHECK(state IN ('approved_waiting_native','cancelled')),
            UNIQUE(draft_id,revision))`);
        await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS story_approval_reserved_slot ON scheduler.story_draft_approvals(account,run_at) WHERE state <> 'cancelled'`);
    }
    async list() {return (await this.pool.query('SELECT * FROM scheduler.story_draft_approvals ORDER BY run_at')).rows;}
    async approve(id: string, body: any, deviceUdid: string) {
        validateStoryApproval(body);
        const draft = await storyDraftRevision(id);
        if (draft.revision !== body.revision) throw new Error('This draft changed. Reload and review the new version.');
        const c=await this.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query("SELECT pg_advisory_xact_lock(hashtextextended('story-approval:antoniorevenue',9))");
            const existing=(await c.query('SELECT * FROM scheduler.story_draft_approvals WHERE request_id=$1 OR (draft_id=$2 AND revision=$3)',[body.requestId,id,draft.revision])).rows;
            if (existing.some(r=>r.request_id===body.requestId && (r.draft_id!==id||r.revision!==draft.revision))) throw new Error('Request ID already used for another approval');
            if(existing.length){await c.query('COMMIT');return existing[0];}
            const occupied=(await c.query("SELECT run_at FROM scheduler.story_draft_approvals WHERE account='antoniorevenue' AND state <> 'cancelled' UNION SELECT run_at FROM scheduler.story_sequences WHERE account='antoniorevenue' AND state <> 'cancelled'")).rows;
            const times=new Set(occupied.map(r=>new Date(r.run_at).toISOString()));
            const it=CronExpressionParser.parse(publishingCadence.storyCron,{currentDate:new Date(),tz:publishingCadence.timezone});
            let runAt=it.next().toDate(); while(times.has(runAt.toISOString())) runAt=it.next().toDate();
            // This reserves a review slot only. It never arms a sender or controls the phone.
            const row=(await c.query(`INSERT INTO scheduler.story_draft_approvals(id,request_id,draft_id,revision,device_udid,account,facebook_account,run_at)
                VALUES($1,$2,$3,$4,$5,'antoniorevenue','61584693917444',$6) RETURNING *`,[randomUUID(),body.requestId,id,draft.revision,deviceUdid,runAt])).rows[0];
            await c.query('COMMIT');return row;
        } catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
    }
}
export async function registerStoryApprovalRoutes(ctx: any, pool: Pool) {
    const store=new StoryApprovalStore(pool); await store.initialize();
    ctx.app.get('/api/publishing/stories/approvals',async()=>({publicationEnabled:false, approvals:await store.list(), drafts:await Promise.all(storyDraftIds.map(storyDraftRevision))}));
    ctx.app.post('/api/publishing/stories/drafts/:id/approve',async(req:any,reply:any)=>{
        try{
            const devices=(await ctx.loadDevices()).filter((d:any)=>!d.disabled);
            if(devices.length!==1) throw new Error('Approval requires exactly one enabled phone. Choose the phone before continuing.');
            return await store.approve(req.params.id,req.body,devices[0].udid);
        }catch(e){return reply.code(409).send({error:e instanceof Error?e.message:String(e)});}
    });
}
