/** Instagram API backup for failed phone posts (Antonio, Oct 26: phone first, API backup).
 * Picks Instagram releases in needs_review from the last 24 h. If the Graph API already shows the caption live, it only
 * records that receipt. Otherwise it posts the same file to the main feed through the Instagram API (no Trial, no
 * Facebook link: the API can't do either for this account), adds the first comment, and marks the item published.
 * A release whose Share was tapped waits 45 minutes first, so a late phone upload can land before we post.
 * Usage: api-fallback.ts [--apply] [--item <id>]   Without --apply it prints what it would do. */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createDatabaseConnection } from '../src/database/client.js';
import { metaReceipts } from '../src/publishing/meta-receipts.js';

const apply = process.argv.includes('--apply');
const only = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : null;
const IG = '17841478747351785', PAGE = '972706662581995', V = 'https://graph.facebook.com/v21.0/';
const token: string = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps(f.get("token") or f.get("credential")))`], { encoding: 'utf8', timeout: 60_000 }));
const g = async (path: string, method = 'GET', q: Record<string, string> = {}) => {
    const body = new URLSearchParams(q);
    // GETs retry once after 20 s: a Meta connect timeout (Oct 26 23:23) crashed the whole run. POSTs never retry.
    const get = () => fetch(`${V}${path}?${body}`);
    const res = method === 'GET' ? await get().catch(() => new Promise(z => setTimeout(z, 20_000)).then(get)) : await fetch(V + path, { method, body });
    return res.json() as Promise<any>;
};
const pageToken: string = (await g(PAGE, 'GET', { fields: 'access_token', access_token: token })).access_token;

const db = createDatabaseConnection();
const rows = (await db.pool.query(`SELECT r.item_id, r.share_claimed_at, r.updated_at, i.input, i.media FROM scheduler.publishing_releases r
    JOIN scheduler.publishing_items i ON i.id=r.item_id
    WHERE r.state='needs_review' AND i.status='needs_review' AND r.updated_at > now()-interval '24 hours'
      AND i.input->'targets' @> '[{"platform":"instagram"}]' AND ($1::uuid IS NULL OR r.item_id=$1::uuid)`, [only])).rows;

const done = async (id: string, receipt: object) => {
    await db.pool.query(`UPDATE scheduler.publishing_releases SET state='published', result=$2::jsonb, updated_at=now() WHERE item_id=$1 AND state='needs_review'`, [id, JSON.stringify(receipt)]);
    await db.pool.query(`UPDATE scheduler.publishing_items SET status='published' WHERE id=$1 AND status='needs_review'`, [id]);
};

for (const r of rows) {
    const caption: string = r.input.caption, id: string = r.item_id;
    const live = await metaReceipts(caption, Date.now() - 48 * 3600_000).catch(() => ({} as any));
    if (live.instagram?.url) {
        console.log(JSON.stringify({ id, action: 'already live, recording receipt', url: live.instagram.url }));
        if (apply) await done(id, { postedVia: 'phone_late', receipts: live });
        continue;
    }
    if (r.share_claimed_at && Date.now() - Date.parse(r.updated_at) < 45 * 60_000) { console.log(JSON.stringify({ id, action: 'waiting: Share was tapped under 45 min ago' })); continue; }
    console.log(JSON.stringify({ id, action: apply ? 'posting by API' : 'would post by API', file: r.media.path }));
    if (!apply) continue;

    const c = await g(IG + '/media', 'POST', { media_type: 'REELS', upload_type: 'resumable', caption, access_token: pageToken });
    if (!c.id) { console.log(JSON.stringify({ id, error: c.error?.message ?? 'no container' })); continue; }
    const up = await fetch('https://rupload.facebook.com/ig-api-upload/v21.0/' + c.id, { method: 'POST', body: readFileSync(r.media.path),
        headers: { Authorization: 'OAuth ' + pageToken, offset: '0', file_size: String(statSync(r.media.path).size) } });
    if (!up.ok) { console.log(JSON.stringify({ id, error: 'upload ' + up.status })); continue; }
    let st: any = {};
    for (let n = 0; n < 60 && !['FINISHED', 'ERROR', 'EXPIRED'].includes(st.status_code); n++) { await new Promise(z => setTimeout(z, 10_000)); st = await g(c.id, 'GET', { fields: 'status_code', access_token: pageToken }); }
    if (st.status_code !== 'FINISHED') { console.log(JSON.stringify({ id, error: 'container ' + st.status_code })); continue; }
    const pub = await g(IG + '/media_publish', 'POST', { creation_id: c.id, access_token: pageToken });
    if (!pub.id) { console.log(JSON.stringify({ id, error: pub.error?.message ?? 'publish failed' })); continue; }
    const media = await g(pub.id, 'GET', { fields: 'permalink,caption', access_token: pageToken });
    const comment = r.input.firstComment ? await g(pub.id + '/comments', 'POST', { message: r.input.firstComment, access_token: pageToken }) : null;
    const receipt = { postedVia: 'instagram_graph_api', trial: false, facebook: false,
        receipts: { instagram: { url: media.permalink, mediaId: pub.id, captionMatches: media.caption === caption } },
        firstComment: comment?.id ? { id: comment.id, pinned: false } : comment?.error?.message ?? null };
    await done(id, receipt);
    console.log(JSON.stringify({ id, ...receipt }));
}
await db.close();
