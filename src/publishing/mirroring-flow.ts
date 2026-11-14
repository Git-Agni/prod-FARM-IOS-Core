import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {MirrorScreen,normalizeMirrorText,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import {nativeCaptionWindowsMatch} from './mirroring-receipts.js';
import {nativeImageDistance,openingFrame,validRect,nativeReference,nativeReferenceDistance,type NativeRect} from './mirroring-cover.js';
import {importMirroringMedia} from './mirroring-media.js';
import type {NativeImportJournal} from './mirroring-media-store.js';
import type {PostingInput} from './model.js';
import type {ReleaseMedia} from './instagram-release.js';
import type {ReleaseDriver,ReleaseEvidence} from './release-policy.js';

export type NativeApp='Instagram'|'Facebook'|'TikTok'|'YouTube Studio';
export type NativeField='caption'|'account'|'title'|'channelId'|'visibility'|'audience'|'category'|'tags'|'relatedVideoId'|'aiUse'|'firstComment'|'duration'|'album';
export type NativeStep=
    |{kind:'open';app:NativeApp}
    |{kind:'tap';label:string;context:string[];minY:number;maxY:number}
    |{kind:'point';x:number;y:number;context:string[]}
    |{kind:'key';key:'return'|'escape'|'backspace'|'select-all';context:string[]}
    |{kind:'type';field:NativeField;context:string[]}
    |{kind:'scroll';pixels:number;x:number;y:number;context:string[]}
    |{kind:'wait';context:string[]}
    |{kind:'capture-caption';region:NativeRect;context:string[]}
    |{kind:'proof';check:NativeCheck;context:string[]};
export type NativeCheck=
    |{kind:'field';name:string;field:NativeField;region:NativeRect;context:string[]}
    |{kind:'label';name:string;label:string;region:NativeRect;context:string[]}
    |{kind:'toggle';name:string;label:string;enabled:boolean;referencePath:string;referenceSha256:string;maxDistance:number;region:NativeRect;context:string[]}
    |{kind:'image';name:string;region:NativeRect;maxDistance:number;context:string[]};
export interface NativePhase {steps:NativeStep[];checks:NativeCheck[]}
/** Layouts are local calibration artifacts. They never certify themselves as ready. */
export interface NativeVideoFlow {
    version:1;platform:'tiktok'|'youtube';account:string;channelId?:string;
    identity:NativePhase;compose:NativePhase;receipts:NativePhase;
    submit:{label:'Post'|'Upload Short';context:string[];minY:number;maxY:number};
}
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=300;
function context(v:unknown):v is string[]{return Array.isArray(v)&&v.length>0&&v.length<=8&&v.every(text);}
const fields:NativeField[]=['caption','account','title','channelId','visibility','audience','category','tags','relatedVideoId','aiUse','firstComment','duration','album'];
const forbidden=/^(share|post|upload|upload short|send|publish|delete|discard)(?:\s|$)/i;
export function validateNativeFlow(value:unknown):NativeVideoFlow {
    const v=value as NativeVideoFlow;
    if(!v||v.version!==1||!['tiktok','youtube'].includes(v.platform)||!/^@?[A-Za-z0-9._-]+$/.test(v.account))throw new Error('Invalid native flow identity');
    if(v.platform==='youtube'&&!/^UC[A-Za-z0-9_-]{22}$/.test(v.channelId??''))throw new Error('A YouTube flow needs the exact channel ID');
    for(const phase of [v.identity,v.compose,v.receipts])validateNativePhase(phase);
    // Proof names alone cannot satisfy a gate. Require the correct check type and field.
    const field=(phase:NativePhase,name:string,key:NativeField)=>phase.checks.some(c=>c.name===name&&c.kind==='field'&&c.field===key);
    if(!field(v.identity,'account','account')||!field(v.compose,'caption','caption')||!v.compose.checks.some(c=>c.name==='opening_cover'&&c.kind==='image')||!field(v.receipts,'published_caption','caption')||!field(v.receipts,'published_account','account')||!v.receipts.checks.some(c=>c.name==='published_marker'&&c.kind==='label')||!v.receipts.checks.some(c=>c.name==='published_cover'&&c.kind==='image'&&c.maxDistance<=0.03))throw new Error('Account, full caption, opening cover and published source cover receipts are required');
    if(!v.compose.steps.some(s=>s.kind==='proof'&&s.check.kind==='field'&&s.check.name==='selected_duration'&&s.check.field==='duration'))throw new Error('The selected native clip duration needs a proof check before the editor');
    if(v.platform==='tiktok'&&!v.compose.checks.some(c=>c.name==='public_visibility'&&c.kind==='label'&&c.label==='Everyone can view this post.')||v.platform==='tiktok'&&!v.compose.checks.some(c=>c.name==='manual_ai_off'&&c.kind==='toggle'&&c.enabled===false))throw new Error('TikTok public visibility and manual AI off need native proof');
    if(v.platform==='youtube'){
        if(!field(v.receipts,'published_title','title')||!field(v.receipts,'published_visibility','visibility'))throw new Error('YouTube receipts need the exact title and visibility');
        for(const f of ['title','visibility','audience','category','tags','aiUse'] as NativeField[])if(!field(v.compose,f,f))throw new Error('YouTube metadata needs native proof: '+f);
        if(!field(v.identity,'channel_id','channelId'))throw new Error('YouTube channel identity needs native proof');
    }
    if(!v.submit||v.submit.label!==(v.platform==='tiktok'?'Post':'Upload Short')||!context(v.submit.context)||!(v.submit.minY>=0&&v.submit.maxY<=1&&v.submit.minY<v.submit.maxY))throw new Error('Invalid one-shot submit control');
    return structuredClone(v);
}
export function nativeFlowField(input:PostingInput,field:NativeField):string {
    const y=input.youtube;
    switch(field){
        case 'caption':return input.caption;
        case 'firstComment':if(input.firstComment)return input.firstComment;break;
        case 'account':{const t=input.targets[0]!;if(t.platform==='facebook'){if(!['Antonio Revenue','https://www.facebook.com/profile.php?id=61584693917444'].includes(t.account))throw new Error('Unmapped Facebook identity');return 'Antonio Revenue';}return t.account.replace(/^@/,'');}
        case 'title':if(y)return y.title;break;
        case 'channelId':if(y)return y.channelId;break;
        case 'visibility':if(y)return y.visibility[0]!.toUpperCase()+y.visibility.slice(1);break;
        case 'audience':if(y)return y.madeForKids?'Yes, it’s made for kids':'No, it’s not made for kids';break;
        case 'category':if(y?.publishing)return y.publishing.category;break;
        case 'tags':if(y?.publishing)return y.publishing.tags.join(', ');break;
        case 'relatedVideoId':if(y?.publishing?.relatedVideoId)return y.publishing.relatedVideoId;break;
        case 'aiUse':if(y?.publishing?.aiUse==='review')throw new Error('Review YouTube AI use before posting');if(y?.publishing)return y.publishing.aiUse==='yes'?'Yes':'No';break;
    }
    throw new Error('The saved native field is missing: '+field);
}
export function textInRegion(s:MirrorSnapshot,rect:NativeRect){return s.lines.filter(l=>l.confidence>=0.5&&l.x>=rect.x&&l.y>=rect.y&&l.x+l.width<=rect.x+rect.width+0.002&&l.y+l.height<=rect.y+rect.height+0.002).map(l=>l.text).join(' ');}
const exact=(a:string,b:string)=>normalizeMirrorText(a)===normalizeMirrorText(b);
/** Executes only a reviewed local layout. The caller owns the phone lock and Share claim. */
export class MirroringFlowRelease implements ReleaseDriver {
    readonly screen:MirrorScreen;
    nativeFlowFingerprint?:string;
    get youtubeNative(){return this.flow.platform==='youtube';}
    private input?:PostingInput;private media?:ReleaseMedia;private prepared=false;private submitted=false;
    constructor(signal:AbortSignal,readonly flow:NativeVideoFlow,private root:string,private imports:NativeImportJournal,receiptMedia?:ReleaseMedia){validateNativeFlow(flow);this.screen=new MirrorScreen(signal);this.media=receiptMedia;}
    private async proof(name:string,s:MirrorSnapshot){await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(path.join(this.root,name+'.png'),Buffer.from(s.png,'base64'),{mode:0o600});}
    private async phase(phase:NativePhase,name:string) {
        return runNativePhase(this.screen,phase,name,this.input!,this.media,this.proof.bind(this));
    }
    async preflight(input:PostingInput,media:unknown):Promise<ReleaseEvidence>{
        this.prepared=false;this.input=input;this.media=media as ReleaseMedia;
        if(input.targets.length!==1||input.targets[0]!.platform!==this.flow.platform||input.targets[0]!.account.replace(/^@/,'')!==this.flow.account.replace(/^@/,''))throw new Error('The calibrated native account does not match');
        if(this.flow.platform==='youtube'){
            if(!input.youtube||input.youtube.channelId!==this.flow.channelId||!input.youtube.publishing)throw new Error('The saved YouTube channel and publishing details are required');
            if(input.youtube.publishing.aiUse==='review')throw new Error('YouTube AI use is awaiting review');
            if(input.youtube.publishing.relatedVideoId&&!this.flow.compose.checks.some(c=>c.kind==='field'&&c.field==='relatedVideoId'))throw new Error('The saved related YouTube video needs native proof');
        }
        if(createHash('sha256').update(await readFile(this.media.path)).digest('hex')!==this.media.sha256)throw new Error('Reviewed video changed');
        await this.phase(this.flow.identity,'identity');
        await importMirroringMedia(this.screen,this.media,this.imports);
        await this.phase(this.flow.compose,'preflight');
        await this.screen.waitFor(this.flow.submit.context);
        this.prepared=true;
        return {exactMedia:true,videoFrameCover:true,caption:true,account:true,automaticPromotion:false,linkedFacebook:false};
    }
    async shareOnce(){
        if(this.submitted)throw new Error('Submit was already attempted; inspect the receipt');
        if(!this.prepared)throw new Error('Native preflight is incomplete');
        this.submitted=true;this.prepared=false;
        await this.screen.tapText(this.flow.submit.label,this.flow.submit.context,this.flow.submit.minY,this.flow.submit.maxY);
    }
    async verify(){
        if(!this.input||!this.media)throw new Error('Missing saved native input or source video');
        if(createHash('sha256').update(await readFile(this.media.path)).digest('hex')!==this.media.sha256)throw new Error('Published source video changed');
        await this.phase(this.flow.receipts,'receipt');
        return {[this.flow.platform]:{verified:true,source:this.flow.platform+'_app',mediaSha256:this.media.sha256,evidence:'Calibrated native account, full caption, exact source cover and published control matched. Proof screenshots saved.',checkedAt:new Date().toISOString()}};
    }
    async reconcile(input:PostingInput){this.input=input;return this.verify();}
    async leaveVideo(){await this.screen.home();}
}

export async function runNativePhase(screen:MirrorScreen,phase:NativePhase,name:string,input:PostingInput,media:ReleaseMedia|undefined,proof:(name:string,s:MirrorSnapshot)=>Promise<void>) {
        const captionViews:string[]=[];
        const value=async(field:NativeField)=>{if(field==='album'){if(!media)throw Error('Missing native album source');return 'PF-'+media.sha256.slice(0,12);}if(field!=='duration')return nativeFlowField(input,field);if(!media)throw new Error('Missing source duration');const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',media.path],{timeout:20_000});const seconds=Number(stdout.trim());if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Invalid source duration');return Math.floor(seconds/60)+':'+String(Math.floor(seconds)%60).padStart(2,'0');};
        const checkOne=async(check:NativeCheck)=>{
            const s=await screen.waitFor(check.context),region=textInRegion(s,check.region);
            if(name.includes('receipt')&&s.lines.some(l=>/^(Post|Upload Short|New reel|Caption|Add description\.\.\.)$/i.test(l.text)))throw new Error('A composer is not a publication receipt');
            if(check.kind==='label'&&!exact(region,check.label))throw new Error('Native label did not match: '+check.name);
            if(check.kind==='field'){const expected=await value(check.field);if(check.field==='caption'||check.field==='firstComment'?!nativeCaptionWindowsMatch([...captionViews,region],expected):!exact(region,expected))throw new Error('Native field did not match: '+check.name);}
            if(check.kind==='image'){if(!media)throw new Error('Missing reviewed source video');const distance=await nativeImageDistance(await openingFrame(media.path),s,check.region);if(distance>check.maxDistance)throw new Error('Native opening cover did not match');}
            if(check.kind==='toggle'){if(!screen.has(s,check.label)||await nativeReferenceDistance(await nativeReference(check.referencePath,check.referenceSha256),s,check.region)>check.maxDistance)throw new Error('Native switch did not match its reviewed state: '+check.name);}
            await proof(name+'-'+check.name,s);
        };
        for(const step of phase.steps){
            screen.signal.throwIfAborted();
            if(step.kind==='open')await screen.openApp(step.app);
            else if(step.kind==='tap')await screen.tapText(step.label,step.context,step.minY,step.maxY);
            else if(step.kind==='point')await screen.tap(step.x,step.y,step.context);
            else if(step.kind==='key')await screen.key(step.key,step.context);
            else if(step.kind==='type')await screen.type(await value(step.field),step.context);
            else if(step.kind==='scroll')await screen.scroll(step.pixels,step.context,step.x,step.y);
            else if(step.kind==='proof')await checkOne(step.check);
            else if(step.kind==='capture-caption')captionViews.push(textInRegion(await screen.waitFor(step.context),step.region));
            else await screen.waitFor(step.context);
        }
        for(const check of phase.checks)await checkOne(check);
}

export function validateNativePhase(phase:NativePhase) {
        if(!phase||!Array.isArray(phase.steps)||phase.steps.length>80||!Array.isArray(phase.checks)||!phase.checks.length||phase.checks.length>30)throw new Error('Each native phase needs bounded steps and proof checks');
        for(const s of phase.steps){
            if(s.kind==='open'){if(!['Instagram','Facebook','TikTok','YouTube Studio'].includes(s.app))throw new Error('Unmapped native app');continue;}
            if(!context(s.context))throw new Error('Every native step needs visible context');
            if(s.kind==='tap'){if(!text(s.label)||forbidden.test(s.label)||!(s.minY>=0&&s.maxY<=1&&s.minY<s.maxY))throw new Error('Navigation cannot submit or delete');}
            else if(s.kind==='point'){if(![s.x,s.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw new Error('Unbounded native point');}
            else if(s.kind==='scroll'){if(![s.x,s.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!Number.isSafeInteger(s.pixels)||Math.abs(s.pixels)>1200)throw new Error('Unbounded native scroll');}
            else if(s.kind==='key'){if(!['return','escape','backspace','select-all'].includes(s.key))throw new Error('Unsupported native key');}
            else if(s.kind==='type'){if(!fields.includes(s.field))throw new Error('Unknown native field');}
            else if(s.kind==='proof'){validateNativePhase({steps:[],checks:[s.check]});}
            else if(s.kind==='capture-caption'){if(!validRect(s.region))throw new Error('Invalid native caption capture region');}
            else if(s.kind!=='wait')throw new Error('Unknown native step');
        }
        const names=new Set<string>();
        for(const c of phase.checks){
            if(!text(c.name)||names.has(c.name)||!context(c.context)||!validRect(c.region))throw new Error('Invalid or repeated native proof');names.add(c.name);
            if(c.kind==='field'&&!fields.includes(c.field)||c.kind==='label'&&!text(c.label)||c.kind==='image'&&(!Number.isFinite(c.maxDistance)||c.maxDistance<=0||c.maxDistance>0.065)||c.kind==='toggle'&&(!text(c.label)||typeof c.enabled!=='boolean'||!text(c.referencePath)||!/^[a-f0-9]{64}$/.test(c.referenceSha256)||!Number.isFinite(c.maxDistance)||c.maxDistance<=0||c.maxDistance>0.025)||!['field','label','image','toggle'].includes(c.kind))throw new Error('Invalid native proof check');
        }
}

export async function validateNativePhaseReferences(phase:NativePhase){
    for(const check of [...phase.checks,...phase.steps.flatMap(s=>s.kind==='proof'?[s.check]:[])])if(check.kind==='toggle')await nativeReference(check.referencePath,check.referenceSha256);
}
