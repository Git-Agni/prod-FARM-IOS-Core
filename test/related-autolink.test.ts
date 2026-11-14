import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRelatedReelInCatalog, linkRelatedReel} from '../src/publishing/related-autolink.js';
import {reelCatalog} from '../src/publishing/instagram-related.js';
import {TimedReleaseStore} from '../src/publishing/timed-release.js';
import {validatePostingInput, type PostingInput} from '../src/publishing/model.js';

const canvaCaption = 'Connect Claude to Canva and it designs your carousel posts';
const canva = reelCatalog.reels.find(r => r.label === 'Canva carousels')!;
const post = (over: Partial<PostingInput> = {}) => validatePostingInput({requestId: 'autolink-test', deviceUdid: 'synthetic-device',
    runAt: new Date(Date.now() + 3600_000).toISOString(), timezone: 'America/Los_Angeles', caption: canvaCaption,
    targets: [{platform: 'instagram', account: 'antoniorevenue'}, {platform: 'facebook', account: 'https://www.facebook.com/antoniorevenue'}],
    instagramTrial: true, automaticPromotion: true, facebookMode: 'linked_from_instagram', ...over});
const media = {path: '/not-read.mp4', sha256: 'new-video'};
const headline = (text: string) => async () => text;

test('an Instagram post without a related Reel gets its topic-matched one', async () => {
    const linked = await linkRelatedReel(post(), media, headline('MAKE CAROUSELS FAST'));
    assert.deepEqual(linked?.input.instagramRelatedReel, {url: canva.url, caption: canva.caption, label: canva.label});
    assert.equal(linked?.choice.to, canva.url);
    assert.equal(linked?.choice.automatic, true);
});

test('the post\'s own cover headline keeps a re-cut from linking itself', async () => {
    const linked = await linkRelatedReel(post(), media, headline(canva.headline));
    assert.ok(linked);
    assert.notEqual(linked.input.instagramRelatedReel!.url, canva.url);
});

test('nothing changes for a chosen Reel, a TikTok item, an unreadable frame or the same video', async () => {
    const chosen = post({instagramRelatedReel: {url: reelCatalog.defaultUrl, caption: 'c', label: 'Claude YouTube'}});
    assert.equal(await linkRelatedReel(chosen, media, headline('X')), undefined);
    const tiktok = post({targets: [{platform: 'tiktok', account: 'antoniorevenue'}], instagramTrial: false, automaticPromotion: false, facebookMode: 'direct'});
    assert.equal(await linkRelatedReel(tiktok, media, headline('X')), undefined);
    assert.equal(await linkRelatedReel(post(), media, async () => { throw new Error('ffmpeg failed'); }), undefined);
    assert.equal(await linkRelatedReel(post(), {...media, sha256: canva.sha256}, headline('X')).then(l => l?.input.instagramRelatedReel?.url === canva.url), false);
});

test('the worker refuses a related Reel its loaded catalog does not know, naming a restart', () => {
    assertRelatedReelInCatalog(post({instagramRelatedReel: {url: canva.url, caption: canva.caption, label: canva.label}}));
    assertRelatedReelInCatalog(post());
    assert.throws(() => assertRelatedReelInCatalog(post({instagramRelatedReel: {url: 'https://www.instagram.com/reel/NotInCatalog1/', caption: 'c', label: 'New Reel'}})),
        /not in the Reel catalog this worker loaded at start\. Restart the worker/);
});

test('Instagram preflight stops on an unknown related Reel before any phone input', async () => {
    const {InstagramRelease} = await import('../src/publishing/instagram-release.js');
    const d = new InstagramRelease('http://unused', new AbortController().signal) as any;
    const calls: string[] = [];
    d.request = async (path: string) => { calls.push(path); return {value: {}}; };
    d.start = async () => { calls.push('start'); };
    const input = post({instagramRelatedReel: {url: 'https://www.instagram.com/reel/NotInCatalog1/', caption: 'c', label: 'New Reel'}});
    await assert.rejects(d.preflight(input, {path: '/not-read.mp4', sha256: 'x'}), /Restart the worker/);
    assert.deepEqual(calls, []);
});

/** A pool that answers the arm transaction's queries and records the writes. */
function armPool(item: any) {
    const writes: {sql: string; params: any[]}[] = [];
    const client = {
        query: async (sql: string, params: any[] = []) => {
            if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || sql.includes('pg_advisory_xact_lock')) return {rows: [], rowCount: 0};
            if (sql.startsWith('SELECT * FROM scheduler.publishing_items')) return {rows: [item], rowCount: 1};
            if (sql.includes('SELECT i.id FROM scheduler.publishing_items')) return {rows: [], rowCount: 0};
            writes.push({sql, params});
            if (sql.startsWith('UPDATE scheduler.publishing_items')) return {rows: [{version: item.version + 1}], rowCount: 1};
            return {rows: [{item_id: item.id}], rowCount: 1};
        },
        release: () => undefined,
    };
    return {pool: {connect: async () => client} as any, writes};
}

test('arming links the related Reel and arms the new item version', async () => {
    const item = {id: '00000000-0000-4000-8000-000000000001', version: 2, status: 'held', input: post(), media: {...media, name: 'n.mp4'}};
    const {pool, writes} = armPool(item);
    await new TimedReleaseStore(pool, headline('MAKE CAROUSELS FAST')).arm(item.id, 2);
    const [update, insert] = writes;
    assert.match(update!.sql, /UPDATE scheduler.publishing_items SET input=\$2.*version=version\+1/s);
    assert.equal(update!.params[1].instagramRelatedReel.url, canva.url);
    assert.equal(update!.params[4], 2, 'the update only applies to the version the caller armed');
    assert.match(insert!.sql, /INSERT INTO scheduler.publishing_releases/);
    assert.deepEqual(insert!.params, [item.id, 3]);
});

test('arming leaves a chosen Reel, and a post due within 10 minutes, unchanged', async () => {
    for (const input of [post({instagramRelatedReel: {url: canva.url, caption: canva.caption, label: canva.label}}),
        post({runAt: new Date(Date.now() + 5 * 60_000).toISOString()})]) {
        const item = {id: '00000000-0000-4000-8000-000000000002', version: 4, status: 'held', input, media: {...media, name: 'n.mp4'}};
        const {pool, writes} = armPool(item);
        await new TimedReleaseStore(pool, headline('MAKE CAROUSELS FAST')).arm(item.id, 4);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0]!.params, [item.id, 4]);
    }
});
