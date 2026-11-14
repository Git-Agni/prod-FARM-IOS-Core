import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReasons, heartbeatFrom } from '../src/data.ts';
import { renderPage } from '../src/render.ts';

test('heartbeat older than 90 seconds reads as stopped', () => {
    const now = new Date('2026-10-12T20:00:00Z');
    assert.equal(heartbeatFrom({ last_tick: '2026-10-12T19:59:30Z', control_mode: 'wda', state: 'running', blockers: [] }, now).state, 'running');
    assert.equal(heartbeatFrom({ last_tick: '2026-10-12T19:58:00Z', control_mode: 'wda', state: 'running', blockers: [] }, now).state, 'stopped');
    assert.equal(heartbeatFrom({ last_tick: '2026-10-12T19:59:50Z', control_mode: 'wda', state: 'blocked', blockers: ['x'] }, now).state, 'blocked');
    assert.equal(heartbeatFrom(undefined, now).state, 'stopped');
});

test('reasons are pulled from nested results with their section', () => {
    const reasons = extractReasons({ externalYouTubeDelivery: { reason: 'Needs metadata review', checkedAt: 'x' }, receipts: { instagram: { error: 'not posted' } }, ok: true });
    assert.deepEqual(reasons, ['externalYouTubeDelivery: Needs metadata review', 'receipts: not posted']);
    assert.deepEqual(extractReasons(null), []);
});

test('page escapes captions and shows no control actions', () => {
    const html = renderPage({
        generatedAt: '2026-10-12T20:00:00Z',
        heartbeat: { lastTick: null, ageSeconds: null, healthy: false, controlMode: null, state: 'stopped', blockers: ['No heartbeat'] },
        counts: { armed: 1, running: 0, published24h: 0, publishedTotal: 0, needsReview: 0 },
        queue: [{ itemId: 'a', runAt: '2026-10-12T21:00:00Z', state: 'armed', targets: [{ platform: 'instagram' }], caption: '<script>x</script>' }],
        published: [], review: [],
    }, 'https://phonefarm.clicktoclose.ai/publishing', 'antonio@clicktoclose.ai');
    assert.ok(!html.includes('<script>x'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!/<form|<button|method="post"/i.test(html));
    assert.ok(html.includes('Mac worker stopped'));
});
