import { visibleNativeNodes } from './native-xml.js';
import type {DirectMediaStore} from './direct-media.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {recognizeWords} from '../tiktok/ocr.js';
import type {PostingInput} from './model.js';
import type {ReleaseDriver, ReleaseEvidence} from './release-policy.js';
import type {ReleaseMedia} from './instagram-release.js';
import {locateComment} from './comment-ocr.js';
import type {CommentResult} from './post-comments.js';
import {WdaApp} from './wda-app.js';

export function matchesTikTokPost(label: string, caption: string): boolean {
    const norm=(v:string)=>v.replace(/\s+/g,' ').trim();
    return norm(label).startsWith(norm(caption)+'. Video.');
}

/** Native TikTok release. Each item owns one atomic Post claim. */
export class TikTokRelease extends WdaApp implements ReleaseDriver {
    /** allowSiblingCaption: a hook variant (different video) we already posted uses this exact caption.
     * Then the caption alone cannot tell the posts apart, so verification counts matching posts instead. */
    constructor(base:string,signal:AbortSignal,private imports?:DirectMediaStore,private allowSiblingCaption=false){super(base,signal);}
    private baselineMatches=0;
    /** Close TikTok account prompts (e.g. "Add email", seen Oct 7) that cover the profile. Never fills them in. */
    protected async dismissPrompts() {
        for (let n = 0; n < 3; n++) {
            const later = await this.visible('predicate string', '(label == "Not now" OR label == "Maybe later") AND visible == 1');
            if (later) { await this.tapElement('predicate string', '(label == "Not now" OR label == "Maybe later") AND visible == 1', 'Dismiss TikTok prompt'); await this.sleep(800); continue; }
            if (!await this.visible('predicate string', 'label == "Add email" AND visible == 1')) return;
            const close = visibleNativeNodes(String((await this.request(this.session + '/source')).value))
                .filter(n => n.type === 'XCUIElementTypeButton' && !n.name && !n.label && n.x >= 360 && n.y >= 150 && n.y <= 420 && n.width <= 60 && n.height <= 60);
            if (close.length !== 1) throw new Error('TikTok Add email prompt has no single close button');
            await this.assertInputApp();
            await this.tapPoint(close[0]!.x + close[0]!.width / 2, close[0]!.y + close[0]!.height / 2);
            await this.sleep(1000);
        }
    }
    protected input?: PostingInput;
    protected prepared = false;
    protected override async swipeUp() {
        await this.request('/wda/absolute-actions', {actions:[{type:'pointer',id:'finger1',parameters:{pointerType:'touch'},actions:[
            {type:'pointerMove',duration:0,x:215,y:780,origin:'viewport'},
            {type:'pointerDown',button:0},
            {type:'pointerMove',duration:350,x:215,y:240,origin:'viewport'},
            {type:'pointerUp',button:0},
        ]}]});
    }
    async leaveVideo() { await this.exitApp('com.zhiliaoapp.musically'); }
    private async depth(value:number) { await this.request(this.session+'/appium/settings',{settings:{snapshotMaxDepth:value}}); }
    private async profile() {
        // The feed's deep accessibility tree can stall XCTest. Only inspect tab controls there.
        await this.depth(12);
        await this.tapElement('accessibility id','a11y_vo_profile','TikTok Profile',30_000);
        await this.depth(50);
        await this.dismissPrompts();
        let account='';
        const expected=this.input!.targets[0].account.replace(/^@/,'');
        const deadline=Date.now()+5000;
        do {
            account=(await this.read('accessibility id','user_account_user_name','label','TikTok account')).trim();
            if(account.replace(/^@/,'')===expected)break;
            await this.sleep(300);
        }while(Date.now()<deadline);
        if(account.replace(/^@/,'')!==expected) throw new Error('TikTok account does not match the calendar item');
        await this.tapElement('accessibility id','profile_tab_public_post','Published videos');
    }
    private async matchingPost(): Promise<string|null> { return (await this.matchingPosts())[0] ?? null; }
    /** Visible grid tiles with this exact caption, newest first (top row, then left to right). */
    private async matchingPosts(): Promise<string[]> {
        for(let attempt=0;attempt<4;attempt++) {
            try {
                const rows=(await this.request(this.session+'/elements',{using:'class name',value:'XCUIElementTypeButton'})).value ?? [];
                const found:{id:string;x:number;y:number}[]=[];
                for(const row of rows){
                    const id=this.id(row);
                    if(!(await this.request(`${this.session}/element/${id}/displayed`)).value)continue;
                    const label=String((await this.request(`${this.session}/element/${id}/attribute/label`)).value);
                    if(!matchesTikTokPost(label,this.input!.caption))continue;
                    const r=(await this.request(`${this.session}/element/${id}/rect`)).value;
                    found.push({id,x:r.x,y:r.y});
                }
                return found.sort((a,b)=>a.y-b.y||a.x-b.x).map(f=>f.id);
            } catch(error) {
                if(!(error instanceof Error)||!error.message.includes('stale element')||attempt===3)throw error;
                await this.sleep(500);
            }
        }
        return [];
    }
    protected async screen() {
        const image=Buffer.from((await this.request('/screenshot')).value,'base64');
        const meta=await sharp(image).metadata();
        if(meta.width!==1290 || meta.height!==2796)throw new Error('TikTok screen size changed; review the controls');
        return {image,words:await recognizeWords(image)};
    }
    // TikTok marks some visible composer fields as hidden. Use their measured rectangle
    // only after checking the composer, then read back the exact field value.
    protected async composerField(name:string) {
        await this.waitFor('accessibility id','(publishPageBackButton)','TikTok composer');
        const rows=(await this.request(this.session+'/elements',{using:'accessibility id',value:name})).value ?? [];
        if(rows.length!==1)throw new Error('TikTok composer field is ambiguous: '+name);
        const id=this.id(rows[0]);
        const rect=(await this.request(`${this.session}/element/${id}/rect`)).value;
        if(rect.x<0 || rect.y<100 || rect.x+rect.width>431 || rect.y+rect.height>830)throw new Error('TikTok field is outside the composer');
        return {id,rect};
    }
    private async manualLabelOff() {
        const {image,words}=await this.screen();
        const word=words.find(w=>/^a[iIl]-generated$/i.test(w.text));
        if(!word || !words.some(w=>w.text==='content'&&Math.abs(w.y-word.y)<30))throw new Error('TikTok AI label row was not found');
        const y=Math.round(word.y+word.height/2);
        // On this mapped phone, the off switch has its white thumb on the left,
        // a gray track on the right, and no cyan pixels. Reject unknown layouts.
        const sample=async(x:number)=>{const {data}=await sharp(image).extract({left:x-3,top:y-3,width:7,height:7}).removeAlpha().raw().toBuffer({resolveWithObject:true});return [0,1,2].map(c=>{let n=0;for(let i=c;i<data.length;i+=3)n+=data[i];return n/(data.length/3);});};
        const left=await sample(1092),right=await sample(1167);
        if(left.every(v=>v>240)&&right.every(v=>v>190&&v<235)&&Math.max(...right)-Math.min(...right)<12)return;
        // Never change a setting based on an uncertain visual reading.
        throw new Error('TikTok manual AI label is on or unreadable; review before posting');
    }
    async preflight(input: PostingInput, mediaValue: unknown): Promise<ReleaseEvidence> {
        if(input.targets.length!==1 || input.targets[0].platform!=='tiktok')throw new Error('TikTok needs its own calendar item');
        this.input=input;this.prepared=false;
        const media=mediaValue as ReleaseMedia;
        const bytes=await readFile(media.path);
        if(createHash('sha256').update(bytes).digest('hex')!==media.sha256)throw new Error('Video changed since preparation');
        await this.start('com.zhiliaoapp.musically');
        await this.profile();
        this.baselineMatches=(await this.matchingPosts()).length;
        if(this.baselineMatches&&!this.allowSiblingCaption)throw new Error('A TikTok post with this caption already exists; do not repost');
        let albumName='PF-'+media.sha256.slice(0,8)+'-'+Date.now().toString(36);
        const imported=this.imports ? {value:await this.imports.ensure(input.deviceUdid,media,this.base,this.signal)} : await this.request('/wda/import-media',{name:media.name,mimeType:media.mimeType,data:bytes.toString('base64'),albumName},180_000);
        if(this.imports)albumName=imported.value.albumName;
        if(!imported.value?.localIdentifier || imported.value.albumName!==albumName)throw new Error('Dedicated upload album was not confirmed');
        await this.tapElement('accessibility id','Create','Create');
        await this.tapElement('accessibility id','recordPageUploadButton','Upload');
        await this.tapElement('accessibility id','Recents','Album list');
        const album=await this.revealAlbum(albumName);
        await this.assertInputApp();
        await this.tapPoint(album.x+album.width/2,album.y+album.height/2);
        await this.sleep(500);
        const header=await this.rect('accessibility id',albumName,'Selected album');
        if(header.y>110)throw new Error('TikTok did not open the selected album');
        await this.waitFor('accessibility id','(collectionView)','Video gallery');
        await this.tapPoint(125,170); // first and only imported asset, selection circle
        await this.waitFor('accessibility id','icDeleteAssetOptimize','One selected clip');
        const selected=(await this.request(this.session+'/elements',{using:'accessibility id',value:'icDeleteAssetOptimize'})).value;
        if(selected.length!==1)throw new Error('TikTok selected more than one clip');
        const nextRows=(await this.request(this.session+'/elements',{using:'predicate string',value:"type == 'XCUIElementTypeButton' AND name == 'Next'"})).value;
        if(nextRows.length!==1)throw new Error('TikTok gallery Next is ambiguous');
        const next=(await this.request(`${this.session}/element/${this.id(nextRows[0])}/rect`)).value;
        if(next.x<200||next.y<840||next.y>880)throw new Error('TikTok gallery Next moved');
        await this.tapPoint(next.x+next.width/2,next.y+next.height/2);
        await this.tapElement('accessibility id','(editPageNextButton)','Editor Next',60_000);
        await this.prepareComposer(input);
        this.prepared=true;
        return {exactMedia:true,videoFrameCover:true,caption:true,account:true,automaticPromotion:false,linkedFacebook:false};
    }
    /** Ask iOS to reveal the exact saved album once, then return the visible bounds of that one row.
     * Nov 1-3: three releases stopped with 2 or 3 albums of the same name. The WDA import always creates a new album, and
     * YouTube re-imports a video older than 6 h under the same PF-<sha12> name, so a video posted to Shorts first has copies.
     * Every copy holds one asset imported from the hash-checked file, so the copies are the same video. Nov 4 phone check:
     * each copy is its own album cell with a "1" count, and off-screen titles all report one placeholder rectangle
     * (0,121,310,18), so rows are counted from the screen tree, not from rectangles. Take the first match in tree order,
     * the topmost cell. Any other name, more than 5 copies, or a copy that is not a one-item album still stops. */
    private async revealAlbum(albumName:string) {
        await this.depth(60); // Album rows sit below the shallow profile snapshot.
        // Allow the picker to finish loading without repeating navigation or importing again.
        let rows:any[]=[];
        for(let read=0;read<3;read++){
            rows=(await this.request(this.session+'/elements',{using:'accessibility id',value:albumName})).value ?? [];
            if(rows.length)break;
            if(read<2)await this.sleep(500);
        }
        if(rows.length===0)throw new Error(`Dedicated upload album is missing: ${albumName} (0 matches after 3 reads; import not repeated)`);
        if(rows.length>1){
            const xml=/^PF-[a-f0-9]{12}$/.test(albumName)&&rows.length<=5?String((await this.request(this.session+'/source')).value):'';
            const cells=xml.split('<XCUIElementTypeCell ').slice(1).map(c=>c.split('</XCUIElementTypeCell>')[0]!).filter(c=>c.includes(`name="${albumName}"`));
            const counts=cells.map(c=>/<XCUIElementTypeStaticText [^>]*label="(\d+)"[^>]*index="1"/.exec(c)?.[1]);
            if(cells.length!==rows.length||counts.some(n=>n!=='1'))
                throw new Error(`Dedicated upload album is ambiguous: ${albumName} (${rows.length} matches)`);
        }
        const id=this.id(rows[0]);
        if(!(await this.request(`${this.session}/element/${id}/displayed`)).value)
            await this.request(`${this.session}/wda/element/${id}/scrollTo`,{},30_000);
        const rect=(await this.request(`${this.session}/element/${id}/rect`)).value as {x:number;y:number;width:number;height:number};
        if(rect.y<=115 || rect.y+rect.height>=830)throw new Error('Dedicated upload album is outside the visible list');
        return rect;
    }
    /** A caption ending in hashtags leaves TikTok's full-screen editor and suggestion list open, which hides Edit cover
     * (Oct 7 14:25). Never tap its back arrow: it leaves the composer (Oct 7 15:24). Hide the keyboard, then swipe the
     * suggestion list down, which closes the keyboard and the editor. */
    private async closeCaptionEditor() {
        for(let attempt=0;attempt<3&&await this.visible('class name','XCUIElementTypeKeyboard');attempt++){
            if(attempt===0)await this.raw(this.session+'/wda/keyboard/dismiss',{}).catch(()=>undefined);
            else{await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:330,toX:215,toY:620,duration:0.3});}
            await this.sleep(1000);
        }
        if(await this.visible('class name','XCUIElementTypeKeyboard'))throw new Error('TikTok caption editor did not close');
    }
    private async prepareComposer(input: PostingInput) {
        await this.depth(60);
        const field=await this.composerField('Add description...');
        const initial=String((await this.request(`${this.session}/element/${field.id}/attribute/value`)).value);
        if(initial!=='Add description...'&&initial!=='')throw new Error('TikTok caption field was not empty');
        await this.tapPoint(field.rect.x+30,field.rect.y+30);
        await this.request(this.session+'/wda/keys',{value:[input.caption]},60_000);
        await this.closeCaptionEditor();
        const current=await this.composerField('Add description...');
        if((await this.request(`${this.session}/element/${current.id}/attribute/value`)).value!==input.caption)throw new Error('TikTok caption readback failed');
        await this.waitFor('accessibility id','Edit cover','Visible Edit cover',10_000);
        const cover=await this.composerField('Edit cover');
        await this.tapPoint(cover.rect.x+cover.rect.width/2,cover.rect.y+cover.rect.height/2);
        // The cover editor can load slowly (Oct 7 16:24 stopped here; a rehearsal minutes later passed). Wait for it.
        await this.waitFor('accessibility id','Drag to select','Video cover timeline',10_000);
        const slider=await this.rect('accessibility id','Drag to select','Video cover timeline');
        let percent=parseFloat(await this.read('accessibility id','Drag to select','value','Opening cover frame'));
        if(percent!==0){
            await this.request(this.session+'/wda/dragfromtoforduration',{fromX:slider.x+21,fromY:slider.y+slider.height/2,toX:slider.x+1,toY:slider.y+slider.height/2,duration:0.4});
            percent=parseFloat(await this.read('accessibility id','Drag to select','value','Opening cover frame'));
        }
        if(percent!==0)throw new Error('TikTok cover must use the reviewed opening frame');
        // TikTok can show more than one "Save" (Oct 7: a wrong match opened Messages through a send-to contact).
        // Tap only the cover editor's own Save in the top bar; anything else stops before a tap.
        const saves=[];
        for(const row of (await this.request(this.session+'/elements',{using:'accessibility id',value:'Save'})).value??[]){
            const id=this.id(row),r=(await this.request(this.session+'/element/'+id+'/rect')).value;
            const type=String((await this.request(this.session+'/element/'+id+'/name')).value??'');
            if(type==='XCUIElementTypeButton'&&(await this.request(this.session+'/element/'+id+'/displayed')).value===true&&r.y>=40&&r.y+r.height<=140&&r.x>=250)saves.push(r);
        }
        if(saves.length!==1)throw new Error('TikTok cover Save is missing or ambiguous; nothing was tapped');
        await this.assertInputApp();
        await this.tapPoint(saves[0].x+saves[0].width/2,saves[0].y+saves[0].height/2);await this.sleep(800);
        // Returning through the editor closes TikTok's caption keyboard reliably.
        await this.tapElement('accessibility id','(publishPageBackButton)','Back to editor');
        await this.tapElement('accessibility id','(editPageNextButton)','Return to composer');
        await this.waitFor('accessibility id','Drafts','Composer with keyboard closed');
        const finalCaption=await this.composerField('Add description...');
        if((await this.request(`${this.session}/element/${finalCaption.id}/attribute/value`)).value!==input.caption)throw new Error('TikTok caption changed after cover selection');
        // Location suggestions can move these rows after the composer opens.
        await this.sleep(2000);
        const {words}=await this.screen();
        const options=words.filter(w=>w.text==='More'&&w.y>1200&&words.some(n=>n.text==='options'&&Math.abs(n.y-w.y)<20));
        if(options.length!==1)throw new Error('TikTok More options row was not found');
        await this.tapPoint((options[0].x+options[0].width/2)/3,(options[0].y+options[0].height/2)/3);
        await this.waitFor('accessibility id','Advanced settings','More options');
        await this.manualLabelOff();
        await this.tapElement('accessibility id','Back','Close more options');
        const visibilityScreen=await this.screen();
        if(!visibilityScreen.words.map(w=>w.text).join(' ').includes('Everyone can view this post'))
            throw new Error('TikTok public visibility was not verified');
        await this.waitFor('accessibility id','Post','Final Post');
    }
    async shareOnce(): Promise<void> {
        if(!this.prepared)throw new Error('TikTok preflight is required');
        this.prepared=false;
        // One request only. Never repeat a click after an uncertain response.
        const id=await this.waitFor('accessibility id','Post','Final Post');
        await this.assertInputApp();
        await this.request(`${this.session}/element/${id}/click`,{});
        await this.depth(12);
    }
    async verify() {
        // Open our grid once. Waiting for publication must not repeatedly tap
        // through the app or submit the video again.
        await this.profile();
        // Oct 8 14:28: a 45 s video was still uploading (83%) when a 60 s wait ended. Wait 4 minutes, and keep waiting
        // (up to 15 minutes in all) while the grid still shows an upload percentage, so a slow upload is never called failed.
        const started=Date.now();let deadline=started+4*60_000;
        const uploading=async()=>{try{const {words}=await this.screen();return words.some(w=>/^\d{1,3}%$/.test(w.text)&&w.y>1000&&w.y<1800);}catch{return false;}};
        while(Date.now()<deadline||(Date.now()<started+15*60_000&&await uploading())){
            try {
                // With a sibling caption, only a new matching tile proves this upload (Oct 8: hook variants share captions).
                if((await this.matchingPosts()).length>(this.allowSiblingCaption?this.baselineMatches:0))return {tiktok:{verified:true,source:'tiktok_app',evidence:'Full caption matched in the published video grid on @'+this.input!.targets[0].account.replace(/^@/,'')+(this.allowSiblingCaption?` (matching posts rose above ${this.baselineMatches} before Post)`:''),checkedAt:new Date().toISOString()}};
            }catch(error){this.signal.throwIfAborted();}
            await this.sleep(10_000);
        }
        throw new Error('TikTok post not confirmed; never repeat Post without review');
    }
    /** Separate comment action. Never opens publishing settings or changes AI labels. */
    private async openMatchedPost() {
        await this.depth(50);await this.sleep(700);
        const post=await this.matchingPost();if(!post)throw new Error('Exact TikTok post was not found');
        const rect=(await this.request(`${this.session}/element/${post}/rect`)).value;
        // A profile refresh can move the tile after the caption match. Wait for stable
        // geometry without touching the screen, then stop if it has moved.
        await this.sleep(700);
        const fresh=(await this.request(`${this.session}/element/${post}/rect`)).value;
        if(['x','y','width','height'].some(k=>fresh[k]!==rect[k]))throw Error('TikTok post moved during profile loading; no touch sent');
        if(rect.x<0||rect.x+rect.width>431||rect.y<100||rect.y+rect.height>850||rect.width<=0||rect.height<=0)
            throw new Error('TikTok post is outside the visible grid');
        // One touch on measured native bounds. A missing viewer never repeats the touch.
        await this.tapPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        await this.depth(12);
        await this.sleep(1500);
        await this.waitFor('accessibility id','returnButton','Own TikTok video',8000);
    }

    async commentOnPost(input: PostingInput,text:string,claim:()=>Promise<void>):Promise<CommentResult> {
        this.input=input;
        await this.start('com.zhiliaoapp.musically');await this.profile();
        await this.openMatchedPost();
        await this.sleep(1000);
        const view=await this.screen();
        // The mapped fresh-post control is labeled Add 1st. Stop if another layout appears.
        const add=view.words.find(w=>w.text==='Add'&&w.x>1050&&w.y>1200&&w.y<2300);
        if(add&&view.words.some(w=>/^1st$/i.test(w.text)&&Math.abs(w.y-add.y)<25)) {
            await this.tapPoint((add.x+add.width/2)/3,(add.y-65)/3);
        } else {
            // White text over moving video needs a bounded high-contrast scan.
            // Oct 8 05:59: one frame missed it (moving video behind the label) while a later frame read it. Rescan fresh frames.
            let control:{x:number;y:number}|undefined;
            for(let frame=0;frame<4&&!control;frame++){
                const image=frame===0?view.image:Buffer.from((await this.request('/screenshot')).value,'base64');
                for(const top of [...new Set([...(add?[Math.round(add.y)-20]:[]),1730,1770,1810,1870,1910])]){
                    const crop=await sharp(image).extract({left:1120,top,width:165,height:85}).resize(660,340).greyscale().threshold(220).negate().extend({top:30,bottom:30,left:30,right:30,background:'white'}).png().toBuffer();
                    const words=await recognizeWords(crop);
                    if(words.map(w=>w.text).join(' ')==='Add 1st'){
                        const w=words[0];control={x:(1120+(w.x-30+w.width/2)/4)/3,y:(top+(w.y-30)/4-65)/3};break;
                    }
                }
                if(!control)await this.sleep(700);
            }
            if(!control)throw new Error('TikTok first-comment control is not visible; review existing comments');
            await this.tapPoint(control.x,control.y);
        }
        await this.waitFor('accessibility id','Send','Comment keyboard');
        let screen=await this.screen();
        const draftWords=async(image:Buffer)=>{
            const crop=await sharp(image).extract({left:180,top:1500,width:1020,height:210}).resize(2040,420).greyscale().threshold(200).png().toBuffer();
            return (await recognizeWords(crop)).map(w=>({...w,x:180+w.x/2,y:1500+w.y/2,width:w.width/2,height:w.height/2}));
        };
        const emptyComments=(words:typeof screen.words)=>words.some(w=>/^Comments0$/.test(w.text))||words.some(w=>w.text==='Comments'&&words.some(n=>n.text==='0'&&Math.abs(n.y-w.y)<20));
        // Oct 8 06:47: the first frame came before the sheet finished opening; the failure frame shows Comments 0.
        for(let read=0;read<3&&!emptyComments(screen.words);read++){await this.sleep(700);screen=await this.screen();}
        if(!emptyComments(screen.words))throw new Error('Expected empty comments before first comment');
        if(!locateComment(screen.words,text,1450,1850,{draftCursor:true})){
            if(!screen.words.some(w=>w.y>1450&&w.y<1850&&/^comment/.test(w.text))&&!(await draftWords(screen.image)).some(w=>/^comment\.{3}$/.test(w.text)))throw new Error('TikTok comment draft is not empty or unreadable');
            await this.request(this.session+'/wda/keys',{value:[text]});
        }
        screen=await this.screen();
        if(!locateComment(screen.words,text,1400,1850,{draftCursor:true}))throw new Error('TikTok comment text readback failed');
        const send=await this.waitFor('accessibility id','Send','Comment Send');
        await claim();
        await this.request(`${this.session}/element/${send}/click`,{}); // exactly one submit request
        let match:ReturnType<typeof locateComment>=null;
        for(let n=0;n<10;n++){
            await this.sleep(1000);screen=await this.screen();
            match=locateComment(screen.words,text,1050,2300);
            if(match){
                let authors=screen.words;
                if(!authors.some(w=>w.text==='antoniorevenue'&&w.y<match![0].y&&w.y>match![0].y-120)){
                    const top=Math.round(match[0].y)-120;
                    const crop=await sharp(screen.image).extract({left:150,top,width:650,height:110}).resize(1300,220).greyscale().threshold(200).png().toBuffer();
                    authors=(await recognizeWords(crop)).map(w=>({...w,x:150+w.x/2,y:top+w.y/2}));
                }
                if(authors.some(w=>w.text==='antoniorevenue'&&w.y<match![0].y&&w.y>match![0].y-120)&&authors.some(w=>w.text==='Creator'&&w.y<match![0].y&&w.y>match![0].y-120))break;
            }
            match=null;
        }
        if(!match)throw new Error('TikTok comment receipt missing; do not send again');
        await this.tapPoint((match[0].x+30)/3,(match[0].y+match[0].height/2)/3,900);
        await this.waitFor('accessibility id','Manage multiple comments','Own comment menu');
        if(await this.visible('predicate string','(label == "Pin" OR label == "Pin comment") AND visible == 1'))throw new Error('TikTok now offers Pin; map and verify its confirmation before using it');
        return {status:'comment_posted_pin_unavailable',commentVerified:true,pinned:false,evidence:'Exact comment and Creator identity matched on the native comment sheet. Own-comment menu has no Pin option.'};
    }
    async reconcile(input: PostingInput){this.input=input;await this.start('com.zhiliaoapp.musically');return this.verify();}
}
