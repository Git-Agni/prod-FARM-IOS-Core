import type {DirectMediaStore} from './direct-media.js';
import { exactOwnReelCaption, ownReelViewer, visibleNativeNodes } from './native-xml.js';
import type {CommentResult} from './post-comments.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PostingInput } from './model.js';
import {ReceiptVerificationError, type ReleaseDriver, type ReleaseEvidence} from './release-policy.js';
import { FacebookVerifier } from './facebook-verify.js';
import { WdaApp, parseGalleryCell } from './wda-app.js';
import {locateRelatedCover,locateRelatedCoverInCells,locateHeadlineInCells,reelByUrl,reviewedRelatedReel} from './instagram-related.js';
import {metaReceipts} from './meta-receipts.js';
import {assertRelatedReelInCatalog} from './related-autolink.js';
import {DEFAULT_INSTAGRAM_ACCOUNT,isSecondaryAccount,postingAccountFor} from './posting-accounts.js';

const run = promisify(execFile);
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export interface ReleaseMedia { path: string; name: string; mimeType: string; sha256: string }

/**
 * Posts one Instagram Trial Reel (with native linked Facebook sharing when requested) on the iPhone 15 Pro Max.
 * Mapped live on 2026-09-29. The only public action is `shareOnce`, which taps Share exactly once; everything before
 * it is preflight evidence and everything after it is read-only verification plus the first comment and pin.
 */
export class InstagramRelease extends WdaApp implements ReleaseDriver {
    private fromCreateTrialReel = false;
    /** When the one Share tap happened; receipts only count posts created after it (minus 10 minutes of clock skew). */
    private sharedAt = 0;
    constructor(base:string,signal:AbortSignal,private imports?:DirectMediaStore){super(base,signal);}
    protected override async tapElement(using:string,value:string,what:string,ms=20_000) {
        if(using!=='accessibility id'||!['profile-tab','back-button','BackButton','more-options-button','Edit cover'].includes(value))
            return super.tapElement(using,value,what,ms);
        const r=value==='Edit cover'
            ? await this.rect('predicate string','type == "XCUIElementTypeButton" AND name == "Edit cover" AND visible == 1',what)
            : await this.rect(using,value,what);
        if(r.x<0||r.y<45||r.x+r.width>431||r.y+r.height>925)throw Error('Instagram navigation control is outside the screen');
        await this.tapPoint(r.x+r.width/2,r.y+r.height/2);
        await this.sleep(1000);
    }

    /** Run after receipt and comment checks, including failures. Does not change the post. */
    async leaveVideo(): Promise<void> {
        // Oct 11 20:44: a comment job left the comment menu (Unpin / Add to story / Delete) and keyboard open, and the
        // next Instagram post stopped on that unknown screen. Close the menu by tapping the video above it; never tap Delete.
        try {
            for (let n = 0; n < 3; n++) {
                const menu = this.session && await this.visible('predicate string', 'label == "Delete" AND visible == 1')
                    && await this.visible('predicate string', 'label == "Add to story" AND visible == 1');
                if (!menu) break;
                await this.tapPoint(215, 130); await this.sleep(700);
            }
        } catch { /* best effort; Home below still runs */ }
        // Oct 30: after a release for another account, leave the app on @antoniorevenue again (Stories, comments and
        // the next release expect it). Runs on success and failure; a failed switch stops here for review.
        let switchBack: unknown;
        if (this.input && isSecondaryAccount(this.input)) {
            try { await this.switchInstagramAccount(DEFAULT_INSTAGRAM_ACCOUNT); }
            catch (e) { switchBack = e; }
        }
        // Cleanup must still run when the posting signal was cancelled.
        const response = await fetch(this.base + '/wda/homescreen', {
            method: 'POST', headers: {'content-type':'application/json'}, body:'{}',
            signal: AbortSignal.timeout(15_000),
        });
        const result = await response.json() as any;
        if (!response.ok || result.value?.error) throw new Error('Could not leave the Reel; check the phone');
        if (switchBack) throw new Error(`Instagram was not switched back to @${DEFAULT_INSTAGRAM_ACCOUNT}: ${switchBack instanceof Error ? switchBack.message : String(switchBack)}`);
    }
    /** Make `expected` the active Instagram account through the native switcher and read it back. Nothing is posted.
     * Oct 22: the app was left on @antoniomonteiroai and two releases failed; preflight now switches before checking. */
    async switchInstagramAccount(expected: string, launch = true): Promise<string> {
        if (launch) { await this.start('com.burbn.instagram'); await this.sleep(1500); await this.tapElement('accessibility id', 'profile-tab', 'Profile tab'); }
        let account = (await this.read('accessibility id', 'user-switch-title-button', 'label', 'active account')).replace(/^@/, '');
        if (account !== expected) {
            this.evidence.accountSwitchedFrom = account;
            await this.tapElement('accessibility id', 'user-switch-title-button', 'account switcher');
            await this.tapElement('predicate string', `label BEGINSWITH 'INSTAGRAM profile, ${expected}'`, `${expected} in the account switcher`);
            await new Promise(r => setTimeout(r, 3000));
            await this.tapElement('accessibility id', 'profile-tab', 'Profile tab');
            account = (await this.read('accessibility id', 'user-switch-title-button', 'label', 'active account')).replace(/^@/, '');
        }
        if (account !== expected) throw new Error(`Active Instagram account is ${account}, expected ${expected}`);
        return account;
    }
    protected input?: PostingInput;
    protected mediaPath?: string;
    evidence: Record<string, unknown> = {};

    async preflight(input: PostingInput, mediaValue: unknown): Promise<ReleaseEvidence> {
        const media = mediaValue as ReleaseMedia;
        this.input = input;
        this.mediaPath = media.path;
        this.fromCreateTrialReel = false;
        const ig = input.targets.find(t => t.platform === 'instagram');
        if (!ig) throw new Error('This release needs an Instagram target');
        postingAccountFor(input);
        assertRelatedReelInCatalog(input);
        const facebook = input.targets.some(t => t.platform === 'facebook');
        if (facebook && input.facebookMode !== 'linked_from_instagram') throw new Error('Only native linked Facebook sharing is supported');

        const bytes = await readFile(media.path);
        if (createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('Video changed since the calendar item was saved');
        const seconds = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', media.path])).stdout.trim());
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Could not read the video length');

        await this.start('com.burbn.instagram');
        await this.requireProfileForNewComposer();
        await this.tapElement('accessibility id', 'profile-tab', 'Profile tab');
        const expected = ig.account.replace(/^@/, '');
        const account = await this.switchInstagramAccount(expected, false);

        if(!this.imports)throw Error('A persistent native import journal is required');
        const imported={value:await this.imports.ensure(input.deviceUdid,media,this.base,this.signal)};
        if (!imported.value?.localIdentifier) throw new Error('The phone did not return a media import ID');

        if (input.instagramTrial) {
            // Oct 10 (Antonio): the share screen no longer offers the Trial switch. Trial Reels start from
            // Profile > Reels > Trial reels > "Create trial reel", which opens the same New reel gallery.
            await this.openTrialReelsGrid();
            await this.tapElement('predicate string', 'type == "XCUIElementTypeButton" AND label == "Create trial reel" AND visible == 1', 'Create trial reel');
            this.fromCreateTrialReel = true;
            await this.sleep(1200);
            await this.dismissTrialIntro();
        } else {
            await this.tapElement('accessibility id', 'profile-add-button', 'Create button');
            await this.tapElement('accessibility id', 'creation-reel', 'Create Reel');
        }
        // Never overwrite a draft that is not bound to this source.
        await this.requireNoDraftPrompt();
        return this.completeGallery(input,media,imported.value,seconds,account);
    }

    /** Resume the inspected empty gallery without importing or opening Create again. */
    async completeGallery(input:PostingInput,media:ReleaseMedia,imported:{localIdentifier:string;albumName:string},seconds:number,account:string):Promise<ReleaseEvidence>{
        this.input=input;
        const facebook=input.targets.some(t=>t.platform==='facebook');
        if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256
            ||imported.albumName!=='PF-'+media.sha256.slice(0,12)
            ||account!==input.targets.find(t=>t.platform==='instagram')?.account.replace(/^@/,''))throw Error('Gallery source or account changed');
        await this.waitFor('accessibility id','gallery-header-title','New Reel gallery');
        if(await this.read('accessibility id','gallery-header-title','label','Gallery title')!=='New reel')throw Error('Unknown gallery');
        // Single-select mode: tapping one cell opens the editor with exactly that clip.
        const multi = await this.visible('accessibility id', 'multi-select');
        if (multi && (await this.read('accessibility id', 'multi-select', 'label', 'selection mode')) === 'Cancel') await this.tapElement('accessibility id', 'multi-select', 'single-select mode');
        await this.selectUploadAlbum(imported.albumName);
        const cellLabel = await this.read('accessibility id','gallery-video-cell-0','label','Exact album video');
        const cell=parseGalleryCell(cellLabel);
        // Oct 17: the label read 0:54 for a 55.02 s clip (the tile showed 0:55). Allow one second of rounding either way.
        if(!cell||Math.abs(cell.seconds-Math.floor(seconds))>1||await this.visible('accessibility id','gallery-video-cell-1'))throw Error('Dedicated Instagram album does not contain the exact single clip');
        await this.tapElement('accessibility id','gallery-video-cell-0','Exact imported video');
        // Instagram can keep multi-select on: the tap only selects the clip and shows a gallery Next bar.
        // Continue through it only when exactly that one clip is selected.
        for (const deadline = Date.now() + 15_000; Date.now() < deadline; await this.sleep(500)) {
            if (await this.visible('accessibility id', 'sundial-right-chevron-next-button')) break;
            if (!await this.visible('accessibility id', 'reels-gallery-selection-next')) continue;
            const selected = (await this.request(this.session + '/elements', { using: 'predicate string', value: 'label BEGINSWITH "Selected video thumbnail" AND visible == 1' })).value;
            if (selected.length !== 1 || await this.visible('accessibility id', 'selection-badge-2')) throw Error('Instagram selected more than the exact clip; nothing was shared');
            await this.tapElement('accessibility id', 'reels-gallery-selection-next', 'Gallery selection Next');
            break;
        }
        await this.tapElement('accessibility id', 'sundial-right-chevron-next-button', 'editor Next', 30_000);

        await this.waitFor('accessibility id', 'caption-cell-text-view', 'caption field', 30_000);
        const captionId = await this.waitFor('accessibility id', 'caption-cell-text-view', 'caption field');
        await this.request(`${this.session}/element/${captionId}/value`, { value: [input.caption] });
        if ((await this.read('accessibility id', 'caption-cell-text-view', 'value', 'caption')) !== input.caption) throw new Error('Caption readback does not match');
        await this.tapElement('accessibility id', 'OK', 'caption OK');
        if ((await this.read('accessibility id', 'caption-cell-text-view', 'value', 'caption')) !== input.caption) throw new Error('Caption changed when the editor closed');

        return this.completeSettings(input,media,imported,seconds,account,cellLabel);
    }

    /** Scroll the composer back to the caption, read it, and retype it once if Instagram dropped it. */
    async ensureCaptionBeforeShare(caption: string): Promise<'kept' | 'restored'> {
        for (let n = 0; n < 4 && !await this.visible('accessibility id', 'caption-cell-text-view'); n++) {
            await this.assertInputApp();
            await this.request(this.session + '/wda/dragfromtoforduration', { fromX: 215, fromY: 300, toX: 215, toY: 780, duration: 0.3 });
            await this.sleep(500);
        }
        if (await this.read('accessibility id', 'caption-cell-text-view', 'value', 'caption before Share') === caption) return 'kept';
        const id = await this.waitFor('accessibility id', 'caption-cell-text-view', 'caption field');
        await this.request(`${this.session}/element/${id}/clear`, {}).catch(() => undefined);
        await this.request(`${this.session}/element/${id}/value`, { value: [caption] });
        if (await this.visible('accessibility id', 'OK')) await this.tapElement('accessibility id', 'OK', 'caption OK');
        await this.sleep(800);
        if (await this.read('accessibility id', 'caption-cell-text-view', 'value', 'restored caption') !== caption) throw new Error('Caption was empty before Share and could not be restored; nothing was shared');
        return 'restored';
    }

    async completeSettings(input:PostingInput,media:ReleaseMedia,imported:{localIdentifier:string;albumName:string},seconds:number,account:string,cellLabel:string):Promise<ReleaseEvidence>{
        this.input=input;
        const facebook=input.targets.some(t=>t.platform==='facebook');
        if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256||imported.albumName!=='PF-'+media.sha256.slice(0,12))throw Error('Prepared Instagram source changed');
        const relatedReel = input.instagramRelatedReel ? await this.selectRelatedReel(input.instagramRelatedReel) : undefined;
        for(let n=0;n<2&&!await this.visible('accessibility id','caption-cell-text-view');n++){
            await this.assertInputApp();
            await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:300,toX:215,toY:780,duration:0.3});
        }
        if(await this.read('accessibility id','caption-cell-text-view','value','Prepared caption')!==input.caption)throw Error('Prepared Instagram caption changed');
        const cover = await this.reviewOpeningCover();

        // Locate the row before changing it; Instagram can shift the composer layout.
        for (let i = 0; i < 4 && !(await this.visible('predicate string', 'type == "XCUIElementTypeSwitch" AND name CONTAINS ", Add AI Label," AND visible == 1')); i++) {
            // Oct 13: the 0.15 s flick from y=780 no longer scrolls the Trial composer; a 0.4 s drag from y=700 does.
            await this.request(this.session + '/wda/dragfromtoforduration', { fromX: 215, fromY: 700, toX: 215, toY: 250, duration: 0.4 });
            await this.sleep(700);
        }
        await this.ensureSwitch('Add AI Label', false, async () => {
            const row = await this.rect('predicate string', 'type == "XCUIElementTypeSwitch" AND name CONTAINS ", Add AI Label," AND visible == 1', 'AI label row');
            await this.tapPoint(382, row.y + 29);   // the toggle sits at the row's right edge; the row itself ignores taps
        });
        let automaticPromotion = false, trialEntry: 'share_switch' | 'create_trial_reel' | undefined;
        // Oct 10 21:55: a Reel started from Create trial reel went out as a regular Reel (top of the main Reels grid,
        // is_shared_to_feed true). Never treat the entry point as Trial evidence; Trial needs the visible switch.
        // Oct 11 (Antonio): Trial is unavailable, post regular Reels. With Trial off, a missing switch already means regular.
        if (!input.instagramTrial && !await this.visible('accessibility id', 'trial-switch')) { /* regular Reel */ }
        else {
            await this.ensureSwitch('Trial', input.instagramTrial, () => this.tapElement('accessibility id', 'trial-switch', 'Trial switch'));
            if (input.instagramTrial) { automaticPromotion = await this.ensureAutomaticPromotion(); trialEntry = 'share_switch'; }
        }

        await this.tapElement('predicate string', 'type == "XCUIElementTypeCell" AND name BEGINSWITH "Also share on…," AND visible == 1', 'Also share on');
        const page = postingAccountFor(input);
        const facebookOn = !!(await this.visible('predicate string', `label == "${page.facebookComposerLabel}" AND visible == 1`));
        // Name what the phone showed, so a new account's row can be mapped without guessing (Oct 30).
        const facebookRows = facebook === facebookOn ? [] : [...new Set(visibleNativeNodes((await this.request(this.session + '/source')).value)
            .map(n => n.label).filter(l => /Facebook/.test(l ?? '')))].slice(0, 6);
        await this.tapElement('accessibility id', 'BackButton', 'back to composer');
        if (facebook !== facebookOn) throw new Error((facebook ? `${page.facebookComposerLabel.split(',')[0]} Facebook sharing is not on` : 'Facebook sharing is on but this item has no Facebook target') + (facebookRows.length ? `; rows: ${facebookRows.join(' | ')}` : ''));

        // Oct 23 (Antonio: "none of the posts are going out with captions"): eight Reels from 12 PM to 7 PM shared
        // with an empty caption although the caption read back right after typing. A later composer step now clears it,
        // so read the caption again just before Share and type it back once when it is missing or different.
        const captionBeforeShare = await this.ensureCaptionBeforeShare(input.caption);
        const shareLabel = await this.read('accessibility id', 'share-sheet-share-button', 'label', 'Share button');
        if (shareLabel !== 'Share') throw new Error(`Unexpected final button: ${shareLabel}`);
        this.evidence = { account, importedMediaId: imported.localIdentifier, galleryCell: cellLabel, seconds, cover, aiLabel: false, facebookOn, captionBeforeShare, checkedAt: new Date().toISOString() };
        return { exactMedia: true, videoFrameCover: true, caption: true, account: true, automaticPromotion, linkedFacebook: facebookOn, ...(trialEntry?{trialEntry}:{}), ...(relatedReel?{relatedReel}:{}) };
    }

    /** Select the source-specific album; never infer the source from newest media. */
    protected async selectUploadAlbum(albumName:string){
        if(!/^PF-[a-f0-9]{12}$/.test(albumName))throw Error('Exact Instagram upload album is missing');
        if(!await this.visible('accessibility id','menu-item-All albums'))await this.tapElement('predicate string','type == "XCUIElementTypeCell" AND name BEGINSWITH "Gallery Selection," AND visible == 1','Upload album menu');
        await this.tapElement('accessibility id','menu-item-All albums','All source albums');
        const rows=(await this.request(this.session+'/elements',{using:'accessibility id',value:albumName})).value;
        // Oct 17 (iOS 27): the All albums row loads lazily, so an album imported a day earlier may not be in the tree.
        // Search for the exact PF- name instead, as the Story driver does (a4d2734); no result means it is not on the phone.
        if(rows.length===0)return this.searchUploadAlbum(albumName);
        if(rows.length!==1)throw Error('Exact Instagram album is missing or ambiguous; no fallback to Recents');
        const id=this.id(rows[0]);
        if(!(await this.request(this.session+'/element/'+id+'/displayed')).value)await this.request(this.session+'/wda/element/'+id+'/scrollTo',{},30000);
        let r=(await this.request(this.session+'/element/'+id+'/rect')).value;
        // Oct 11 (iOS 27): scrollTo left the album below the fold once each queued video got its own album. Swipe toward it.
        // Instagram's iOS 27 picker shows Albums as a sideways row: swipe that row (on the tile above the label) as well.
        for(let n=0;n<30&&(r.y<100||r.y+r.height>880||r.x<0||r.x+r.width>430);n++){
            if(r.y<100||r.y+r.height>880){
                const down=r.y+r.height>880;
                await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:down?760:300,toX:215,toY:down?360:700,duration:0.3});
            }else{
                const left=r.x+r.width>430,rowY=Math.max(120,r.y-60);
                await this.request(this.session+'/wda/dragfromtoforduration',{fromX:left?380:60,fromY:rowY,toX:left?160:280,toY:rowY,duration:0.3});
            }
            await this.sleep(600);r=(await this.request(this.session+'/element/'+id+'/rect')).value;
        }
        if(r.y<100||r.y+r.height>880||r.x<0||r.x+r.width>430)throw Error('Instagram source album is outside the visible list');
        await this.tapPoint(r.x+r.width/2,r.y+r.height/2);
        await this.waitFor('predicate string','type == "XCUIElementTypeCell" AND name == "Gallery Selection, '+albumName+' selected" AND visible == 1','Selected source album');
    }

    private async searchUploadAlbum(albumName:string){
        await this.tapElement('predicate string','(label == "Search" OR name == "Search") AND visible == 1','Album search',15_000);
        const field=await this.waitFor('accessibility id','search-text-input','Album search field',15_000);
        await this.request(`${this.session}/element/${field}/value`,{value:[albumName]});
        const cell=`type == "XCUIElementTypeCell" AND name BEGINSWITH "${albumName}, " AND visible == 1`;
        await this.waitFor('predicate string',cell,'Album search result',10_000).catch(()=>undefined);
        const hits=(await this.request(this.session+'/elements',{using:'predicate string',value:cell})).value as unknown[];
        if(hits.length===0)throw Error('Exact Instagram album is not on the phone (album search found nothing); no fallback to Recents');
        const names=await Promise.all(hits.map(async h=>String((await this.request(this.session+'/element/'+this.id(h as any)+'/attribute/name')).value)));
        if(names.some(n=>n!==`${albumName}, 1 items`&&n!==`${albumName}, 1 item`))throw Error('Exact Instagram album is ambiguous; no fallback to Recents');
        const r=(await this.request(this.session+'/element/'+this.id(hits[0] as any)+'/rect')).value;
        await this.tapPoint(r.x+r.width/2,r.y+Math.min(r.height/2,100));
        await this.waitFor('predicate string','type == "XCUIElementTypeCell" AND name == "Gallery Selection, '+albumName+' selected" AND visible == 1','Selected source album',15_000);
    }

    protected async selectRelatedReel(related:NonNullable<PostingInput['instagramRelatedReel']>) {
        if(!await this.visible('accessibility id','Select a reel')){
            if(!await this.visible('accessibility id','share-sheet-share-button'))throw Error('Instagram composer is no longer open; no scrolling sent');
            for(let n=0;n<3&&!(await this.visible('accessibility id','Link a reel'));n++)await this.swipeUp();
            await this.tapElement('accessibility id','Link a reel','Related Reel');
        }
        await this.waitFor('accessibility id','Select a reel','Owned Reel picker');
        const found=await this.findRelatedTile(related);
        await this.tapPoint(found.x,found.y);
        await this.waitFor('accessibility id','Edit linked reel','Link title');
        const rows=(await this.request(this.session+'/elements',{using:'class name',value:'XCUIElementTypeTextField'})).value;
        if(rows.length!==1)throw Error('Related Reel title is ambiguous');
        await this.assertInputApp();
        await this.request(this.session+'/element/'+this.id(rows[0])+'/value',{value:[related.label]});
        await this.tapElement('accessibility id','OK','Save related Reel');
        await this.tapElement('accessibility id','Link a reel','Read saved related Reel');
        if(await this.read('class name','XCUIElementTypeTextField','value','Saved link title')!==related.label)throw Error('Related Reel label did not save');
        await this.tapElement('accessibility id','OK','Return to composer');
        return {url:related.url,label:related.label,verified:true};
    }

    /** Find the related Reel's tile in the open "Select a reel" picker; returns the point to tap. The reviewed default
     * Reel is matched by its saved cover image; every other Reel by its cover headline (instagram-reels.json), read
     * with OCR, because the tiles have no accessibility text. Scrolls down page by page, at most 12 times. No match,
     * or a headline on two tiles, throws before any tile is tapped. */
    protected async findRelatedTile(related:NonNullable<PostingInput['instagramRelatedReel']>):Promise<{x:number;y:number}> {
        const cellsNow=async()=>visibleNativeNodes((await this.request(this.session+'/source')).value).filter(n=>n.type==='XCUIElementTypeCell'&&n.width>=130&&n.width<=150&&n.height>=240);
        const shot=async()=>Buffer.from((await this.request('/screenshot')).value,'base64');
        if(related.url===reviewedRelatedReel){
            // The heading appears before the grid finishes loading. Re-read once,
            // without touching the grid, if its cover is not yet identifiable.
            // Thumbnails can take several seconds to render (blank grid seen Oct 7 13:25). Re-read without touching the grid.
            for(let attempt=0;;attempt++){
                try{return await locateRelatedCover(await shot(),related);}
                catch(e){
                    // After the grid has had time to load, look at the real cells and scroll down page by page.
                    if(attempt>=3){
                        try{return await locateRelatedCoverInCells(await shot(),await cellsNow(),related);}catch{}
                        if(attempt>=12)throw e;
                        await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:760,toX:215,toY:360,duration:0.3});
                    }
                    await this.sleep(1500);
                }
            }
        }
        const reel=reelByUrl(related.url);
        if(!reel?.headline||reel.caption!==related.caption||reel.label!==related.label)throw Error('This related Reel is not in the Reel catalog with a cover headline; no Reel selected');
        await this.sleep(3000);   // thumbnails render a few seconds after the heading
        for(let page=0;;page++){
            const png=await shot(),{found,scores}=await locateHeadlineInCells(png,await cellsNow(),reel.headline);
            await this.pickerPage(png,page,scores.map(s=>({...s.cell,score:s.score,text:s.text})));
            if(found)return found;
            if(page>=12)throw Error('Related Reel headline was not found in the picker; no Reel selected');
            await this.assertInputApp();
            await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:760,toX:215,toY:360,duration:0.3});
            await this.sleep(1500);
        }
    }

    /** Each picker page OCR read; attended calibration saves them as evidence. */
    protected async pickerPage(_png:Buffer,_page:number,_tiles:unknown[]):Promise<void>{}

    protected async verifyRelatedReel(receipts:Record<string,{verified:boolean;evidence:string}>) {
        const related=this.input?.instagramRelatedReel;
        if(!related)return;
        const visible=visibleNativeNodes((await this.request(this.session+'/source')).value);
        if(!visible.some(n=>n.name==='organic-cta-button')) {
            // The owner Trial viewer can omit the Watch button. Read the saved
            // link setting without changing it and keep that limit in the receipt.
            await this.tapElement('accessibility id','more-options-button','Read saved related Reel');
            // Oct 8: the first Hormozi Reel posted with no link. A published Reel offers "Link a reel" when none is
            // saved; add it there (the same picker as the composer), then read it back below.
            if(await this.visible('predicate string','label == "Link a reel" AND visible == 1')){
                await this.tapElement('predicate string','label == "Link a reel" AND visible == 1','Add missing related Reel');
                await this.waitFor('accessibility id','Select a reel','Owned Reel picker');
                const found=await this.findRelatedTile(related);
                await this.tapPoint(found.x,found.y);
                await this.waitFor('accessibility id','Edit linked reel','Link title');
                const rows=(await this.request(this.session+'/elements',{using:'class name',value:'XCUIElementTypeTextField'})).value;
                if(rows.length!==1)throw Error('Related Reel title is ambiguous');
                await this.request(this.session+'/element/'+this.id(rows[0])+'/value',{value:[related.label]});
                await this.tapElement('accessibility id','OK','Save related Reel');
                await this.sleep(2000);
                receipts.instagram!.evidence+='; related Reel was missing on the live post and was added from its menu';
                await this.tapElement('accessibility id','more-options-button','Read saved related Reel');
            }
            await this.tapElement('predicate string','label == "Edit linked reel" AND visible == 1','Saved related Reel');
            const label=await this.read('class name','XCUIElementTypeTextField','value','Saved related Reel title');
            await this.tapElement('accessibility id','Cancel','Leave saved link unchanged');
            if(label!==related.label)throw Error('Published saved related Reel label does not match');
            receipts.instagram!.evidence+='; saved related-Reel title matched '+related.label+'; Watch button visibility was not verified in the owner Trial view';
            return;
        }
        if(await this.read('accessibility id','organic-cta-button','label','Published related Reel')!=='Watch · '+related.label)throw Error('Published related Reel label does not match');
        await this.tapElement('accessibility id','organic-cta-button','Open published related Reel');
        await this.sleep(1200);
        if(!exactOwnReelCaption((await this.request(this.session+'/source')).value,related.caption,this.input!.targets.find(t=>t.platform==='instagram')!.account))throw Error('Published related Reel opens the wrong post');
        await this.tapElement('accessibility id','back-button','Return to published Reel');
        receipts.instagram!.evidence+='; Watch link opened the exact owned related Reel';
    }

    protected async requireProfileForNewComposer() {
        for (const name of ['caption-cell-text-view', 'camera-discard-draft', 'discard-reel-preview', 'gallery-close-button', 'Continue editing your draft?']) {
            if (await this.visible('accessibility id', name))
                throw new Error('Instagram has an existing draft or gallery; it was left unchanged');
        }
        // The last verified pin can leave an empty comment drawer open.
        // Never dismiss typed text or an unsent Reel draft.
        if(await this.visible('accessibility id','text-view')) {
            if(await this.read('accessibility id','text-view','label','Comment editor')!=='Add a comment'
                ||(await this.read('accessibility id','text-view','value','Comment text')).trim())
                throw Error('Instagram has unsent comment text; it was left unchanged');
            const dismiss=visibleNativeNodes((await this.request(this.session+'/source')).value)
                .filter(n=>n.type==='XCUIElementTypeButton'&&n.label==='Dismiss');
            if(dismiss.length!==1||dismiss[0]!.y<100||dismiss[0]!.y>800)throw Error('Comment drawer is unknown; it was left unchanged');
            const r=dismiss[0]!;await this.tapPoint(r.x+r.width/2,r.y+r.height/2);await this.sleep(700);
        }
        if(await this.visible('accessibility id','back-button')) {
            const account=this.input?.targets.find(t=>t.platform==='instagram')?.account;
            if(account&&ownReelViewer((await this.request(this.session+'/source')).value,account))
                await this.tapElement('accessibility id','back-button','Leave owned Reel');
        }
        if(await this.visible('accessibility id','BackButton')&&await this.visible('accessibility id','Trial reels'))
            await this.tapElement('accessibility id','BackButton','Leave Trial grid');
        if (!(await this.visible('accessibility id', 'profile-tab')))
            throw new Error('Instagram has an existing draft or an unknown screen; it was left unchanged');
    }

    protected async requireNoDraftPrompt() {
        // "Continue editing your draft?" appears a moment after Create (Oct 7 13:36). Start new video keeps the
        // saved draft in Drafts and opens a fresh gallery. A discard prompt still stops the run.
        for (let n = 0; n < 8; n++) {
            if (await this.visible('accessibility id', 'camera-discard-draft')) throw new Error('An existing Instagram draft needs review; it was not discarded');
            if (await this.visible('accessibility id', 'Continue editing your draft?')) {
                await this.tapElement('predicate string', 'label == "Start new video" AND visible == 1', 'Start new video (draft kept)');
                await this.sleep(800); continue;
            }
            if (await this.visible('accessibility id', 'gallery-header-title')) return;
            await this.sleep(500);
        }
    }

    protected async reviewOpeningCover() {
        await this.tapElement('accessibility id', 'Edit cover', 'Edit cover');
        let frame = await this.rect('accessibility id', 'Selected frame', 'Selected cover frame');
        const mapped = (r:typeof frame) => r.x >= 0 && r.x + r.width <= 430
            && r.width >= 40 && r.width <= 65 && r.y >= 700 && r.y + r.height <= 850
            && r.height >= 60 && r.height <= 90;
        if (!mapped(frame)) throw new Error('Instagram cover controls moved; review them before posting');
        const selectionMoved = frame.x > 12;
        if (selectionMoved) {
            await this.assertInputApp();
            await this.request(this.session + '/wda/dragfromtoforduration', {
                fromX:frame.x + frame.width / 2, fromY:frame.y + frame.height / 2,
                toX:1, toY:frame.y + frame.height / 2, duration:0.5,
            });
            frame = await this.rect('accessibility id', 'Selected frame', 'Opening cover frame');
        }
        if (!mapped(frame) || frame.x > 12)
            throw new Error('Instagram is not using the opening cover frame; review it before posting');
        await this.tapElement('accessibility id', 'done-button', 'Save opening cover');
        return {openingFrame:true,selectedFrame:frame,selectionMoved};
    }

    private async switchOn(prefix: string): Promise<boolean> {
        const label = await this.read('predicate string', `type == "XCUIElementTypeSwitch" AND name CONTAINS ", ${prefix}," AND visible == 1`, 'name', `${prefix} switch`);
        if (label.startsWith('Checked, ')) return true;
        if (label.startsWith('Not checked, ')) return false;
        throw new Error(`${prefix} state cannot be read`);
    }
    private async ensureSwitch(prefix: string, wanted: boolean, toggle: () => Promise<void>) {
        if (await this.switchOn(prefix) !== wanted) { await toggle(); await this.sleep(1200); }
        if (await this.switchOn(prefix) !== wanted) throw new Error(`${prefix} did not turn ${wanted ? 'on' : 'off'}`);
    }
    private async ensureAutomaticPromotion(): Promise<boolean> {
        const row = await this.rect('predicate string', 'type == "XCUIElementTypeSwitch" AND name BEGINSWITH "Checked, Trial," AND visible == 1', 'Trial row');
        if (row.x !== 0 || row.width !== 430 || row.height < 100 || row.y < 100 || row.y > 700) throw new Error('Trial settings link needs calibration for this layout');
        await this.tapPoint(200, row.y + row.height - 21);   // the inline "trial settings" link has no accessibility ID
        await this.waitFor('predicate string', 'label == "Trial settings" AND visible == 1', 'Trial settings');
        const state = async () => (await this.read('predicate string', 'type == "XCUIElementTypeSwitch" AND name ENDSWITH "Share to everyone automatically" AND visible == 1', 'name', 'automatic promotion')).startsWith('Checked, ');
        if (!await state()) { await this.tapElement('accessibility id', 'igds-switch', 'automatic promotion switch'); await this.sleep(1000); }
        const on = await state();
        await this.tapElement('accessibility id', 'Done', 'Trial settings Done');
        if (!on) throw new Error('Automatic promotion did not turn on');
        return true;
    }

    /** Leave the composer without posting or saving a draft (dry runs and failed preflights). */
    async abandon(): Promise<void> {
        for (let step = 0; step < 6; step++) {
            if (await this.visible('accessibility id', 'camera-discard-draft')) { await this.tapElement('accessibility id', 'camera-discard-draft', 'Start over'); continue; }
            if (await this.visible('accessibility id', 'discard-reel-preview')) { await this.tapElement('accessibility id', 'discard-reel-preview', 'discard reel'); await this.sleep(1200); continue; }
            if (await this.visible('accessibility id', 'gallery-close-button')) { await this.tapElement('accessibility id', 'gallery-close-button', 'close gallery'); await this.sleep(1200); continue; }
            if (await this.visible('accessibility id', 'Done')) { await this.tapElement('accessibility id', 'Done', 'Done'); continue; }
            if (await this.visible('accessibility id', 'BackButton')) { await this.tapElement('accessibility id', 'BackButton', 'Back'); await this.sleep(1200); continue; }
            return;
        }
    }

    async shareOnce(): Promise<void> {
        // Exactly one tap. Callers claim the release before this and never call it twice.
        const id = await this.waitFor('accessibility id', 'share-sheet-share-button', 'Share button');
        await this.assertInputApp();
        this.sharedAt = Date.now();
        const r = await this.raw(`${this.session}/element/${id}/click`, {});
        if (!r.ok || r.body.value?.error) throw new Error(`Share tap result is uncertain: ${r.body.value?.error ?? r.status}`);
        // Oct 23 diagnosis of empty captions: keep what the phone showed just after Share. Read-only; no taps.
        for (const wait of [1500, 6000]) {
            await this.sleep(wait);
            try {
                const png = (await this.request('/screenshot')).value as string;
                const dir = path.resolve('.scheduler-data/share-shots'); await mkdir(dir, { recursive: true });
                await writeFile(path.join(dir, `${new Date(this.sharedAt).toISOString().replace(/[:.]/g, '-')}-${wait}.png`), Buffer.from(png, 'base64'));
            } catch { /* evidence only */ }
        }
    }

    /** Close known Instagram promo sheets (e.g. Meta Verified) that cover the tab bar. Never taps the promo action. */
    protected async dismissPromoSheets() {
        for (let n = 0; n < 3; n++) {
            const notNow = await this.visible('predicate string', 'label == "Not now" AND visible == 1');
            if (notNow) { await this.tapElement('predicate string', 'label == "Not now" AND visible == 1', 'Dismiss prompt'); await this.sleep(800); continue; }
            if (!await this.visible('predicate string', 'label == "Verify your profile" AND visible == 1')) return;
            await this.assertInputApp();
            // Verified live Oct 7: a tap on the dimmed area above the sheet closes it; a downward swipe did not.
            await this.tapPoint(215, 250);
            await this.sleep(1000);
        }
        if (await this.visible('predicate string', 'label == "Verify your profile" AND visible == 1')) throw new Error('An Instagram promo sheet would not close');
    }

    /** Find the new Trial Reel by caption on Profile > Reels > Trial reels, then read its native receipt labels. */
    async verify(timeoutMs = 8 * 60_000): Promise<Record<string, { url?: string; verified: boolean; evidence?: string }>> {
        const input = this.input!;
        const prefix = input.caption.trim().split('\n')[0].slice(0, 30).trim();
        const receipts:Record<string,{verified:boolean;evidence:string}>={};
        // One navigation pass. A delayed result stays in review for a later read-only check.
        await this.sleep(Math.min(timeoutMs, 15_000));
        // Prefer tap-free Graph receipts (Oct 7: in-app grids lagged or were covered by prompts).
        // Oct 8: Graph listed a 14:32 Reel just as a 3-minute wait ended. Allow 6 minutes.
        const graph = await this.graphReceipts(input, Math.min(timeoutMs, 6 * 60_000));
        if (graph) return graph;
        try {
                await this.dismissPromoSheets();
                if(!await this.hasExactCaption())await this.openMatchingTrialReel(prefix);
                if (!await this.hasExactCaption()) throw new Error('Trial Reel full caption does not match');
                await this.tapElement('accessibility id', 'more-options-button', 'More actions');
                await this.waitFor('predicate string', 'label == "This reel is a trial reel." AND visible == 1', 'trial reel label', 10_000);
                const shared = !!(await this.visible('predicate string', 'label == "Shared to Facebook"'));
                const ai = !!(await this.visible('predicate string', 'label == "AI content"'));
                await this.tapElement('predicate string', 'label == "Dismiss" AND visible == 1', 'close More');
                receipts.instagram = { verified: true, evidence: `Matching Trial Reel on @${postingAccountFor(input).instagram} starts "${prefix}"; native label "This reel is a trial reel."${ai ? '; AI content label' : ''}` };
                if (input.targets.some(t => t.platform === 'facebook')) {
                    if (!shared) throw new Error('Instagram has not confirmed linked Facebook sharing yet');
                    if (!postingAccountFor(input).facebookAppCheck) throw new Error('Facebook Page has no in-app check; waiting for its Graph receipt');
                    try {
                        // Confirm Facebook inside this run. Linked sharing can take a minute to appear on the Page,
                        // so look again up to three times, 60 seconds apart, before leaving it for a later check.
                        for (let attempt = 0; ; attempt++) {
                            try { receipts.facebook = await new FacebookVerifier(this.base, this.signal).verifyPost(input, false, this.mediaPath ? { mediaPath: this.mediaPath } : false); break; }
                            catch (e) {
                                if (attempt >= 3 || !/Matching Reel not found|Newest Facebook Reel was not reached/.test(e instanceof Error ? e.message : String(e))) throw e;
                                await this.sleep(60_000);
                            }
                        }
                    } finally {
                        // Return to the matching Instagram Reel for the approved pinned comment.
                        await this.start('com.burbn.instagram');
                        if(!await this.hasExactCaption())await this.openMatchingTrialReel(prefix);
                    }
                }
                await this.verifyRelatedReel(receipts);
                return receipts;
        } catch (error) {
            throw new ReceiptVerificationError('Instagram receipt needs review after one navigation pass: '+(error instanceof Error?error.message:String(error)),receipts);
        }
    }

    /** Resume receipt checks only. Never imports media, opens a composer or taps Share. */
    /** Graph confirmation for Instagram and linked Facebook. A Facebook Reel without its caption is repaired in the app. */
    protected async graphReceipts(input: PostingInput, waitMs: number) {
        if (!/^http:\/\/127\.0\.0\.1:/.test(this.base)) return undefined; // unit tests use fake hosts; no network there
        const facebook = input.targets.some(t => t.platform === 'facebook'), deadline = Date.now() + waitMs;
        let found: Awaited<ReturnType<typeof metaReceipts>> = {};
        for (;;) {
            try { found = await metaReceipts(input.caption, this.sharedAt ? this.sharedAt - 10 * 60_000 : 0, postingAccountFor(input)); } catch { return undefined; }
            if (found.instagram && (!facebook || found.facebook || found.facebookMissingCaption)) break;
            if (Date.now() >= deadline) return undefined;
            await this.sleep(20_000);
        }
        const receipts: Record<string, { verified: boolean; url?: string; evidence: string }> = { instagram: found.instagram! };
        // Oct 10: a "Trial" Reel went out as a regular Reel. Prove Trial after posting; never infer it from the path taken.
        if (input.instagramTrial && found.instagram!.sharedToFeed !== false)
            throw new ReceiptVerificationError(`Instagram posted, but not as a Trial Reel (is_shared_to_feed ${found.instagram!.sharedToFeed}); review ${found.instagram!.url}`, receipts);
        if (input.instagramTrial) receipts.instagram!.evidence += '; Trial confirmed (is_shared_to_feed false)';
        if (facebook && !found.facebook && !postingAccountFor(input).facebookAppCheck)
            throw new ReceiptVerificationError('Instagram verified; the Facebook Page has no in-app check, so its Graph receipt needs review', receipts);
        if (facebook) receipts.facebook = found.facebook ?? await new FacebookVerifier(this.base, this.signal).verifyPost(input, false, this.mediaPath ? { mediaPath: this.mediaPath } : false);
        // Best effort: open the new Reel so the in-run first comment can be pinned. If this fails, the comment job retries later.
        try {
            await this.start('com.burbn.instagram');
            if (!await this.hasExactCaption() && !await this.openByLink(found.instagram!.url)) await this.openMatchingTrialReel(input.caption.trim().split('\n')[0].slice(0, 30).trim());
            try { await this.verifyRelatedReel(receipts); }
            catch (e) { receipts.instagram!.evidence += '; related Reel NOT confirmed: ' + (e instanceof Error ? e.message : String(e)); }
        } catch {}
        return receipts;
    }

    async reconcile(input: PostingInput) {
        this.input = input;
        await this.start('com.burbn.instagram');
        return this.verify(60_000);
    }

    /** Oct 30: a first Trial Reel on @antoniomonteiroai shows one-time intro sheets ("Trial reels need more time to get
     * views", "Take a chance and try it anyway with trial reels"). Tap only their "Got it"; nothing else changes. */
    private async dismissTrialIntro() {
        for (let n = 0; n < 2; n++) {
            const intro = await this.visible('predicate string', '(label == "Trial reels need more time to get views" OR label BEGINSWITH "Take a chance and try it anyway") AND visible == 1');
            if (!intro) return;
            await this.tapElement('predicate string', 'type == "XCUIElementTypeButton" AND label == "Got it" AND visible == 1', 'Got it on the Trial reels intro');
            await this.sleep(1000);
        }
    }
    private async openTrialReelsGrid() {
        // Close a leftover own-comment context menu before looking for the profile tab.
        const labels=visibleNativeNodes((await this.request(this.session+'/source')).value).map(n=>n.label);
        if(labels.includes('Preview') && labels.some(l=>['Pin','Unpin','Delete','Reply with a reel'].includes(l))) {
            await this.tapPoint(400,150);
            await this.sleep(700);
        }
        // A retry may start inside a reel viewer or menu that hides the tab bar: back out first.
        for (let step = 0; step < 5 && !(await this.visible('accessibility id', 'profile-tab')); step++) {
            if (await this.visible('predicate string', 'label == "Dismiss" AND visible == 1')) await this.tapElement('predicate string', 'label == "Dismiss" AND visible == 1', 'Dismiss');
            else if (await this.visible('accessibility id', 'back-button')) await this.tapElement('accessibility id', 'back-button', 'Back');
            else if (await this.visible('accessibility id', 'BackButton')) await this.tapElement('accessibility id', 'BackButton', 'Back');
            await this.sleep(1200);
        }
        await this.tapElement('accessibility id', 'profile-tab', 'Profile tab');
        await this.sleep(1500);
        const expected = this.input?.targets.find(t => t.platform === 'instagram')?.account.replace(/^@/, '');
        if (expected && (await this.read('accessibility id', 'user-switch-title-button', 'label', 'active account')).replace(/^@/, '') !== expected)
            throw new Error('Receipt account does not match the scheduled account');
        // The current app labels the profile tabs, and groups trials under a cell named
        // open-drafts whose label is just Drafts. Read current geometry, not a four-way guess.
        const cells = async () => visibleNativeNodes((await this.request(this.session+'/source')).value)
            .filter(n=>n.type==='XCUIElementTypeCell');
        let rows=await cells();
        const reelsTab=()=>rows.find(n=>n.label==='Reels'&&n.y>=100&&n.y+n.height<830);
        if(!reelsTab()){
            await this.request(this.session+'/wda/dragfromtoforduration',
                {fromX:215,fromY:520,toX:215,toY:180,duration:0.3});
            await this.sleep(1200);rows=await cells();
        }
        const tab=reelsTab();
        if(!tab)throw new Error('The labeled profile Reels tab is not safely visible');
        await this.tapPoint(tab.x+tab.width/2,tab.y+tab.height/2);
        await this.sleep(1000);rows=await cells();
        // Wait for the new tab data without tapping the tab again.
        for(let read=0;read<4&&!rows.some(n=>n.label==='Trial reels'||n.name==='open-drafts'||n.label==='Drafts and trial reels');read++){
            await this.sleep(1000);rows=await cells();
        }
        let trial=rows.find(n=>n.label==='Trial reels');
        if(!trial){
            let entry=rows.find(n=>n.name==='open-drafts'||n.label==='Drafts and trial reels');
            if(entry&&entry.y>=100&&entry.y+entry.height>850){
                await this.swipeUp();await this.sleep(1000);rows=await cells();
                entry=rows.find(n=>n.name==='open-drafts'||n.label==='Drafts and trial reels');
            }
            // Oct 30: a profile with few Reels cannot scroll, so its first tile stays partly under the tab bar
            // (@antoniomonteiroai: y 635 to 889). Tap the middle of the part that is clear of the tab bar.
            const clearBottom=entry?Math.min(entry.y+entry.height,840):0;
            if(!entry||entry.y<100||clearBottom-entry.y<120)throw new Error('The Drafts and trials entry is not safely visible');
            await this.tapPoint(entry.x+entry.width/2,(entry.y+clearBottom)/2);
            await this.sleep(800);
            // Oct 30: the first visit on @antoniomonteiroai shows "Trial reels need more time to get views" over the
            // page. Acknowledge only that sheet; it changes no setting.
            await this.dismissTrialIntro();
            rows=await cells();trial=rows.find(n=>n.label==='Trial reels');
            // Oct 10 21:35: the Drafts tile now opens the Trial reels page directly (title "Trial reels", Create trial reel button).
            const title=visibleNativeNodes((await this.request(this.session+'/source')).value)
                .find(n=>n.type==='XCUIElementTypeStaticText'&&n.label==='Trial reels'&&n.y<120);
            if(!trial&&title&&await this.visible('accessibility id','BackButton')){
                await this.waitFor('accessibility id','reels-video-thumbnail','trial reels grid',15_000);return;
            }
        }
        if(!trial||trial.y<100||trial.y+trial.height>910)throw new Error('The Trial reels menu is not safely visible');
        await this.tapPoint(trial.x+trial.width/2,trial.y+trial.height/2);
        await this.waitFor('accessibility id', 'reels-video-thumbnail', 'trial reels grid', 15_000);
    }
    /** Open the new Reel straight from its Graph permalink (verified Oct 7 14:42: lands on the owned Reel with its Watch button).
     * Falls back to the Trial grid when the link is unknown or the caption does not match. */
    private async openByLink(url?: string): Promise<boolean> {
        if (!/^http:\/\/127\.0\.0\.1:/.test(this.base)) return false; // unit tests use fake hosts
        try { url ??= (await metaReceipts(this.input!.caption, this.sharedAt ? this.sharedAt - 10 * 60_000 : 0, postingAccountFor(this.input!))).instagram?.url; } catch { return false; }
        if (!url || !/^https:\/\/www\.instagram\.com\/reel\//.test(url)) return false;
        await this.request(this.session + '/url', { url });
        await this.waitForOwnReelViewer().catch(() => undefined);
        await this.sleep(1500);
        return this.hasExactCaption();
    }

    private async openMatchingTrialReel(prefix: string) {
        await this.openTrialReelsGrid();
        // A delayed upload may no longer be first. Inspect recent visible reels without reposting.
        for (let index = 0; index < 3; index++) {
            const rows = (await this.request(this.session + '/elements', {using:'accessibility id', value:'reels-video-thumbnail'})).value ?? [];
            const visible: string[] = [];
            for (const row of rows) if ((await this.request(`${this.session}/element/${this.id(row)}/displayed`)).value === true) visible.push(this.id(row));
            if (!visible[index]) break;
            const r=(await this.request(`${this.session}/element/${visible[index]}/rect`)).value;
            if(r.x<0||r.y<80||r.x+r.width>431||r.y+r.height>925)throw Error('Trial Reel thumbnail is outside the screen');
            await this.tapPoint(r.x+r.width/2,r.y+r.height/2);
            await this.waitForOwnReelViewer();
            await this.sleep(1800);
            if (await this.hasExactCaption()) return;
            await this.tapElement('accessibility id', 'back-button', 'back to Trial grid');
            await this.waitFor('accessibility id', 'reels-video-thumbnail', 'trial reels grid', 10_000);
        }
        throw new Error('Matching caption not found among recent Trial Reels');
    }

    private async waitForOwnReelViewer() {
        const account=this.input?.targets.find(t=>t.platform==='instagram')?.account;
        if(!account)throw Error('Missing expected Instagram account');
        const deadline=Date.now()+15_000;
        do {
            if(ownReelViewer((await this.request(this.session+'/source')).value,account))return;
            await this.sleep(700);
        }while(Date.now()<deadline);
        throw Error('Owned Reel viewer could not be verified');
    }

    private async hasExactCaption(): Promise<boolean> {
        if (!this.input) return false;
        const account=this.input.targets.find(t=>t.platform==='instagram')?.account;
        if(!account)return false;
        return exactOwnReelCaption((await this.request(this.session+'/source')).value,this.input.caption,account);
    }

    /** Independent comment recovery after a verified post. Never calls Share. */
    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly=false):Promise<CommentResult>{
        this.input=input;
        await this.start('com.burbn.instagram');
        if(!await this.hasExactCaption()&&!await this.openByLink())await this.openMatchingTrialReel(input.caption.slice(0,30));
        const result=await this.commentAndPin(text,claim,existingOnly);
        return {...result,commentVerified:true,pinned:true,evidence:'Exact full caption and own comment matched; native comment reports Comment is pinned.'};
    }

    /** Daily Story: open the trial reel with the most plays among the newest visible ones and share it to the Story once. */
    async storyFromBestTrialReel(claim: () => Promise<void>): Promise<{ status: string; plays: number; rank: number; caption: string }> {
        await this.start('com.burbn.instagram');
        await this.openTrialReelsGrid();
        const rows = (await this.request(this.session + '/elements', { using: 'accessibility id', value: 'reels-video-thumbnail' })).value ?? [];
        let best = -1, plays = -1;
        for (let i = 0; i < Math.min(rows.length, 9); i++) {
            const r = await this.raw(`${this.session}/element/${this.id(rows[i])}/attribute/label`);
            const m = /- ([\d,.]+)(K?) plays$/.exec(String(r.body?.value ?? ''));
            if (!m) continue;
            const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
            if (n > plays) { plays = n; best = i; }
        }
        if (best < 0) throw new Error('No play counts found on Trial reels');
        await this.request(`${this.session}/element/${this.id(rows[best])}/click`, {});
        await this.waitForOwnReelViewer();
        const caption = await this.read('predicate string', 'type == "XCUIElementTypeStaticText" AND visible == 1 AND label CONTAINS " "', 'label', 'caption', 5_000).catch(() => '');
        await this.tapElement('predicate string', 'name == "send-button" AND label == "Send" AND visible == 1', 'Send');
        await this.tapElement('predicate string', 'name == "Add to story" AND visible == 1', 'Add to story');
        await this.waitFor('accessibility id', 'share-to-your-story', 'Story editor', 30_000);
        await claim();
        await this.tapElement('accessibility id', 'share-to-your-story', 'Share to your story');
        const deadline = Date.now() + 30_000;
        while (await this.visible('accessibility id', 'share-to-your-story')) {
            if (Date.now() >= deadline) throw new Error('Story editor did not close after one Share; review the account, do not retry');
            await this.sleep(1000);
        }
        return { status: 'story_shared', plays, rank: best, caption: caption.slice(0, 80) };
    }
    /** Post the approved first comment on the open reel, then pin it. Runs once, after the release is published. */
    async commentAndPin(text: string, claim: () => Promise<void>, existingOnly=false): Promise<{ status: string }> {
        await this.tapElement('predicate string', 'name == "comment-button" AND visible == 1', 'Comments');
        await this.sleep(1500); // Read positions after the comments sheet finishes moving.
        const own = async () => visibleNativeNodes((await this.request(this.session+'/source')).value)
            .find(n=>n.type==='XCUIElementTypeCell' && n.label.startsWith(`antoniorevenue said ${text}. Commented `));
        let mine=await own();
        if(mine?.label.includes('Comment is pinned.'))return {status:'already_pinned'};
        if(!mine){
            if(existingOnly)throw new Error('Existing own comment not found; repair cannot create one');
            const box=await this.waitFor('predicate string','type == "XCUIElementTypeTextView" AND name == "text-view"','comment box');
            const draft=(await this.request(`${this.session}/element/${box}/attribute/value`)).value;
            if(draft && draft!=='Add a comment…' && draft!=='Add a comment')throw new Error('Comment draft is not empty');
            await this.request(`${this.session}/element/${box}/value`,{value:[text]});
            if((await this.read('predicate string','type == "XCUIElementTypeTextView" AND name == "text-view"','value','comment text'))!==text)throw new Error('Comment text readback does not match');
            await claim();
            await this.tapElement('predicate string','name == "send-button" AND label == "Post comment" AND visible == 1','Post comment');
            for(let n=0;n<15;n++){await this.sleep(1000);mine=await own();if(mine)break;}
            if(!mine)throw new Error('Posted comment receipt missing; never send again automatically');
        }else await claim();
        await this.sleep(700);
        mine=await own();
        if(!mine)throw new Error('Our comment moved out of view');
        await this.tapPoint(mine.x+Math.min(mine.width/2,160),mine.y+Math.min(mine.height-15,45),900);
        if(await this.visible('predicate string','(label == "Unpin" OR label == "Unpin comment") AND visible == 1'))return {status:'already_pinned'};
        await this.tapElement('predicate string', '(label == "Pin" OR label == "Pin comment") AND visible == 1', 'Pin');
        if (await this.visible('predicate string', 'label == "Pin comment" AND visible == 1')) await this.tapElement('predicate string', 'label == "Pin comment" AND visible == 1', 'confirm Pin comment');
        let verified=false;
        for(let n=0;n<15;n++){await this.sleep(1000);if((await own())?.label.includes('Comment is pinned.')){verified=true;break;}}
        if(!verified)throw new Error('Pinned comment readback missing');
        return { status: 'pinned' };
    }
}
