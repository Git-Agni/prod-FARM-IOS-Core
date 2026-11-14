import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spotlightTexts,SPOTLIGHT_FALLBACKS} from '../src/publishing/story-spotlight.js';
import {reviewStoryDraft} from '../src/publishing/story-policy.js';

test('spotlight text comes only from the caption, a keyword CTA or fixed lines', () => {
    const t = spotlightTexts('Comment "SWAP" and I\'ll send you my guide 👇\n\nFree Claude Code just hit 705 stars in one day on GitHub. It keeps the Claude Code app and swaps the model underneath.\n\nWhat the README says it does:\n1. Connects 61 providers: free, paid and local models\n\nFollow @antoniorevenue. I post every day.\n\n#claudeai #ai');
    assert.equal(t.length, 5);
    assert.equal(t[0], 'Free Claude Code just hit 705 stars in one day on GitHub.');
    assert.equal(t[2], 'Connects 61 providers: free, paid and local models');
    assert.equal(t[4], "Comment SWAP on the reel and I'll send it to you.");
    assert.ok(!t.some(x => /#|@antoniorevenue|What the README says/.test(x)));
});

test('a short caption falls back to neutral lines and a profile CTA without a keyword', () => {
    const t = spotlightTexts('Big news today for every sales team.\n#ai');
    assert.deepEqual(t.slice(1, 4), SPOTLIGHT_FALLBACKS.slice(0, 3));
    assert.equal(t[4], 'Watch the full reel on my profile.');
});

const frame = (n: number, stage: string, ref = 'https://www.instagram.com/reel/AbC123/') => ({stage, text: 'Line ' + n, assetKind: 'reel_frame', assetRef: `/x/frame-${n}.png`, automatedChecks: true, claimReview: 'source_checked', sourceRef: ref});
const draft = (frames: any[]) => ({policyVersion: 2, format: 'reel_spotlight', nativeText: true, musicStyle: 'music_only', sourceReelId: '3eb6d874-0232-4b99-936b-b5146bace93c', frames});
const stages = ['hook', 'point', 'point', 'point', 'reply'];

test('a spotlight passes with five distinct frames from one Reel', () => {
    assert.equal(reviewStoryDraft(draft(stages.map((s, i) => frame(i + 1, s)))).valid, true);
});

test('a spotlight is rejected when frames mix Reels or repeat an image', () => {
    assert.equal(reviewStoryDraft(draft(stages.map((s, i) => frame(i + 1, s, i ? undefined : 'https://www.instagram.com/reel/Other1/')))).valid, false);
    const repeated = stages.map((s, i) => frame(i + 1, s)); repeated[4].assetRef = repeated[0].assetRef;
    assert.equal(reviewStoryDraft(draft(repeated)).valid, false);
    const unchecked = stages.map((s, i) => frame(i + 1, s)); (unchecked[2] as any).automatedChecks = false;
    assert.equal(reviewStoryDraft(draft(unchecked)).valid, false);
});

test('a caption whose pitch shares the Comment line still yields five texts', () => {
    const t = spotlightTexts("Comment YOUTUBE and I'll send you 11 free Claude skills that run most of your YouTube workflow. One writes scripts from 21 hook formulas, and the others handle titles. One even breaks down the top videos in your niche.\n\n#claude #ai");
    assert.equal(t.length, 5);
    assert.ok(t.every(x => typeof x === 'string' && x.length > 0));
    assert.equal(t[0], 'One writes scripts from 21 hook formulas, and the others handle titles.');
    assert.equal(t[4], "Comment YOUTUBE on the reel and I'll send it to you.");
});
