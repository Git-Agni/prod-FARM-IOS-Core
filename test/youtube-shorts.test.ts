import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validatePostingInput, requestHash } from '../src/publishing/model.js';
import { inspectShortsVideo, validateShortsProbe } from '../src/publishing/youtube-shorts.js';
import { assertReleaseTargets, releaseOnce } from '../src/publishing/release-policy.js';

const input = {
    requestId: 'youtube-test-20261002', deviceUdid: 'synthetic-device', caption: 'Test description',
    runAt: '2026-10-03T18:00:00Z', timezone: 'America/Los_Angeles',
    targets: [{ platform: 'youtube', account: 'synthetic-channel' }],
    instagramTrial: false, automaticPromotion: false, facebookMode: 'linked_from_instagram',
    youtube: { title: 'Short title', channelId: 'UC' + 'x'.repeat(22), visibility: 'private', madeForKids: false },
};

test('YouTube stores exact metadata and hashes changes to channel or visibility', () => {
    const p = validatePostingInput(input);
    assert.deepEqual(p.youtube, input.youtube);
    assert.notEqual(requestHash(p, 'video'), requestHash(validatePostingInput({ ...input, youtube: { ...input.youtube, visibility: 'public' } }), 'video'));
    assert.equal(validatePostingInput({ ...input, caption: 'a'.repeat(5000) }).caption.length, 5000);
    assert.throws(() => validatePostingInput({ ...input, caption: 'a'.repeat(5001) }), /5,000/);
});

test('YouTube rejects missing audience, ambiguous channel, mixed platforms and unsupported extras', () => {
    for (const patch of [
        { youtube: { ...input.youtube, madeForKids: undefined } },
        { youtube: { ...input.youtube, channelId: 'channel name' } },
        { youtube: { ...input.youtube, title: 'x'.repeat(101) } },
        { youtube: { ...input.youtube, visibility: 'scheduled' } },
        { targets: [...input.targets, { platform: 'tiktok', account: 'synthetic' }] },
        { instagramTrial: true, automaticPromotion: true },
    ]) assert.throws(() => validatePostingInput({ ...input, ...patch }));
});

test('YouTube cannot reach a native driver or acquire an upload claim', async () => {
    const p = validatePostingInput(input);
    assert.throws(() => assertReleaseTargets(p), /preparation only/);
    const calls: string[] = [];
    await assert.rejects(releaseOnce(p, {}, {
        preflight: async () => { calls.push('phone'); throw new Error('Must not call'); },
        shareOnce: async () => { calls.push('upload'); }, verify: async () => ({}),
    }, { claimShare: async () => { calls.push('claim'); return true; }, save: async (_state, result: any) => { assert.equal(result.shareAttempted, false); } }), /preparation only/);
    assert.deepEqual(calls, []);
});

test('Shorts validates rotation, real duration and orientation', () => {
    const probe = (width: number, height: number, duration: string, rotation = 0) => ({ streams: [{ codec_type: 'video', width, height, sample_aspect_ratio: '1:1', side_data_list: [{ rotation }] }], format: { duration } });
    assert.equal(validateShortsProbe(probe(1080, 1920, '180')).eligible, true);
    assert.equal(validateShortsProbe(probe(1920, 1080, '28.9', -90)).width, 1080);
    for (const p of [probe(1920, 1080, '28'), probe(1080, 1920, '180.01'), probe(1080, 1920, 'NaN'), probe(1080, 1920, '28', 45), { streams: [] }])
        assert.throws(() => validateShortsProbe(p));
});

test('Actual ffprobe accepts a vertical fixture and rejects a renamed non-video file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'shorts-test-'));
    try {
        const file = path.join(dir, 'fixture.mp4');
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=90x160:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
        const result = await inspectShortsVideo(file);
        assert.equal(result.width, 90); assert.equal(result.height, 160);
        await writeFile(path.join(dir, 'fake.mp4'), 'This is not a video');
        await assert.rejects(inspectShortsVideo(path.join(dir, 'fake.mp4')), /inspection failed/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
