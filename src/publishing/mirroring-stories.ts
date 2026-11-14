import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import path from 'node:path';
import {MirrorScreen,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import {runNativePhase,validateNativePhase,validateNativePhaseReferences,type NativePhase} from './mirroring-flow.js';
import {StorySequenceStore} from './story-sequences.js';
import {reviewStoryDraft} from './story-policy.js';
import type {ReleaseMedia} from './instagram-release.js';
import type {PostingInput} from './model.js';
/** textBurnedIn: the words are drawn into the image, so no native text is typed. linkUrl: a link sticker to that URL (the Reel). */
export interface NativeStoryFrame {text:string;textBurnedIn?:boolean;linkUrl?:string;linkText?:string;assetRef:string;sourceSha256:string;sourcePath?:string;media:ReleaseMedia;previewPath:string;previewSha256:string}
/** Any phone driver that builds one frame, claims, taps Share once and returns both destination receipts. */
export interface StoryFrameDriver {publishFrame(frame:NativeStoryFrame,claim:()=>Promise<void>):Promise<any>;leaveVideo():Promise<void>}
/** App receipts (Mac Mirroring flow) or Graph receipts (iPhone WDA flow), on both Instagram and Facebook. */
export function storyFrameVerified(r:any){return r?.instagram?.verified===true&&['instagram_app','instagram_graph'].includes(r.instagram.source)&&r?.facebook?.verified===true&&['facebook_app','facebook_graph','facebook_crosspost'].includes(r.facebook.source);}
export interface NativeStoryFlow {version:1;prepare:NativePhase;instagramReceipt:NativePhase;facebookReceipt:NativePhase;submit:{label:'Share';context:string[];minY:number;maxY:number}}
const validHash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
async function checkedLocal(file:string,hash:string){
    const allowed=await realpath(path.resolve('.scheduler-data'));
    const resolved=await realpath(file);
    if(!resolved.startsWith(allowed+path.sep))throw new Error('Native Story evidence must be stored inside Phone Farm data');
    const bytes=await readFile(resolved);if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Native Story asset or preview changed');return bytes;
}
/** Reuse the bounded native-step validator. Story phases must prove the frame and both destinations. */
export function validateNativeStoryFlow(value:unknown):NativeStoryFlow {
    const v=value as NativeStoryFlow;
    if(!v||v.version!==1||v.submit?.label!=='Share')throw new Error('Invalid native Story layout');
    const required=(p:NativePhase,n:string)=>p?.checks?.some(c=>c.name===n&&c.kind==='field'&&c.field==='caption');
    if(!required(v.prepare,'frame_text')||!v.prepare.checks.some(c=>c.name==='opening_cover'&&c.kind==='image')||!required(v.instagramReceipt,'frame_text')||!required(v.facebookReceipt,'frame_text'))throw new Error('Story frame text, reviewed image and both receipts need native checks');
    for(const p of [v.instagramReceipt,v.facebookReceipt])if(!p.checks.some(c=>c.name==='published_marker'&&c.kind==='label'))throw new Error('A Story viewer receipt is required');
    if(!v.prepare.checks.some(c=>c.name==='facebook_destination'&&c.kind==='label'&&c.label==='Antonio Revenue')||!v.prepare.checks.some(c=>c.name==='music_style'&&c.kind==='label'&&c.label==='Music only'))throw new Error('Story destination and music style need native checks');
    for(const p of [v.prepare,v.instagramReceipt,v.facebookReceipt])validateNativePhase(p);
    for(const p of [v.instagramReceipt,v.facebookReceipt]){
        if(!p.checks.some(c=>c.name==='published_account'&&c.kind==='field'&&c.field==='account')||!p.checks.some(c=>c.name==='published_image'&&c.kind==='image'))throw new Error('Story receipts need the exact account and image');
    }
    if(!v.submit.context.length||v.submit.minY<0||v.submit.maxY>1||v.submit.minY>=v.submit.maxY)throw new Error('Invalid Story Share region');
    return structuredClone(v);
}
export async function loadNativeStoryFlow(file='.scheduler-data/native-layouts/stories.json'){const flow=validateNativeStoryFlow(JSON.parse(await readFile(path.resolve(file),'utf8')));for(const p of [flow.prepare,flow.instagramReceipt,flow.facebookReceipt])await validateNativePhaseReferences(p);return flow;}
export async function nativeStoryRevision(draft:any,frames:NativeStoryFrame[]) {
    if(!reviewStoryDraft(draft).valid||frames.length!==5)throw new Error('Five reviewed Story frames are required');
    if(new Set(frames.map(f=>f.sourceSha256)).size!==5)throw new Error('Story source assets must be different, including their hashes');
    for(let i=0;i<5;i++){
        const f=frames[i]!;
        if(['b_roll','native_reel'].includes(draft.frames[i].assetKind))throw new Error('B-roll trims and native Reel Story shares still need their native controls and full previews. Do not substitute a still image');
        if(f.media.mimeType!=='image/png')throw new Error('This Story runner accepts reviewed PNG photo frames only');
        if(f.text!==draft.frames[i].text||f.assetRef!==draft.frames[i].assetRef||!validHash(f.sourceSha256)||!validHash(f.media.sha256)||!validHash(f.previewSha256))throw new Error('Native Story frames must match the reviewed sequence');
        if(draft.frames[i].assetKind==='native_reel'){if(createHash('sha256').update(f.assetRef).digest('hex')!==f.sourceSha256)throw new Error('The native Reel source hash does not match');}
        else{if(!f.sourcePath)throw new Error('The original Story source file is required');await checkedLocal(f.sourcePath,f.sourceSha256);}
        await checkedLocal(f.media.path,f.media.sha256);await checkedLocal(f.previewPath,f.previewSha256);
    }
    return createHash('sha256').update(canonicalJson({draft,frames})).digest('hex');
}
/** Postgres jsonb reorders object keys, so a revision must not depend on key order (Oct 13: the first WDA capture
 * failed its own check after a jsonb round trip). jsonb also drops undefined keys, so they are skipped here
 * (Oct 15: frames 1 to 4 carried linkUrl: undefined and every lifestyle capture failed its own check). */
export function canonicalJson(value:unknown):string{
    if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>(value as any)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJson((value as any)[k])).join(',')+'}';
    return JSON.stringify(value)??'null';
}
export class NativeStoryStore {
    constructor(private pool:Pool){}
    async initialize(){
        await new StorySequenceStore(this.pool).initialize();
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_story_preview_sets(
            sequence_id uuid PRIMARY KEY REFERENCES scheduler.story_sequences(id), native_frames jsonb NOT NULL,
            revision text NOT NULL, fingerprint text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_story_jobs(
            id uuid PRIMARY KEY, sequence_id uuid UNIQUE NOT NULL REFERENCES scheduler.story_sequences(id),
            revision text NOT NULL, native_frames jsonb NOT NULL, approved_at timestamptz,
            state text NOT NULL DEFAULT 'waiting_native_approval' CHECK(state IN('waiting_native_approval','armed','running','published','needs_review')),
            fingerprint text NOT NULL, pilot boolean NOT NULL DEFAULT false, result jsonb NOT NULL DEFAULT '{}')`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_story_frames(
            job_id uuid NOT NULL REFERENCES scheduler.mirroring_story_jobs(id), run_at timestamptz NOT NULL, frame integer NOT NULL CHECK(frame BETWEEN 1 AND 5),
            state text NOT NULL CHECK(state IN('claimed','published','needs_review')), claimed_at timestamptz NOT NULL DEFAULT now(), receipts jsonb,
            PRIMARY KEY(job_id,run_at,frame))`);
    }
    async prepare(sequenceId:string,frames:NativeStoryFrame[],fingerprint:string){
        const s=(await this.pool.query('SELECT * FROM scheduler.story_sequences WHERE id=$1',[sequenceId])).rows[0];
        if(!s||s.state!=='needs_review'||new Date(s.run_at).getTime()<=Date.now())throw new Error('Choose a future reviewed Story sequence');
        const revision=await nativeStoryRevision(s.draft,frames);
        const captured=(await this.pool.query('SELECT revision,fingerprint,native_frames FROM scheduler.mirroring_story_preview_sets WHERE sequence_id=$1',[sequenceId])).rows[0];
        if(!captured||captured.revision!==revision||captured.fingerprint!==fingerprint||await nativeStoryRevision(s.draft,captured.native_frames)!==revision)throw new Error('Capture all five actual native drafts without Share before creating this approval');
        const row=(await this.pool.query('INSERT INTO scheduler.mirroring_story_jobs(id,sequence_id,revision,native_frames,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *',[randomUUID(),sequenceId,revision,JSON.stringify(frames),fingerprint])).rows[0];
        if(!row)throw new Error('This sequence already has a native job');return row;
    }
    async approve(id:string,revision:string,reviewedFrames:unknown,confirmed:unknown){
        if(confirmed!==true||!Array.isArray(reviewedFrames)||new Set(reviewedFrames).size!==5||![1,2,3,4,5].every(n=>reviewedFrames.includes(n)))throw new Error('Approve all five actual native previews');
        const row=(await this.pool.query("SELECT j.*,s.draft,s.run_at FROM scheduler.mirroring_story_jobs j JOIN scheduler.story_sequences s ON s.id=j.sequence_id WHERE j.id=$1 AND j.state='waiting_native_approval'",[id])).rows[0];
        if(!row||new Date(row.run_at).getTime()<=Date.now()||row.revision!==revision||await nativeStoryRevision(row.draft,row.native_frames)!==revision)throw new Error('Native Story draft changed or its slot passed');
        const r=await this.pool.query("UPDATE scheduler.mirroring_story_jobs SET state='armed',approved_at=now() WHERE id=$1 AND revision=$2 AND state='waiting_native_approval' RETURNING id",[id,revision]);
        if(r.rowCount!==1)throw new Error('Native Story approval changed');
    }
    async requestPilot(id:string){
        const r=await this.pool.query("UPDATE scheduler.mirroring_story_jobs SET pilot=true WHERE id=$1 AND state='armed' AND approved_at IS NOT NULL AND sequence_id IN(SELECT id FROM scheduler.story_sequences WHERE run_at>now()) AND NOT EXISTS(SELECT 1 FROM scheduler.mirroring_story_frames WHERE job_id=$1) RETURNING id",[id]);
        if(r.rowCount!==1)throw new Error('Choose an approved future native sequence without any Share claim');
    }
    async list(){return (await this.pool.query('SELECT j.id,j.sequence_id,j.revision,j.state,j.approved_at,j.pilot,j.result,s.run_at,s.title FROM scheduler.mirroring_story_jobs j JOIN scheduler.story_sequences s ON s.id=j.sequence_id ORDER BY s.run_at DESC LIMIT 100')).rows;}
    async tick(fingerprint:string,driverFor:(row:any)=>Promise<StoryFrameDriver>,pilotOnly=false,certificateFlow='stories'){
        const due=(await this.pool.query(`SELECT j.*,s.device_udid,s.run_at,s.draft FROM scheduler.mirroring_story_jobs j JOIN scheduler.story_sequences s ON s.id=j.sequence_id
            WHERE j.state='armed' AND j.approved_at IS NOT NULL AND s.run_at<=now() AND j.fingerprint=$1 AND ($2=false OR j.pilot=true) ORDER BY s.run_at LIMIT 1`,[fingerprint,pilotOnly])).rows;
        for(const row of due){
            const c=await this.pool.connect();let locked=false;let driver:StoryFrameDriver|undefined;
            try{
                locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[row.device_udid])).rows[0].locked;if(!locked)continue;
                if(new Date(row.run_at).getTime()<Date.now()-30*60_000)throw new Error('Story slot missed. Review a new time');
                if(await nativeStoryRevision(row.draft,row.native_frames)!==row.revision)throw new Error('Approved Story assets changed');
                const reserved=await c.query("UPDATE scheduler.mirroring_story_jobs SET state='running' WHERE id=$1 AND state='armed' RETURNING id",[row.id]);if(reserved.rowCount!==1)continue;
                driver=await driverFor(row);
                for(let frame=1;frame<=5;frame++){
                    const receipts=await driver.publishFrame(row.native_frames[frame-1],async()=>{
                        const r=await c.query("INSERT INTO scheduler.mirroring_story_frames(job_id,run_at,frame,state) VALUES($1,$2,$3,'claimed') ON CONFLICT DO NOTHING RETURNING frame",[row.id,row.run_at,frame]);
                        if(r.rowCount!==1)throw new Error('Story Share was already attempted. Never repeat a frame');
                    });
                    if(!storyFrameVerified(receipts))throw new Error('Each Story frame needs both native receipts');
                    await c.query("UPDATE scheduler.mirroring_story_frames SET state='published',receipts=$4 WHERE job_id=$1 AND run_at=$2 AND frame=$3",[row.id,row.run_at,frame,JSON.stringify(receipts)]);
                }
                await c.query("UPDATE scheduler.mirroring_story_jobs SET state='published',result=$2 WHERE id=$1",[row.id,JSON.stringify({nativeFlowFingerprint:fingerprint,framesVerified:5,checkedAt:new Date().toISOString()})]);
                if(row.pilot)await c.query(`INSERT INTO scheduler.mirroring_flow_certificates(flow,fingerprint,pilot_item_id) VALUES($3,$1,$2)
                    ON CONFLICT(flow) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,pilot_item_id=EXCLUDED.pilot_item_id,verified_at=now()`,[fingerprint,row.id,certificateFlow]);
            }catch(e){await c.query("UPDATE scheduler.mirroring_story_jobs SET state='needs_review',result=$2 WHERE id=$1 AND state IN('armed','running')",[row.id,JSON.stringify({error:e instanceof Error?e.message:String(e)})]);await c.query("UPDATE scheduler.mirroring_story_frames SET state='needs_review' WHERE job_id=$1 AND state='claimed'",[row.id]);}
            finally{await driver?.leaveVideo().catch(()=>undefined);if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[row.device_udid]);c.release();}
        }
    }
    async recoverInterrupted(){await this.pool.query("UPDATE scheduler.mirroring_story_jobs SET state='needs_review',result=result||'{\"error\":\"Worker interrupted. Preserve every Story Share claim\"}'::jsonb WHERE state='running'");}
    async preview(id:string,index:number){
        if(!Number.isInteger(index)||index<1||index>5)throw new Error('Choose a Story frame from 1 to 5');
        const row=(await this.pool.query('SELECT native_frames FROM scheduler.mirroring_story_jobs WHERE id=$1',[id])).rows[0];if(!row)throw new Error('Native Story job not found');
        const f=row.native_frames[index-1];return checkedLocal(f.previewPath,f.previewSha256);
    }
}
/** Prepared and owner-approved native drafts only. Per-frame Share claims belong to the store. */
export class NativeStoryDriver {
    readonly screen:MirrorScreen;
    constructor(signal:AbortSignal,private flow:NativeStoryFlow,private root:string,screen?:MirrorScreen,private beforeFrame?:(frame:NativeStoryFrame)=>Promise<void>){validateNativeStoryFlow(flow);this.screen=screen??new MirrorScreen(signal);}
    private async proof(name:string,s:MirrorSnapshot){await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(path.join(this.root,name+'.png'),Buffer.from(s.png,'base64'),{mode:0o600});}
    private async prepareFrame(frame:NativeStoryFrame){
        await checkedLocal(frame.media.path,frame.media.sha256);
        await this.beforeFrame?.(frame);
        const input={caption:frame.text,targets:[{platform:'instagram',account:'antoniorevenue'}]} as PostingInput;
        const prefix=frame.sourceSha256.slice(0,12);
        await runNativePhase(this.screen,this.flow.prepare,prefix+'-preflight',input,frame.media,this.proof.bind(this));
        await this.screen.waitFor(this.flow.submit.context);
        return {input,prefix};
    }
    async captureDraftFrame(frame:NativeStoryFrame):Promise<NativeStoryFrame>{
        const {prefix}=await this.prepareFrame(frame);
        const s=await this.screen.waitFor(this.flow.submit.context);
        const bytes=Buffer.from(s.png,'base64'),previewPath=path.join(this.root,prefix+'-native-draft.png');
        await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(previewPath,bytes,{mode:0o600});
        return {...frame,previewPath,previewSha256:createHash('sha256').update(bytes).digest('hex')};
    }
    async publishFrame(frame:NativeStoryFrame,claim:()=>Promise<void>){
        const {input,prefix}=await this.prepareFrame(frame);
        await claim();
        await this.screen.tapText('Share',this.flow.submit.context,this.flow.submit.minY,this.flow.submit.maxY);
        await runNativePhase(this.screen,this.flow.instagramReceipt,prefix+'-instagram-receipt',input,frame.media,this.proof.bind(this));
        // Facebook Page identity is explicit in its own receipt phase.
        const fb={...input,targets:[{platform:'facebook',account:'Antonio Revenue'}]} as PostingInput;
        await runNativePhase(this.screen,this.flow.facebookReceipt,prefix+'-facebook-receipt',fb,frame.media,this.proof.bind(this));
        return {instagram:{verified:true,source:'instagram_app'},facebook:{verified:true,source:'facebook_app'}};
    }
    async leaveVideo(){await this.screen.home();}
}
