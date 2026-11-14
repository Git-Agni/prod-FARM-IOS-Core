import sharp from 'sharp';
import {FacebookVerifier} from './facebook-verify.js';
import {visibleNativeNodes} from './native-xml.js';
import {recognizeWords} from '../tiktok/ocr.js';
import type {PostingInput} from './model.js';
import type {CommentResult} from './post-comments.js';

/** Comments only. This driver never opens post settings or AI label controls. */
export class FacebookComments extends FacebookVerifier {
    async leaveVideo(){await this.exitApp('com.facebook.Facebook');}
    private async menuWords(){
        await this.waitFor('accessibility id','fds-glimpse-preview','Own comment menu');
        const image=Buffer.from((await this.request('/screenshot')).value,'base64');
        const meta=await sharp(image).metadata();if(meta.width!==1290||meta.height!==2796)throw new Error('Facebook comment screen size changed');
        const preview=await this.rect('accessibility id','fds-glimpse-preview','Comment preview');
        return (await recognizeWords(image)).filter(w=>w.x>600&&w.y>(preview.y+preview.height)*3);
    }
    private async more(){
        const words=await this.menuWords();const more=words.filter(w=>w.text==='More');
        if(more.length!==1)throw new Error('Facebook comment More menu is missing');
        const w=more[0];await this.tapPoint((w.x+w.width/2)/3,(w.y+w.height/2)/3);await this.sleep(400);
        return this.menuWords();
    }
    /** One screen-tree snapshot. WDA's displayed flag reports on-screen Facebook comments as hidden (Oct 13),
     * so read visible="true" nodes from the source instead. Two copies of our comment stop everything for review. */
    private async commentSnapshot(text:string){
        const nodes=visibleNativeNodes((await this.request(this.session+'/source')).value);
        const bodies=nodes.filter(n=>n.name==='comment-body-text'&&n.label===text&&n.y>=50&&n.y+n.height<=900);
        if(bodies.length>1)throw new Error('Two copies of our Facebook comment are visible; review by hand');
        const body=bodies[0];
        if(body&&!nodes.some(n=>n.name==='comment-author-name'&&n.label.startsWith('Antonio Revenue')&&n.y<body.y&&body.y-n.y<45))throw new Error('Matching comment does not have the expected author');
        return {own:body?{x:body.x,y:body.y,width:body.width,height:body.height}:null,empty:!body&&nodes.some(n=>n.name==='no-comment-background')};
    }
    private async ownComment(text:string){return (await this.commentSnapshot(text)).own;}
    private async sheetNodes(){return visibleNativeNodes((await this.request(this.session+'/source')).value);}
    /** Close the comment sheet by its background and open it again, fresh at the top of the list. */
    private async reopenSheet(box:string){
        const bg=(await this.sheetNodes()).find(n=>n.name==='bottom_sheet_background');
        if(!bg||bg.y>5||bg.height<150)throw new Error('Facebook comment sheet background is missing; not touched');
        await this.tapPoint(bg.x+bg.width/2,bg.y+bg.height/2);await this.sleep(1200);
        await this.tapElement('accessibility id','shorts-comment-top-button','Facebook comments');
        await this.waitFor('predicate string',box,'Comment as Antonio Revenue');await this.sleep(2000);
    }
    /** Oct 13: keyword Reels collect viewer comments and our "Check your DMs!" replies before a backfill runs, so our
     * comment can sit below the first screen. Scroll the list down only (an upward drag can close the sheet) and say
     * "complete" only when the list stops moving. Our comment found anywhere wins. */
    private async scanComments(text:string){
        let last='';const seen=new Set<string>();
        for(let n=0;n<20;n++){
            const {own}=await this.commentSnapshot(text);if(own)return {own,complete:true,seen:seen.size};
            const nodes=await this.sheetNodes();
            if(!nodes.some(x=>x.name==='bottom_sheet_background'))throw new Error('Facebook comment sheet closed while scanning');
            for(const b of nodes.filter(x=>x.name==='comment-body-text')){const a=nodes.find(x=>x.name==='comment-author-name'&&x.y<b.y&&b.y-x.y<45);if(a)seen.add(a.label+'|'+b.label);}
            const sig=nodes.filter(x=>x.name==='comment-body-text'||x.name==='comment-author-name').map(x=>x.label+'@'+Math.round(x.y)).join('|');
            if(sig===last)return {own:null,complete:true,seen:seen.size};last=sig;
            await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:760,toX:215,toY:420,duration:0.15});await this.sleep(900);
        }
        return {own:null,complete:false,seen:seen.size};
    }
    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly=false,postUrl?:string):Promise<CommentResult>{
        await this.verifyPost(input,true,false,postUrl);
        const count=await this.read('accessibility id','shorts-comment-top-button','label','Facebook comment count');
        await this.tapElement('accessibility id','shorts-comment-top-button','Facebook comments');
        const box='type == "XCUIElementTypeTextView" AND name == "comment-composer-text-area" AND label == "Comment as Antonio Revenue"';
        await this.waitFor('predicate string',box,'Comment as Antonio Revenue');
        // Oct 13: the composer appears before the comment list. A single check missed our comment one second
        // before it loaded. Wait for our comment or the empty-list marker before deciding anything.
        let own:Awaited<ReturnType<FacebookComments['ownComment']>>=null;let empty=false;let claimed=false;
        for(let n=0;n<16;n++){
            ({own,empty}=await this.commentSnapshot(text));if(own||empty)break;
            // Oct 13 10:42: one sheet opened with only the composer and never loaded its list. Reopen it once.
            if(n===7)await this.reopenSheet(box);
            await this.sleep(1000);
        }
        let scanned=false;
        if(!own&&!empty&&count!=='Comment, 0 comments'&&(await this.sheetNodes()).some(n=>n.name==='comment-body-text')){
            const scan=await this.scanComments(text);own=scan.own;
            // Complete only when every comment the Reel counts was actually seen (replies included).
            scanned=scan.complete&&scan.seen>=Number(/^Comment, (\d+) comments?$/.exec(count)?.[1]??Infinity);
        }
        if(!own){
            if(existingOnly)throw new Error('Existing own comment not found; repair cannot create one');
            // Type only when the loaded list is empty on a 0-comment Reel, or the whole list was scanned without ours.
            if(!(empty&&count==='Comment, 0 comments')&&!scanned)throw new Error('Facebook Reel has comments but not ours, or the list did not load; not typed');
            await this.tapElement('predicate string',box,'Comment box');
            const existing=await this.read('predicate string',box,'value','Comment draft');
            if(existing.trim())throw new Error('Facebook comment draft is not empty');
            await this.request(this.session+'/wda/keys',{value:[text]});
            if(await this.read('predicate string',box,'value','Comment text')!==text)throw new Error('Facebook comment text readback failed');
            const send=await this.waitFor('accessibility id','comment-composer-confirm-button','Post comment');
            await claim();claimed=true;
            await this.request(`${this.session}/element/${send}/click`,{});
            // Oct 13: founderos's comment appeared after more than 15 s (uncertain_review although it was up). Wait 45 s.
            // Oct 13 12:40: right after Send, Facebook drew our one comment twice (local copy plus server copy) for a
            // moment. After our own send, wait for that to settle instead of stopping; before typing, two copies still stop.
            for(let n=0;n<45;n++){await this.sleep(1000);try{own=await this.ownComment(text);}catch(error){if(!/Two copies/.test(String(error)))throw error;own=null;continue;}if(own&&!await this.visible('predicate string','name == "comment-timestamp" AND label == "Posting..."'))break;own=null;}
            // On a scrolled list the new comment can land off screen. Look from the top, read-only, before giving up.
            if(!own&&scanned){await this.reopenSheet(box);own=(await this.scanComments(text)).own;}
            if(!own)throw new Error('Facebook comment receipt missing; never post again automatically');
        }
        await this.tapPoint(own.x+Math.min(own.width/2,150),own.y+own.height/2,900);
        const preview=await this.read('accessibility id','fds-glimpse-preview','label','Own comment preview');
        if(!preview.startsWith('Antonio Revenue')||!preview.includes(text))throw new Error('Comment menu belongs to another comment');
        let words=await this.more();
        if(words.some(w=>/^Unpin$/i.test(w.text)))return {status:'already_pinned',commentVerified:true,pinned:true,evidence:'Exact comment and author matched. Native menu offers Unpin Comment.'};
        const pin=words.filter(w=>w.text==='Pin'&&words.some(n=>n.text==='Comment'&&Math.abs(n.y-w.y)<25));
        if(pin.length!==1)throw new Error('Facebook Pin Comment is not available');
        if(!claimed)await claim();
        const w=pin[0];await this.tapPoint((w.x+w.width/2)/3,(w.y+w.height/2)/3);
        own=null;for(let n=0;n<15;n++){await this.sleep(1000);own=await this.ownComment(text);if(own)break;}
        // A pinned comment moves to the top of the list; reopen the sheet there if it left the screen.
        if(!own){await this.reopenSheet(box);own=(await this.scanComments(text)).own;}
        if(!own)throw new Error('Pinned comment is not visible');
        // Oct 13: twice the pin landed but the readback long-press opened nothing (Facebook was still showing its
        // pinned confirmation). Retry the read-only long-press, finding our comment again each time.
        for(let attempt=0;;attempt++){
            await this.tapPoint(own.x+Math.min(own.width/2,150),own.y+own.height/2,900);
            try{await this.waitFor('accessibility id','fds-glimpse-preview','Own comment menu',6_000);break;}
            catch(error){if(attempt>=2)throw error;await this.sleep(2000);own=await this.ownComment(text);if(!own)throw new Error('Pinned comment is not visible');}
        }
        words=await this.more();
        if(!words.some(w=>/^Unpin$/i.test(w.text)))throw new Error('Facebook pin readback failed');
        return {status:'pinned',commentVerified:true,pinned:true,evidence:'Exact comment and author matched. Reopened native menu offers Unpin Comment.'};
    }
}
