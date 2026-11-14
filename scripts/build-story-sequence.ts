/** Build one five-frame Story plan from the newest posted Instagram Reel. Never touches the phone and never approves.
 * Usage: build-story-sequence.ts SPEC.json [--save]
 * The spec names the slot, the copy and, per frame, either a second of the Reel (with a crop) or a reviewed local photo.
 * The Reel must be the newest published @antoniorevenue feed Reel (not a Trial Reel) with a verified Graph receipt;
 * an older one is refused.
 * Writes 1080x1920 PNGs to .scheduler-data/story-assets/DATE-SLUG (the runner only reads Phone Farm data), copies them
 * with manifest.json and plan.json to docs/stories/DATE/SLUG, and runs the policy review. --save stores the plan in
 * scheduler.story_sequences for its slot. Native drafts, owner approval and Share stay with the Story runner. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createDatabaseConnection } from '../src/database/client.js';
import { reviewStoryDraft } from '../src/publishing/story-policy.js';
import { StorySequenceStore } from '../src/publishing/story-sequences.js';

interface FrameSpec {
    stage: string; text: string; assetKind: string; claimReview: 'no_factual_claim' | 'source_checked'; sourceNote?: string;
    reelSecond?: number; crop?: { x: number; y: number; width: number; height: number }; photo?: string; reviewNote: string;
}
interface Spec { slug: string; title: string; runAt: string; format: 'proof_led' | 'post_led'; reelId: string; frames: FrameSpec[] }

const [specPath, flag] = process.argv.slice(2);
if (!specPath) throw Error('Usage: build-story-sequence.ts SPEC.json [--save]');
const spec = JSON.parse(await readFile(specPath, 'utf8')) as Spec;
if (!/^[a-z0-9-]{3,40}$/.test(spec.slug) || spec.frames?.length !== 5) throw Error('Spec needs a slug and five frames');
const PHONE = '00008130-000229EE1AA0001C', W = 1080, H = 1920, BG = { r: 13, g: 13, b: 15, alpha: 1 };

const db = createDatabaseConnection();
try {
    // Newest published Instagram Reel with a verified Graph receipt (the same receipts post-links.ts reads).
    const reel = (await db.pool.query(`SELECT i.id,i.media->>'path' path,i.media->>'name' name,r.updated_at,
        r.result->'receipts'->'instagram'->>'url' ig,r.result->'receipts'->'facebook'->>'url' fb
        FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
        WHERE i.status='published' AND i.input->'targets' @> '[{"platform":"instagram"}]'
        AND r.result->'receipts'->'instagram'->>'verified'='true'
        -- Trial Reels are hidden from followers; a Story must point at a Reel on the main grid.
        AND COALESCE(r.result->'receipts'->'instagram'->>'sharedToFeed','true')<>'false' AND COALESCE(i.input->>'instagramTrial','false')<>'true'
        ORDER BY r.updated_at DESC LIMIT 1`)).rows[0];
    if (!reel) throw Error('No published Instagram Reel with a verified receipt');
    if (reel.id !== spec.reelId) throw Error(`The newest posted Reel is ${reel.name} (${reel.id}); update the spec instead of using an older one`);
    const media = await readFile(reel.path);

    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(spec.runAt));
    const dataDir = path.resolve('.scheduler-data/story-assets', `${date}-${spec.slug}`), docsDir = path.resolve('docs/stories', date, spec.slug);
    await mkdir(dataDir, { recursive: true, mode: 0o700 }); await mkdir(docsDir, { recursive: true });

    const manifest = [], frames = [];
    for (const [i, f] of spec.frames.entries()) {
        let source: Buffer, sourceRef: string;
        if (f.reelSecond !== undefined) {
            source = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(f.reelSecond), '-i', reel.path, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 << 20 });
            if (f.crop) source = await sharp(source).extract({ left: f.crop.x, top: f.crop.y, width: f.crop.width, height: f.crop.height }).png().toBuffer();
            sourceRef = `${reel.ig} at ${f.reelSecond} s`;
        } else if (f.photo) { source = await readFile(f.photo); sourceRef = f.photo; }
        else throw Error(`Frame ${i + 1} needs reelSecond or photo`);
        // Content sits in the lower part of a dark 9:16 canvas, so the native text (centered) has open space above it.
        const photo = !!f.photo, fit = await sharp(source).resize(photo ? { width: W, height: 1350, fit: 'cover' } : { width: 1000, height: 620, fit: 'inside' }).png().toBuffer();
        const meta = await sharp(fit).metadata();
        // Native text lands around 40 to 60 % of the height (rehearsal Oct 13), so content starts below it.
        const top = photo ? Math.round((H - meta.height!) / 2) : 1240;
        const png = await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
            .composite([{ input: fit, left: Math.round((W - meta.width!) / 2), top }]).removeAlpha().png().toBuffer();
        const file = path.join(dataDir, `frame-${i + 1}.png`);
        await writeFile(file, png, { mode: 0o600 }); await copyFile(file, path.join(docsDir, `frame-${i + 1}.png`));
        const sha256 = createHash('sha256').update(png).digest('hex');
        manifest.push({ frame: i + 1, stage: f.stage, asset: file, sha256, source: sourceRef, reviewNote: f.reviewNote });
        frames.push({ stage: f.stage, text: f.text, assetKind: f.assetKind, assetRef: file, visualReviewed: true, claimReview: f.claimReview,
            ...(f.claimReview === 'source_checked' ? { sourceRef: f.sourceNote ? `${sourceRef}; ${f.sourceNote}` : sourceRef } : {}) });
    }
    const draft = { policyVersion: 2, format: spec.format, nativeText: true, musicStyle: 'music_only', sourceReelId: reel.id, frames };
    const review = reviewStoryDraft(draft);
    const plan = { requestId: `story-${date}-${spec.slug}`, title: spec.title, deviceUdid: PHONE, account: 'antoniorevenue',
        facebookAccount: '61584693917444', runAt: spec.runAt, draft };
    await writeFile(path.join(docsDir, 'manifest.json'), JSON.stringify({ reel: { id: reel.id, name: reel.name, instagram: reel.ig, facebook: reel.fb,
        postedAt: reel.updated_at, sha256: createHash('sha256').update(media).digest('hex') }, frames: manifest }, null, 2) + '\n');
    await writeFile(path.join(docsDir, 'plan.json'), JSON.stringify({ ...plan, review }, null, 2) + '\n');
    console.log('review', JSON.stringify(review));
    if (!review.valid) { process.exitCode = 1; }
    else if (flag === '--save') {
        const row = await new StorySequenceStore(db.pool).save(plan);
        console.log('saved plan', row.id, row.state, new Date(row.run_at).toISOString());
    }
    console.log('assets', path.relative(process.cwd(), docsDir));
} finally { await db.close(); }
