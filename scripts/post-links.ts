/** Read-only: find the public link of one video on every platform, matched by caption or title.
 * Usage: post-links.ts MEDIA_NAME. Instagram + Facebook via Meta Graph (Antonio Revenue page), YouTube via the
 * channel's public feed, TikTok via ScrapeCreators (can lag a few hours; then shown as pending).
 * Secrets come from 1Password through the shared Python reader and stay in this process. */
import { execFileSync } from 'node:child_process';
import { createDatabaseConnection } from '../src/database/client.js';

const name = process.argv[2]; if (!name) throw Error('Usage: post-links.ts MEDIA_NAME');
const secrets = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
meta=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
sc=m.fields("c2c-monorepo","SCRAPECREATORS_API_KEY")
print(json.dumps({"meta":meta.get("token") or meta.get("credential"),"page":str(meta.get("page antonio revenue","")).split()[0],"sc":sc.get("credential") or sc.get("password")}))`], { encoding: 'utf8' }));
const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
const starts = (a: string, b: string) => norm(a).slice(0, 60) === norm(b).slice(0, 60);
const json = async (url: string, headers: Record<string, string> = {}) => (await fetch(url, { headers, signal: AbortSignal.timeout(40_000) })).json() as any;

const db = createDatabaseConnection();
try {
    const items = (await db.pool.query(`SELECT i.input,i.status FROM scheduler.publishing_items i WHERE i.media->>'name'=$1 AND i.status='published'`, [name])).rows;
    const caption = items.find(i => i.input.targets.some((t: any) => t.platform !== 'youtube'))?.input.caption ?? items[0]?.input.caption ?? '';
    const ytTitle = items.find(i => i.input.targets[0].platform === 'youtube')?.input.youtube?.title;
    const out: Record<string, string> = {};
    const g = (path: string, params: Record<string, string>) => json(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`);
    const page = await g(secrets.page, { fields: 'access_token,instagram_business_account', access_token: secrets.meta });
    const ig = page.instagram_business_account?.id, ptok = page.access_token ?? secrets.meta;
    if (ig) for (const m of (await g(ig + '/media', { fields: 'caption,permalink', limit: '25', access_token: ptok })).data ?? [])
        if (caption && starts(m.caption ?? '', caption)) { out.instagram = m.permalink; break; }
    for (const r of (await g(secrets.page + '/video_reels', { fields: 'description,permalink_url', limit: '25', access_token: ptok })).data ?? [])
        if (caption && starts(r.description ?? '', caption)) { out.facebook = 'https://www.facebook.com' + r.permalink_url; break; }
    if (ytTitle) {
        const feed = await (await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=UCMZWuXp0lsxE2vmuifYMWuA', { signal: AbortSignal.timeout(30_000) })).text();
        for (const [, id, title] of feed.matchAll(/<yt:videoId>(.*?)<\/yt:videoId>[\s\S]*?<title>(.*?)<\/title>/g))
            if (norm(title!.replace(/&amp;/g, '&').replace(/&#39;/g, "'")) === norm(ytTitle)) { out.youtube = 'https://youtube.com/shorts/' + id; break; }
    }
    const tt = await json('https://api.scrapecreators.com/v3/tiktok/profile/videos?handle=antoniorevenue', { 'x-api-key': secrets.sc });
    for (const v of tt.aweme_list ?? []) if (caption && starts(v.desc ?? '', caption)) { out.tiktok = `https://www.tiktok.com/@antoniorevenue/video/${v.aweme_id}`; break; }
    console.log(JSON.stringify(out));
} finally { await db.close(); }
