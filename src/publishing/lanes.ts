/** Autopilot controls for the calendar page (Antonio, Oct 15: "a button ... I can click post now and manage the schedules").
 * Lane hours default to cadence.ts and can be overridden from the page; the override lives in .scheduler-data/lane-hours.json
 * and is read on every run of lane-slotter.ts, slot-alert.ts and repost-filler.ts. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Pool} from 'pg';
import {publishingCadence as cadence} from './cadence.js';
import {requestHash,validatePostingInput} from './model.js';

export type Lane='instagram'|'tiktok'|'youtube';
export type LaneHours=Record<Lane,number[]>;
const dir=fileURLToPath(new URL('../../.scheduler-data/',import.meta.url)),file=dir+'lane-hours.json';
export const defaultLaneHours=():LaneHours=>({instagram:[...cadence.instagramHours],tiktok:[...cadence.tiktokHours],youtube:[...cadence.youtubeHours]});
export function laneHours():LaneHours{
    try{return {...defaultLaneHours(),...JSON.parse(readFileSync(file,'utf8'))};}catch{return defaultLaneHours();}
}
export function saveLaneHours(value:unknown):LaneHours{
    const v=value as Record<string,unknown>,out=defaultLaneHours();
    for(const lane of ['instagram','tiktok','youtube'] as Lane[]){
        const h=v?.[lane];
        if(!Array.isArray(h)||h.length<1||h.length>24||!h.every(x=>Number.isInteger(x)&&x>=0&&x<=23)||new Set(h).size!==h.length)
            throw new Error(`${lane}: give 1 to 24 different whole hours from 0 to 23`);
        out[lane]=[...h].sort((a,b)=>a-b);
    }
    mkdirSync(dir,{recursive:true});writeFileSync(file,JSON.stringify(out));
    return out;
}
/** Move one video (all its armed, unclaimed platform posts) to two minutes from now. No itemId: the next armed video.
 * The phone worker then posts it at its normal pace, one platform after another. Never touches a claimed or running post. */
export async function postNow(pool:Pool,itemId?:string){
    const c=await pool.connect();
    try{
        await c.query('BEGIN');
        const pick=(await c.query(`SELECT i.media->>'sha256' sha FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
          WHERE r.state='armed' AND r.share_claimed_at IS NULL AND ($1::uuid IS NULL OR i.id=$1) ORDER BY (i.results ? 'repost'),r.run_at LIMIT 1`,[itemId??null])).rows[0];
        if(!pick)throw new Error(itemId?'That post is not armed (or it already started)':'Nothing is armed to post');
        const rows=(await c.query(`SELECT i.*,r.run_at FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
          WHERE i.media->>'sha256'=$1 AND r.state='armed' AND r.share_claimed_at IS NULL FOR UPDATE OF i,r`,[pick.sha])).rows;
        const moved:any[]=[];
        for(const r of rows){
            const youtube=r.input.targets.some((t:any)=>t.platform==='youtube');
            const runAt=new Date(Date.now()+(youtube?4:2)*60000).toISOString();
            const input=validatePostingInput({...r.input,runAt});
            await c.query(`UPDATE scheduler.publishing_items SET input=$2,request_hash=$3,version=version+1,results=results||jsonb_build_object('postNow',jsonb_build_object('at',now(),'from',$4::text)),updated_at=now() WHERE id=$1`,
              [r.id,input,requestHash(input,r.media.sha256),r.run_at.toISOString()]);
            await c.query(`UPDATE scheduler.publishing_releases SET run_at=$2,item_version=item_version+1,updated_at=now() WHERE item_id=$1 AND state='armed' AND share_claimed_at IS NULL`,[r.id,runAt]);
            moved.push({id:r.id,name:r.media.name,platforms:r.input.targets.map((t:any)=>t.platform),runAt});
        }
        await c.query('COMMIT');
        return {moved};
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
