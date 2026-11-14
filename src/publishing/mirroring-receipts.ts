import {MirrorScreen,containsCaption,normalizeMirrorText,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import type {PostingInput} from './model.js';
import type {ReleaseMedia} from './instagram-release.js';
import {openingFrame,publishedCoverDistance,uniqueImageMatch} from './mirroring-cover.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const owner='antoniorevenue';
const page='https://www.facebook.com/profile.php?id=61584693917444';
const canonical=(s:string)=>normalizeMirrorText(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').replace(/\bI'Il\b/g,"I'll").replace(/(\p{L})-\s+(\p{L})/gu,'$1-$2').replace(/\s+/g,' ').trim();
const accountLabel=(s:string)=>normalizeMirrorText(s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
async function receiptOpening(media:ReleaseMedia){
    if(!media||createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256)
        throw new Error('A published receipt needs its unchanged source video');
    return openingFrame(media.path);
}

/** Overlapping windows must account for every saved word, including the ordered hashtags.
 * Each window must be contiguous in a native caption view. Video text cannot replace missing windows. */
export function nativeCaptionWindowsMatch(views:string[],caption:string) {
    const words=canonical(caption).split(' ');
    const normalized=views.map(canonical);
    if(words.length<=12)return normalized.some(v=>v.includes(words.join(' ')));
    for(let start=0;start<words.length;start+=6) {
        const from=Math.min(start,words.length-12);
        if(!normalized.some(v=>v.includes(words.slice(from,from+12).join(' '))))return false;
    }
    return true;
}

/** Receipt navigation only. This reader cannot import media, create posts or tap Share. */
export class MirroringReceiptReader {
    constructor(readonly screen:MirrorScreen,private proof:(name:string,s?:MirrorSnapshot)=>Promise<MirrorSnapshot>){}
    async instagramProfile() {
        await this.screen.openApp('Instagram');
        for(let n=0;n<6;n++) {
            const s=await this.screen.snapshot();
            await this.proof('instagram-profile-navigation-'+n,s);
            if(this.screen.has(s,'New reel')||this.screen.has(s,'Caption')||this.screen.has(s,'Edit linked reel'))
                throw new Error('An existing Instagram composer or link edit needs review');
            if(this.screen.has(s,'Create')&&this.screen.has(s,'Edits')&&this.screen.has(s,'Fundraiser')) {
                await this.screen.tap(0.5,0.36,['Create','Edits','Fundraiser']);continue;
            }
            if(this.screen.has(s,'Trial reel insights')) {
                await this.screen.tap(0.5,0.4,['Trial reel insights']);continue;
            }
            if(this.screen.has(s,owner)&&this.screen.has(s,'Trial insights')) {
                await this.screen.tap(0.107,0.133,[owner,'Trial insights']);continue;
            }
            if(this.screen.has(s,owner)&&this.screen.has(s,'Insights on Edits')) {
                await this.screen.tap(0.107,0.133,[owner,'Insights on Edits']);continue;
            }
            if(this.screen.has(s,owner)&&(this.screen.has(s,'Your dashboard')||this.screen.has(s,'Professional dashboard')))return s;
            if(this.screen.has(s,owner)&&this.screen.has(s,'Edit profile'))return s;
            if(this.screen.has(s,'Add a comment')) {await this.screen.tap(0.5,0.31,[owner,'Add a comment']);continue;}
            if(this.screen.has(s,'Posts')&&this.screen.has(s,'Reposts')&&this.screen.has(s,'Tagged')) {
                // A collapsed profile still shows its tabs. Reveal the owned header
                // before navigating; a Reel tile is not the Trial grid heading.
                await this.screen.scroll(650,['Posts','Reposts','Tagged']);continue;
            }
            if(this.screen.has(s,'Trial reels')&&!this.screen.has(s,'Your dashboard')&&!this.screen.has(s,'Posts')) {
                await this.screen.tap(0.107,0.133,['Trial reels']);continue;
            }
            const context=s.text.filter(x=>x.trim()&&x.length<200&&!/^\d/.test(x)).slice(0,2);
            if(!context.length)throw new Error('Cannot identify Instagram before Profile');
            await this.screen.tap(0.824,0.937,context);
            await this.screen.waitUntil(v=>this.screen.has(v,owner),'Owned Instagram profile did not open');
        }
        throw new Error('Owned Instagram profile could not be verified');
    }
    async trialGrid() {
        let s=await this.instagramProfile();
        const discover=s.lines.find(x=>normalizeMirrorText(x.text)==='Discover people');
        if(discover){await this.screen.tap(0.929,discover.y+discover.height/2,[owner,'Discover people']);s=await this.screen.snapshot();}
        for(let n=0;n<5;n++) {
            await this.proof('instagram-reel-tab-navigation-'+n,s);
            const highlight=s.lines.find(x=>normalizeMirrorText(x.text)==='New'&&x.x<0.3&&x.y>0.18&&x.y<0.84);
            if(highlight) {
                const y=highlight.y+highlight.height+0.04;
                if(y>0.88)throw new Error('Instagram Reel tab is outside the reviewed layout');
                await this.screen.tap(0.379,y,[owner,'New']);
                break;
            }
            await this.screen.scroll(-600,[owner]);s=await this.screen.snapshot();
        }
        s=await this.screen.waitFor(['Drafts and trial reels']);
        const tile=s.lines.find(x=>normalizeMirrorText(x.text)==='Drafts and trial reels');
        if(!tile||tile.y>0.9)throw new Error('The owned Trial Reel tile is not visible');
        await this.screen.tap(tile.x+tile.width/2,Math.max(0.2,tile.y-0.04),[owner,'Drafts and trial reels']);
        await this.screen.waitFor(['Drafts','Trial reels']);
        await this.screen.tapText('Trial reels',['Drafts','Trial reels'],0.75,0.97);
        return this.screen.waitFor(['Trial reels','Create trial reel']);
    }
    async openIGCaption() {
        let s=await this.screen.waitFor([owner]);
        if(!this.screen.has(s,'Add a comment')) {
            const caption=s.lines.find(x=>x.y>0.78&&x.y<0.89&&x.x<0.5&&x.text.startsWith('Comment '));
            if(!caption)throw new Error('Native Reel caption control is missing');
            // The collapsed caption's apostrophe can vary between OCR frames.
            // Guard navigation with its stable keyword; verify every word after expansion.
            await this.screen.tap(caption.x+Math.min(caption.width/2,0.4),caption.y+caption.height/2,[owner,caption.text.split(/\s+/).slice(0,2).join(' ')]);
        }
        return this.screen.waitFor([owner,'Add a comment']);
    }
    async verifyRelated(reel:NonNullable<PostingInput['instagramRelatedReel']>) {
        await this.trialGrid();
        await this.screen.tap(0.183,0.29,['Trial reels','Create trial reel']);
        const s=await this.screen.waitFor([owner,'Watch',reel.label]);
        const link=s.lines.find(x=>x.text.includes('Watch')&&x.text.includes(reel.label)&&x.y>0.6&&x.y<0.86);
        if(!link)throw new Error('The reviewed owned related Reel is not linked from the latest Trial Reel');
        await this.screen.tap(link.x+link.width/2,link.y+link.height/2,[owner,'Watch',reel.label]);
        await this.screen.waitFor([owner,reel.label]);
        const caption=await this.openIGCaption();
        if(!containsCaption(caption.text,reel.caption))throw new Error('Owned related Reel full caption did not match');
        await this.proof('related-owned-native-caption',caption);
        await this.screen.home();
        return {url:reel.url,label:reel.label,captionVerified:true,account:owner};
    }
    async verifyInstagram(input:PostingInput,media:ReleaseMedia) {
        const opening=await receiptOpening(media);
        await this.trialGrid();
        let matched=-1;
        for(let attempt=0;attempt<10;attempt++){
            const grid=await this.screen.waitFor(['Trial reels','Create trial reel']);
            const distances=await Promise.all(Array.from({length:9},(_,i)=>publishedCoverDistance(opening,grid,
                {x:(16+i%3*222)/696,y:(252+Math.floor(i/3)*394)/1532,width:220/696,height:(i<6?350:300)/1532},392/1532)));
            try{matched=uniqueImageMatch(distances,0.03,0.05).index;await this.proof('instagram-owned-source-cover',grid);break;}
            catch{await delay(500,undefined,{signal:this.screen.signal});}
        }
        if(matched<0)throw new Error('The published Trial grid has no unique opening cover for this source video');
        {
            const index=matched;
            await this.screen.tap([0.183,0.5,0.818][index%3]!,[0.29,0.55,0.805][Math.floor(index/3)]!,['Trial reels','Create trial reel']);
            await this.screen.waitFor([owner]);
            const caption=await this.openIGCaption();
            if(containsCaption(caption.text,input.caption)) {
                await this.proof('instagram-full-caption-receipt',caption);
                await this.screen.tap(0.5,0.31,[owner,'Add a comment']);
                await this.screen.waitFor([owner,'Trial insights']);
                await this.screen.tap(0.906,0.873,[owner,'Trial insights']);
                const menu=await this.screen.waitFor(['This reel is a trial reel.','Shared to Facebook']);
                await this.proof('instagram-trial-facebook-receipt',menu);
                await this.screen.home();
                return {verified:true,source:'instagram_app',mediaSha256:media.sha256,evidence:'Owned Trial Reel grid opening cover matched the exact source; full caption, ordered hashtags, Trial and Shared to Facebook labels verified',checkedAt:new Date().toISOString()};
            }
            await this.screen.tap(0.5,0.31,[owner,'Add a comment']);
            await this.screen.waitFor(['Trial reels']);
            await this.screen.tap(0.107,0.133,['Trial reels']);
            await this.screen.waitFor(['Trial reels','Create trial reel']);
        }
        throw new Error('The source cover matched but its full published caption did not. No second Share is allowed.');
    }
    async verifyFacebook(input:PostingInput,media:ReleaseMedia) {
        const opening=await receiptOpening(media);
        if(input.targets.find(t=>t.platform==='facebook')?.account!==page)throw new Error('Unmapped Facebook Page');
        await this.screen.openApp('Facebook');
        let s=await this.screen.snapshot();
        if(this.screen.has(s,'Summary')&&this.screen.has(s,'See more')) {
            await this.screen.tap(0.5,0.24,['Summary','See more']);
            s=await this.screen.snapshot();
        }
        // Exit an expanded or collapsed Reel to its Page before checking identity.
        if(this.screen.has(s,'Add a comment')&&this.screen.has(s,'Antonio Revenue')) {
            await this.screen.tap(0.074,0.135,['Antonio Revenue','Add a comment']);
            s=await this.screen.snapshot();
        }
        if(!this.screen.has(s,'Professional dashboard')) {
            // Only the native home feed uses this Page-tab coordinate. Clock text
            // and video subtitles cannot safely guard navigation on a moving feed.
            if(!this.screen.has(s,'facebook')||!this.screen.has(s,"What's on your mind?"))
                throw new Error('Facebook did not expose its reviewed home navigation');
            await this.screen.tap(0.854,0.937,['facebook',"What's on your mind?"]);
        }
        s=await this.screen.waitFor(['Antonio Revenue','Professional dashboard']);
        await this.proof('facebook-owned-page',s);
        const ad=s.lines.find(x=>x.text.includes('Improve your ROI'));
        if(ad){await this.screen.tap(0.875,ad.y+ad.height/2,['Antonio Revenue','Improve your ROI']);s=await this.screen.snapshot();}
        for(let n=0;n<4&&!this.screen.has(s,'Reels');n++){await this.screen.scroll(-600,['Antonio Revenue']);s=await this.screen.snapshot();}
        await this.screen.tapText('Reels',['Antonio Revenue','Reels'],0.3,0.89);
        s=await this.screen.waitFor(['Antonio Revenue','Create reel']);
        await this.proof('facebook-owned-reel-grid',s);
        const tile=s.lines.find(x=>normalizeMirrorText(x.text)==='Create reel'&&x.x<0.3&&x.y>0.5&&x.y<0.89);
        if(!tile)throw new Error('Facebook Page Reel grid needs its reviewed layout');
        const top=tile.y+tile.height/2-0.631*(392/1532);
        const visible=Math.min(350/1532,1400/1532-top);
        if(visible<180/1532||await publishedCoverDistance(opening,s,
            {x:238/696,y:top,width:220/696,height:visible},392/1532)>0.03)
            throw new Error('The newest Facebook Reel cover does not match this source video');
        await this.proof('facebook-owned-source-cover',s);
        // The left cell is Create Reel; the centre cell is the newest native Reel.
        await this.screen.tap(0.5,tile.y-0.025,['Antonio Revenue','Create reel']);
        const prefix=input.caption.split(/\s+/).slice(0,3).join(' ');
        s=await this.screen.waitFor(['Antonio Revenue',prefix],45_000);
        // Stop playback before expanding text so a loop cannot move the metadata rows.
        await this.screen.tap(0.5,0.4,['Antonio Revenue',prefix]);
        let expanded=false;
        for(let attempt=0;attempt<3;attempt++) {
            s=await this.screen.waitFor(['Antonio Revenue',prefix]);
            const caption=s.lines.find(x=>normalizeMirrorText(x.text).startsWith(normalizeMirrorText(prefix))&&x.y>0.65&&x.y<0.92);
            if(!caption)throw new Error('Facebook native caption was not found');
            await this.proof('facebook-collapsed-native-caption-'+attempt,s);
            try {
                // Read the paused player's current caption and target its More control.
                if(!/\bmore\s*$/i.test(caption.text))throw new Error('Facebook collapsed caption has no More control');
                await this.screen.tapTextPrefix(prefix,'more',['Antonio Revenue',prefix],0.65,0.92,0.97);
                expanded=true;break;
            }catch(error) {
                const message=error instanceof Error?error.message:String(error);
                if(!/Exactly one matching visible control|screen does not match the expected text/.test(message))throw error;
                // Those controller guards confirm no input was sent. Only a navigation
                // tap can be retried here; this reader has no Share or upload path.
            }
        }
        if(!expanded)throw new Error('Facebook caption moved during all three guarded navigation attempts');
        const views:string[]=[];
        for(let n=0;n<6;n++) {
            s=await this.screen.waitFor(['Antonio Revenue','Add a comment']);
            await this.proof('facebook-caption-receipt-'+n,s);
            const account=s.lines.find(x=>accountLabel(x.text).startsWith('antonio revenue')&&x.x<0.6&&x.y>0.2&&x.y<0.9);
            if(!account)throw new Error('Expanded Facebook receipt belongs to an unreadable account');
            const lines=s.lines.filter(x=>x.y>account.y+0.035&&x.y<0.85&&x.x<0.86);
            views.push(lines.map(x=>x.text).join(' '));
            if(nativeCaptionWindowsMatch(views,input.caption))return {verified:true,source:'facebook_app',mediaSha256:media.sha256,evidence:'Antonio Revenue Page Reel opening cover matched the exact source; every saved caption word and ordered hashtag matched in native expanded caption views',checkedAt:new Date().toISOString()};
            // Place the pointer over the caption before scrolling its bounded text region.
            await this.screen.scroll(-180,['Antonio Revenue','Add a comment'],0.45,Math.min(0.88,account.y+0.12));
        }
        throw new Error('Independent Facebook full-caption receipt is still missing. No new upload is allowed.');
    }
}
