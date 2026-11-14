import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { PostingInput } from './model.js';
import type { StoredAsset } from '../types.js';
import { requireWdaControl } from '../devices/control-mode.js';

/** This driver has no publish method. Every run ends before the final Share action. */
export class InstagramPreview {
    private session = '';
    constructor(private base: string, private signal: AbortSignal, private beforeRequest?: () => Promise<void>) {}
    async request(route: string, body?: unknown): Promise<any> {
        requireWdaControl();
        this.signal.throwIfAborted();
        await this.beforeRequest?.();
        const response = await fetch(this.base + route, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([this.signal, AbortSignal.timeout(90_000)]) });
        const result = await response.json() as any;
        if (!response.ok || result.value?.error) throw new Error(`Phone operation failed: ${result.value?.error ?? response.status}`);
        return result;
    }
    async start() {
        const result = await this.request('/session', { capabilities: { alwaysMatch: { bundleId: 'com.burbn.instagram' } } });
        this.session = `/session/${result.sessionId}`;
    }
    async element(name: string): Promise<string> {
        const deadline = Date.now() + 20_000;
        while (true) {
            try {
                const result = await this.request(this.session + '/elements', { using: 'accessibility id', value: name });
                for (const candidate of result.value ?? []) {
                    const id = candidate.ELEMENT ?? candidate['element-6066-11e4-a52e-4f735466cecf'];
                    if (typeof id !== 'string') continue;
                    const displayed = (await this.request(`${this.session}/element/${id}/displayed`)).value;
                    if (displayed === true) return id;
                }
                throw new Error('no such element: not visible');
            } catch(error) {
                if (!(error instanceof Error) || !error.message.includes('no such element')) throw error;
                if (Date.now() >= deadline) throw new Error(`Instagram control is missing: ${name}`);
                await new Promise(resolve=>setTimeout(resolve,500));
            }
        }
    }
    async attribute(name: string, attribute: string) {
        const id = await this.element(name);
        return (await this.request(`${this.session}/element/${id}/attribute/${attribute}`)).value;
    }
    async click(name: string) {
        const allowed = ['profile-tab','profile-add-button','creation-reel','gallery-video-cell-0','reels-gallery-selection-next','sundial-right-chevron-next-button','trial-switch','OK','Done','Also share on…','BackButton'];
        if (!allowed.includes(name)) throw new Error('This control is not allowed in a preview');
        // A selector name can be reused by Instagram for both Next and Share.
        // Block publication labels even when the underlying selector is familiar.
        const label = String(await this.attribute(name,'label'));
        if (/^(share|post|publish)( now)?$/i.test(label.trim())) throw new Error('This preview driver cannot publish');
        const id = await this.element(name);
        await this.request(`${this.session}/element/${id}/click`,{});
    }
    async trialState(): Promise<boolean> {
        await this.element('trial-switch');
        const result = await this.request(this.session + '/elements', { using: 'predicate string',
            value: 'type == "XCUIElementTypeSwitch" AND (name BEGINSWITH "Checked, Trial," OR name BEGINSWITH "Not checked, Trial,")' });
        for (const candidate of result.value ?? []) {
            const id = candidate.ELEMENT ?? candidate['element-6066-11e4-a52e-4f735466cecf'];
            if ((await this.request(`${this.session}/element/${id}/displayed`)).value !== true) continue;
            const label = String((await this.request(`${this.session}/element/${id}/attribute/label`)).value);
            if (label.startsWith('Checked, Trial,')) return true;
            if (label.startsWith('Not checked, Trial,')) return false;
        }
        throw new Error('The visible Trial state cannot be read');
    }
    async ensureAutomaticPromotion(): Promise<void> {
        const rows = await this.request(this.session + '/elements', { using:'predicate string',
            value:'type == "XCUIElementTypeSwitch" AND name BEGINSWITH "Checked, Trial,"' });
        let rect: any;
        for (const row of rows.value ?? []) {
            const id = row.ELEMENT ?? row['element-6066-11e4-a52e-4f735466cecf'];
            if ((await this.request(`${this.session}/element/${id}/displayed`)).value !== true) continue;
            rect = (await this.request(`${this.session}/element/${id}/rect`)).value;
            break;
        }
        // The inline link has no separate accessibility ID on this tested layout.
        // Reject other layouts rather than tapping an unknown control.
        if (!rect || rect.x !== 0 || rect.width !== 430 || rect.height !== 127 || rect.y < 100 || rect.y > 680)
            throw new Error('Trial settings link needs calibration for this layout');
        await this.request('/wda/absolute-actions', {actions:[{type:'pointer',id:'finger1',parameters:{pointerType:'touch'},actions:[
            {type:'pointerMove',duration:0,x:200,y:rect.y+rect.height-21,origin:'viewport'},
            {type:'pointerDown',button:0},{type:'pause',duration:80},{type:'pointerUp',button:0}
        ]}]});
        await this.element('Trial settings');
        const state = async () => {
            const r = await this.request(this.session+'/elements',{using:'predicate string',
                value:'type == "XCUIElementTypeSwitch" AND (name == "Checked, Share to everyone automatically" OR name == "Not checked, Share to everyone automatically")'});
            for (const item of r.value ?? []) {
                const id=item.ELEMENT ?? item['element-6066-11e4-a52e-4f735466cecf'];
                if ((await this.request(`${this.session}/element/${id}/displayed`)).value !== true) continue;
                const label=(await this.request(`${this.session}/element/${id}/attribute/label`)).value;
                if (label === 'Checked, Share to everyone automatically') return true;
                if (label === 'Not checked, Share to everyone automatically') return false;
            }
            throw new Error('Automatic promotion state cannot be verified');
        };
        if (!await state()) {
            const toggle = await this.element('igds-switch');
            await this.request(`${this.session}/element/${toggle}/click`,{});
        }
        if (!await state()) throw new Error('Automatic promotion did not turn on');
        await this.click('Done');
    }
    async verifyLinkedFacebook(): Promise<void> {
        await this.click('Also share on…');
        // Read the owning cell: the nested switch reports 0 even when visibly on.
        const label = await this.attribute('Antonio Revenue, Facebook · Public, On','label');
        if (label !== 'Antonio Revenue, Facebook · Public, On')
            throw new Error('Linked Facebook sharing is not confirmed for Antonio Revenue');
        await this.click('BackButton');
    }
    async swipeUp() {
        await this.request(this.session + '/wda/dragfromtoforduration', { fromX:215,fromY:778,toX:215,toY:325,duration:0.5 });
    }
    async run(input: PostingInput, asset: StoredAsset, expectedHash: string) {
        const target = input.targets.find(t => t.platform === 'instagram');
        if (!target) throw new Error('This preview needs an Instagram target');
        if (input.targets.some(t => t.platform === 'facebook' && t.account !== 'https://www.facebook.com/profile.php?id=61584693917444')) throw new Error('This Facebook destination has not been verified on the phone');
        if (input.facebookMode !== 'linked_from_instagram' && input.targets.some(t => t.platform === 'facebook')) throw new Error('Separate Facebook posting is not calibrated');
        if (input.instagramTrial && input.automaticPromotion !== true) throw new Error('This older item must be recreated with automatic promotion on');
        await this.start();
        await this.click('profile-tab');
        const account = String(await this.attribute('user-switch-title-button','label')).replace(/^@/,'');
        if (account !== target.account.replace(/^@/,'')) throw new Error('The active Instagram account does not match this item');
        const bytes = await readFile(asset.path);
        if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Video changed since the calendar item was saved');
        const imported = await this.request('/wda/import-media', { name:asset.name,mimeType:asset.mimeType,data:bytes.toString('base64') });
        if (!imported.value?.localIdentifier) throw new Error('The phone did not return a media import ID');
        await this.click('profile-add-button');
        await this.click('creation-reel');
        // Recents exposes positions, not PHAsset IDs. Selection requires visual review.
        // Keep publication disabled until exact imported-media selection is proven.
        await this.click('gallery-video-cell-0');
        await this.click('reels-gallery-selection-next');
        await this.click('sundial-right-chevron-next-button');
        const caption = await this.element('caption-cell-text-view');
        if (input.caption) {
            await this.request(`${this.session}/element/${caption}/value`, { value: [input.caption] });
            if (String(await this.attribute('caption-cell-text-view','value')) !== input.caption) throw new Error('Caption readback does not match');
            await this.click('OK');
            if (String(await this.attribute('caption-cell-text-view','value')) !== input.caption) throw new Error('Caption changed when the editor closed');
        }
        await this.swipeUp();
        if (await this.trialState() !== input.instagramTrial) await this.click('trial-switch');
        if (await this.trialState() !== input.instagramTrial) throw new Error('Trial setting did not match');
        if (input.instagramTrial) await this.ensureAutomaticPromotion();
        const linkedFacebook = input.targets.some(t => t.platform === 'facebook');
        if (linkedFacebook) await this.verifyLinkedFacebook();
        return { status: 'composer_needs_review', account, importedMediaId:imported.value.localIdentifier,
            videoSha256:expectedHash, trial:input.instagramTrial, captionVerified:true,
            exactMediaSelectionVerified:false, automaticPromotionVerified:input.instagramTrial, automaticPromotion:input.instagramTrial ? true : null, facebookDeliveryVerified:false, facebookComposerVerified:linkedFacebook,
            published:false, checkedAt:new Date().toISOString(),
            nextAction:'Review the selected media, cover, Trial settings and Facebook destination on the phone. Publication remains disabled.' };
    }
}
