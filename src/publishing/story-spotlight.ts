/** Script-only Story sequences (no model): five full-bleed frames from Antonio's newest feed Reel, with text taken from
 * that Reel's own published caption. Covered by Antonio's standing approval of Oct 13, 2026 (see storySchedule). */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { StorySequenceStore } from './story-sequences.js';
import { reviewStoryDraft } from './story-policy.js';

export const SPOTLIGHT_FALLBACKS = ['New reel is up on my profile.', 'The full breakdown is in the reel.', 'Watch it to the end.', 'Save it so you can find it later.'];
const PHONE = '00008130-000229EE1AA0001C', W = 1080, H = 1920;

/** Caption to five frame texts. Only the caption's own sentences, a keyword CTA, or fixed neutral fallbacks. */
export function spotlightTexts(caption: string): string[] {
    const keyword = caption.match(/\bComment\s+["“']?([A-Z][A-Z0-9]{1,19})["”']?/)?.[1];
    const clean = (s: string) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/^\s*(\d+[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim();
    const lines = caption.split('\n').map(clean)
        .filter(l => l && !l.startsWith('#') && !/^follow @/i.test(l) && !/@antoniorevenue/i.test(l));
    // Split first, then drop CTA sentences: some captions put the whole pitch on the "Comment X" line (Oct 13, YOUTUBE).
    const sentences = lines.flatMap(l => l.match(/[^.!?]+[.!?]*/g) ?? []).map(s => s.trim())
        .filter(s => { const w = s.split(/\s+/).length; return w >= 3 && w <= 25 && s.length <= 170 && !s.endsWith(':') && !/\bcomment\b/i.test(s) && !s.includes('#'); });
    const picked = [...new Set(sentences)].slice(0, 4);
    for (const f of SPOTLIGHT_FALLBACKS) if (picked.length < 4 && !picked.includes(f)) picked.push(f);
    const reply = keyword ? `Comment ${keyword} on the reel and I'll send it to you.` : 'Watch the full reel on my profile.';
    return [...picked.slice(0, 4), reply];
}

/** Newest published feed Reel (verified Instagram receipt, not Trial) that no Story plan has used yet. */
export async function nextSpotlightReel(pool: Pool) {
    return (await pool.query(`SELECT i.id,i.media->>'path' path,i.input->>'caption' caption,r.result->'receipts'->'instagram'->>'url' url
        FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
        WHERE i.status='published' AND i.input->'targets' @> '[{"platform":"instagram"}]'
        AND r.result->'receipts'->'instagram'->>'verified'='true'
        AND COALESCE(r.result->'receipts'->'instagram'->>'sharedToFeed','true')<>'false' AND COALESCE(i.input->>'instagramTrial','false')<>'true'
        AND r.updated_at > now()-interval '3 days'
        AND NOT EXISTS(SELECT 1 FROM scheduler.story_sequences s WHERE s.state<>'cancelled' AND s.draft->>'sourceReelId'=i.id::text)
        ORDER BY r.updated_at DESC LIMIT 1`)).rows[0] as { id: string; path: string; caption: string; url: string } | undefined;
}

function grab(video: string, seconds: number): Buffer {
    return execFileSync('ffmpeg', ['-v', 'error', '-ss', seconds.toFixed(2), '-i', video, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 << 20 });
}
/** Five distinct, non-blank frames: at each point, the brightest high-contrast of three nearby candidates. */
export async function spotlightFrames(video: string): Promise<Buffer[]> {
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }));
    if (!(duration > 5)) throw Error('Reel is too short for a Story sequence');
    const frames: Buffer[] = [], seen = new Set<string>();
    for (const at of [0.06, 0.28, 0.5, 0.72, 0.92]) {
        let best: { png: Buffer; score: number } | undefined;
        for (const d of [-1.2, 0, 1.2]) {
            const t = Math.min(duration - 0.3, Math.max(0.2, at * duration + d));
            const png = grab(video, t), st = await sharp(png).stats();
            const mean0 = st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3, score = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) + mean0, mean = st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
            if (mean < 12 || mean > 245) continue;
            if (!best || score > best.score) best = { png, score };
        }
        if (!best) throw Error('No usable frame near ' + Math.round(at * 100) + '% of the Reel');
        // Full-bleed 9:16, slightly darkened so the native white text reads on any frame.
        const out = await sharp(best.png).resize(W, H, { fit: 'cover' }).modulate({ brightness: 0.78 }).removeAlpha().png().toBuffer();
        const key = createHash('sha256').update(out).digest('hex');
        if (seen.has(key)) throw Error('Two Story frames are identical');
        seen.add(key); frames.push(out);
    }
    return frames;
}

/** Build and save one plan for a slot. Returns null when no new feed Reel exists. Never touches the phone. */
export async function buildSpotlightPlan(pool: Pool, runAt: Date) {
    const reel = await nextSpotlightReel(pool);
    if (!reel) return null;
    const texts = spotlightTexts(reel.caption ?? ''), images = await spotlightFrames(reel.path);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(runAt);
    const dir = path.resolve('.scheduler-data/story-assets', `${date}-spotlight-${runAt.toISOString().slice(11, 13)}-${reel.id.slice(0, 8)}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stages = ['hook', 'point', 'point', 'point', 'reply'], frames = [];
    for (let i = 0; i < 5; i++) {
        const file = path.join(dir, `frame-${i + 1}.png`);
        await writeFile(file, images[i]!, { mode: 0o600 });
        frames.push({ stage: stages[i], text: texts[i], assetKind: 'reel_frame', assetRef: file, automatedChecks: true, claimReview: 'source_checked', sourceRef: reel.url });
    }
    const draft = { policyVersion: 2, format: 'reel_spotlight', nativeText: true, musicStyle: 'music_only', sourceReelId: reel.id, frames };
    const review = reviewStoryDraft(draft);
    if (!review.valid) throw Error('Spotlight plan failed review: ' + review.errors.join(' '));
    // A cancelled plan keeps its request ID, so a rebuild for the same slot gets the next build number.
    const base = `spotlight-${runAt.toISOString().replace(/[:.]/g, '-')}`;
    const builds = Number((await pool.query(`SELECT count(*) n FROM scheduler.story_sequences WHERE request_id LIKE $1`, [base + '%'])).rows[0].n);
    return new StorySequenceStore(pool).save({ requestId: builds ? `${base}-${builds + 1}` : base, title: 'Spotlight: ' + texts[0]!.slice(0, 120),
        deviceUdid: PHONE, account: 'antoniorevenue', facebookAccount: '61584693917444', runAt: runAt.toISOString(), draft });
}

/** For each Story slot 1 to 30 hours ahead without a plan, build a spotlight plan. */
export async function ensureSpotlightPlans(pool: Pool) {
    const slots = (await pool.query(`SELECT d.run_at FROM scheduler.story_daily_slots d WHERE d.run_at > now()+interval '1 hour' AND d.run_at < now()+interval '30 hours'
        AND NOT EXISTS(SELECT 1 FROM scheduler.story_sequences s WHERE s.run_at=d.run_at AND s.state<>'cancelled') ORDER BY d.run_at`)).rows;
    for (const s of slots) {
        try { await buildSpotlightPlan(pool, new Date(s.run_at)); }
        catch (error) { console.error(new Date().toISOString(), 'Story spotlight plan failed:', error instanceof Error ? error.message : error); }
    }
}
