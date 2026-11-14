// Shared WebDriverAgent helpers for the Instagram drivers. Instagram re-renders often, so every lookup is retried on
// "stale element reference" and only visible elements count.
import { requireWdaControl } from '../devices/control-mode.js';
import { visibleNativeNodes } from './native-xml.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const W3C = 'element-6066-11e4-a52e-4f735466cecf';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class WdaApp {
    protected session = '';
    protected expectedBundleId = '';

    /** Stop input if a notification or another app takes the foreground. Never retry the touch. */
    protected async assertInputApp() {
        if (!this.expectedBundleId) throw new Error('Expected app is missing; native input stopped');
        const active = (await this.request(this.session + '/wda/activeAppInfo')).value;
        if (active?.bundleId !== this.expectedBundleId)
            throw new Error('Another app or system overlay is active; native input stopped');
        const source = String((await this.request(this.session + '/source')).value ?? '');
        if (visibleNativeNodes(source).some(n => /NotificationShortLookView/.test(n.name + n.type)))
            throw new Error('A notification banner is visible; native input stopped');
    }
    constructor(protected base: string, protected signal: AbortSignal, protected beforeRequest?: () => Promise<void>) { requireWdaControl(); }

    protected async raw(route: string, body?: unknown, timeoutMs = 90_000): Promise<any> {
        this.signal.throwIfAborted();
        await this.beforeRequest?.();
        const response = await fetch(this.base + route, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]) });
        return { ok: response.ok, status: response.status, body: await response.json() as any };
    }
    protected async request(route: string, body?: unknown, timeoutMs?: number): Promise<any> {
        const r = await this.raw(route, body, timeoutMs);
        if (!r.ok || r.body.value?.error) throw new Error(`Phone operation failed: ${r.body.value?.error ?? r.status}`);
        return r.body;
    }
    async start(bundleId: string) {
        // Check before app launch. Never try to unlock or dismiss the passcode screen.
        if ((await this.request('/wda/locked')).value !== false)
            throw new Error('Unlock the iPhone before starting this action');
        this.expectedBundleId = bundleId;
        const existing = (await this.request('/status')).sessionId;
        if (typeof existing === 'string' && /^[a-zA-Z0-9-]+$/.test(existing)) {
            // A new WDA session can terminate the previous app before reading its
            // capabilities. Reuse the session so another app's draft survives.
            this.session = `/session/${existing}`;
            await this.request(this.session + '/wda/apps/activate', {bundleId});
        } else {
            this.session = `/session/${(await this.request('/session', { capabilities: { alwaysMatch: {
                bundleId, forceAppLaunch: false, shouldTerminateApp: false,
                shouldWaitForQuiescence: false, waitForIdleTimeout: 0,
            } } })).sessionId}`;
        }
        await this.request(this.session + '/appium/settings', {settings:{defaultActiveApplication:bundleId,waitForIdleTimeout:0,animationCoolOffTimeout:0,snapshotMaxDepth:bundleId === 'com.zhiliaoapp.musically' ? 12 : 50,customSnapshotTimeout:bundleId === 'com.zhiliaoapp.musically' ? 3 : 15}});
    }
    /** Cleanup still runs when an action's time limit has expired. Caller must hold the phone lock. */
    protected async exitApp(bundleId:string) {
        const post=async(route:string,body:unknown)=>{
            const response=await fetch(this.base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
            if(!response.ok)throw new Error('Phone cleanup failed');
        };
        // Keep the app and any unsent composer intact. Home stops foreground
        // playback without terminating an app or changing its account session.
        await post('/wda/homescreen',{});
        // Oct 10 16:23: a Short left by Home kept playing in picture-in-picture over Instagram's caption OK button.
        // Close YouTube itself (the comment driver already relaunches it fresh); its sign-in is kept.
        if(bundleId==='com.google.ios.youtube'&&this.session)await post(this.session+'/wda/apps/terminate',{bundleId}).catch(()=>undefined);
    }
    /** Read-only failure evidence: screenshot and screen tree, saved locally. Never sends input; works after a time-out. */
    async captureFailure(label: string): Promise<string> {
        const get=async(route:string)=>(await (await fetch(this.base+route,{signal:AbortSignal.timeout(20_000)})).json() as any).value;
        const dir=path.resolve('.scheduler-data/release-failures'),file=path.join(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}-${label.replace(/[^\w-]/g,'')}`);
        await mkdir(dir,{recursive:true});
        await writeFile(file+'.png',Buffer.from(String(await get('/screenshot')),'base64'));
        await writeFile(file+'.xml',String(await get(this.session?this.session+'/source':'/source')));
        return path.relative(process.cwd(),file);
    }
    /** After a failure before Share or Post: close the app so the next run starts clean. Never signs out. */
    async resetAfterFailure(): Promise<void> {
        const post=async(route:string,body:unknown)=>{await fetch(this.base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});};
        if(this.session&&this.expectedBundleId)await post(this.session+'/wda/apps/terminate',{bundleId:this.expectedBundleId});
        await post('/wda/homescreen',{});
    }
    /** Read-only evidence for an attended composer check. Never publishes or saves a draft. */
    async capturePreview() {
        await this.assertInputApp();
        return {source:String((await this.request(this.session+'/source')).value),
            screenshot:Buffer.from((await this.request('/screenshot')).value,'base64')};
    }
    protected id(row: any): string { return row.ELEMENT ?? row[W3C]; }

    /** First visible match, or null. Stale results are retried a few times. */
    protected async visible(using: string, value: string): Promise<string | null> {
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const rows = (await this.request(this.session + '/elements', { using, value })).value ?? [];
                for (const row of rows) if ((await this.request(`${this.session}/element/${this.id(row)}/displayed`)).value === true) return this.id(row);
                return null;
            } catch (error) {
                if (!(error instanceof Error) || !/stale element/.test(error.message)) throw error;
                await sleep(400);
            }
        }
        return null;
    }
    protected async waitFor(using: string, value: string, what: string, ms = 20_000): Promise<string> {
        const deadline = Date.now() + ms;
        while (true) {
            const found = await this.visible(using, value);
            if (found) return found;
            if (Date.now() >= deadline) throw new Error(`Phone control is missing: ${what}`);
            await sleep(500);
        }
    }
    /** Read an attribute of the first visible match, re-finding it when Instagram re-renders. */
    protected async read(using: string, value: string, attribute: string, what: string, ms = 20_000): Promise<string> {
        const deadline = Date.now() + ms;
        while (true) {
            const id = await this.waitFor(using, value, what, Math.max(1000, deadline - Date.now()));
            const r = await this.raw(`${this.session}/element/${id}/attribute/${attribute}`);
            if (r.ok && !r.body.value?.error) return String(r.body.value ?? '');
            if (Date.now() >= deadline) throw new Error(`Could not read ${what}`);
            await sleep(400);
        }
    }
    protected async tapElement(using: string, value: string, what: string, ms = 20_000) {
        const deadline = Date.now() + ms;
        while (true) {
            const id = await this.waitFor(using, value, what, Math.max(1000, deadline - Date.now()));
            await this.assertInputApp();
            const r = await this.raw(`${this.session}/element/${id}/click`, {});
            if (r.ok && !r.body.value?.error) return;
            if (!/stale element/.test(String(r.body.value?.error)) || Date.now() >= deadline) throw new Error(`Could not tap ${what}: ${r.body.value?.error ?? r.status}`);
            await sleep(400);
        }
    }
    protected async rect(using: string, value: string, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const id = await this.waitFor(using, value, what);
            const r = await this.raw(`${this.session}/element/${id}/rect`);
            if (r.ok && !r.body.value?.error) return r.body.value;
            await sleep(400);
        }
        throw new Error(`Could not measure ${what}`);
    }
    protected async tapPoint(x: number, y: number, holdMs = 80) {
        await this.assertInputApp();
        await this.request('/wda/absolute-actions', { actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' },
            { type: 'pointerDown', button: 0 }, { type: 'pause', duration: holdMs }, { type: 'pointerUp', button: 0 }] }] });
    }
    protected async swipeUp() {
        await this.assertInputApp();
        await this.request(this.session + '/wda/dragfromtoforduration', { fromX: 215, fromY: 778, toX: 215, toY: 325, duration: 0.5 });
    }
    protected sleep(ms: number) { return sleep(ms); }
}

/** "TUESDAY, SEPTEMBER 29, 2026" in Pacific time, the date Instagram's gallery prints on each cell. */
export function galleryDate(date = new Date()): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        .format(date).toUpperCase();
}
/** Parse "Video thumbnail, video duration: 0:29, TUESDAY, SEPTEMBER 29, 2026". */
export function parseGalleryCell(label: string): { seconds: number; date: string } | null {
    const m = /^Video thumbnail, video duration: (\d+):(\d\d), (.+)$/.exec(label.trim());
    return m ? { seconds: Number(m[1]) * 60 + Number(m[2]), date: m[3].trim() } : null;
}
