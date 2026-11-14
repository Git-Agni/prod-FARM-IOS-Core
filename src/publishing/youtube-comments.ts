import sharp from 'sharp';
import {PreparedYouTubeRelease} from './prepared-youtube.js';
import {recognizeWords} from '../tiktok/ocr.js';
import {visibleNativeNodes} from './native-xml.js';
import type {PostingInput} from './model.js';
import type {CommentResult} from './post-comments.js';

const YOUTUBE='com.google.ios.youtube';

/** First comment and pin on a published Short, in the YouTube app. Verified live Oct 7 15:06-15:09 on p1zxOewEg9A.
 * Opens the Short from its public-feed link, posts once (never when the comment already exists), then pins it. */
export class YouTubeComments extends PreparedYouTubeRelease {
    async leaveVideo(){await this.exitApp(YOUTUBE);}

    private async ownComment(text:string){
        const want=text.replace(/\s+/g,' ').trim();
        return visibleNativeNodes((await this.request(this.session+'/source')).value)
            .find(n=>n.type==='XCUIElementTypeOther'&&/^(Pinned by @antoniorevenue, )?@antoniorevenue, /.test(n.label)&&n.label.replace(/\s+/g,' ').endsWith(want));
    }
    /** The comment menu is not in the accessibility tree and is white on dark: read it from an inverted screenshot. */
    private async menuWords(){
        const shot=Buffer.from((await this.request('/screenshot')).value,'base64');
        return recognizeWords(await sharp(shot).negate({alpha:false}).grayscale().png().toBuffer());
    }

    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly=false):Promise<CommentResult>{
        this.input=input;
        const receipt=await this.publicFeedReceipt(input,60_000);
        if(!receipt?.url)throw new Error('Short is not on the public channel feed yet');
        // A restored YouTube session can reopen an old comment box: start the app fresh.
        await this.start(YOUTUBE);await this.request(this.session+'/wda/apps/terminate',{bundleId:YOUTUBE});await this.sleep(1500);
        await this.start(YOUTUBE);await this.sleep(2500);
        await this.request(this.session+'/url',{url:receipt.url});
        await this.waitFor('predicate string','label == "Go to channel @antoniorevenue" AND visible == 1','Own Short',20_000);
        // Record whether the Short shows its related long-form link (Antonio, Oct 8: confirm YouTube linking too).
        const related=visibleNativeNodes((await this.request(this.session+'/source')).value).find(n=>n.name==='id.reel_multi_format_link')?.label;
        const linkNote=related?` Related link shown: "${related}".`:' Related long-form link NOT shown on the Short.';
        await this.tapElement('accessibility id','id.reel_comment_button','View comments');
        await this.sleep(2500);
        let own=await this.ownComment(text);let claimed=false;
        if(!own){
            if(existingOnly)throw new Error('Existing own comment not found; repair cannot create one');
            const box=await this.waitFor('predicate string','type == "XCUIElementTypeTextView" AND visible == 1','Comment box');
            if(String((await this.request(this.session+'/element/'+box+'/attribute/value')).value??'').trim())throw new Error('YouTube comment draft is not empty');
            await this.assertInputApp();
            await this.request(this.session+'/element/'+box+'/click',{});
            await this.sleep(800); // Oct 8 01:43: keys sent right after the tap were lost and the box stayed empty.
            await this.request(this.session+'/wda/keys',{value:[text]});
            // A comment that wraps to two lines replaces the text view (Oct 7 16:49, stale element): find it again.
            await this.sleep(500);
            const typed=await this.waitFor('predicate string','type == "XCUIElementTypeTextView" AND visible == 1','Typed comment box');
            if(String((await this.request(this.session+'/element/'+typed+'/attribute/value')).value??'')!==text)throw new Error('YouTube comment text readback failed');
            await claim();claimed=true;
            await this.tapElement('predicate string','name == "id.comment.send.button" AND label == "Send comment" AND visible == 1','Send comment');
            for(let n=0;n<15&&!own;n++){await this.sleep(1000);own=await this.ownComment(text);}
            if(!own)throw new Error('YouTube comment receipt missing; never post again automatically');
        }
        if(own.label.startsWith('Pinned by @antoniorevenue'))return {status:'already_pinned',commentVerified:true,pinned:true,evidence:'Exact own comment on the Short reads "Pinned by @antoniorevenue".'+linkNote};
        // The "..." menu button has no accessibility element; it sits at the comment row's top-right corner.
        await this.assertInputApp();
        await this.tapPoint(own.x+own.width-24,own.y+24);
        await this.sleep(1500);
        const words=await this.menuWords(),below=(w:{y:number})=>w.y>3*own!.y;
        const pin=words.filter(w=>w.text==='Pin'&&below(w)),edit=words.find(w=>w.text==='Edit'&&below(w));
        if(pin.length!==1||!edit||!words.some(w=>w.text==='Delete')||pin[0]!.y>=edit.y)throw new Error('YouTube Pin is not available in the comment menu');
        if(!claimed)await claim();
        await this.tapPoint((pin[0]!.x+pin[0]!.width/2)/3,(pin[0]!.y+pin[0]!.height/2)/3);
        await this.tapElement('predicate string','name == "id.ui.confirmation_dialog.confirm.button" AND label == "Pin" AND visible == 1','Confirm pin');
        for(let n=0;n<10;n++){await this.sleep(1000);own=await this.ownComment(text);if(own?.label.startsWith('Pinned by @antoniorevenue'))break;}
        if(!own?.label.startsWith('Pinned by @antoniorevenue'))throw new Error('YouTube pin readback failed');
        return {status:'pinned',commentVerified:true,pinned:true,evidence:'Exact own comment on the Short reads "Pinned by @antoniorevenue".'+linkNote};
    }
}
