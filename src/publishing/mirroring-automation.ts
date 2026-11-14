import {loadNativeCommentFlow} from './mirroring-comments.js';
import type {CommentPlatform} from './post-comments.js';
import type {Pool} from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {validateNativeFlow,validateNativePhaseReferences,type NativeVideoFlow} from './mirroring-flow.js';
import {loadNativeStoryFlow} from './mirroring-stories.js';
import type {PostingInput} from './model.js';
export const nativeGroups=['instagram_facebook','tiktok','youtube','stories'] as const;
export type NativeGroup=typeof nativeGroups[number];
const deps=['src/publishing/mirroring-release.ts','src/publishing/mirroring-receipts.ts','src/publishing/mirroring-cover.ts','src/publishing/mirroring-flow.ts','src/publishing/mirroring-media.ts','src/publishing/mirroring-media-store.ts','src/publishing/mirroring-automation.ts','src/publishing/mirroring-stories.ts','src/publishing/mirroring-comments.ts','src/publishing/mirroring-driver.ts','src/publishing/release-policy.ts','src/devices/mirroring/screen.ts','src/devices/mirroring/PhoneFarmMirroring.swift','src/devices/mirroring/PhoneFarmAudioMute.swift','src/devices/mirroring/audio.ts','src/devices/mirroring/controller.ts','src/publishing/timed-release.ts','src/publishing/release-loop.ts','src/publishing/post-comments.ts','src/publishing/story-policy.ts'];
async function sourceDigest(){const h=createHash('sha256');for(const file of [...deps,'src/publishing/mirroring-owned-reel.ts','src/publishing/queue-revision.ts'])h.update(file).update(await readFile(path.resolve(file)));return h.digest('hex');}
// Bind certifications to code present when this process loaded its modules.
const loadedSourceDigest=sourceDigest();
export function nativeGroup(input:PostingInput):NativeGroup {
    if(input.targets.length===1&&input.targets[0]!.platform==='youtube')return 'youtube';
    if(input.targets.length===1&&input.targets[0]!.platform==='tiktok')return 'tiktok';
    if(input.targets.some(t=>t.platform==='instagram')&&input.targets.every(t=>['instagram','facebook'].includes(t.platform)))return 'instagram_facebook';
    throw new Error('No native flow for these targets');
}
export function qualifiedNativeFlow(fingerprint:string,certificate:any){return /^[a-f0-9]{64}$/.test(fingerprint)&&certificate?.fingerprint===fingerprint&&typeof certificate?.pilot_item_id==='string'&&Number.isFinite(Date.parse(certificate?.verified_at));}
export async function loadNativeVideoFlow(group:'tiktok'|'youtube'):Promise<NativeVideoFlow> {
    const file=path.resolve('.scheduler-data/native-layouts',group+'.json');
    const flow=validateNativeFlow(JSON.parse(await readFile(file,'utf8')));
    for(const phase of [flow.identity,flow.compose,flow.receipts])await validateNativePhaseReferences(phase);
    if(flow.platform!==group)throw new Error('Native layout platform mismatch');
    return flow;
}
export async function nativeFingerprint(group:NativeGroup){
    const h=createHash('sha256').update(group);
    const current=await sourceDigest();
    if(current!==await loadedSourceDigest)throw new Error('Native source changed. Restart the app and worker before testing');
    h.update(current);
    if(group==='tiktok'||group==='youtube')h.update(JSON.stringify(await loadNativeVideoFlow(group)));
    if(group==='stories')h.update(JSON.stringify(await loadNativeStoryFlow()));
    return h.digest('hex');
}
/** The app owns foreground permission and certifications. Configuration is never a delivery receipt. */
export class MirroringAutomationStore {
    constructor(private pool:Pool){}
    async initialize(){
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_owned_reel_observations(
            url text PRIMARY KEY,caption text NOT NULL,source_item_id uuid NOT NULL REFERENCES scheduler.publishing_items(id),
            anchor_item_id uuid NOT NULL REFERENCES scheduler.publishing_items(id),source_sha256 text NOT NULL,
            fingerprint text NOT NULL,proof_root text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_comment_certificates(platform text PRIMARY KEY,fingerprint text NOT NULL,pilot_item_id uuid NOT NULL,verified_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_automation_control(
            id integer PRIMARY KEY CHECK(id=1), foreground_allowed boolean NOT NULL DEFAULT false,
            updated_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query('INSERT INTO scheduler.mirroring_automation_control(id) VALUES(1) ON CONFLICT DO NOTHING');
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_flow_certificates(
            flow text PRIMARY KEY, fingerprint text NOT NULL, pilot_item_id uuid NOT NULL,
            verified_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_worker_pilots(
            item_id uuid PRIMARY KEY REFERENCES scheduler.publishing_items(id), fingerprint text NOT NULL,
            state text NOT NULL CHECK(state IN('pending','passed','needs_review')), requested_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_owned_reels(
            url text PRIMARY KEY, caption text NOT NULL, source_item_id uuid NOT NULL REFERENCES scheduler.publishing_items(id),
            verified_at timestamptz NOT NULL DEFAULT now())`);
    }
    async foregroundAllowed(){return (await this.pool.query('SELECT foreground_allowed FROM scheduler.mirroring_automation_control WHERE id=1')).rows[0]?.foreground_allowed===true;}
    async commentFingerprint(platform:CommentPlatform){return createHash('sha256').update(await nativeFingerprint(platform==='tiktok'?'tiktok':'instagram_facebook')).update(JSON.stringify(await loadNativeCommentFlow(platform))).digest('hex');}
    async certifyComment(id:string,platform:CommentPlatform,claimKey:string){
        const r=(await this.pool.query('SELECT status,result FROM scheduler.engagement_actions WHERE claim_key=$1',[claimKey])).rows[0];
        if(r?.status!=='done'||r.result?.commentVerified!==true||(platform==='tiktok'?r.result?.status!=='comment_posted_pin_unavailable':r.result?.pinned!==true))return;
        await this.pool.query(`INSERT INTO scheduler.mirroring_comment_certificates(platform,fingerprint,pilot_item_id) VALUES($1,$2,$3) ON CONFLICT(platform) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,pilot_item_id=EXCLUDED.pilot_item_id,verified_at=now()`,[platform,await this.commentFingerprint(platform),id]);
    }
    async pause(){await this.pool.query('UPDATE scheduler.mirroring_automation_control SET foreground_allowed=false,updated_at=now() WHERE id=1');}
    async allowForeground(confirmed:unknown){if(confirmed!==true)throw new Error('Confirm that Phone Farm may bring Mirroring forward');await this.pool.query('UPDATE scheduler.mirroring_automation_control SET foreground_allowed=true,updated_at=now() WHERE id=1');}
    async status(){
        const allowed=await this.foregroundAllowed();
        const certs=(await this.pool.query('SELECT * FROM scheduler.mirroring_flow_certificates')).rows;
        const flows=Object.fromEntries(await Promise.all(nativeGroups.map(async group=>{
            try{const fingerprint=await nativeFingerprint(group),certificate=certs.find(c=>c.flow===group);return [group,{codeImplemented:true,layoutAvailable:true,qualified:qualifiedNativeFlow(fingerprint,certificate),fingerprint,pilotItemId:certificate?.pilot_item_id??null}];}
            catch{return [group,{codeImplemented:true,layoutAvailable:false,qualified:false,fingerprint:null,pilotItemId:null}];}
        })));
        const comments=Object.fromEntries(await Promise.all((['instagram','facebook','tiktok'] as CommentPlatform[]).map(async platform=>{try{const fingerprint=await this.commentFingerprint(platform);const c=(await this.pool.query('SELECT * FROM scheduler.mirroring_comment_certificates WHERE platform=$1',[platform])).rows[0];return [platform,{layoutAvailable:true,qualified:qualifiedNativeFlow(fingerprint,c),fingerprint}];}catch{return [platform,{layoutAvailable:false,qualified:false,fingerprint:null}];}})));
        return {foregroundAllowed:allowed,flows,comments,reason:allowed?'Only flows with a current worker pilot can post.':'Phone control is paused while you work. No native input is allowed.'};
    }
    async requestPilot(id:string,version:number){
        if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id??'')||!Number.isSafeInteger(version)||version<1)throw new Error('Choose a current calendar item');
        const status=await this.status();if(!status.foregroundAllowed)throw new Error('Allow foreground phone control before requesting a native test');
        const item=(await this.pool.query('SELECT i.*,r.state release_state,r.share_claimed_at FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id=$1',[id])).rows[0];
        if(!item||item.version!==version||item.status!=='held'||item.release_state!=='armed'||item.share_claimed_at||Date.parse(item.input.runAt)<=Date.now()||Date.parse(item.input.runAt)>Date.now()+10*60_000)throw new Error('Choose one unclaimed armed item in the next ten minutes. Existing claims cannot be reset');
        const fingerprint=await nativeFingerprint(nativeGroup(item.input));
        const r=await this.pool.query("INSERT INTO scheduler.mirroring_worker_pilots(item_id,fingerprint,state) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING item_id",[id,fingerprint]);
        if(r.rowCount!==1)throw new Error('This item already has a pilot attempt');
        return {itemId:id,fingerprint,state:'pending'};
    }
    async pendingPilots(){return (await this.pool.query("SELECT * FROM scheduler.mirroring_worker_pilots WHERE state IN('pending','needs_review') ORDER BY requested_at")).rows;}
    async finishPilot(id:string){
        const c=await this.pool.connect();
        try{
            await c.query('BEGIN');
            const p=(await c.query("SELECT p.*,r.state release_state,r.result,r.share_claimed_at,i.input FROM scheduler.mirroring_worker_pilots p JOIN scheduler.publishing_releases r ON r.item_id=p.item_id JOIN scheduler.publishing_items i ON i.id=p.item_id WHERE p.item_id=$1 AND p.state IN('pending','needs_review') FOR UPDATE OF p",[id])).rows[0];
            if(!p){await c.query('COMMIT');return;}
            if(p.release_state==='armed'||p.release_state==='running'){await c.query('COMMIT');return;}
            const group=nativeGroup(p.input),fingerprint=await nativeFingerprint(group);
            const receipts=p.result?.receipts;
            const nativeSources:Record<string,string>={instagram:'instagram_app',facebook:'facebook_app',tiktok:'tiktok_app',youtube:'youtube_app'};
            const allDestinations=group!=='instagram_facebook'||['instagram','facebook'].every(platform=>p.input.targets.some((t:any)=>t.platform===platform));
            const passed=allDestinations&&p.release_state==='published'&&!!p.share_claimed_at&&p.fingerprint===fingerprint&&p.result?.nativeFlowFingerprint===fingerprint&&p.input.targets.every((t:any)=>receipts?.[t.platform]?.verified===true&&receipts[t.platform].source===nativeSources[t.platform]);
            await c.query('UPDATE scheduler.mirroring_worker_pilots SET state=$2 WHERE item_id=$1',[id,passed?'passed':'needs_review']);
            if(passed)await c.query(`INSERT INTO scheduler.mirroring_flow_certificates(flow,fingerprint,pilot_item_id) VALUES($1,$2,$3)
                ON CONFLICT(flow) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,pilot_item_id=EXCLUDED.pilot_item_id,verified_at=now()`,[group,fingerprint,id]);
            await c.query('COMMIT');
        }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    }
    async registerOwnedReel(value:any){
        const url=new URL(value?.url??'');
        if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.search||url.hash||url.username||url.password||!/^\/reel\/[A-Za-z0-9_-]+\/$/.test(url.pathname)||value?.confirmOwnedUrl!==true)throw new Error('Confirm the exact owned Reel URL');
        const item=(await this.pool.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[value.sourceItemId])).rows[0];
        if(!item||item.status!=='published'||!item.results?.release?.receipts?.instagram?.verified||!item.input.targets.some((t:any)=>t.platform==='instagram'&&t.account.replace(/^@/,'')==='antoniorevenue'))throw new Error('Choose a source item with an owned native Instagram receipt');
        const r=await this.pool.query('INSERT INTO scheduler.mirroring_owned_reels(url,caption,source_item_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING url',[url.href,item.input.caption,item.id]);
        if(r.rowCount!==1)throw new Error('This URL already has a source binding');
        return {url:url.href,caption:item.input.caption,sourceItemId:item.id,nativeCaptionCheckRequired:true};
    }
    async ownedReel(url:string,caption:string){
        const r=(await this.pool.query(`SELECT i.media FROM scheduler.mirroring_owned_reels o JOIN scheduler.publishing_items i ON i.id=o.source_item_id
            WHERE o.url=$1 AND o.caption=$2 AND i.status='published' AND i.results->'release'->'receipts'->'instagram'->>'verified'='true'`,[url,caption])).rows[0];
        if(r)return r.media;
        const observed=(await this.pool.query(`SELECT i.media FROM scheduler.mirroring_owned_reel_observations o
            JOIN scheduler.publishing_items i ON i.id=o.source_item_id JOIN scheduler.publishing_items a ON a.id=o.anchor_item_id
            WHERE o.url=$1 AND o.caption=$2 AND o.fingerprint=$3 AND o.source_sha256=i.media->>'sha256'
            AND i.input->>'caption'=o.caption AND i.status IN('needs_review','published') AND a.status='published'
            AND a.results->'release'->'receipts'->'instagram'->>'verified'='true'
            AND a.results->'release'->'receipts'->'instagram'->>'source'='instagram_app'
            AND a.input->'instagramRelatedReel'->>'url'=o.url AND a.input->'instagramRelatedReel'->>'caption'=o.caption`,[url,caption,await nativeFingerprint('instagram_facebook')])).rows[0];
        if(!observed)throw new Error('The exact related Reel needs a verified owned source reference');return observed.media;
    }
}
