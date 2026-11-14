import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { MirrorScreen, containsCaption, normalizeMirrorText, type MirrorSnapshot } from '../devices/mirroring/screen.js';
import type {NativeImportJournal} from './mirroring-media-store.js';
import {MirroringReceiptReader} from './mirroring-receipts.js';
import {openingFrame,nativeImageDistance,uniqueImageMatch} from './mirroring-cover.js';
import { importMirroringMedia } from './mirroring-media.js';
import type { ReleaseMedia } from './instagram-release.js';
import type { PostingInput } from './model.js';
import type { ReleaseDriver, ReleaseEvidence } from './release-policy.js';

const run=promisify(execFile);
const FACEBOOK='https://www.facebook.com/profile.php?id=61584693917444';

/** Distance between a reviewed opening frame and the native 3:4 profile cover, excluding UI. */
export async function openingCoverDistance(source:Buffer,snapshot:MirrorSnapshot) {
    const meta=await sharp(source).metadata();
    if(!meta.width||!meta.height||meta.width/meta.height>0.8)throw new Error('The video needs a reviewed vertical opening frame');
    const height=Math.round(meta.width/0.75);
    if(height>meta.height)throw new Error('Opening-frame crop is not supported');
    const expected=await sharp(source).extract({left:0,top:Math.floor((meta.height-height)/2),width:meta.width,height}).resize(48,64).removeAlpha().raw().toBuffer();
    const actual=await sharp(Buffer.from(snapshot.png,'base64')).extract({left:Math.round(snapshot.width*0.341),top:Math.round(snapshot.height*0.401),width:Math.round(snapshot.width*0.319),height:Math.round(snapshot.height*0.193)}).resize(48,64).removeAlpha().raw().toBuffer();
    if(expected.length!==actual.length)throw new Error('Native cover image channels differ');
    return expected.reduce((sum,value,index)=>sum+Math.abs(value-actual[index]!),0)/(expected.length*255);
}

/** Reads the native toggle knob in the reviewed layout. Ambiguous colors or positions stop preflight. */
export async function mirrorSwitchState(s:MirrorSnapshot,y:number) {
    if(y<0.15||y>0.84)throw new Error('The native switch is outside the calibrated area');
    const png=Buffer.from(s.png,'base64');
    const samples=await Promise.all([0.84,0.91].map(async x=>{
        const {data,info}=await sharp(png).extract({left:Math.round(s.width*x)-3,top:Math.round(s.height*y)-3,width:6,height:6}).removeAlpha().raw().toBuffer({resolveWithObject:true});
        return data.reduce((sum,v)=>sum+v,0)/(info.width*info.height*info.channels*255);
    }));
    // Instagram's dark knob moves left/off and right/on inside its light track.
    if(samples[0]!>0.65&&samples[1]!<0.35)return true;
    if(samples[0]!<0.35&&samples[1]!>0.65)return false;
    throw new Error('The native switch state is ambiguous; no Share is allowed');
}

/** One native Mirroring release. No driver can run until its flow is certified by a real worker pilot. */
export class MirroringInstagramRelease implements ReleaseDriver {
    nativeFlowFingerprint?:string;
    private input?:PostingInput;
    private submitted=false;
    private coverChecked=false;
    private preflightComplete=false;
    readonly screen:MirrorScreen;
    readonly evidence:Record<string,unknown>={control:'native_mirroring_v4'};
    constructor(signal:AbortSignal,private evidenceRoot:string,private relatedMedia?: (url:string,caption:string)=>Promise<ReleaseMedia>,private importJournal?:NativeImportJournal,private receiptMedia?:ReleaseMedia) { this.screen=new MirrorScreen(signal); }
    private async proof(name:string,s?:MirrorSnapshot) {
        const snapshot=s??await this.screen.snapshot();
        await mkdir(this.evidenceRoot,{recursive:true,mode:0o700});
        await writeFile(path.join(this.evidenceRoot,name+'.png'),Buffer.from(snapshot.png,'base64'),{mode:0o600});
        return snapshot;
    }
    private heading(s:MirrorSnapshot,label:string) {
        return s.lines.find(x=>normalizeMirrorText(x.text).toLowerCase()===label.toLowerCase()&&x.y>0.15&&x.y<0.85);
    }
    private async toggle(label:string,wanted:boolean,context:string[]) {
        let s=await this.screen.waitFor([label,...context]);
        let row=this.heading(s,label);if(!row)throw new Error('Native switch label is not mapped: '+label);
        // The OCR label's centre matches the switch centre in this reviewed composer layout.
        let y=row.y+row.height/2;
        if(await mirrorSwitchState(s,y)!==wanted){await this.screen.tap(0.874,y,[label,...context]);s=await this.screen.waitFor([label,...context]);row=this.heading(s,label);if(!row)throw new Error('Native switch moved');y=row.y+row.height/2;}
        if(await mirrorSwitchState(s,y)!==wanted)throw new Error('Native switch did not reach its required state: '+label);
        return s;
    }
    private async profile() {
        return new MirroringReceiptReader(this.screen,this.proof.bind(this)).instagramProfile();
    }
    async preflight(input:PostingInput,mediaValue:unknown):Promise<ReleaseEvidence> {
        this.preflightComplete=false;
        this.input=input;
        if(input.targets.find(x=>x.platform==='instagram')?.account.replace(/^@/,'')!=='antoniorevenue')throw new Error('Instagram account is not calibrated');
        if(input.targets.some(x=>x.platform==='tiktok'||x.platform==='youtube'))throw new Error('This Mirroring flow only supports Instagram with linked Facebook');
        if(!input.instagramTrial||!input.automaticPromotion)throw new Error('This Mirroring flow requires Trial and automatic promotion');
        if(input.targets.find(x=>x.platform==='facebook')?.account!==FACEBOOK||input.facebookMode!=='linked_from_instagram')throw new Error('The linked Facebook Page is not calibrated');
        if(!input.instagramRelatedReel)throw new Error('Select the exact related Reel before the Mirroring release');
        if(!this.relatedMedia)throw new Error('The related Reel needs its owned source reference');
        const reference=await this.relatedMedia(input.instagramRelatedReel.url,input.instagramRelatedReel.caption);
        const referenceBytes=await readFile(reference.path);
        if((await import('node:crypto')).createHash('sha256').update(referenceBytes).digest('hex')!==reference.sha256)throw new Error('The related Reel source changed');
        this.relatedOpening=await openingFrame(reference.path);
        const reader=new MirroringReceiptReader(this.screen,this.proof.bind(this));
        this.evidence.relatedNative=await reader.verifyRelated(input.instagramRelatedReel);
        const media=mediaValue as ReleaseMedia;
        this.receiptMedia=media;
        const imported=await importMirroringMedia(this.screen,media,this.importJournal);
        this.evidence.mediaImport=imported;
        const profile=await this.profile();
        const dashboard=this.screen.has(profile,'Your dashboard')?'Your dashboard':this.screen.has(profile,'Professional dashboard')?'Professional dashboard':'Edit profile';
        await this.screen.tap(0.107,0.133,['antoniorevenue',dashboard]);
        await this.screen.waitFor(['Reel']);
        await this.screen.tapText('Reel',['Reel']);
        let gallery=await this.screen.waitFor(['New reel','Recents']);
        if(gallery.lines.some(x=>normalizeMirrorText(x.text)==='Cancel'&&x.y>0.23&&x.y<0.28)) {
            await this.screen.tapText('Cancel',['New reel','Recents','Cancel'],0.23,0.28);
            gallery=await this.screen.waitFor(['New reel','Recents']);
        }
        await this.proof('native-gallery',gallery);
        // The first native cell must match the new video duration before selecting it.
        const seconds=Number((await run('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',media.path])).stdout.trim());
        const duration=Math.floor(seconds/60)+':'+String(Math.floor(seconds)%60).padStart(2,'0');
        // The left tile is Camera. The newest imported video is the centre tile.
        const firstDuration=gallery.lines.find(x=>x.x>0.34&&x.x<0.66&&x.y>0.25&&x.y<0.55&&x.text===duration);
        if(!firstDuration)throw new Error('The newest gallery video does not match the imported duration');
        await this.screen.tap(0.5,firstDuration.y-0.06,['New reel','Recents',duration]);
        await this.screen.waitFor(['Next']);
        await this.screen.tap(0.867,0.917,['Next','Open in Edits']);
        await this.screen.waitFor(['New reel','Edit cover']);
        await this.screen.tapText('Edit cover',['New reel','Edit cover']);
        await this.screen.waitFor(['Edit cover','Cover']);
        // Scrub to the far-left video frame, then inspect the actual profile crop.
        await this.screen.tap(0.105,0.84,['Edit cover','Cover']);
        await this.screen.tapText('Profile grid',['Edit cover','Profile grid']);
        const crop=await this.screen.waitFor(['Edit cover','Profile grid','Drag to edit crop']);
        const frame=path.join(this.evidenceRoot,'opening.png');await mkdir(this.evidenceRoot,{recursive:true,mode:0o700});
        await run('ffmpeg',['-y','-v','error','-i',media.path,'-frames:v','1',frame]);
        const distance=await openingCoverDistance(await readFile(frame),crop);
        if(distance>0.065)throw new Error('The native cover does not match the saved opening frame');
        await this.proof('cover-profile-crop',crop);this.coverChecked=true;this.evidence.coverDistance=distance;
        await this.screen.tap(0.886,0.132,['Edit cover','Profile grid']);
        await this.screen.waitFor(['New reel']);
        // Caption and the native link are separate controls. A complete readback is mandatory.
        await this.screen.tapText('Add a caption...',['New reel']);
        await this.screen.waitFor(['Caption']);
        await this.screen.type(input.caption,['Caption']);
        const caption=await this.screen.snapshot();
        if(!containsCaption(caption.text,input.caption))throw new Error('The entire native caption and hashtags did not match after typing');
        await this.proof('caption-preflight',caption);
        await this.screen.tapText('Link a reel',['Caption','Link a reel']);
        await this.selectRelatedReel(input.instagramRelatedReel);
        await this.screen.tap(0.885,0.132,['Caption']);
        await this.screen.waitFor(['New reel']);
        await this.findComposerRow('Add AI Label');
        await this.toggle('Add AI Label',false,['New reel']);
        await this.toggle('Trial',true,['New reel']);
        let s=await this.screen.snapshot();
        const settings=s.lines.find(x=>x.text.toLowerCase().includes('trial settings'));
        if(!settings)throw new Error('The native Trial settings link is missing');
        await this.screen.tap(settings.x+settings.width*0.75,settings.y+settings.height/2,['New reel','trial settings']);
        await this.screen.waitFor(['Trial settings','Share to everyone automatically']);
        await this.toggle('Share to everyone automatically',true,['Trial settings']);
        await this.proof('trial-auto-promotion');
        await this.screen.tapText('Done',['Trial settings','Done']);
        await this.findComposerRow('Also share on');
        s=await this.screen.snapshot();const sharing=s.lines.find(x=>x.text.startsWith('Also share on'));
        if(!sharing)throw new Error('The linked sharing control is missing');
        await this.screen.tap(sharing.x+sharing.width/2,sharing.y+sharing.height/2,['New reel','Also share on']);
        await this.screen.waitFor(['Antonio Revenue','Public']);
        await this.toggle('Antonio Revenue',true,['Public']);
        const threads=await this.screen.snapshot();if(this.heading(threads,'Threads'))await this.toggle('Threads',false,['Antonio Revenue']);
        await this.proof('facebook-linked-public');
        await this.screen.tap(0.071,0.132,['Antonio Revenue','Public']);
        await this.screen.waitFor(['New reel','Share']);
        await this.proof('composer-before-share');
        this.preflightComplete=true;
        return {exactMedia:true,videoFrameCover:this.coverChecked,caption:true,account:true,automaticPromotion:true,linkedFacebook:true,
            relatedReel:{...input.instagramRelatedReel,verified:true}};
    }
    private async findComposerRow(label:string) {
        for(let n=0;n<4;n++){const s=await this.screen.snapshot();if(this.screen.has(s,label))return;
            await this.screen.drag(0.5,0.77,0.5,0.28,['New reel']);}
        throw new Error('The native composer row is missing: '+label);
    }
    private relatedOpening?:Buffer;
    private async selectRelatedReel(reel:NonNullable<PostingInput['instagramRelatedReel']>) {
        if(!this.relatedOpening||!this.evidence.relatedNative)throw new Error('The owned related Reel was not checked before composing');
        const s=await this.screen.waitFor(['Select a reel']);
        await this.proof('related-selector',s);
        // Three columns in the reviewed native picker. Require a unique cover match,
        // backed by the owned full caption read before entering the composer.
        const cells=Array.from({length:9},(_,i)=>({x:(16+(i%3)*221)/696,y:(282+Math.floor(i/3)*392)/1532,width:220/696,height:282/1532}));
        const distances=await Promise.all(cells.map(r=>nativeImageDistance(this.relatedOpening!,s,r,'top')));
        const match=uniqueImageMatch(distances,0.15,0.05),cell=cells[match.index]!;
        await this.screen.tap(cell.x+cell.width/2,cell.y+cell.height/2,['Select a reel']);
        await this.screen.waitFor(['Edit linked reel']);
        await this.screen.tap(0.4,0.245,['Edit linked reel']);
        await this.screen.key('select-all',['Edit linked reel']);
        await this.screen.key('backspace',['Edit linked reel']);
        await this.screen.type(reel.label,['Edit linked reel']);
        const named=await this.screen.waitFor(['Edit linked reel',reel.label]);
        await this.proof('related-link-title',named);
        await this.screen.tapText('Done',['Edit linked reel',reel.label,'Done']);
        await this.screen.waitFor(['Caption',reel.label]);
        this.evidence.relatedCoverDistance=match.value;
    }
    async shareOnce() {
        if(this.submitted)throw new Error('Share was already attempted; no second tap is allowed');
        if(!this.input||!this.coverChecked||!this.preflightComplete)throw new Error('Native preflight is incomplete');
        this.submitted=true;
        await this.screen.tapText('Share',['New reel','Share'],0.87,0.96);
    }
    async verify():Promise<Record<string,{verified:boolean;source?:string;evidence?:string}>> {
        if(!this.input||!this.receiptMedia)throw new Error('Missing saved post input or source video');
        const reader=new MirroringReceiptReader(this.screen,this.proof.bind(this));
        const instagram=await reader.verifyInstagram(this.input,this.receiptMedia);
        const facebook=await reader.verifyFacebook(this.input,this.receiptMedia);
        return {instagram,facebook};
    }
    async reconcile(input:PostingInput){this.input=input;return this.verify();}
    async leaveVideo() { await this.screen.home(); }
}
