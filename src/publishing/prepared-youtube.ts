import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {WdaApp} from './wda-app.js';
import {visibleNativeNodes} from './native-xml.js';
import {type PostingInput} from './model.js';
import {preparedInputHash} from './prepared-instagram.js';
import {assertRelease,type ReleaseDriver,type ReleaseEvidence} from './release-policy.js';
import type {ReleaseMedia} from './instagram-release.js';
import {recognizeWords} from '../tiktok/ocr.js';
import {longFormById} from './youtube-longform.js';

export const reviewedLongForm={id:'DWREa1sv_Ho',title:'How I Use Jev AI Inside Businesses Doing $7M a Month',owner:'Antonio Monteiro | More Leads & Sales With AI',seconds:957};
export function ownedShortsTabRect(xml:string){
 const candidates=visibleNativeNodes(xml).filter(n=>n.type==='XCUIElementTypeButton'&&n.name==='id.ui.tab..button'&&n.label.startsWith('Shorts, Tab '));
 const rows=[...new Map(candidates.map(n=>[[n.x,n.y,n.width,n.height,n.label].join('|'),n])).values()];
 if(rows.length!==1)throw Error('Owned Shorts tab is missing or ambiguous');const r=rows[0]!;
 if(r.x<0||r.x+r.width>431||r.y<200||r.y+r.height>750)throw Error('Owned Shorts tab moved');return r;
}
export function assertPreparedYouTube(item:any,proof:any,now=Date.now()) {
    if(proof?.kind!=='youtube'||item.status!=='held'||proof.itemId!==item.id||proof.itemVersion!==item.version
       ||proof.sourceSha256!==item.media.sha256||proof.inputHash!==preparedInputHash(item.input,item.media.sha256)
       ||!proof.sessionId||!proof.coverReviewed||!proof.duplicateCheckComplete||!proof.phoneVolumeZero
       ||!Number.isFinite(Date.parse(proof.checkedAt))||Date.parse(proof.checkedAt)>now
       ||!Number.isFinite(Date.parse(proof.expiresAt))||Date.parse(proof.expiresAt)<=now
       ||Date.parse(proof.expiresAt)-Date.parse(proof.checkedAt)>10*60_000)
        throw Error('Prepared YouTube evidence changed or expired');
    assertRelease(item.input,proof.evidence,{nativeYouTubeLayout:true});
}

/** One reviewed composer, one Upload claim. No fallback or retry after submission. */
export class PreparedYouTubeRelease extends WdaApp implements ReleaseDriver {
    readonly youtubeNative=true;
    protected ready=false;
    protected input?:PostingInput;
    constructor(base:string,signal:AbortSignal,private item:any){super(base,signal);}
    async preflight(input:PostingInput,mediaValue:unknown):Promise<ReleaseEvidence> {
        const p=this.item.results.preparedNative;assertPreparedYouTube(this.item,p);
        const media=mediaValue as ReleaseMedia;
        if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==p.sourceSha256)throw Error('Prepared video changed');
        if((await this.request('/wda/locked')).value!==false||(await this.request('/status')).sessionId!==p.sessionId)throw Error('Prepared YouTube session changed or phone locked');
        await this.start('com.google.ios.youtube');await this.waitFor('accessibility id','id.metadata_editor.upload_button','Source-bound Upload composer');await this.assertInputApp();
        // Reviewing expanded metadata can leave the title above the viewport.
        // Restore it with bounded navigation, without altering any saved field.
        for(let n=0;n<3&&!await this.visible('class name','XCUIElementTypeTextView');n++){
            if(n===2)throw Error('Prepared YouTube title is outside the reviewed composer');
            await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:250,toX:215,toY:780,duration:.4});await this.sleep(500);
        }
        const source=String((await this.request(this.session+'/source')).value),nodes=visibleNativeNodes(source);
        if(await this.read('class name','XCUIElementTypeTextView','value','YouTube title')!==input.youtube!.title
           ||!nodes.some(n=>n.name==='id.elements.components.identity_chip_component'&&n.label?.includes('@'+input.targets[0]!.account.replace(/^@/,'')))
           ||!nodes.some(n=>n.name==='id.metadata_editor.upload_button'&&n.label==='Upload Short'))throw Error('Prepared YouTube composer changed');
        this.input=input;this.ready=true;return p.evidence;
    }
    async shareOnce(){
        if(!this.ready)throw Error('Fresh YouTube preflight required');this.ready=false;
        await this.assertInputApp();
        await this.tapElement('accessibility id','id.metadata_editor.upload_button','Upload Short');
    }
    /** Public, tap-free receipt: the exact title on the channel's own feed. Shorts appear within about a minute. */
    protected async publicFeedReceipt(input:PostingInput,waitMs:number){
        const title=input.youtube!.title.trim(),deadline=Date.now()+waitMs;
        const clean=(t:string)=>t.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
        while(true){
            try{
                const xml=await (await fetch('https://www.youtube.com/feeds/videos.xml?channel_id='+input.youtube!.channelId,{signal:AbortSignal.timeout(20_000)})).text();
                for(const [,id,t] of xml.matchAll(/<yt:videoId>(.*?)<\/yt:videoId>[\s\S]*?<title>(.*?)<\/title>/g))
                    if(clean(t!)===title)return{verified:true,source:'youtube_public_feed',url:'https://youtube.com/shorts/'+id,
                        evidence:`Exact title on channel ${input.youtube!.channelId} public feed; related long-form video verified before Upload`};
            }catch{}
            // Oct 10 19:17: every YouTube RSS feed returned 404. The channel's public Shorts page still lists each Short's
            // ID and exact title in one lockup block; use it the same way, exact title only.
            try{
                const page=await (await fetch('https://www.youtube.com/channel/'+input.youtube!.channelId+'/shorts',{headers:{'accept-language':'en-US'},signal:AbortSignal.timeout(20_000)})).text();
                for(const block of page.split('"shortsLockupViewModel"').slice(1)){
                    const id=/"videoId":"([A-Za-z0-9_-]{11})"/.exec(block)?.[1],raw=/"primaryText":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
                    if(!id||raw===undefined)continue;
                    let t:string;try{t=JSON.parse('"'+raw+'"');}catch{continue;}
                    if(t.trim()===title)return{verified:true,source:'youtube_shorts_page',url:'https://youtube.com/shorts/'+id,
                        evidence:`Exact title on channel ${input.youtube!.channelId} public Shorts page; related long-form video verified before Upload`};
                }
            }catch{}
            if(Date.now()>=deadline)return undefined;
            await this.sleep(15_000);
        }
    }
    async verify(){
        const input=this.input!,related=longFormById(input.youtube?.publishing?.relatedVideoId);
        // Prefer the public feed: no navigation, no tile guessing (Oct 7: the in-app grid lagged and opened an older Short).
        const fromFeed=await this.publicFeedReceipt(input,3*60_000);
        if(fromFeed)return {youtube:fromFeed};
        await this.sleep(15_000);
        let source=String((await this.request(this.session+'/source')).value);
        let nodes=visibleNativeNodes(source);
        const dismissCopyPreview=async()=>{
            if(!nodes.some(n=>n.name==='Dismiss'&&n.width===430&&n.height===932)
               ||!nodes.some(n=>n.label==='Sheet Grabber'))return;
            const words=await recognizeWords(Buffer.from((await this.request('/screenshot')).value,'base64'));
            const copy=words.filter(w=>w.text.toLowerCase()==='copy'&&w.y>2300&&words.some(l=>l.text.toLowerCase()==='link'&&Math.abs(l.y-w.y)<30&&l.x>w.x));
            if(copy.length!==1)throw Error('An unexpected YouTube sheet was left unchanged');
            await this.tapPoint(5,100);await this.sleep(500);
            source=String((await this.request(this.session+'/source')).value);nodes=visibleNativeNodes(source);
        };
        await dismissCopyPreview();
        if(!nodes.some(n=>n.name==='eml.shorts-video-title-new'&&n.label===input.youtube!.title)){
            // Read the owned channel once. Never open Create or an upload prompt.
            await this.tapElement('accessibility id','id.ui.pivotbar.FElibrary.button','You');
            await this.waitFor('predicate string','name == "View channel" OR name == "@'+input.targets[0]!.account.replace(/^@/,'')+'"','Owned channel navigation');
            if(await this.visible('accessibility id','View channel'))await this.tapElement('accessibility id','View channel','Owned channel');
            await this.waitFor('accessibility id','@'+input.targets[0]!.account.replace(/^@/,''),'Owned channel identity');
            source=String((await this.request(this.session+'/source')).value);nodes=visibleNativeNodes(source);
            if(!nodes.some(n=>n.name==='@'+input.targets[0]!.account.replace(/^@/,'')))throw Error('Owned channel identity needs review');
            const tab=ownedShortsTabRect(source);await this.tapPoint(tab.x+tab.width/2,tab.y+tab.height/2);
            await this.sleep(1500);
            source=String((await this.request(this.session+'/source')).value);nodes=visibleNativeNodes(source);
            const unique=(rows:typeof nodes)=>[...new Map(rows.map(n=>[[n.x,n.y,n.width,n.height,n.label].join('|'),n])).values()];
            const findNamed=()=>unique(nodes.filter(n=>n.label?.startsWith(input.youtube!.title+' -')&&n.label.includes('Antonio Monteiro')));
            let named=findNamed();
            // A new Short can take a minute to appear in the channel grid (Oct 7: the older top tile was opened).
            // Pull to refresh and look again before falling back to the first published tile.
            for(let attempt=0;attempt<4&&!named.length;attempt++){
                await this.sleep(20_000);await this.assertInputApp();
                await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:320,toX:215,toY:760,duration:0.4});await this.sleep(2500);
                source=String((await this.request(this.session+'/source')).value);nodes=visibleNativeNodes(source);named=findNamed();
            }
            // This app version reuses index-0 on every grid cell, including Drafts.
            // Inspect the first published tile once; the exact viewer is the receipt.
            const published=unique(nodes.filter(n=>n.name==='short-item-index-0'&&/^(No views|[\d.,KM]+ views)$/.test(n.label)&&n.y>=200&&n.y+n.height<=933)).sort((a,b)=>a.y-b.y||a.x-b.x);
            const match=named.length?named:published.slice(0,1);
            if(match.length!==1)throw Error('Uploaded Short needs native review; no second Upload');
            const n=match[0]!;await this.tapPoint(n.x+n.width/2,n.y+n.height*.3);
            await this.sleep(1000);
            source=String((await this.request(this.session+'/source')).value);nodes=visibleNativeNodes(source);
            await dismissCopyPreview();
        }
        if(!nodes.some(n=>n.name==='eml.shorts-video-title-new'&&n.label===input.youtube!.title)
           ||!nodes.some(n=>n.name==='decorated-avatar-id'&&n.label==='Go to channel @'+input.targets[0]!.account.replace(/^@/,''))
           ||!related||!nodes.some(n=>n.name==='id.reel_multi_format_link'&&related.titles.includes(n.label)))
            throw Error('Native Short title, owner or related long-form link needs review');
        await this.tapElement('accessibility id','eml.shorts-video-title-new','Published description');
        const description=visibleNativeNodes(String((await this.request(this.session+'/source')).value));
        if(!description.some(n=>n.label===input.caption))throw Error('Published YouTube description differs');
        // iOS 27 (Oct 10 12:26): the close button became id.elements.button "Close". Closing is cleanup after the
        // receipt matched, so try both and never fail a verified upload over it.
        const close=await this.visible('accessibility id','id.ui.browse.close.button')
            ??await this.visible('predicate string','name == "id.elements.button" AND label == "Close" AND visible == 1');
        if(close){await this.assertInputApp();await this.request(this.session+'/element/'+close+'/click',{}).catch(()=>undefined);}
        return {youtube:{verified:true,source:'youtube_app',evidence:'Exact native title, account and full description matched. Viewer-facing link matched the owned long-form video '+related!.id}};
    }
    async reconcile(input:PostingInput){this.input=input;const fromFeed=await this.publicFeedReceipt(input,30_000);if(fromFeed)return {youtube:fromFeed};await this.start('com.google.ios.youtube');return this.verify();}
    async leaveVideo(){await this.exitApp('com.google.ios.youtube');}
}
