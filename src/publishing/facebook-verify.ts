import {visibleNativeNodes} from './native-xml.js';
import type { PostingInput } from './model.js';
import {WdaApp} from './wda-app.js';
import {frameZero,matchTile} from './facebook-match.js';
import { sameCaptionAroundMentions } from './meta-receipts.js';

export const normalizeCaption = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Verification on the configured Facebook Page. Read-only, except adding a missing caption to our own cover-matched Reel. */
export class FacebookVerifier extends WdaApp {
    protected override async tapElement(using:string,value:string,what:string,ms=20_000) {
        const navigation=['tab-bar-item-190055527696468','Reels','back-button','feed-controls-menu-drag-handle','fbreels-description-collapse'];
        if(using!=='accessibility id'||(!navigation.includes(value)&&!value.startsWith('shorts-aggregation-video-component-')))
            return super.tapElement(using,value,what,ms);
        let r=await this.rect(using,value,what);
        if(value==='fbreels-description-collapse'){
            await this.sleep(1200);
            r=await this.rect(using,value,what);
        }
        if(r.x<0||r.y<45||r.x+r.width>431||r.y+r.height>925||r.width<=0||r.height<=0)
            throw Error('Facebook navigation control is outside the screen');
        // The collapsed row only expands from its visible More control at the right edge.
        const x=value==='fbreels-description-collapse'?r.x+r.width*.95:r.x+r.width/2;
        await this.tapPoint(x,r.y+r.height/2);await this.sleep(700);
    }
    /** Linked Instagram sharing sometimes lands on Facebook without its caption. Add the exact caption only on the
     * Reel whose cover matches our frame zero, with no description and no comments. Reads the text back before Save. */
    protected async addMissingCaption(input: PostingInput) {
        if (!await this.visible('predicate string', 'label == "Comment, 0 comments" AND visible == 1')) throw new Error('Captionless Facebook Reel already has comments; not edited');
        // Menu and Edit taps can be ignored while the Reel or the sheet animates (seen Oct 7). Retry the whole
        // open sequence until the description box appears; nothing is typed until then.
        const editRow = 'type == "XCUIElementTypeButton" AND label BEGINSWITH "Edit video, You can edit" AND visible == 1';
        let box = '';
        for (let attempt = 0; attempt < 3 && !box; attempt++) {
            await this.sleep(2500 * (attempt + 1));
            if (!await this.visible('predicate string', editRow)) {
                if (!await this.visible('accessibility id', 'shorts-option-button')) continue;
                await this.tapElement('accessibility id', 'shorts-option-button', 'Reel options');
                try { await this.waitFor('predicate string', editRow, 'Edit video row', 5_000); } catch { continue; }
                await this.sleep(600);
            }
            await this.tapElement('predicate string', editRow, 'Edit video');
            try { box = await this.waitFor('accessibility id', 'sharesheet-description-text-view', 'Facebook description', 20_000); } catch { box = ''; }
        }
        if (!box) throw new Error('Facebook Edit reel did not open; nothing was changed');
        const before = String((await this.request(`${this.session}/element/${box}/attribute/value`)).value ?? '');
        if (before.trim() && !before.startsWith('Describe your reel')) throw new Error('Facebook description is not empty; not edited');
        await this.assertInputApp();
        await this.request(`${this.session}/element/${box}/value`, { value: [input.caption] });
        const typed = String((await this.request(`${this.session}/element/${box}/attribute/value`)).value ?? '');
        if (normalizeCaption(typed) !== normalizeCaption(input.caption)) throw new Error('Facebook description did not match after typing; not saved');
        // The keyboard covers Save; its blue check ("selected") closes the keyboard without saving.
        if (!await this.visible('accessibility id', 'post-text-button') && await this.visible('accessibility id', 'selected')) await this.tapElement('accessibility id', 'selected', 'Close keyboard');
        // iOS reports this Save button as not displayed even when it is on screen (seen Oct 7). Tap its frame,
        // only when the label is exactly Save and the frame sits fully on screen.
        await this.sleep(1000);
        const saves = (await this.request(this.session + '/elements', { using: 'accessibility id', value: 'post-text-button' })).value ?? [];
        if (saves.length !== 1) throw new Error('Facebook Save button is missing or ambiguous; not saved');
        const saveId = this.id(saves[0]);
        if (String((await this.request(`${this.session}/element/${saveId}/attribute/label`)).value) !== 'Save') throw new Error('Facebook Save label changed; not saved');
        const r = (await this.request(`${this.session}/element/${saveId}/rect`)).value;
        if (r.y < 600 || r.y + r.height > 925 || r.width < 100) throw new Error('Facebook Save button is not on screen; not saved');
        await this.assertInputApp();
        await this.request(`${this.session}/element/${saveId}/click`, {});
        for (let n = 0; n < 5 && await this.visible('predicate string', 'label == "Edit reel" AND visible == 1'); n++) await this.sleep(1000);
        if (await this.visible('predicate string', 'label == "Edit reel" AND visible == 1')) { await this.tapPoint(r.x + r.width / 2, r.y + r.height / 2, 150); await this.sleep(3000); }
        // After Save, Facebook may offer "Add a Send Message button"; decline without changing settings.
        for (let n = 0; n < 6; n++) {
            if (await this.visible('predicate string', 'label == "Not now" AND visible == 1')) { await this.tapElement('predicate string', 'label == "Not now" AND visible == 1', 'Decline Facebook prompt'); break; }
            if (await this.visible('accessibility id', 'fbreels-description-collapse') || await this.visible('accessibility id', 'fbreels-description-expand')) break;
            await this.sleep(1500);
        }
        await this.waitFor('accessibility id', 'shorts-option-button', 'Reel after Save', 30_000);
        for (let n = 0; n < 10 && !await this.visible('accessibility id', 'fbreels-description-collapse') && !await this.visible('accessibility id', 'fbreels-description-expand'); n++) await this.sleep(1500);
    }
    /** Open one Reel by its Graph receipt link and prove it is ours by owner and exact full caption. Read-only. */
    protected async openReelByUrl(input: PostingInput, url: string) {
        if(!/^https:\/\/www\.facebook\.com\/reel\/\d+\/?$/.test(url)) throw new Error('Facebook receipt link is not a Reel link');
        await this.start('com.facebook.Facebook');
        await this.request(this.session+'/url',{url});
        await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'com.facebook.Facebook'}});
        // Read the owner from the screen tree: WDA reported this on-screen control as not displayed on some Reels (Oct 13).
        let owner=false;
        for(let n=0;n<20&&!owner;n++){owner=visibleNativeNodes((await this.request(this.session+'/source')).value).some(x=>x.name==='shorts-owner-component'&&x.label.startsWith('Antonio Revenue'));if(!owner)await this.sleep(1000);}
        if(!owner) throw new Error('Phone control is missing: Antonio Revenue Reel');
        for(let n=0;n<10&&!await this.visible('accessibility id','fbreels-description-collapse')&&!await this.visible('accessibility id','fbreels-description-expand');n++) await this.sleep(1000);
        if (!await this.visible('accessibility id','fbreels-description-expand')) await this.tapElement('accessibility id','fbreels-description-collapse','Expand Reel caption',10_000);
        const caption=await this.read('accessibility id','fbreels-description-expand','label','Facebook caption');
        if(!sameCaptionAroundMentions(input.caption,caption)) throw new Error('Facebook Reel opened by link has a different caption');
        return {verified:true,source:'facebook_app',evidence:`Opened ${url} by link; owner Antonio Revenue and exact full caption matched`,checkedAt:new Date().toISOString()};
    }
    async verifyPost(input: PostingInput, keepOpen = false, repair: false | { mediaPath: string } = false, reelUrl?: string) {
        const target=input.targets.find(t=>t.platform==='facebook');
        if(target?.account!=='https://www.facebook.com/profile.php?id=61584693917444') throw new Error('Facebook destination has not been mapped');
        // Oct 13: the Page Reels grid only ever yielded the newest Reel. The receipt link opens the exact Reel;
        // the grid stays as the fallback when there is no link or the link does not prove our caption.
        let linkError='';
        if(reelUrl&&!repair){
            try{const receipt=await this.openReelByUrl(input,reelUrl);if(!keepOpen)await this.tapElement('accessibility id','back-button','Leave Facebook Reel');return receipt;}
            catch(error){linkError=error instanceof Error?error.message:String(error);}
        }
        await this.start('com.facebook.Facebook');
        // The Page tab can retain an old Reels collection after cross-posting.
        // Open the exact saved Page URL to load its current native collection.
        await this.request(this.session+'/url',{url:target.account});
        await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'com.facebook.Facebook'}});
        await this.waitFor('predicate string','label BEGINSWITH "Antonio Revenue" AND visible == 1','Antonio Revenue Page',15_000);
        const selector=await this.visible('accessibility id','navigation_bar_picker_title');
        if(selector && !String((await this.request(`${this.session}/element/${selector}/attribute/label`)).value).startsWith('Antonio Revenue,')) throw new Error('Wrong Facebook Page');
        // Locate the Reels tab without touching any creation or engagement controls.
        for(let n=0;n<4 && !await this.visible('accessibility id','Reels');n++) await this.scroll();
        await this.tapElement('accessibility id','Reels','Page Reels');
        // The grid keeps its old scroll position (seen at "25 of 46 reels"); pull back to the top first.
        for(let n=0;n<10;n++){await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:300,toX:215,toY:800,duration:0.15});await this.sleep(400);}
        const cover=repair?await frameZero(repair.mediaPath):undefined;
        const seen=new Set<string>();
        for(let page=0;page<6;page++) {
            await this.sleep(600);
            // Use one accessibility snapshot. Re-reading every cached element ID failed
            // when Facebook refreshed the grid between the displayed and rect requests.
            const tiles=visibleNativeNodes((await this.request(this.session+'/source')).value)
                .filter(n=>n.type==='XCUIElementTypeButton'&&n.name.startsWith('shorts-aggregation-video-component-')&&n.y>=110&&n.y+n.height<=850);
            if(cover){
                // Pinned Reels sort first, so position never identifies our post. The tile cover is frame zero.
                const {best}=await matchTile(Buffer.from((await this.request('/screenshot')).value,'base64'),tiles,cover);
                if(best){
                    await this.tapElement('accessibility id',best.name,'Facebook Reel matched by cover');await this.sleep(1200);
                    let added=false;
                    if(!await this.visible('accessibility id','fbreels-description-expand')&&!await this.visible('accessibility id','fbreels-description-collapse')){await this.addMissingCaption(input);added=true;}
                    if (!await this.visible('accessibility id','fbreels-description-expand')) await this.tapElement('accessibility id','fbreels-description-collapse','Expand Reel caption',10_000);
                    const caption=await this.read('accessibility id','fbreels-description-expand','label','Facebook caption');
                    if(!sameCaptionAroundMentions(input.caption,caption))throw new Error('Facebook Reel matched by cover, but its caption differs; not edited');
                    if (!keepOpen) await this.tapElement('accessibility id','back-button','Leave Facebook Reel');
                    return {verified:true,source:'facebook_app',evidence:`Cover matched frame zero (difference ${best.score.toFixed(3)}) and exact full caption matched on Antonio Revenue > Reels${added?'; the missing caption was added':''}`,checkedAt:new Date().toISOString()};
                }
            }
            for(const name of [...new Set(tiles.map(n=>n.name))]) {
                if(seen.has(name))continue;seen.add(name);
                await this.tapElement('accessibility id',name,'Facebook Reel');
                await this.sleep(1200);
                if(!await this.visible('accessibility id','fbreels-description-expand')&&!await this.visible('accessibility id','fbreels-description-collapse')){await this.tapElement('accessibility id','back-button','Back to Facebook Page');continue;}
                if (!await this.visible('accessibility id','fbreels-description-expand')) await this.tapElement('accessibility id','fbreels-description-collapse','Expand Reel caption',10_000);
                const caption=await this.read('accessibility id','fbreels-description-expand','label','Facebook caption');
                if(sameCaptionAroundMentions(input.caption,caption)) {
                    const receipt={verified:true,source:'facebook_app',evidence:'Exact full caption matched in the Facebook app on Antonio Revenue > Reels',checkedAt:new Date().toISOString()};
                    if (!keepOpen) await this.tapElement('accessibility id','back-button','Leave Facebook Reel');
                    return receipt;
                }
                await this.tapElement('accessibility id','back-button','Back to Facebook Page');
            }
            await this.scroll();
        }
        throw new Error('Matching Reel not found in Facebook; linked sharing alone is not delivery proof'+(linkError?` (link: ${linkError})`:''));
    }
    private async scroll(){await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:790,toX:215,toY:290,duration:0.15});await this.sleep(600);}
}
