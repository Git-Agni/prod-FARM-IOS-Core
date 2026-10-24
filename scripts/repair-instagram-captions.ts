/** Put the saved caption back on Instagram Trial Reels that published with an empty caption (Oct 23: eight Reels from
 * 12 PM to 7 PM). Usage: repair-instagram-captions.ts pairs.json [--apply]   pairs.json = [{"url": "...", "itemId": "..."}]
 * Per Reel: holds the phone lock, opens the Reel by link, opens More > Manage trial > Edit, and only when the caption box
 * is empty types the item's caption, reads it back, taps Done, then confirms the caption through the Graph API.
 * Without --apply it stops at the Edit screen and taps Cancel. Never posts, shares or deletes. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createDatabaseConnection } from '../src/database/client.js';
import { InstagramRelease } from '../src/publishing/instagram-release.js';
import { metaReceipts, normalizeText } from '../src/publishing/meta-receipts.js';

const PHONE = '00008130-000229EE1AA0001C', BASE = 'http://127.0.0.1:8100', apply = process.argv.includes('--apply');
const pairs: { url: string; itemId: string }[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const out = '.scheduler-data/caption-repair/' + new Date().toISOString().replace(/[:.]/g, '-'); mkdirSync(out, { recursive: true });
const db = createDatabaseConnection(), c = await db.pool.connect();
const results: any[] = [];

for (const pair of pairs) {
    const item = (await c.query('SELECT input FROM scheduler.publishing_items WHERE id=$1', [pair.itemId])).rows[0];
    if (!item) { results.push({ ...pair, status: 'no item' }); continue; }
    const caption: string = (pair as any).caption ?? item.input.caption;
    let locked = false;
    const d: any = new InstagramRelease(BASE, AbortSignal.timeout(180_000));
    const shot = async (n: string) => { try { writeFileSync(`${out}/${pair.itemId.slice(0, 8)}-${n}.png`, Buffer.from((await d.request('/screenshot')).value, 'base64')); } catch { /* evidence only */ } };
    try {
        for (let n = 0; n < 20 && !locked; n++) {
            locked = (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l', [PHONE])).rows[0].l;
            if (!locked) await new Promise(r => setTimeout(r, 30_000));
        }
        if (!locked) throw Error('Phone busy for 10 minutes');
        await d.start('com.burbn.instagram');
        // A previous failed attempt can leave the Edit info sheet open: discard it before opening the next Reel.
        if (await d.visible('accessibility id', 'Cancel') && await d.visible('predicate string', 'type == "XCUIElementTypeTextView"')) { await d.tapElement('accessibility id', 'Cancel', 'Cancel stale edit'); await d.sleep(1500); if (await d.visible('predicate string', 'label == "Discard" AND visible == 1')) await d.tapElement('predicate string', 'label == "Discard" AND visible == 1', 'Discard'); await d.sleep(1000); }
        await d.request(d.session + '/url', { url: pair.url });
        await d.sleep(4000);
        await d.tapElement('accessibility id', 'more-options-button', 'More');
        await d.sleep(1200);
        await d.tapElement('predicate string', 'label == "Manage trial" AND visible == 1', 'Manage trial');
        await d.sleep(1500);
        await d.tapElement('predicate string', 'label == "Edit" AND visible == 1', 'Edit');
        const TV = 'type == "XCUIElementTypeTextView" AND visible == 1';
        await d.waitFor('predicate string', TV, 'caption box', 15_000);
        await d.sleep(1500);   // the Edit sheet re-renders once after it opens
        const before = await d.read('predicate string', TV, 'value', 'caption box');
        await shot('edit');
        if (before.trim() && before !== 'Write a caption...') { await d.tapElement('accessibility id', 'Cancel', 'Cancel'); results.push({ ...pair, status: 'already has a caption', before: before.slice(0, 60) }); continue; }
        if (!apply) { await d.tapElement('accessibility id', 'Cancel', 'Cancel'); results.push({ ...pair, status: 'dry run: empty caption found' }); continue; }
        await d.request(`${d.session}/element/${await d.waitFor('predicate string', TV, 'caption box')}/value`, { value: [caption] });
        await d.sleep(800);
        // Hashtag suggestions cover the box after typing, so iOS reports it as not visible; read it without that filter.
        const typed = await d.read('predicate string', 'type == "XCUIElementTypeTextView"', 'value', 'typed caption');
        if (normalizeText(typed) !== normalizeText(caption)) { await d.tapElement('accessibility id', 'Cancel', 'Cancel'); throw Error('Typed caption did not read back; cancelled'); }
        await shot('typed');
        await d.tapElement('accessibility id', 'Done', 'Done');
        await d.sleep(4000);
        await shot('saved');
        let graph = false;
        for (let n = 0; n < 6 && !graph; n++) {
            const found = await metaReceipts(caption, Date.now() - 24 * 3600_000).catch(() => ({} as any));
            graph = found.instagram?.url?.includes(pair.url.split('/reel/')[1]!.replace('/', '')) ?? false;
            if (!graph) await d.sleep(10_000);
        }
        results.push({ ...pair, status: graph ? 'repaired, Graph caption matches' : 'saved in app, Graph not matched yet' });
    } catch (e: any) { await shot('error'); results.push({ ...pair, status: 'failed: ' + e.message }); }
    finally {
        try { await d.leaveVideo(); } catch { /* best effort */ }
        await fetch(BASE + '/wda/homescreen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
        if (locked) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [PHONE]);
    }
    console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
c.release(); await db.close();
