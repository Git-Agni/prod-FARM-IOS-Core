import type { Pool } from 'pg';
import { ReceiptVerificationError, releaseOnce, assertReceipts, assertReleaseTargets, type ReleaseDriver } from './release-policy.js';
import { requestHash, validatePostingInput } from './model.js';
import { linkRelatedReel, openingHeadline } from './related-autolink.js';
import { ENGAGEMENT_SCHEMA } from './engage-task.js';
import { publishingCadence } from './cadence.js';

/** Admit due work within 45 minutes and start it within 55, so every post in an hourly group gets its turn
 * behind the others on the one phone, but never runs into the next hour's slot. */
export function insidePostingWindow(runAt: number, admittedAt: number, now: number) {
    return admittedAt-runAt<=45*60_000 && now-runAt<=55*60_000;
}

const interruptedResult=`jsonb_build_object('error',CASE WHEN share_claimed_at IS NULL THEN 'Worker interrupted before Share; nothing was submitted'
  ELSE 'Worker interrupted; inspect the phone before rescheduling' END,'interruptedBeforeShare',share_claimed_at IS NULL)`;

/** Durable, one-shot posting jobs. Only an explicitly armed job can run. */
export class TimedReleaseStore {
    constructor(private pool: Pool, private headlineOf: (path: string) => Promise<string> = openingHeadline) {}
    async initialize() {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.publishing_releases (
            item_id uuid PRIMARY KEY REFERENCES scheduler.publishing_items(id),
            item_version integer NOT NULL, run_at timestamptz NOT NULL,
            state text NOT NULL CHECK(state IN ('armed','running','cancelled','published','needs_review')),
            share_claimed_at timestamptz, result jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
        )`);
    }
    async arm(itemId: string, version: number, options: {nativeYouTubeLayout?:boolean} = {}) {
        const c = await this.pool.connect();
        try {
            await c.query('BEGIN');
            const item = (await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[itemId])).rows[0];
            if (!item) throw new Error('Calendar item not found');
            if (item.results?.metaTrialPilot) throw new Error('Meta Trial pilot requires review; keep its publication claim intact');
            validatePostingInput(item.input);
            assertReleaseTargets(item.input,options);
            if (/https?:\/\/|www\./i.test(item.input.caption)) throw new Error('Remove URLs from the public caption');
            // Serialize arms for the same video, including arms on different phones.
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[item.media.sha256]);
            const duplicate = await c.query(`SELECT i.id FROM scheduler.publishing_items i
              LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
              WHERE i.id<>$1 AND i.media->>'sha256'=$2
              -- Antonio (Oct 15 21:15): never post the exact same video twice; Instagram flagged a repost as duplicate content.
              AND (i.status IN ('published','needs_review','publishing') OR r.state IN ('armed','running','published','needs_review'))
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(i.input->'targets') a,
                jsonb_array_elements($3::jsonb) b WHERE a->>'platform'=b->>'platform'
                AND lower(ltrim(a->>'account','@'))=lower(ltrim(b->>'account','@'))) LIMIT 1`,
              [itemId,item.media.sha256,JSON.stringify(item.input.targets)]);
            if (duplicate.rowCount) throw new Error('This video already has a release for this account: '+duplicate.rows[0].id);
            // Every Instagram post links its topic-matched Reel, whatever path created it (related-autolink.ts).
            // The item's version moves with the change, and the release is armed at the new version. A post due within
            // 10 minutes is left as it is.
            let armVersion = version;
            const linked = item.version === version && item.status === 'held'
                && Date.parse(item.input.runAt) > Date.now() + 10*60_000 ? await linkRelatedReel(item.input, item.media, this.headlineOf) : undefined;
            if (linked) {
                const u = await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now(),
                  results=results||jsonb_build_object('relatedReel',$4::jsonb) WHERE id=$1 AND version=$5 AND status='held' RETURNING version`,
                  [itemId,linked.input,requestHash(linked.input,item.media.sha256),JSON.stringify(linked.choice),version]);
                if (!u.rowCount) throw new Error('Item changed, target time passed, or a release already exists');
                armVersion = u.rows[0].version;
            }
            const tiktok = item.input.targets.find((t:any)=>t.platform==='tiktok');
            if(tiktok) {
                const account=tiktok.account.replace(/^@/,'').toLowerCase();
                const day=(await c.query("SELECT (($1::timestamptz AT TIME ZONE 'America/Los_Angeles')::date)::text AS posting_day",[item.input.runAt])).rows[0].posting_day;
                await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))',['tiktok:'+account+':'+day]);
                const count=(await c.query(`SELECT count(*)::int n FROM scheduler.publishing_items i
                  JOIN scheduler.publishing_releases r ON r.item_id=i.id
                  WHERE i.id<>$1 AND r.state IN ('armed','running','published','needs_review')
                  AND (r.run_at AT TIME ZONE 'America/Los_Angeles')::date=$2::date
                  AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.input->'targets') t
                    WHERE t->>'platform'='tiktok' AND lower(ltrim(t->>'account','@'))=$3)`,[itemId,day,account])).rows[0].n;
                if(count>=publishingCadence.tiktokDailyLimit)throw new Error(`TikTok is limited to ${publishingCadence.tiktokDailyLimit} posts per day for this account in Los Angeles time`);
            }
            const r = await c.query(`INSERT INTO scheduler.publishing_releases(item_id,item_version,run_at,state)
              SELECT id,version,(input->>'runAt')::timestamptz,'armed' FROM scheduler.publishing_items
              WHERE id=$1 AND version=$2 AND status='held' AND (input->>'runAt')::timestamptz>now()
              ON CONFLICT(item_id) DO NOTHING RETURNING item_id`,[itemId,armVersion]);
            if (!r.rowCount) throw new Error('Item changed, target time passed, or a release already exists');
            await c.query('COMMIT');
        } catch(error) { await c.query('ROLLBACK'); throw error; }
        finally { c.release(); }
    }

    async cancel(itemId: string) {
        return (await this.pool.query(`UPDATE scheduler.publishing_releases SET state='cancelled',updated_at=now()
          WHERE item_id=$1 AND state='armed' RETURNING item_id`,[itemId])).rowCount===1;
    }
    async tick(driverFor: (item: any) => Promise<ReleaseDriver>, readyFor: (udid: string) => boolean = () => true,
        allowedItems?: readonly string[]) {
        // A pilot can admit one reviewed item without consuming unrelated or overdue releases.
        if (allowedItems?.length === 0) return;
        const due = await this.pool.query(`SELECT r.item_id,i.input FROM scheduler.publishing_releases r
          JOIN scheduler.publishing_items i ON i.id=r.item_id
          WHERE r.state='armed' AND r.run_at<=now()
          AND ($1::uuid[] IS NULL OR r.item_id=ANY($1::uuid[]))
          ORDER BY r.run_at LIMIT 20`, [allowedItems ?? null]);
        const admittedAt = Date.now();
        // Leave unavailable phones armed. A failed health check must never consume a release or claim Share.
        for (const row of due.rows) if ((!allowedItems || allowedItems.includes(row.item_id))
            && readyFor(row.input.deviceUdid)) await this.run(row.item_id,driverFor,admittedAt);
    }
    private async run(id: string, driverFor: (item: any) => Promise<ReleaseDriver>, admittedAt: number) {
        const c=await this.pool.connect();let locked=false;let phone='';let started=false;let prepared=false;let driver: (ReleaseDriver & { leaveVideo?: () => Promise<void> }) | undefined;
        // Oct 19: a pooler drop killed this client mid-run. The failure write below then threw on the dead client, the
        // release stayed 'running', and the unlock in finally threw before release(), leaking the client. Four such leaks
        // emptied the pool and the worker hung. Fall back to a fresh pooled client and destroy a broken one.
        let broken=false;const onError=()=>{broken=true;};c.on('error',onError);
        const q=(sql:string,params:unknown[])=>c.query(sql,params).catch(()=>{broken=true;return this.pool.query(sql,params);});
        try {
            const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];
            if(!item) return;
            phone=item.input.deviceUdid;prepared=!!item.results?.preparedNative;
            locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[phone])).rows[0].locked;
            if(!locked) return;
            const job=(await c.query(`UPDATE scheduler.publishing_releases SET state='running',updated_at=now()
              WHERE item_id=$1 AND state='armed' AND run_at<=now() RETURNING *`,[id])).rows[0];
            if(!job)return;started=true;
            if(item.status!=='held'||item.version!==job.item_version)throw new Error('Calendar item changed');
            if(!insidePostingWindow(new Date(job.run_at).getTime(),admittedAt,Date.now()))throw new Error('Posting window missed; review the new time');
            driver=await driverFor(item);
            await releaseOnce(item.input,item.media,driver,{
                claimShare:async()=>{
                    const r=await c.query(`UPDATE scheduler.publishing_releases SET share_claimed_at=now(),updated_at=now()
                      WHERE item_id=$1 AND state='running' AND share_claimed_at IS NULL
                      AND EXISTS(SELECT 1 FROM scheduler.publishing_items WHERE id=$1 AND version=$2 AND status='held') RETURNING item_id`,[id,job.item_version]);
                    return r.rowCount===1;
                },
                save:async(state,result)=>{
                    await c.query('BEGIN');
                    try {
                        await c.query('UPDATE scheduler.publishing_releases SET state=$2,result=$3,updated_at=now() WHERE item_id=$1',[id,state,JSON.stringify(result)]);
                        await c.query(`UPDATE scheduler.publishing_items SET status=$2,results=results||jsonb_build_object('release',$3::jsonb),version=version+1,updated_at=now() WHERE id=$1`,[id,state,JSON.stringify(result)]);
                        await c.query('COMMIT');
                    } catch(e){await c.query('ROLLBACK');throw e;}
                },
            });
            // After a verified post: post the approved first comment and pin it. Its own claim; never touches the release.
            const pinner = driver as ReleaseDriver & { commentAndPin?: (text: string, claim: () => Promise<void>) => Promise<{status:string}> };
            const released = (await c.query('SELECT state FROM scheduler.publishing_releases WHERE item_id=$1',[id])).rows[0]?.state;
            if (released === 'published' && item.input.firstComment && pinner.commentAndPin) {
                const key = 'pin:item:'+id; let claimed = false;
                await c.query(ENGAGEMENT_SCHEMA);
                try {
                    const result = await pinner.commentAndPin(item.input.firstComment, async () => {
                        const r = await c.query(`INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status) VALUES ($1,'pin',$2,'claimed') ON CONFLICT (claim_key) DO NOTHING RETURNING claim_key`,[key,'item:'+id]);
                        if (!r.rowCount) throw new Error('First comment already claimed');
                        claimed = true;
                    });
                    await c.query(`UPDATE scheduler.engagement_actions SET status='done',result=$2,updated_at=now() WHERE claim_key=$1`,[key,JSON.stringify(result)]);
                } catch(err) {
                    const message = err instanceof Error ? err.message : String(err);
                    await c.query(`INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status,result) VALUES ($1,'pin',$2,$3,$4)
                        ON CONFLICT (claim_key) DO UPDATE SET status=$3,result=$4,updated_at=now()`,[key,'item:'+id,claimed?'uncertain_review':'failed_before_action',JSON.stringify({error:message})]).catch(()=>undefined);
                }
            }
        } catch(e) {
            // Save what the phone showed, so the cause is visible without guessing. Bounded and read-only.
            const capture=(driver as {captureFailure?:(label:string)=>Promise<string>}|undefined)?.captureFailure;
            const evidence=capture?await capture.call(driver,id.slice(0,8)).catch(()=>undefined):undefined;
            if(started)await q(`UPDATE scheduler.publishing_releases SET state='needs_review',result=result||$2::jsonb,updated_at=now() WHERE item_id=$1`,[id,JSON.stringify({error:e instanceof Error?e.message:String(e),...(evidence?{failureEvidence:evidence}:{})})]);
            // A half-finished composer breaks the next run. Close the app only when nothing was submitted.
            const claimed=started&&(await q('SELECT share_claimed_at FROM scheduler.publishing_releases WHERE item_id=$1',[id])).rows[0]?.share_claimed_at;
            if(started&&!claimed&&!prepared)await (driver as {resetAfterFailure?:()=>Promise<void>}|undefined)?.resetAfterFailure?.().catch(()=>undefined);
        } finally {
            if(driver?.leaveVideo) {
                try { await driver.leaveVideo(); }
                catch(error) { await q("UPDATE scheduler.publishing_releases SET result=result||$2::jsonb WHERE item_id=$1",[id,JSON.stringify({exitVideoError:error instanceof Error?error.message:String(error)})]).catch(()=>undefined); }
            }
            // A dead session already dropped its advisory lock on the server.
            if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]).catch(()=>{broken=true;});
            c.off('error',onError);c.release(broken);}
    }
    /** Check delayed receipts under the same phone lock. This path cannot call Share. */
    async reconcilePending(driverFor: (item: any) => Promise<ReleaseDriver>, itemId?: string) {
        const pending = await this.pool.query(`SELECT item_id FROM scheduler.publishing_releases
          WHERE state='needs_review' AND share_claimed_at IS NOT NULL
          AND share_claimed_at>now()-interval '24 hours'
          AND ($1::uuid IS NULL OR item_id=$1)
          AND ($1::uuid IS NOT NULL OR updated_at<now()-interval '5 minutes')
          ORDER BY run_at LIMIT 1`, [itemId ?? null]);
        for (const row of pending.rows) {
            const c=await this.pool.connect();let phone='';let locked=false;let broken=false;const onError=()=>{broken=true;};c.on('error',onError);
            let driver: (ReleaseDriver & {reconcile?: (input: any) => ReturnType<ReleaseDriver['verify']>; leaveVideo?: () => Promise<void>}) | undefined;
            try {
                const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[row.item_id])).rows[0];
                phone=item.input.deviceUdid;
                locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;
                if(!locked)continue;
                const job=(await c.query("SELECT * FROM scheduler.publishing_releases WHERE item_id=$1 AND state='needs_review'",[item.id])).rows[0];
                if(!job?.share_claimed_at)continue;
                driver=await driverFor(item);
                if(!driver.reconcile)continue;
                const receipts=await driver.reconcile(item.input);
                assertReceipts(item.input,receipts);
                const {error,receiptCheckError,...previous}=job.result;
                const result={...previous,previousVerificationError:error ?? receiptCheckError,receipts,reconciledAt:new Date().toISOString(),reconciliation:'Read-only native check; no second Share'};
                await c.query('BEGIN');
                try {
                    await c.query("UPDATE scheduler.publishing_releases SET state='published',result=$2,updated_at=now() WHERE item_id=$1",[item.id,result]);
                    await c.query("UPDATE scheduler.publishing_items SET status='published',results=results||jsonb_build_object('release',$2::jsonb),version=version+1,updated_at=now() WHERE id=$1",[item.id,JSON.stringify(result)]);
                    await c.query('COMMIT');
                } catch(e){await c.query('ROLLBACK');throw e;}
            } catch(e) {
                const q=(sql:string,params:unknown[])=>c.query(sql,params).catch(()=>{broken=true;return this.pool.query(sql,params);});
                await q("UPDATE scheduler.publishing_releases SET result=result||$2::jsonb||jsonb_build_object('receiptChecks',COALESCE((result->>'receiptChecks')::int,CASE WHEN result ? 'lastReceiptCheck' THEN 1 ELSE 0 END)+1),updated_at=now() WHERE item_id=$1 AND state='needs_review'",[row.item_id,JSON.stringify({lastReceiptCheck:new Date().toISOString(),receiptCheckError:e instanceof Error?e.message:String(e),...(e instanceof ReceiptVerificationError?{receipts:e.receipts}:{})})]);
                if(e instanceof ReceiptVerificationError)await q(`UPDATE scheduler.publishing_items SET results=jsonb_set(results,'{release}',COALESCE(results->'release','{}'::jsonb)||jsonb_build_object('receipts',$2::jsonb)),updated_at=now() WHERE id=$1`,[row.item_id,JSON.stringify(e.receipts)]);
            } finally {
                if(driver?.leaveVideo)await driver.leaveVideo().catch(()=>undefined);
                if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]).catch(()=>{broken=true;});
                c.off('error',onError);c.release(broken);
            }
        }
    }
    async recoverInterrupted() {
        // Never replay a job interrupted while running, even if no receipt survived. The Share claim is written before
        // any Share tap, so a job with no claim submitted nothing; lane-slotter.ts may give it a new slot.
        await this.pool.query(`UPDATE scheduler.publishing_releases SET state='needs_review',result=result||${interruptedResult},updated_at=now() WHERE state='running'`);
    }
    /** Oct 19: two jobs stayed 'running' for hours after their failure write was lost, while the worker kept ticking.
     * The worker runs one job at a time and calls this between jobs, so an idle unclaimed 'running' row is orphaned.
     * Claimed rows are left alone: attended scripts set 'running' together with their claim. */
    async recoverStale() {
        return (await this.pool.query(`UPDATE scheduler.publishing_releases SET state='needs_review',result=result||${interruptedResult},updated_at=now()
          WHERE state='running' AND share_claimed_at IS NULL AND updated_at<now()-interval '30 minutes' RETURNING item_id::text`)).rows.map((r:any)=>r.item_id as string);
    }
}
