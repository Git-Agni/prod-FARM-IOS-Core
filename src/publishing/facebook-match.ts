import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
type Rect = { x: number; y: number; width: number; height: number };

/** Frame zero of the source video. Facebook grid tiles show this frame as the cover. */
export async function frameZero(path: string): Promise<Buffer> {
    const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { encoding: 'buffer', maxBuffer: 64e6 });
    return stdout as Buffer;
}
const signature = (image: Buffer, crop?: { left: number; top: number; width: number; height: number }) =>
    (crop ? sharp(image).extract(crop) : sharp(image)).resize(24, 42, { fit: 'cover' }).removeAlpha().raw().toBuffer();
export function difference(a: Buffer, b: Buffer) { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i]! - b[i]!); return t / (a.length * 255); }

/** One clear winner or nothing. Never pick by rank alone. */
export function uniqueTile(scores: { name: string; score: number }[], max = 0.12, gap = 0.04) {
    const ranked = [...scores].sort((a, b) => a.score - b.score);
    if (!ranked[0] || ranked[0].score > max || (ranked[1] && ranked[1].score - ranked[0].score < gap)) return null;
    return ranked[0];
}

/** Score each fully visible grid tile (points) against the source's frame zero on a 3x screenshot. */
export async function matchTile(screenshot: Buffer, tiles: (Rect & { name: string })[], source: Buffer) {
    const target = await signature(source);
    const meta = await sharp(screenshot).metadata(), scale = (meta.width ?? 1290) / 430;
    const scores = [];
    for (const t of tiles) {
        const crop = { left: Math.round(t.x * scale), top: Math.round(t.y * scale), width: Math.round(t.width * scale), height: Math.round(t.height * scale) };
        if (crop.left < 0 || crop.top < 0 || crop.left + crop.width > (meta.width ?? 0) || crop.top + crop.height > (meta.height ?? 0)) continue;
        scores.push({ name: t.name, score: difference(target, await signature(screenshot, crop)) });
    }
    return { best: uniqueTile(scores), scores };
}
