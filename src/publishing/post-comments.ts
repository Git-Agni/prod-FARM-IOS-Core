import type { Pool } from 'pg';
import type { PostingInput } from './model.js';
import { ENGAGEMENT_SCHEMA } from './engage-task.js';

export type CommentPlatform = 'instagram' | 'facebook' | 'tiktok' | 'youtube';
export interface CommentResult { status: string; commentVerified: boolean; pinned: boolean; evidence: string }
export interface CommentDriver {
    commentOnPost(input: PostingInput, text: string, claim: () => Promise<void>, existingOnly?: boolean, postUrl?: string): Promise<CommentResult>;
    leaveVideo(): Promise<void>;
}
export const commentKey = (platform: CommentPlatform, id: string) => platform==='instagram' ? `pin:item:${id}` : `comment:${platform}:item:${id}`;

/** Comments have their own claims. A failed comment never changes the video release or retries its Share. */
export async function runPostComment(pool: Pool, id: string, platform: CommentPlatform, driver: CommentDriver) {
    const c=await pool.connect();let phone='';let locked=false;let claimed=false;let ownsAttempt=false;let prior:string|undefined;
    const key=commentKey(platform,id);
    try {
        await c.query(ENGAGEMENT_SCHEMA);
        const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];
        // A Short reuses the first comment of the same video's other calendar items.
        const text:string|undefined=item?.input.firstComment??(platform==='youtube'&&item?(await c.query(`SELECT input->>'firstComment' t FROM scheduler.publishing_items
          WHERE media->>'sha256'=$1 AND input ? 'firstComment' ORDER BY created_at LIMIT 1`,[item.media?.sha256])).rows[0]?.t:undefined);
        if(!item || !['published','needs_review'].includes(item.status) || !text || !item.input.targets.some((t:any)=>t.platform===platform))return;
        if(!item.results?.release?.receipts?.[platform]?.verified)throw new Error('Native post receipt is required before commenting');
        phone=item.input.deviceUdid;
        locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[phone])).rows[0].locked;
        if(!locked){console.log(new Date().toISOString(),'comment job waits: phone busy',key);return;}
        prior=(await c.query('SELECT status FROM scheduler.engagement_actions WHERE claim_key=$1',[key])).rows[0]?.status;
        // Reserve the attempt before opening an app. Interrupted attempts stay visible for review.
        const reserved=await c.query(`INSERT INTO scheduler.engagement_actions(claim_key,action,post_url,status)
          VALUES($1,'comment_pin',$2,'preparing')
          ON CONFLICT (claim_key) DO UPDATE SET status='preparing',updated_at=now(),
            result=jsonb_build_object('retries',COALESCE((scheduler.engagement_actions.result->>'retries')::int,0)+1)
          WHERE (scheduler.engagement_actions.status='failed_before_action' OR (scheduler.engagement_actions.status='uncertain_review' AND $3))
            AND scheduler.engagement_actions.updated_at<now()-interval '10 minutes'
            AND COALESCE((scheduler.engagement_actions.result->>'retries')::int,0)<3
          RETURNING claim_key`,[key,'item:'+id,platform!=='tiktok']);
        if(!reserved.rowCount)return;ownsAttempt=true;console.log(new Date().toISOString(),'comment job starts',key);
        // A comment that may already be up (uncertain) is retried in pin-only mode: the driver never types or posts a second one.
        const existingOnly=prior==='uncertain_review';
        const result=await driver.commentOnPost(item.input,text,async()=>{
            const r=await c.query(`UPDATE scheduler.engagement_actions SET status='claimed',updated_at=now() WHERE claim_key=$1 AND status='preparing' RETURNING claim_key`,[key]);
            if(!r.rowCount)throw new Error('Comment already claimed');claimed=true;
        },existingOnly,item.results.release.receipts[platform].url);
        await c.query(`UPDATE scheduler.engagement_actions SET status='done',result=$2,updated_at=now() WHERE claim_key=$1`,[key,JSON.stringify(result)]);
        await c.query(`UPDATE scheduler.publishing_items SET results=jsonb_set(results,ARRAY[$2],$3::jsonb),updated_at=now() WHERE id=$1`,[id,platform+'Comment',JSON.stringify(result)]);
    } catch(error) {
        // Save a screenshot and screen tree for any failed comment, like failed posts (release-failures/).
        if(ownsAttempt)await (driver as {captureFailure?:(l:string)=>Promise<string>}).captureFailure?.(`comment-${platform}-${id.slice(0,8)}`).catch(()=>undefined);
        // Errors before the job is reserved used to vanish; log them so a skipped comment shows why.
        if(!ownsAttempt)console.error(new Date().toISOString(),'comment job skipped',key,error instanceof Error?error.message:String(error));
        // Oct 11 14:28: a pin-only retry failed before its claim and overwrote uncertain_review with failed_before_action;
        // the next retry then posted the Facebook comment a second time. A comment that may be up stays uncertain.
        if(ownsAttempt)await c.query(`UPDATE scheduler.engagement_actions SET status=$2,result=COALESCE(result,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE claim_key=$1`,[key,claimed||prior==='uncertain_review'?'uncertain_review':'failed_before_action',JSON.stringify({error:error instanceof Error?error.message:String(error)})]);
    } finally {
        // Close the app only while this job holds the phone lock: TikTok leaves its comment menu open after the Pin check (Oct 7).
        if(ownsAttempt){await driver.leaveVideo().catch(()=>undefined);await (driver as {resetAfterFailure?:()=>Promise<void>}).resetAfterFailure?.().catch(()=>undefined);}
        if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);
        c.release();
    }
}
