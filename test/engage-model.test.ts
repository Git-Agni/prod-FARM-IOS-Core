import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertEngageControl, predicateLiteral, validateEngagePayload } from '../src/publishing/engage-model.js';

const base = { postUrl: 'https://www.instagram.com/reel/Dd4XAhPAdDu/', captionPrefix: 'Comment COUNCIL and I', comment: 'What business idea would you put in front of the council first?' };

test('pin claims one key per reel', () => {
    const p = validateEngagePayload({ ...base, action: 'pin' }, '2026-09-30');
    assert.equal(p.claimKey, 'pin:https://www.instagram.com/reel/Dd4XAhPAdDu/');
});

test('story claims one key per day, whatever the reel', () => {
    const a = validateEngagePayload({ ...base, action: 'story', comment: '' }, '2026-09-30');
    const b = validateEngagePayload({ ...base, action: 'story', postUrl: 'https://www.instagram.com/reel/Other12345/', comment: '' }, '2026-09-30');
    assert.equal(a.claimKey, 'story:2026-09-30');
    assert.equal(a.claimKey, b.claimKey);
});

test('rejects non-reel URLs, URL comments and missing pin text', () => {
    assert.throws(() => validateEngagePayload({ ...base, action: 'pin', postUrl: 'https://evil.example/reel/x/' }, 'd'));
    assert.throws(() => validateEngagePayload({ ...base, action: 'pin', comment: 'see https://clicktoclose.ai/lm/x now' }, 'd'));
    assert.throws(() => validateEngagePayload({ ...base, action: 'pin', comment: '' }, 'd'));
    assert.throws(() => validateEngagePayload({ ...base, action: 'like' }, 'd'));
});

test('only engagement controls are allowed, never share-sheet contacts', () => {
    assert.doesNotThrow(() => assertEngageControl('share-to-your-story'));
    assert.throws(() => assertEngageControl('supershare-v3-cell'));
    assert.throws(() => assertEngageControl('send-to-button'));
});

test('predicate literals are escaped and bounded', () => {
    assert.equal(predicateLiteral('say "hi" \\ now'), 'say \\"hi\\" \\\\ now');
    assert.equal(predicateLiteral('x'.repeat(90)).length, 90);
});

test('story_best needs no URL and shares the one Story per day key', () => {
    const p = validateEngagePayload({ action: 'story_best' }, '2026-09-30');
    assert.equal(p.claimKey, 'story:2026-09-30');
    assert.equal(p.postUrl, '');
});
