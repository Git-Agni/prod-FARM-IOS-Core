/** Tag every Story pool photo by what Antonio is doing in it (Oct 20: "the background images ... have to relate to what
 * we're talking about"). Read-only on the photos: sends a 384 px copy of each to the same small vision model the Story
 * scorer uses and caches the answer by SHA-256 in docs/stories/photo-tags.json, so each photo is tagged once.
 * Usage: tag-story-photos.ts [--limit N] */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { loadPhotoPool, photoBuffer } from '../src/publishing/story-lifestyle.js';
import { openRouterKey, STORY_SCORE_MODELS } from '../src/publishing/story-score.js';
import { PHOTO_ACTIVITIES, PHOTO_SETTINGS, type PhotoTag } from '../src/publishing/story-photo-match.js';

const FILE = 'docs/stories/photo-tags.json';
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const tags: Record<string, PhotoTag> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')).tags : {};
const PROMPT = `This is a photo of Antonio, a business owner who builds AI sales systems. Describe only what is visible.
Reply with JSON only: {"activity":"...","setting":"...","screen":true|false,"lookingAtCamera":true|false,"note":"max 8 words"}
activity is exactly one of: ${PHOTO_ACTIVITIES.join(', ')}.
setting is exactly one of: ${PHOTO_SETTINGS.join(', ')}.
screen is true when a laptop, monitor, phone or tablet screen is clearly in use.`;

// Capture time (Spotlight metadata) for every tagged photo, so a sequence never shows two shots from one shoot.
for (const p of loadPhotoPool()) {
    const tag = tags[p.sha256];
    if (!tag || tag.takenAt !== undefined) continue;
    try {
        const out = execFileSync('mdls', ['-raw', '-name', 'kMDItemContentCreationDate', p.file], { encoding: 'utf8' }).trim();
        const ms = Date.parse(out.replace(' +0000', 'Z').replace(' ', 'T'));
        tag.takenAt = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    } catch { tag.takenAt = null; }
}
const todo = loadPhotoPool().filter(p => !tags[p.sha256]).slice(0, limit);
console.log(`${Object.keys(tags).length} tagged, ${todo.length} to tag`);
const save = () => writeFileSync(FILE, JSON.stringify({ about: 'What each Story pool photo shows, by SHA-256. Written by scripts/tag-story-photos.ts; used to match a frame to its photo.', tags }, null, 1) + '\n');
let done = 0;
async function tagOne(p: (typeof todo)[number]) {
    const img = await sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate().resize(384, 384, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    for (const model of STORY_SCORE_MODELS) {
        try {
            const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(90_000),
                headers: { authorization: 'Bearer ' + openRouterKey(), 'content-type': 'application/json' },
                body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
                    { type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img.toString('base64') } }] }] }) });
            const j = await r.json() as any; if (!r.ok) throw Error(j?.error?.message ?? 'HTTP ' + r.status);
            const t = String(j.choices?.[0]?.message?.content ?? ''), v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
            if (!PHOTO_ACTIVITIES.includes(v.activity) || !PHOTO_SETTINGS.includes(v.setting)) throw Error('Off-list tag ' + t.slice(0, 80));
            tags[p.sha256] = { activity: v.activity, setting: v.setting, screen: v.screen === true, lookingAtCamera: v.lookingAtCamera === true, note: String(v.note ?? '').slice(0, 60), model };
            if (++done % 20 === 0) { save(); console.log(done, 'tagged'); }
            return;
        } catch (e) { console.error(p.sha256.slice(0, 8), model, e instanceof Error ? e.message : e); }
    }
}
for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(tagOne));
save();
console.log(`done: ${Object.keys(tags).length} tagged`);
