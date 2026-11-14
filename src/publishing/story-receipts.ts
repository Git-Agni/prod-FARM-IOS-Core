/** Tap-free Story receipts from the Meta Graph API: live Stories on @antoniorevenue and on the Antonio Revenue Page.
 * Read-only. Verified reachable on 2026-10-07 (both endpoints returned an empty list with no live Story). */
import { execFileSync } from 'node:child_process';

export interface LiveStory { id: string; createdAt: number; mediaType?: string; url?: string }
export interface StoryState { instagram: LiveStory[]; facebook: LiveStory[] }

let secrets: { meta: string; page: string } | undefined;
function loadSecrets() {
    // Same 1Password item as the video receipts (meta-receipts.ts); values stay in this process.
    secrets ??= JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps({"meta":f.get("token") or f.get("credential"),"page":str(f.get("page antonio revenue","")).split()[0]}))`], { encoding: 'utf8', timeout: 60_000 }));
    return secrets!;
}

/** Graph returns ISO times for Instagram and unix seconds (string or number) for Page Stories. */
export function storyTime(value: unknown): number {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) return Number(value) * 1000;
    return typeof value === 'string' ? Date.parse(value) : NaN;
}

/** The one Story that appeared after this Share. Ambiguity is an error, never a guess. */
export function newStory(stories: LiveStory[], known: ReadonlySet<string>, sharedAt: number): LiveStory | null {
    const fresh = stories.filter(s => !known.has(s.id) && Number.isFinite(s.createdAt) && s.createdAt >= sharedAt - 60_000);
    if (fresh.length > 1) throw new Error('More than one new Story appeared; review the account before continuing');
    return fresh[0] ?? null;
}

export async function liveStories(): Promise<StoryState> {
    const s = loadSecrets();
    const g = async (path: string, params: Record<string, string>) => {
        const body = await (await fetch(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30_000) })).json() as any;
        if (body.error) throw new Error('Meta Graph Story read failed: ' + (body.error.message ?? 'unknown'));
        return body;
    };
    const page = await g(s.page, { fields: 'access_token,instagram_business_account', access_token: s.meta });
    const token = page.access_token ?? s.meta, ig = page.instagram_business_account?.id;
    if (!ig) throw new Error('The Antonio Revenue Page has no linked Instagram account');
    const igRows = (await g(ig + '/stories', { fields: 'id,media_type,timestamp,permalink', limit: '100', access_token: token })).data ?? [];
    const fbRows = (await g(s.page + '/stories', { limit: '100', access_token: token })).data ?? [];
    return {
        instagram: igRows.map((r: any) => ({ id: String(r.id), createdAt: storyTime(r.timestamp), mediaType: r.media_type, url: r.permalink })),
        facebook: fbRows.map((r: any) => ({ id: String(r.post_id ?? r.id), createdAt: storyTime(r.creation_time), mediaType: r.media_type, url: r.url })),
    };
}
