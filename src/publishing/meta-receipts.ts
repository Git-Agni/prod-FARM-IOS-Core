/** Tap-free Instagram and Facebook receipts from the Meta Graph API (Antonio Revenue page and its Instagram account).
 * Read-only. Matches the exact caption; Instagram Trial Reels are included in the account's media. */
import { execFileSync } from 'node:child_process';
import type { PostingAccount } from './posting-accounts.js';

type Receipt = { verified: true; source: string; url: string; evidence: string; sharedToFeed?: boolean };
let secrets: { meta: string; page: string } | undefined;

function loadSecrets() {
    // 1Password through the shared reader; values stay in this process.
    secrets ??= JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps({"meta":f.get("token") or f.get("credential"),"page":str(f.get("page antonio revenue","")).split()[0]}))`], { encoding: 'utf8', timeout: 60_000 }));
    return secrets!;
}
export const normalizeText = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Facebook shows @handles as Page names (Oct 8: "@antoniorevenue" became "Antonio | More Leads & Sales..."), so
 * match the caption text around each mention, in order. Both values are compared after whitespace normalization. */
export function sameCaptionAroundMentions(want: string, got: string) {
    want = normalizeText(want); got = normalizeText(got);
    if (got === want) return true;
    const parts = want.split(/@[A-Za-z0-9._]+/).map(t => t.trim()).filter(Boolean);
    if (parts.length < 2) return false; let at = 0;
    for (const part of parts) { const i = got.indexOf(part, at); if (i < 0) return false; at = i + part.length; }
    return got.startsWith(parts[0]!);
}

/** Look up the post once. Instagram must match exactly; Facebook returns `missingCaption` when its newest Reel has none.
 * `after` (ms): only posts created at or after it count (Oct 15: reposts and hook variants share a caption with older posts). */
export async function metaReceipts(caption: string, after = 0, account?: Pick<PostingAccount, 'instagram' | 'facebookPageId' | 'facebookComposerLabel'>) {
    const s = loadSecrets();
    // Oct 30: other calibrated accounts read their own Page (the same business token reaches it); default is Antonio Revenue.
    const pageId = account?.facebookPageId ?? s.page, handle = account?.instagram ?? 'antoniorevenue', pageName = account?.facebookComposerLabel.split(',')[0] ?? 'Antonio Revenue';
    const g = async (path: string, params: Record<string, string>) =>
        (await (await fetch(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30_000) })).json()) as any;
    const page = await g(pageId, { fields: 'access_token,instagram_business_account', access_token: s.meta });
    const token = page.access_token ?? s.meta, ig = page.instagram_business_account?.id, want = normalizeText(caption);
    const out: { instagram?: Receipt; facebook?: Receipt; facebookMissingCaption?: boolean } = {};
    if (ig) for (const m of (await g(ig + '/media', { fields: 'caption,permalink,media_product_type,is_shared_to_feed,timestamp', limit: '25', access_token: token })).data ?? [])
        // is_shared_to_feed is false for Trial Reels and true for regular Reels (checked on Oct 4 to 13 posts).
        if (Date.parse(m.timestamp ?? 0) >= after && normalizeText(m.caption ?? '') === want) { out.instagram = { verified: true, source: 'instagram_graph', url: m.permalink, evidence: `Exact full caption on @${handle} via the Instagram Graph API`, sharedToFeed: m.is_shared_to_feed }; break; }
    // Hook variants share a caption (Oct 8: heystevetan-C matched yesterday's heystevetan-A). Newest first.
    const reels = ((await g(pageId + '/video_reels', { fields: 'description,permalink_url,created_time', limit: '25', access_token: token })).data ?? [])
        .sort((a: any, b: any) => Date.parse(b.created_time ?? 0) - Date.parse(a.created_time ?? 0));
    // Facebook turns @handles into Page names (Oct 8: "@antoniorevenue" became "Antonio | More Leads & Sales..."),
    // so match the caption text around each mention, in order, on the newest Reel that has it.
    const sameText = (d: string) => sameCaptionAroundMentions(want, d);
    for (const r of reels) if (Date.parse(r.created_time ?? 0) >= after && sameText(normalizeText(r.description ?? ''))) { out.facebook = { verified: true, source: 'facebook_graph', url: 'https://www.facebook.com' + r.permalink_url, evidence: `Exact full caption on ${pageName} Reels via the Facebook Graph API` }; break; }
    if (!out.facebook && reels[0] && !normalizeText(reels[0].description ?? '')) out.facebookMissingCaption = true;
    return out;
}
