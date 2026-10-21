/** Frame-zero cover check for a YouTube Short (Oct 20: kit Shorts could not arm because nothing checked their cover).
 * Sends frame 0 of our own video to the Story scorer's small vision model and passes only a real cover: a big headline that
 * reads at phone size and names the Short's subject. On-device OCR was tried first and missed stylized cover headlines. */
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { openRouterKey, STORY_SCORE_MODELS } from './story-score.js';

export interface CoverVerdict { pass: boolean; headline: string; isCover: boolean; readable: boolean; subjectMatch: boolean; model: string; reason: string }
const PROMPT = `This is frame 0 of a YouTube Short, the image viewers see before it plays. Classify its main text.
- style "thumbnail": heavy display lettering like a YouTube thumbnail: very bold, usually uppercase, large enough that one line spans most of the frame width, often on colored bars or with a strong shadow.
- style "caption": ordinary sentence-case or lowercase text at subtitle or caption size, even if one word is highlighted or boxed. Most of the frame width is empty around it.
- style "none": no headline text.
Also give "readable" (true if it reads easily on a phone) and "headline" (the main text exactly as shown).
Reply with JSON only: {"style":"thumbnail"|"caption"|"none","readable":true|false,"headline":"..."}`;

const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'can', 'now', 'this', 'that', 'are', 'its', 'how', 'not', 'free', 'into']);
const terms = (s: string) => (s.toLowerCase().match(/[a-z0-9²]{3,}/g) ?? []).filter(w => !STOP.has(w));

export async function checkShortCover(videoPath: string, title: string): Promise<CoverVerdict> {
    const frame = execFileSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 << 20 });
    const img = await sharp(frame).resize({ width: 720 }).jpeg({ quality: 85 }).toBuffer();
    let last = '';
    for (const model of STORY_SCORE_MODELS) {
        try {
            const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(90_000),
                headers: { authorization: 'Bearer ' + openRouterKey(), 'content-type': 'application/json' },
                body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
                    { type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img.toString('base64') } }] }] }) });
            const j = await r.json() as any; if (!r.ok) throw Error(j?.error?.message ?? 'HTTP ' + r.status);
            const t = String(j.choices?.[0]?.message?.content ?? ''), v = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
            const headline = String(v.headline ?? ''), want = terms(title), got = new Set(terms(headline));
            const subjectMatch = want.some(w => got.has(w));
            const isCover = v.style === 'thumbnail', readable = v.readable === true, pass = isCover && readable && subjectMatch;
            const reason = pass ? 'cover passes' : !isCover ? 'frame 0 is not a cover' : !readable ? 'headline hard to read' : 'headline does not name the Short subject';
            return { pass, headline, isCover, readable, subjectMatch, model, reason };
        } catch (e) { last = `${model}: ${e instanceof Error ? e.message : String(e)}`; }
    }
    throw Error('Cover check failed: ' + last);
}
