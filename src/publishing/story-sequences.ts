import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { reviewStoryDraft } from './story-policy.js';
import { publishingCadence } from './cadence.js';

export function validateStoryPlan(value: any) {
    if (!value || typeof value !== 'object' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value.requestId ?? '')) throw new Error('A stable request ID is required');
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) throw new Error('A short title is required');
    if (typeof value.deviceUdid !== 'string' || !/^[a-zA-Z0-9-]{10,80}$/.test(value.deviceUdid)) throw new Error('A registered phone is required');
    if (value.account !== 'antoniorevenue' || value.facebookAccount !== '61584693917444') throw new Error('Use the reviewed Instagram and Facebook accounts');
    if (!Number.isFinite(Date.parse(value.runAt))) throw new Error('A valid target time is required');
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value.runAt));
    if (!(publishingCadence.storyTimes as readonly string[]).includes(parts.slice(0,5)) || !parts.endsWith(':00') || new Date(value.runAt).getMilliseconds()) throw new Error(`Story plans use ${publishingCadence.storyTimes.join(' or ')} Los Angeles time`);
    if (!Array.isArray(value.draft?.frames) || value.draft.frames.length !== 5) throw new Error('Include five Story frames');
    return {requestId:value.requestId,title:value.title.trim(),deviceUdid:value.deviceUdid,account:value.account,
        facebookAccount:value.facebookAccount,runAt:new Date(value.runAt).toISOString(),draft:value.draft};
}

/** Saves reviewable plans, never approval inferred from JSON or a schedule request. */
export class StorySequenceStore {
    constructor(private pool: Pool) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.story_sequences (
            id uuid PRIMARY KEY, request_id text UNIQUE NOT NULL, content_hash text NOT NULL,
            device_udid text NOT NULL, account text NOT NULL, run_at timestamptz NOT NULL,
            title text NOT NULL, draft jsonb NOT NULL, review jsonb NOT NULL,
            state text NOT NULL DEFAULT 'needs_review' CHECK(state IN ('needs_review','missed','cancelled')),
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS story_sequence_slot ON scheduler.story_sequences(device_udid,account,run_at) WHERE state <> 'cancelled'`);
    }
    async save(value: unknown) {
        const input = validateStoryPlan(value);
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const old = (await this.pool.query('SELECT * FROM scheduler.story_sequences WHERE request_id=$1',[input.requestId])).rows[0];
        if (old) { if (old.content_hash !== hash) throw new Error('Request ID belongs to different content'); return old; }
        if (Date.parse(input.runAt) <= Date.now()) throw new Error('Choose a future review target');
        const review = reviewStoryDraft(input.draft);
        const row = (await this.pool.query(`INSERT INTO scheduler.story_sequences
            (id,request_id,content_hash,device_udid,account,run_at,title,draft,review)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(request_id) DO NOTHING RETURNING *`,
            [randomUUID(),input.requestId,hash,input.deviceUdid,input.account,input.runAt,input.title,input.draft,review])).rows[0];
        if (row) return row;
        const raced = (await this.pool.query('SELECT * FROM scheduler.story_sequences WHERE request_id=$1',[input.requestId])).rows[0];
        if (raced?.content_hash !== hash) throw new Error('Request ID belongs to different content');
        return raced;
    }
    /** Move an unsubmitted plan, preserving its assets and approval boundary. */
    async reschedule(id:string,expectedUpdatedAt:string,runAt:string){
        if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isFinite(Date.parse(expectedUpdatedAt)))throw Error('Choose the current Story plan');
        const c=await this.pool.connect();
        try{
            await c.query('BEGIN');
            const row=(await c.query('SELECT * FROM scheduler.story_sequences WHERE id=$1 FOR UPDATE',[id])).rows[0];
            if(!row||!['needs_review','missed'].includes(row.state)||new Date(row.updated_at).toISOString()!==new Date(expectedUpdatedAt).toISOString())throw Error('Story plan changed; refresh before moving it');
            if((await c.query('SELECT 1 FROM scheduler.mirroring_story_jobs WHERE sequence_id=$1',[id])).rowCount)throw Error('A native Story approval or attempt already exists; preserve its slot');
            const input=validateStoryPlan({requestId:row.request_id,title:row.title,deviceUdid:row.device_udid,account:row.account,facebookAccount:'61584693917444',runAt,draft:row.draft});
            if(Date.parse(input.runAt)<=Date.now())throw Error('Choose a future Story slot');
            const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex'),review=reviewStoryDraft(input.draft);
            const saved=(await c.query("UPDATE scheduler.story_sequences SET run_at=$2,content_hash=$3,review=$4,state='needs_review',updated_at=now() WHERE id=$1 RETURNING *",[id,input.runAt,hash,review])).rows[0];
            await c.query('COMMIT');return saved;
        }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    }
    async list() {
        const native=(await this.pool.query("SELECT to_regclass('scheduler.mirroring_story_jobs') present")).rows[0]?.present;
        return (await this.pool.query(native ? 'SELECT s.*,j.state native_state,j.result native_result FROM scheduler.story_sequences s LEFT JOIN scheduler.mirroring_story_jobs j ON j.sequence_id=s.id ORDER BY s.run_at DESC LIMIT 100' : 'SELECT * FROM scheduler.story_sequences ORDER BY run_at DESC LIMIT 100')).rows;
    }
    async tick(now: Date) {
        const native=(await this.pool.query("SELECT to_regclass('scheduler.mirroring_story_jobs') present")).rows[0]?.present;
        await this.pool.query("UPDATE scheduler.story_sequences s SET state='missed',updated_at=$1 WHERE s.state='needs_review' AND s.run_at <= $1"+(native ? " AND NOT EXISTS(SELECT 1 FROM scheduler.mirroring_story_jobs j WHERE j.sequence_id=s.id AND j.state IN('armed','running','published','needs_review'))" : ''),[now]);
    }
}
