/** Watch the Instagram caption block (Oct 23: Instagram returned feedback_required on every caption save and Reels
 * published empty from 12 PM). Read-only by default: it reads the account's recent media through the Graph API, finds
 * Reels with an empty caption since the block began, and maps each to its calendar item by Share time.
 * The block counts as lifted when a Reel shared after the newest empty one has a caption.
 * Usage: caption-block-monitor.ts [--repair]
 *   --repair: only when the block is lifted, writes the pairs file and runs repair-instagram-captions.ts --apply on it.
 * Prints one JSON status line. Never posts. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createDatabaseConnection } from '../src/database/client.js';

const SINCE = Date.parse('2026-10-23T18:30:00Z');   // 11:30 AM PT, before the first empty caption at 12:03 PM
const s = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps({"meta":f.get("token") or f.get("credential"),"page":str(f.get("page antonio revenue","")).split()[0]}))`], { encoding: 'utf8', timeout: 60_000 }));
const g = async (p: string, q: Record<string, string>) => (await (await fetch(`https://graph.facebook.com/v21.0/${p}?${new URLSearchParams(q)}`, { signal: AbortSignal.timeout(30_000) })).json()) as any;
const page = await g(s.page, { fields: 'access_token,instagram_business_account', access_token: s.meta });
const media: any[] = ((await g(page.instagram_business_account.id + '/media', { fields: 'id,caption,timestamp,permalink', limit: '50', access_token: page.access_token })).data ?? [])
    .filter((m: any) => Date.parse(m.timestamp) >= SINCE).sort((a: any, b: any) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
const empty = media.filter(m => !(m.caption ?? '').trim());
const lastEmpty = empty.at(-1);
const captionedAfter = lastEmpty ? media.filter(m => Date.parse(m.timestamp) > Date.parse(lastEmpty.timestamp) && (m.caption ?? '').trim()) : [];
const lifted = empty.length > 0 && captionedAfter.length > 0;

const db = createDatabaseConnection();
const pairs: { url: string; itemId: string; postedAt: string }[] = [], unmatched: string[] = [];
for (const m of empty) {
    const t = Date.parse(m.timestamp);
    const row = (await db.pool.query(`SELECT r.item_id FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
        WHERE r.share_claimed_at BETWEEN $1 AND $2 AND i.input->'targets' @> '[{"platform":"instagram"}]' ORDER BY r.share_claimed_at DESC LIMIT 1`,
        [new Date(t - 10 * 60_000), new Date(t + 60_000)])).rows[0];
    if (row) pairs.push({ url: m.permalink, itemId: row.item_id, postedAt: m.timestamp }); else unmatched.push(m.permalink);
}
await db.close();

const status = { checkedAt: new Date().toISOString(), lifted, emptySinceBlock: empty.length, matched: pairs.length, unmatched,
    newestEmpty: lastEmpty?.timestamp ?? null, captionedAfterNewestEmpty: captionedAfter.map(m => m.permalink) };
const dir = '.scheduler-data/caption-block'; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/latest.json`, JSON.stringify({ ...status, pairs }, null, 2));
console.log(JSON.stringify(status));
if (process.argv.includes('--repair') && lifted && pairs.length) {
    writeFileSync(`${dir}/pairs.json`, JSON.stringify(pairs, null, 2));
    execFileSync('node', ['--env-file-if-exists=.env', '--import', 'tsx', 'scripts/repair-instagram-captions.ts', `${dir}/pairs.json`, '--apply'], { stdio: 'inherit', timeout: 60 * 60_000 });
}
