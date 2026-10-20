/** Lifestyle Story frames (Antonio, Oct 15 2026): "not the images of the reel itself. Just drop the reel in the end, add some
 * color, some life, add my gallery images that sell". Four of his approved photos, full color, with text in the style of his
 * profile Highlights (white pills, one red line), then the Reel itself as the last frame. No model: photos rotate least
 * recently used from docs/stories/photo-pool.json plus the auto-approved Dropbox Stories folder; text comes from the Reel. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

export interface PoolPhoto { file: string; sha256: string; faceTop?: number | null; t?: number }
/** Under a proof card at the top, only photos with the face low (or not visible) keep the face clear. */
export const cardSafe = (p: PoolPhoto) => p.faceTop == null || p.faceTop > 0.7;
const W = 1080, H = 1920, IMAGE = /\.(jpe?g|png|heic)$/i;

export function loadPhotoPool(file = 'docs/stories/photo-pool.json'): PoolPhoto[] {
    const pool = JSON.parse(readFileSync(file, 'utf8')) as { autoApprovedFolder?: string; photos: PoolPhoto[]; videoStills?: PoolPhoto[] };
    const photos = [...pool.photos, ...(pool.videoStills ?? [])].filter(p => existsSync(p.file));
    const folder = pool.autoApprovedFolder;
    if (folder && existsSync(folder))
        for (const name of readdirSync(folder).filter(n => IMAGE.test(n)).sort()) {
            const file = path.join(folder, name);
            photos.push({ file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
        }
    const seen = new Set<string>();
    return photos.filter(p => !seen.has(p.sha256) && seen.add(p.sha256));
}

/** The n photos used longest ago (never used first), in a stable order. */
export function pickPhotos(pool: PoolPhoto[], lastUsed: ReadonlyMap<string, number>, n = 4): PoolPhoto[] {
    if (pool.length < n) throw Error(`The Story photo pool has ${pool.length} photos; ${n} are needed`);
    return [...pool].sort((a, b) => (lastUsed.get(a.sha256) ?? 0) - (lastUsed.get(b.sha256) ?? 0) || a.sha256.localeCompare(b.sha256)).slice(0, n);
}

/** Greedy wrap to about `max` characters per line. */
export function wrapLines(text: string, max = 26): string[] {
    const lines: string[] = [];
    for (const word of text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').split(/\s+/).filter(Boolean)) {
        const last = lines[lines.length - 1];
        if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
        else lines.push(word);
    }
    return lines;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Highlight style: one white rounded pill per line, black bold text; the `red` line is red. */
export function textOverlay(lines: string[], { top = 300, size = 58, red = -1 } = {}): Buffer {
    const step = Math.round(size * 1.42);
    const pills = lines.map((line, i) => {
        const y = top + i * step, w = Math.min(W - 60, Math.round(line.length * size * 0.56 + size * 1.1));
        return `<rect x="${(W - w) / 2}" y="${y - size}" width="${w}" height="${Math.round(size * 1.32)}" rx="16" fill="#fff"/>`
            + `<text x="${W / 2}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="${size}" text-anchor="middle" fill="${i === red ? '#E8231F' : '#111'}">${esc(line)}</text>`;
    }).join('');
    return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${pills}</svg>`);
}

/** Video stills: the full-resolution frame at t seconds. HEIC goes through macOS sips; everything else straight to sharp. */
async function photoBuffer(file: string, t?: number): Promise<Buffer> {
    if (t !== undefined) return execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', '-'], { maxBuffer: 128 << 20 });
    if (!/\.heic$/i.test(file)) return readFile(file);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'story-heic-'));
    try { const out = path.join(dir, 'p.jpg'); execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', out], { stdio: 'ignore' }); return await readFile(out); }
    finally { await rm(dir, { recursive: true, force: true }); }
}

export interface ProofCard { file: string; headline: string; source: string }
export function loadProofCards(file = 'docs/stories/proof-cards.json'): ProofCard[] {
    return (JSON.parse(readFileSync(file, 'utf8')) as { cards: ProofCard[] }).cards.filter(c => existsSync(c.file));
}

/** A big red hand-drawn arrow from beside the headline up to the proof card (as in the Highlights). */
function arrow(textTop: number, cardBottom: number): string {
    const x0 = 150, y0 = textTop - 20, x1 = 230, y1 = cardBottom + 10;
    return `<g stroke="#E8231F" stroke-width="14" stroke-linecap="round" fill="none">`
        + `<path d="M ${x0} ${y0} C ${x0 - 70} ${y0 - 70}, ${x1 - 120} ${y1 + 60}, ${x1} ${y1}"/>`
        + `<path d="M ${x1} ${y1} l -58 4 M ${x1} ${y1} l -18 52"/></g>`;
}

/** One bright, full-color 1080x1920 frame: the photo (EXIF-rotated, cover crop, lifted exposure and saturation), an optional
 * proof card at the top with a red arrow, and the text pills. Frames without a card put the text near the top. */
export async function lifestyleFrame(source: PoolPhoto | Buffer, text: string, { red = false, card }: { red?: boolean; card?: ProofCard } = {}): Promise<Buffer> {
    const lines = wrapLines(text);
    const raw = Buffer.isBuffer(source) ? source : await photoBuffer(source.file, source.t);
    const bg = await sharp(raw, { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.18, brightness: 1.12 }).linear(1.04, 6).toBuffer();
    const layers: OverlayOptions[] = [];
    let textTop = 300;
    if (card) {
        const img = await sharp(card.file).resize(960, 620, { fit: 'inside' }).png().toBuffer(), meta = await sharp(img).metadata();
        const framed = await sharp({ create: { width: meta.width! + 24, height: meta.height! + 24, channels: 4, background: '#ffffff' } })
            .composite([{ input: img, left: 12, top: 12 }]).png().toBuffer();
        layers.push({ input: framed, left: Math.round((W - meta.width! - 24) / 2), top: 190 });
        const cardBottom = 190 + meta.height! + 24;
        textTop = cardBottom + 230;
        layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${arrow(textTop, cardBottom)}</svg>`) });
    }
    layers.push({ input: textOverlay(lines, { top: textTop, red: red || card ? lines.length - 1 : -1 }) });
    return sharp(bg).composite(layers).removeAlpha().png().toBuffer();
}

/** Frame texts from the Reel caption: up to three short caption sentences (three lines max each), then the keyword CTA. */
export function lifestyleTexts(spotlight: string[], fallbacks: readonly string[]): string[] {
    const short = (s: string) => wrapLines(s).length <= 3;
    const picked = spotlight.slice(0, 4).filter(short).slice(0, 3);
    for (const f of fallbacks) if (picked.length < 3 && !picked.includes(f)) picked.push(f);
    const cta = spotlight[4] ?? '';
    const keyword = cta.match(/^Comment (\S+) /)?.[1];
    return [...picked, keyword ? `Comment ${keyword} on this reel` : 'The full reel is next'];
}

/** Quality gate before a picture is used: enough pixels for a full-screen Story, sharp (variance of a Laplacian on a
 * 512 px copy) and not too dark or blown out. */
export async function imageQuality(raw: Buffer): Promise<{ ok: boolean; sharpness: number; brightness: number; width: number; height: number }> {
    const img = sharp(raw, { failOn: 'none' }).rotate(), meta = await img.metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? 0, height = meta.autoOrient?.height ?? meta.height ?? 0;
    const grey = await img.clone().resize(512, 512, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = grey, w = info.width, h = info.height;
    let sum = 0, sum2 = 0, n = 0, lum = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
        sum += v; sum2 += v * v; n++; lum += data[i]!;
    }
    const sharpness = sum2 / n - (sum / n) ** 2, brightness = lum / n;
    const ok = Math.min(width, height) >= 1080 && sharpness >= 60 && brightness >= 45 && brightness <= 215;
    return { ok, sharpness: Math.round(sharpness), brightness: Math.round(brightness), width, height };
}

/** Clean, minimal frame (Antonio, Oct 15: "the edit has to be clean, minimal"): the full-color picture, at most two lines
 * of white text with a soft shadow in the lower third, and for proof frames the real dashboard screenshot with rounded
 * corners and a soft shadow near the top. No pills, arrows or marker strokes. */
export async function minimalFrame(source: PoolPhoto | Buffer, text: string, { card }: { card?: ProofCard } = {}): Promise<Buffer> {
    const raw = Buffer.isBuffer(source) ? source : await photoBuffer(source.file, source.t);
    const bg = await sharp(raw, { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.1, brightness: 1.06 }).toBuffer();
    const layers: OverlayOptions[] = [];
    let cardBottom = 0;
    if (card) {
        const img = await sharp(card.file).resize(940, 600, { fit: 'inside' }).png().toBuffer(), m = await sharp(img).metadata();
        const r = 22, mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="${m.width}" height="${m.height}" rx="${r}" fill="#fff"/></svg>`);
        const rounded = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        const pad = 60, shadow = await sharp({ create: { width: m.width! + pad * 2, height: m.height! + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: Buffer.from(`<svg width="${m.width! + pad * 2}" height="${m.height! + pad * 2}"><rect x="${pad}" y="${pad + 14}" width="${m.width}" height="${m.height}" rx="${r}" fill="#000" opacity="0.45"/></svg>`) }]).blur(24).png().toBuffer();
        const left = Math.round((W - m.width!) / 2), top = 240;
        layers.push({ input: shadow, left: left - pad, top: top - pad }, { input: rounded, left, top });
        cardBottom = top + m.height!;
    }
    // Words sit right under the card on proof frames (as in the Highlights), and in the upper third otherwise.
    const lines = wrapLines(text, 26), size = 60;
    if (lines.length > 3) throw Error(`Story text is longer than three lines: ${text}`);
    const base = cardBottom ? cardBottom + 190 : 380;
    // One clean red arrow from beside the words up to the card's right edge.
    const arrowSvg = cardBottom ? (() => {
        // Curved arrow: tail beside the words, tip just under the card's right column (where the result is).
        const tx = W - 210, ty = cardBottom + 18, sx = W - 95, sy = base - size * 0.35, cx = W - 70, cy = (ty + sy) / 2 - 20;
        const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, head = 46;
        const wing = (deg: number) => { const r = deg * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
            return `L ${(tx - head * (ux * c - uy * sn)).toFixed(1)} ${(ty - head * (ux * sn + uy * c)).toFixed(1)}`; };
        return `<g fill="none" stroke="#FF3B30" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" filter="url(#s)">`
            + `<path d="M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}"/><path d="M ${tx} ${ty} ${wing(32)} M ${tx} ${ty} ${wing(-32)}"/></g>`;
    })() : '';
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="9" flood-color="#000" flood-opacity="0.55"/></filter></defs>`
        + arrowSvg + lines.map((l, i) => `<text x="${W / 2}" y="${base + i * size * 1.22}" font-family="SF Pro Display, Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="${size}" text-anchor="middle" fill="#fff" filter="url(#s)">${esc(l)}</text>`).join('') + '</svg>';
    layers.push({ input: Buffer.from(svg) });
    return sharp(bg).composite(layers).removeAlpha().png().toBuffer();
}

/** Recent published Instagram Reels (Trial included: the link sticker opens the Reel directly), newest first, with how many
 * Story plans already linked each one. */
async function linkableReels(pool: import('pg').Pool) {
    return (await pool.query(`SELECT i.id,i.input->>'caption' caption,r.result->'receipts'->'instagram'->>'url' url,
        (SELECT count(*) FROM scheduler.story_sequences s WHERE s.state<>'cancelled' AND s.draft->>'sourceReelId'=i.id::text)::int uses
        FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
        WHERE i.status='published' AND i.input->'targets' @> '[{"platform":"instagram"}]' AND r.result->'receipts'->'instagram'->>'verified'='true'
        AND r.result->'receipts'->'instagram'->>'url' ~ '^https://www\\.instagram\\.com/reel/[A-Za-z0-9_-]+/?$' AND r.updated_at > now()-interval '10 days'
        ORDER BY r.updated_at DESC LIMIT 40`)).rows as { id: string; caption: string; url: string; uses: number }[];
}

/** When each pool picture was last used in a Story plan (from the saved plans, so it survives restarts). */
async function photoLastUse(pool: import('pg').Pool): Promise<Map<string, number>> {
    const rows = (await pool.query(`SELECT s.run_at, f->>'photoSha256' sha FROM scheduler.story_sequences s, jsonb_array_elements(s.draft->'frames') f
        WHERE s.state<>'cancelled' AND s.draft->>'format'='lifestyle'`)).rows;
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.sha, Math.max(m.get(r.sha) ?? 0, new Date(r.run_at).getTime()));
    return m;
}

/** The Full Visual kit's bands (engine/full-visual/src/theme.ts), applied to Story frames on Oct 20: one centre axis
 * (x 540); the words in the caption band (y 300 to 520, wrap 740 px, starting at the kit's 74 px and shrinking to fit);
 * the real thing in the stage (y 540 to 1450, 900 px wide, big and centred); nothing in the last 220 px, which
 * Instagram owns. */
export const KIT = { axis: W / 2, captionTop: 300, captionBottom: 520, wrap: 740, sizeMax: 74, sizeMin: 44, stageTop: 540, stageBottom: 1450, stageWidth: 900 } as const;
/** Caption lines and size that fit the band, or null when the text is too long for one frame (one idea per frame). */
export function captionLayout(text: string): { size: number; lineHeight: number; lines: string[] } | null {
    // The largest size that fits wins, but a layout ending a paragraph on one lone word gives way to a slightly smaller
    // size without one; with none, the first fit stands.
    let first: { size: number; lineHeight: number; lines: string[] } | null = null;
    for (let size = KIT.sizeMax; size >= KIT.sizeMin; size -= 2) {
        const lineHeight = Math.round(size * 1.12), perLine = Math.floor(KIT.wrap / (size * 0.58));
        // Balanced wrap: the narrowest width that keeps each paragraph's line count, so no line is a lone word.
        const balanced = (l: string) => { const n = wrapLines(l, perLine).length; let w = perLine;
            while (w > 8 && wrapLines(l, w - 1).length === n) w--; return wrapLines(l, w); };
        const lines = text.split('\n').flatMap(balanced);
        if ((lines.length - 1) * lineHeight + size > KIT.captionBottom - KIT.captionTop) continue;
        const layout = { size, lineHeight, lines };
        first ??= layout;
        const lone = text.split('\n').some(l => { const w = balanced(l); return w.length > 1 && !w[w.length - 1]!.includes(' '); });
        if (!lone) return layout;
    }
    return first;
}
/** True when the text fits the caption band. */
export const fits = (text: string) => captionLayout(text) !== null;

/** Story frame on the kit's bands: the full-colour photo as the ground with a soft dark band behind the caption, the words
 * centred in the caption band, and the real thing (a Reel reference image or a proof card) big and centred in the stage.
 * The stage stops 60 px above a known face so the person stays visible. */
export async function journalFrame(source: PoolPhoto | Buffer, text: string, { card }: { card?: ProofCard } = {}): Promise<Buffer> {
    const raw = Buffer.isBuffer(source) ? source : await photoBuffer(source.file, source.t);
    const bg = await sharp(raw, { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.1, brightness: 1.06 }).toBuffer();
    const layout = captionLayout(text);
    if (!layout) throw Error(`Story text does not fit the caption band: ${text}`);
    const { size, lineHeight, lines } = layout;
    const band = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.62"/>`
        + `<stop offset="0.72" stop-color="#000" stop-opacity="0.4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
        + `<filter id="s"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.6"/></filter></defs>`
        + `<rect x="0" y="0" width="${W}" height="${KIT.captionBottom + 160}" fill="url(#g)"/>`;
    const words = lines.map((l, i) => `<text x="${KIT.axis}" y="${Math.round(KIT.captionTop + size * 0.82 + i * lineHeight)}" font-family="SF Pro Display, Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="${size}" text-anchor="middle" fill="#fff" filter="url(#s)">${esc(l)}</text>`).join('');
    const layers: OverlayOptions[] = [{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${band}${words}</svg>`) }];
    if (card) {
        const face = Buffer.isBuffer(source) ? null : source.faceTop;
        const bottom = face != null && face * H - 60 - KIT.stageTop >= 400 ? Math.min(KIT.stageBottom, Math.round(face * H - 60)) : KIT.stageBottom;
        const boxH = bottom - KIT.stageTop;
        const img = await sharp(card.file).resize(KIT.stageWidth, boxH, { fit: 'inside' }).png().toBuffer(), m = await sharp(img).metadata();
        const r = 22, mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="${m.width}" height="${m.height}" rx="${r}" fill="#fff"/></svg>`);
        const rounded = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        const left = Math.round(KIT.axis - m.width! / 2), top = Math.round(KIT.stageTop + (boxH - m.height!) / 2), pad = 50;
        const shadow = await sharp({ create: { width: m.width! + pad * 2, height: m.height! + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: Buffer.from(`<svg width="${m.width! + pad * 2}" height="${m.height! + pad * 2}"><rect x="${pad}" y="${pad + 12}" width="${m.width}" height="${m.height}" rx="${r}" fill="#000" opacity="0.45"/></svg>`) }]).blur(20).png().toBuffer();
        layers.push({ input: shadow, left: left - pad, top: top - pad }, { input: rounded, left, top });
    }
    return sharp(bg).composite(layers).removeAlpha().png().toBuffer();
}

const TOPIC_STOP = new Set(['from', 'with', 'before', 'under', 'days', 'grew', 'every', 'rate', 'the', 'and', 'in', 'to']);
/** True when a proof headline and a caption share a topic word ("show", "lead", "SMS", "refunds"). */
export function topicMatch(headline: string, caption: string) {
    const terms = headline.toLowerCase().match(/[a-z]{3,}/g)?.filter(w => !TOPIC_STOP.has(w)) ?? [];
    const text = caption.toLowerCase();
    return terms.some(w => new RegExp(`\\b${w}`).test(text));
}

/** The Reel caption's own sentences, original casing (lowercasing broke names like Claude Code). No filler. */
export function captionSentences(caption: string): string[] {
    const clean = (x: string) => x.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/^\s*(\d+[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim();
    const out = caption.split('\n').map(clean).filter(l => l && !l.startsWith('#') && !/^follow @/i.test(l) && !/@antoniorevenue/i.test(l))
        .flatMap(l => l.match(/[^.!?]+[.!?]*/g) ?? []).map(x => x.trim())
        .filter(x => { const w = x.split(/\s+/).length; return w >= 3 && w <= 22 && !x.endsWith(':') && !/\bcomment\b/i.test(x) && !x.includes('#'); });
    return [...new Set(out)];
}

export type StoryType = 'build' | 'proof_stack' | 'documentation';
/** Rotation over the slots (Nik's build timeline and result stacking, SooWei's documentation). */
export function storyTypeFor(runAt: Date): StoryType {
    // One ordinal per Story slot (two a day), so consecutive slots differ: build and proof alternate, and about two slots a
    // week are a documentation update.
    const pt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(runAt));
    const ordinal = Math.floor(runAt.getTime() / 86_400_000) * 2 + (pt >= 12 ? 1 : 0);
    return ordinal % 7 === 3 ? 'documentation' : ordinal % 2 ? 'proof_stack' : 'build';
}

/** Our own last seven days from the publishing records: real numbers for documentation Stories. */
async function weekNumbers(pool: import('pg').Pool) {
    const r = (await pool.query(`SELECT count(DISTINCT i.media->>'sha256') FILTER (WHERE true)::int videos, count(*)::int posts
        FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id WHERE r.state='published' AND r.updated_at>now()-interval '7 days'`)).rows[0];
    return { videos: r.videos as number, posts: r.posts as number };
}

/** One five-frame plan for a slot. Type rotates by slot. Words come only from a recent Reel's caption, our real numbers and
 * the approved proof cards (Antonio, Oct 17: revenue screenshots are OK). The last frame links the Reel. Never touches the phone. */
export async function buildLifestylePlan(pool: import('pg').Pool, runAt: Date, _opts: { spotlightTexts?: (c: string) => string[] } = {}) {
    const reels = await linkableReels(pool);
    if (!reels.length) return null;
    // Oct 20: the Full Visual kit's script rules (src/publishing/story-script.ts): the caption's hook, its mechanism in
    // order, a re-hook before the last point, the turn, and a CTA that names what arrives. Only lines that fit a frame.
    const { storyScript } = await import('./story-script.js');
    const usable = reels.map(r => {
        const sc = storyScript(r.caption ?? '');
        return sc && fits(sc.hook) ? { ...r, sc: { ...sc, points: sc.points.filter(fits) } } : null;
    }).filter((r): r is NonNullable<typeof r> => !!r && r.sc.points.length >= 2);
    if (!usable.length) return null;
    const reel = [...usable].sort((a, b) => a.uses - b.uses)[0]!;
    const { hook: a, points: [b, c], turn, cta } = reel.sc as { hook: string; points: [string, string]; turn?: string; cta: string };
    const glue = (prefix: string, text: string) => fits(`${prefix}\n${text}`) ? `${prefix}\n${text}` : text;
    const type = storyTypeFor(runAt), slotIndex = Math.floor(runAt.getTime() / (12 * 3_600_000));
    // Proof proves the point (kit): cards whose headline shares a topic word with the Reel go first, the rest rotate.
    const all0 = loadProofCards(), rotated = all0.map((_, k) => all0[(slotIndex * 2 + k) % all0.length]!);
    const cards = [...rotated.filter(x => topicMatch(x.headline, reel.caption ?? '')), ...rotated.filter(x => !topicMatch(x.headline, reel.caption ?? ''))];
    const card = (k: number) => cards[k % cards.length]!;
    const lastUse = await photoLastUse(pool), all = loadPhotoPool(), used = new Set<string>();
    const pick = async (filter: (p: PoolPhoto) => boolean) => {
        for (const p of pickPhotos(all.filter(p => filter(p) && !used.has(p.sha256)), lastUse, Math.min(12, all.length)))
            if ((await imageQuality(await photoBuffer(p.file, p.t))).ok) { used.add(p.sha256); return p; }
        throw Error('No picture passed the quality gate');
    };
    let spec: { text: string; card?: ProofCard; link?: boolean; stage: string }[];
    if (type === 'build') spec = [
        { stage: 'hook', text: a }, { stage: 'point', text: glue("Ok so here's how it works:", b) }, { stage: 'point', text: glue('And the best part?', c) },
        // The cards are client results from our sales systems, never this Reel's tool: say so (kit: no overclaim).
        { stage: 'proof', text: `From our client work:\n${card(0).headline}`, card: card(0) }, { stage: 'reply', text: cta, link: true }];
    else if (type === 'proof_stack') spec = [
        { stage: 'hook', text: a }, { stage: 'point', text: turn && fits(turn) ? turn : b },
        { stage: 'proof', text: card(0).headline, card: card(0) }, { stage: 'proof', text: card(1).headline, card: card(1) },
        { stage: 'reply', text: cta, link: true }];
    else { const w = await weekNumbers(pool); spec = [
        { stage: 'hook', text: 'Quick update on the week' },
        { stage: 'point', text: `${w.videos} videos went out this week\n${w.posts} posts across Instagram,\nTikTok and YouTube` },
        { stage: 'proof', text: card(0).headline, card: card(0) },
        { stage: 'point', text: glue('The one I keep coming back to:', a) }, { stage: 'reply', text: cta, link: true }]; }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(runAt);
    const dir = path.resolve('.scheduler-data/story-assets', `${date}-${type}-${runAt.toISOString().slice(11, 13)}`);
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const frames = [];
    for (const [i, f] of spec.entries()) {
        // Card and link frames keep the face low or out of frame so the screenshot or sticker never covers it.
        const photo = await pick(f.card || f.link ? cardSafe : () => true), file = path.join(dir, `frame-${i + 1}.png`);
        await fs.writeFile(file, await journalFrame(photo, f.text, { card: f.card }), { mode: 0o600 });
        frames.push({ stage: f.stage, text: f.text.replace(/\n/g, ' '), textBurnedIn: true, assetKind: 'lifestyle_frame', assetRef: file,
            photoSha256: photo.sha256, automatedChecks: true, claimReview: 'source_checked', sourceRef: f.card ? f.card.source : reel.url,
            ...(f.card ? { proofCard: f.card.file } : {}), ...(f.link ? { linkUrl: reel.url } : {}) });
    }
    const draft = { policyVersion: 2, format: 'lifestyle', storyType: type, nativeText: true, musicStyle: 'music_only', sourceReelId: reel.id, frames };
    const { reviewStoryDraft } = await import('./story-policy.js');
    const review = reviewStoryDraft(draft);
    if (!review.valid) throw Error('Lifestyle plan failed review: ' + review.errors.join(' '));
    const base = `lifestyle-${runAt.toISOString().replace(/[:.]/g, '-')}`;
    const builds = Number((await pool.query(`SELECT count(*) n FROM scheduler.story_sequences WHERE request_id LIKE $1`, [base + '%'])).rows[0].n);
    const { StorySequenceStore } = await import('./story-sequences.js');
    const title = `${{ build: 'Build', proof_stack: 'Proof', documentation: 'Week' }[type]}: ` + (type === 'documentation' ? 'Quick update on the week' : a).slice(0, 110);
    return new StorySequenceStore(pool).save({ requestId: builds ? `${base}-${builds + 1}` : base, title,
        deviceUdid: '00008130-000229EE1AA0001C', account: 'antoniorevenue', facebookAccount: '61584693917444', runAt: runAt.toISOString(), draft });
}

/** Weekly batch (Antonio, Oct 15: "every week we build the full week worth of story sequences"): every Story slot from 1 hour
 * to 7 days ahead without a plan gets a lifestyle plan. Draft capture on the phone still happens the day before. */
export async function ensureWeekPlans(pool: import('pg').Pool) {
    const { spotlightTexts } = await import('./story-spotlight.js');
    const slots = (await pool.query(`SELECT d.run_at FROM scheduler.story_daily_slots d WHERE d.run_at > now()+interval '1 hour' AND d.run_at < now()+interval '7 days'
        AND NOT EXISTS(SELECT 1 FROM scheduler.story_sequences s WHERE s.run_at=d.run_at AND s.state<>'cancelled') ORDER BY d.run_at`)).rows;
    for (const s of slots) {
        try { await buildLifestylePlan(pool, new Date(s.run_at), { spotlightTexts }); }
        catch (error) { console.error(new Date().toISOString(), 'Story lifestyle plan failed:', error instanceof Error ? error.message : error); }
    }
}
