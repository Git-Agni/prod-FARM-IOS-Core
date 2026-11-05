/** Instagram API backup for failed phone posts (Antonio, Oct 26: phone first, API backup).
 * Picks Instagram releases in needs_review from the last 24 h. If the Graph API already shows the caption live, it only
 * records that receipt. Otherwise it posts the same file through the Instagram API, adds the first comment, and marks the
 * item published. Oct 27 (Antonio: "published through the api trial reels also sharing to Facebook"): a Trial item posts as
 * a Trial Reel with automatic promotion (trial_params graduation_strategy SS_PERFORMANCE, verified: Meta rejects an unknown
 * strategy, so the parameter is read). Linked Facebook requests never become separate Page uploads. Only an explicitly
 * direct Facebook request may use the Page uploader, and it still requires pages_manage_posts.
 * A release whose Share was tapped waits 45 minutes first, so a late phone upload can land before we post.
 * Usage: api-fallback.ts [--apply] [--item <id> [--now]]   Without --apply it prints what it would do. */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createDatabaseConnection } from '../src/database/client.js';
import { metaReceipts } from '../src/publishing/meta-receipts.js';
import { assertInstagramWritesAllowed, recordInstagramWriteHold } from '../src/publishing/instagram-write-hold.js';

const apply = process.argv.includes('--apply');
if (apply) await assertInstagramWritesAllowed();
const only = process.argv.includes('--item') ? process.argv[process.argv.indexOf('--item') + 1] : null;
const IG = '17841478747351785', PAGE = '972706662581995', V = 'https://graph.facebook.com/v21.0/';
const token: string = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=m.fields("c2c-monorepo","Meta Marketing API — Antonio Monteiro (C2C ads + lead forms)")
print(json.dumps(f.get("token") or f.get("credential")))`], { encoding: 'utf8', timeout: 60_000 }));
const g = async (path: string, method = 'GET', q: Record<string, string> = {}) => {
    if (method === 'POST') await assertInstagramWritesAllowed();
    const body = new URLSearchParams(q);
    // GETs retry once after 20 s: a Meta connect timeout (Oct 26 23:23) crashed the whole run. POSTs never retry.
    const get = () => fetch(`${V}${path}?${body}`);
    const res = method === 'GET' ? await get().catch(() => new Promise(z => setTimeout(z, 20_000)).then(get)) : await fetch(V + path, { method, body });
    const result = await res.json() as any;
    if (result.error?.code === 9) {
        await recordInstagramWriteHold('Meta error 9: User is performing too many actions', 'legacy_api_fallback', 9);
        throw Error('Instagram writes stopped after Meta error 9; no later item will be submitted');
    }
    return result;
};
const pageToken: string = (await g(PAGE, 'GET', { fields: 'access_token', access_token: token })).access_token;
const canPostPage = ((await g('me/permissions', 'GET', { access_token: token })).data ?? [])
    .some((p: any) => p.permission === 'pages_manage_posts' && p.status === 'granted');

/** Page Reel upload (start, binary upload, finish). Returns the video id or an error string. */
const facebookReel = async (path: string, description: string) => {
    if (!canPostPage) return { error: 'skipped: token lacks pages_manage_posts' };
    const start = await g(PAGE + '/video_reels', 'POST', { upload_phase: 'start', access_token: pageToken });
    if (!start.video_id) return { error: start.error?.message ?? 'no video id' };
    const up = await fetch('https://rupload.facebook.com/video-upload/v21.0/' + start.video_id, { method: 'POST', body: readFileSync(path),
        headers: { Authorization: 'OAuth ' + pageToken, offset: '0', file_size: String(statSync(path).size) } });
    if (!up.ok) return { error: 'facebook upload ' + up.status };
    const fin = await g(PAGE + '/video_reels', 'POST', { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description, access_token: pageToken });
    return fin.success ? { videoId: start.video_id } : { error: fin.error?.message ?? 'facebook finish failed' };
};


/** Serve one file for a few minutes at a random path through a Cloudflare quick tunnel (no account, no DNS change). */
const serveOnce = async (path: string) => {
    const { createServer } = await import('node:http');
    const { createReadStream } = await import('node:fs');
    const { spawn } = await import('node:child_process');
    const { randomBytes } = await import('node:crypto');
    const name = '/' + randomBytes(16).toString('hex') + '.mp4', size = statSync(path).size;
    const server = createServer((q, s) => {
        if (q.url !== name) { s.writeHead(404); s.end(); return; }
        s.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(size) });
        if (q.method === 'HEAD') { s.end(); return; }
        createReadStream(path).pipe(s);
    });
    await new Promise<void>(z => server.listen(0, '127.0.0.1', () => z()));
    const port = (server.address() as any).port;
    const tunnel = spawn('/opt/homebrew/bin/cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    const close = () => { tunnel.kill(); server.close(); };
    const base = await new Promise<string>((ok, bad) => {
        const t = setTimeout(() => bad(new Error('no tunnel URL in 60 s')), 60_000);
        tunnel.stderr.on('data', (d: Buffer) => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(t); ok(m[0]); } });
    }).catch(e => { close(); throw e; });
    // the quick tunnel's hostname can take a few seconds to resolve; wait until the file answers before handing it to Meta
    for (let n = 0; n < 20; n++) { const h = await fetch(base + name, { method: 'HEAD' }).catch(() => null); if (h?.ok) break; await new Promise(z => setTimeout(z, 3000)); }
    return { url: base + name, close };
};

const db = createDatabaseConnection();
const rows = (await db.pool.query(`SELECT r.item_id, r.share_claimed_at, r.updated_at, i.input, i.media FROM scheduler.publishing_releases r
    JOIN scheduler.publishing_items i ON i.id=r.item_id
    WHERE r.state='needs_review' AND i.status='needs_review' AND r.updated_at > now()-interval '24 hours'
      AND NOT (i.results ? 'metaTrialPilot')
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
    if (r.input.facebookMode === 'linked_from_instagram' && r.input.targets?.some((t: any) => t.platform === 'facebook')) {
        console.log(JSON.stringify({ id, action: 'held: no supported API control for linked Facebook sharing has been verified' }));
        continue;
    }
    // --now (Antonio, Oct 27: "post through the api for trial reels please") skips the 45-minute wait for one named item;
    // the live-caption check above still runs first, so a late phone upload is never posted twice.
    if (r.share_claimed_at && Date.now() - Date.parse(r.updated_at) < 45 * 60_000 && !(only && process.argv.includes('--now'))) { console.log(JSON.stringify({ id, action: 'waiting: Share was tapped under 45 min ago' })); continue; }
    console.log(JSON.stringify({ id, action: apply ? 'posting by API' : 'would post by API', file: r.media.path }));
    if (!apply) continue;

    const trial = r.input.instagramTrial !== false;
    // Oct 27: trial_params only takes effect on the standard upload (Meta fetches video_url); with upload_type=resumable it is
    // accepted and ignored (DfBPB40DX8A went out as a normal reel). A Trial item is served for a few minutes from a random
    // file name through a Cloudflare quick tunnel; everything else keeps the resumable upload.
    const hosted = trial ? await serveOnce(r.media.path).catch((e: any) => ({ error: String(e) } as any)) : null;
    if (hosted?.error) { console.log(JSON.stringify({ id, error: 'trial hosting failed: ' + hosted.error })); continue; }
    let c: any;
    try {
        c = await g(IG + '/media', 'POST', trial
            ? { media_type: 'REELS', video_url: hosted.url, caption, trial_params: JSON.stringify({ graduation_strategy: 'SS_PERFORMANCE' }), access_token: pageToken }
            : { media_type: 'REELS', upload_type: 'resumable', caption, access_token: pageToken });
        if (!c.id) { console.log(JSON.stringify({ id, error: c.error?.message ?? 'no container' })); continue; }
        if (!trial) {
            const up = await fetch('https://rupload.facebook.com/ig-api-upload/v21.0/' + c.id, { method: 'POST', body: readFileSync(r.media.path),
                headers: { Authorization: 'OAuth ' + pageToken, offset: '0', file_size: String(statSync(r.media.path).size) } });
            if (!up.ok) { console.log(JSON.stringify({ id, error: 'upload ' + up.status, body: (await up.text()).slice(0, 300) })); continue; }
        }
        let st0: any = {};  // Meta fetches video_url while the container processes; keep the file served until it finishes
        for (let n = 0; n < 60 && !['FINISHED', 'ERROR', 'EXPIRED'].includes(st0.status_code); n++) { await new Promise(z => setTimeout(z, 10_000)); st0 = await g(c.id, 'GET', { fields: 'status_code,status', access_token: pageToken }); }
        if (st0.status_code !== 'FINISHED') { console.log(JSON.stringify({ id, error: 'container ' + st0.status_code, status: st0.status })); continue; }
    } finally { hosted?.close?.(); }
    const pub = await g(IG + '/media_publish', 'POST', { creation_id: c.id, access_token: pageToken });
    if (!pub.id) { console.log(JSON.stringify({ id, error: pub.error?.message ?? 'publish failed' })); continue; }
    const media = await g(pub.id, 'GET', { fields: 'permalink,caption', access_token: pageToken });
    const comment = r.input.firstComment ? await g(pub.id + '/comments', 'POST', { message: r.input.firstComment, access_token: pageToken }) : null;
    const wantsFacebook = (r.input.targets ?? []).some((t: any) => t.platform === 'facebook');
    const fb = wantsFacebook
        ? r.input.facebookMode === 'direct' ? await facebookReel(r.media.path, caption)
            : { error: 'Linked Facebook sharing is unverified; a separate Facebook upload is forbidden' }
        : { error: 'not a Facebook target' };
    // trial_params is accepted, but the Graph API exposes no Trial field on the published media and is_shared_to_feed read
    // true on the first one (Oct 27, DfBPB40DX8A), so the receipt records the request; only the phone's Trial reels list proves it.
    const receipt = { postedVia: 'instagram_graph_api', trialRequested: trial, trialVerified: false, automaticPromotion: trial, facebook: 'videoId' in fb ? fb : false,
        facebookSkipped: 'error' in fb ? fb.error : undefined,
        receipts: { instagram: { url: media.permalink, mediaId: pub.id, captionMatches: media.caption === caption } },
        firstComment: comment?.id ? { id: comment.id, pinned: false } : comment?.error?.message ?? null };
    await done(id, receipt);
    console.log(JSON.stringify({ id, ...receipt }));
}
await db.close();
