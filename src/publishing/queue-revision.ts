import type {Pool} from 'pg';
import {requestHash,validatePostingInput,type PostingInput} from './model.js';
import {publishingCadence} from './cadence.js';

export function assertRevisableRelease(item:any,release:any,version:number,hasPilot:boolean){
    if(!item||item.status!=='held'||item.version!==version||hasPilot
        ||release&&(release.state!=='armed'||release.share_claimed_at||release.item_version!==version))
        throw new Error('Only an unchanged held item with no submission or pilot can be revised');
}

/** Change a future slot and an owned link together. Keep media, copy and all claims. */
export async function revisePendingItem(pool:Pool,id:string,version:number,runAt:string,
    related:PostingInput['instagramRelatedReel'],verifyRelated:(url:string,caption:string)=>Promise<unknown>){
    if(!/^[a-f0-9-]{36}$/.test(id??'')||!Number.isSafeInteger(version)||version<1
        ||!Number.isFinite(Date.parse(runAt))||Date.parse(runAt)<=Date.now())
        throw new Error('Choose the current item and a future posting time');
    const c=await pool.connect();
    try{
        await c.query('BEGIN');
        const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];
        if(!item)throw new Error('Calendar item not found');
        const lock=(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[item.input.deviceUdid])).rows[0];
        if(!lock?.locked)throw new Error('Phone busy. The pending slot was not changed');
        const current=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1 FOR UPDATE',[id])).rows[0];
        const release=(await c.query('SELECT * FROM scheduler.publishing_releases WHERE item_id=$1 FOR UPDATE',[id])).rows[0];
        const pilot=(await c.query('SELECT item_id FROM scheduler.mirroring_worker_pilots WHERE item_id=$1',[id])).rowCount;
        assertRevisableRelease(current,release,version,!!pilot);
        if(current.input.deviceUdid!==item.input.deviceUdid)throw new Error('Calendar phone changed');
        const input=validatePostingInput({...current.input,runAt,...(related?{instagramRelatedReel:related}:{})});
        if(related){
            if(!input.targets.some(t=>t.platform==='instagram'))throw new Error('Only Instagram supports a related Reel');
            await verifyRelated(related.url,related.caption);
        }
        const tt=input.targets.find(t=>t.platform==='tiktok');
        if(tt&&release){
            const account=tt.account.replace(/^@/,'').toLowerCase();
            const day=(await c.query("SELECT (($1::timestamptz AT TIME ZONE 'America/Los_Angeles')::date)::text AS posting_day",[input.runAt])).rows[0].posting_day;
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))',['tiktok:'+account+':'+day]);
            const count=(await c.query(`SELECT count(*)::int n FROM scheduler.publishing_items i
                JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id<>$1
                AND r.state IN ('armed','running','published','needs_review')
                AND (r.run_at AT TIME ZONE 'America/Los_Angeles')::date=$2::date
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.input->'targets') t
                    WHERE t->>'platform'='tiktok' AND lower(ltrim(t->>'account','@'))=$3)`,[id,day,account])).rows[0].n;
            if(count>=publishingCadence.tiktokDailyLimit)throw new Error('The new day exceeds the TikTok posting limit');
        }
        const revised=(await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,updated_at=now()
            WHERE id=$1 RETURNING *`,[id,JSON.stringify(input),requestHash(input,current.media.sha256)])).rows[0];
        if(release)await c.query(`UPDATE scheduler.publishing_releases SET item_version=$2,run_at=$3,updated_at=now()
            WHERE item_id=$1`,[id,revised.version,input.runAt]);
        await c.query('COMMIT');return revised;
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
