/** Side-by-side check for the Devin Story copies: his frames on top, ours below, then a vision score of ours.
 * Usage: compare-devin-story.ts <slug> <devin frames dir or sheet.jpg> -> .scheduler-data/story-assets/devin/<slug>/compare.jpg */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { scoreStory } from '../src/publishing/story-score.js';

const [slug, ref] = process.argv.slice(2) as [string, string];
const dir = path.resolve('.scheduler-data/story-assets/devin', slug);
const ours = readdirSync(dir).filter(f => /^frame-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6))).map(f => path.join(dir, f));
const row = async (files: string[]) => Promise.all(files.map(f => sharp(f).resize(270, 480, { fit: 'cover' }).toBuffer()));
const top = ref.endsWith('.jpg') ? [await sharp(path.resolve(ref)).resize({ width: Math.max(ours.length, 1) * 280 }).toBuffer()]
    : await row(readdirSync(path.resolve(ref)).filter(f => /^frame-\d+\.jpg$/.test(f)).sort().map(f => path.join(path.resolve(ref), f)));
const bottom = await row(ours);
const topH = ref.endsWith('.jpg') ? (await sharp(top[0]!).metadata()).height! : 480;
const W = Math.max(bottom.length, ref.endsWith('.jpg') ? 1 : top.length) * 280;
await sharp({ create: { width: W, height: topH + 500, channels: 3, background: '#111' } })
    .composite([...top.map((b, i) => ({ input: b, left: i * 280, top: 0 })), ...bottom.map((b, i) => ({ input: b, left: i * 280, top: topH + 20 }))])
    .jpeg({ quality: 86 }).toFile(path.join(dir, 'compare.jpg'));
const spec = JSON.parse(readFileSync(path.resolve('docs/stories/devin', slug + '.json'), 'utf8'));
const frames = ours.slice(0, 10).map(f => readFileSync(f));
if (frames.length >= 3) {
    const s = await scoreStory(frames, spec.title ?? slug);
    console.log(`${slug} | ${s.pass ? 'PASS' : 'FAIL'} overall ${s.overall} hook ${s.hook} cta ${s.cta}`);
    for (const f of s.frames) console.log(`  ${f.frame}: read ${f.readability} img ${f.image} fit ${f.fit} | ${f.note}`);
    if (s.reasons.length) console.log('  reasons:', s.reasons.join('; '));
} else console.log(slug, '| single frame, not scored');
console.log(path.join(dir, 'compare.jpg'), existsSync(path.join(dir, 'compare.jpg')));
