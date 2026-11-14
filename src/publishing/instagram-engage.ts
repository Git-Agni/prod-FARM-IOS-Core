import {visibleNativeNodes} from './native-xml.js';
import { assertEngageControl, predicateLiteral, type EngagePayload } from './engage-model.js';
import { assertInstagramWritesAllowed } from './instagram-write-hold.js';

// Controls mapped on the iPhone 15 Pro Max, Instagram build of 2026-09-29 (read-only walk, nothing shared):
// the reel URL opens the viewer ("Reel by antoniorevenue."), comment-button opens the sheet, send-button opens the
// share sheet whose "Add to story" leads to the editor with share-to-your-story and discard-story-preview.
// The pin menu labels ("Pin", "Pin comment", "pinned") come from the attended ROADMAP run and are checked live.
export interface EngageResult { [key: string]: unknown; action: string; postUrl: string; status: 'pinned' | 'already_pinned' | 'story_shared'; irreversibleAt?: string }

export class InstagramEngage {
    private session = '';
    constructor(private base: string, private signal: AbortSignal, private beforeRequest?: () => Promise<void>) {}
    private async request(route: string, body?: unknown): Promise<any> {
        this.signal.throwIfAborted();
        await this.beforeRequest?.();
        const response = await fetch(this.base + route, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([this.signal, AbortSignal.timeout(90_000)]) });
        const result = await response.json() as any;
        if (!response.ok || result.value?.error) throw new Error(`Phone operation failed: ${result.value?.error ?? response.status}`);
        return result;
    }
    private id(row: any): string { return row.ELEMENT ?? row['element-6066-11e4-a52e-4f735466cecf']; }
    private async visible(using: string, value: string): Promise<string | null> {
        const rows = (await this.request(this.session + '/elements', { using, value })).value ?? [];
        for (const row of rows) if ((await this.request(`${this.session}/element/${this.id(row)}/displayed`)).value === true) return this.id(row);
        return null;
    }
    private async waitFor(using: string, value: string, what: string, ms = 20_000): Promise<string> {
        const deadline = Date.now() + ms;
        while (true) {
            const found = await this.visible(using, value);
            if (found) return found;
            if (Date.now() >= deadline) throw new Error(`Instagram control is missing: ${what}`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
    private async click(name: string) {
        assertEngageControl(name);
        const id = await this.waitFor('predicate string', `(name == "${predicateLiteral(name)}" OR label == "${predicateLiteral(name)}") AND visible == 1`, name);
        await this.request(`${this.session}/element/${id}/click`, {});
    }

    async open(payload: EngagePayload) {
        if (this.base.startsWith('http://127.0.0.1:')) await assertInstagramWritesAllowed();
        const started = await this.request('/session', { capabilities: { alwaysMatch: { bundleId: 'com.burbn.instagram' } } });
        this.session = `/session/${started.sessionId}`;
        await this.request(this.session + '/url', { url: payload.postUrl });
        await this.waitFor('accessibility id', 'Reel by antoniorevenue.', 'the @antoniorevenue reel viewer', 30_000);
        // The caption line proves the link opened the intended reel, not a neighbour in the feed.
        const deadline=Date.now()+20_000;
        while(true){
            const nodes=visibleNativeNodes((await this.request(this.session+'/source')).value);
            if(nodes.some(n=>n.label==='Reel by antoniorevenue.')&&nodes.some(n=>n.label.startsWith(payload.captionPrefix)))break;
            if(Date.now()>=deadline)throw new Error('The linked Reel caption does not match');
            await new Promise(r=>setTimeout(r,500));
        }
    }

    /** Pin the first comment. `claim` runs right before the long-press menu action, the one step that changes the post. */
    async pin(payload: EngagePayload, claim: () => Promise<void>): Promise<EngageResult> {
        await this.click('comment-button');
        const comment = await this.waitFor('predicate string', `label BEGINSWITH "antoniorevenue said ${predicateLiteral(payload.comment)}. Commented " AND visible == 1`, 'the first comment (Metricool may not have posted it yet)', 30_000);
        if (await this.visible('predicate string', `label BEGINSWITH "antoniorevenue said ${predicateLiteral(payload.comment)}. Commented " AND label CONTAINS "Comment is pinned." AND visible == 1`))
            return { action: 'pin', postUrl: payload.postUrl, status: 'already_pinned' };
        const rect = (await this.request(`${this.session}/element/${comment}/rect`)).value;
        await this.request('/wda/absolute-actions', { actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(rect.x + Math.min(rect.width / 2, 160)), y: Math.round(rect.y + rect.height / 2), origin: 'viewport' },
            { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 900 }, { type: 'pointerUp', button: 0 }] }] });
        await this.waitFor('predicate string', '(label == "Pin" OR name == "Pin") AND visible == 1', 'the Pin menu option');
        await claim();
        const irreversibleAt = new Date().toISOString();
        await this.click('Pin');
        if (await this.visible('predicate string', 'label == "Pin comment" AND visible == 1')) await this.click('Pin comment');
        await this.waitFor('predicate string', `label BEGINSWITH "antoniorevenue said ${predicateLiteral(payload.comment)}. Commented " AND label CONTAINS "Comment is pinned." AND visible == 1`, 'the pinned-comment readback', 15_000);
        return { action: 'pin', postUrl: payload.postUrl, status: 'pinned', irreversibleAt };
    }

    /** Share the live reel to the Story once. `claim` runs right before the single Share tap. */
    async story(payload: EngagePayload, claim: () => Promise<void>): Promise<EngageResult> {
        await this.click('send-button');
        await this.click('Add to story');
        await this.waitFor('accessibility id', 'share-to-your-story', 'the Story editor', 30_000);
        await claim();
        const irreversibleAt = new Date().toISOString();
        await this.click('share-to-your-story');
        // The editor closing is the native signal that the Story was submitted. Never tap Share a second time.
        const deadline = Date.now() + 30_000;
        while (await this.visible('accessibility id', 'share-to-your-story')) {
            if (Date.now() >= deadline) throw new Error('Story editor did not close after one Share; review the account, do not retry');
            await new Promise(r => setTimeout(r, 1000));
        }
        return { action: 'story', postUrl: payload.postUrl, status: 'story_shared', irreversibleAt };
    }
}
