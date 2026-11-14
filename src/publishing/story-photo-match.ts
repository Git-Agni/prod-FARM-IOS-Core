import { readFileSync } from 'node:fs';
import sharp from 'sharp';

/** Background photo per frame (Antonio, Oct 20: "the background images ... have to relate to what we're talking about").
 * Each pool photo is tagged once by what Antonio is doing in it (scripts/tag-story-photos.ts). Each frame states what it
 * is about, and the photo whose activity fits that best wins; least recently used breaks ties. */
export const PHOTO_ACTIVITIES = ['laptop', 'phone', 'tablet_reading', 'desk_headphones', 'talking_to_camera', 'filming', 'meeting', 'gym', 'eating', 'walking', 'thinking', 'relaxing', 'travel_outdoor', 'other'] as const;
export const PHOTO_SETTINGS = ['home', 'office', 'outdoor', 'travel', 'gym', 'car', 'other'] as const;
export type PhotoActivity = (typeof PHOTO_ACTIVITIES)[number];
export interface PhotoTag { activity: PhotoActivity; setting: (typeof PHOTO_SETTINGS)[number]; screen: boolean; lookingAtCamera: boolean; note: string; model: string; takenAt?: string | null }

/** What a frame is about: building or using a tool, selling or replying, showing results, a reflective turn, the ask. */
export type FrameIntent = 'tool' | 'sales' | 'content' | 'results' | 'reflect' | 'ask';

/** Activities that show each intent, best first; the first scores 6, then 5, and so on. Anything off the list scores 0. */
const FIT: Record<FrameIntent, PhotoActivity[]> = {
    tool: ['laptop', 'desk_headphones', 'tablet_reading', 'phone'],
    sales: ['phone', 'meeting', 'laptop', 'desk_headphones', 'talking_to_camera'],
    content: ['filming', 'talking_to_camera', 'laptop', 'desk_headphones', 'phone', 'tablet_reading'],
    results: ['laptop', 'desk_headphones', 'meeting', 'phone', 'tablet_reading'],
    reflect: ['thinking', 'walking', 'tablet_reading', 'relaxing'],
    ask: ['phone', 'talking_to_camera', 'laptop', 'tablet_reading'],
};
export function photoFit(intent: FrameIntent, tag: PhotoTag | undefined): number {
    const i = tag ? FIT[intent].indexOf(tag.activity) : -1;
    return i < 0 ? 0 : 6 - i + (tag!.screen && intent !== 'reflect' ? 0.5 : 0);
}

/** The Reel's topic from its caption: sales and leads, content and video, or tools (the default for our AI Reels). */
export function topicIntent(caption: string): FrameIntent {
    const c = caption.toLowerCase();
    if (/\b(lead|leads|sales|setter|closer|close rate|call|calls|reply|replies|sms|dm|appointment|show rate)\b/.test(c)) return 'sales';
    if (/\b(video|reel|reels|content|edit|editing|youtube|post|posts|camera|footage)\b/.test(c)) return 'content';
    return 'tool';
}

/** A frame's intent from its stage: the hook and points follow the Reel's topic, proof shows results, the turn reflects,
 * the reply is the ask. */
export function frameIntent(stage: string, topic: FrameIntent, turn = false): FrameIntent {
    if (stage === 'reply') return 'ask';
    if (stage === 'proof') return 'results';
    if (turn) return 'reflect';
    return topic;
}

/** What a sequence already used: the source files (stills of one video are one scene) and how often each activity
 * appeared. The kit wants a new real thing per beat, so a repeated activity loses 1.5 per earlier use, never below 0.1. */
export interface SequenceSeen { files: Set<string>; activities: Map<string, number>; times: number[] }
export const newSeen = (): SequenceSeen => ({ files: new Set(), activities: new Map(), times: [] });
/** One scene: the same file (a .mov and its .mp4 copy count as one) or a capture within 90 minutes of a used one. */
const stem = (f: string) => f.replace(/\.[^./]+$/, '');
const SESSION_MS = 90 * 60_000;
function sameScene(seen: SequenceSeen, p: { file?: string; sha256: string }, tags: Readonly<Record<string, PhotoTag>>) {
    if (p.file && seen.files.has(stem(p.file))) return true;
    const at = tags[p.sha256]?.takenAt ? Date.parse(tags[p.sha256]!.takenAt!) : NaN;
    return Number.isFinite(at) && seen.times.some(t => Math.abs(t - at) < SESSION_MS);
}
export function markSeen(seen: SequenceSeen, p: { file: string; sha256: string }, tags: Readonly<Record<string, PhotoTag>>) {
    seen.files.add(stem(p.file));
    const at = tags[p.sha256]?.takenAt ? Date.parse(tags[p.sha256]!.takenAt!) : NaN;
    if (Number.isFinite(at)) seen.times.push(at);
    const a = tags[p.sha256]?.activity;
    if (a) seen.activities.set(a, (seen.activities.get(a) ?? 0) + 1);
}

/** Candidates best first: the closest fit to the frame's intent (less 1.5 per earlier use of the same activity in this
 * sequence, floored at 0.1 so related beats unrelated), then least recently used, then a stable order. A scene the sequence already used is dropped. */
export function rankPhotos<P extends { sha256: string; file?: string }>(candidates: P[], intent: FrameIntent, tags: Readonly<Record<string, PhotoTag>>, lastUsed: ReadonlyMap<string, number>, seen: SequenceSeen = newSeen()): P[] {
    // A related photo always outranks an unrelated one: the repeat penalty never takes a fit below 0.1.
    const score = (p: P) => { const fit = photoFit(intent, tags[p.sha256]);
        return fit > 0 ? Math.max(0.1, fit - 1.5 * (seen.activities.get(tags[p.sha256]!.activity) ?? 0)) : 0; };
    return candidates.filter(p => !sameScene(seen, p, tags)).sort((a, b) => score(b) - score(a)
        || (lastUsed.get(a.sha256) ?? 0) - (lastUsed.get(b.sha256) ?? 0) || a.sha256.localeCompare(b.sha256));
}

/** The cached tags (scripts/tag-story-photos.ts), or none. */
export function loadPhotoTags(file = 'docs/stories/photo-tags.json'): Record<string, PhotoTag> {
    try { return (JSON.parse(readFileSync(file, 'utf8')) as { tags: Record<string, PhotoTag> }).tags; } catch { return {}; }
}

/** 64-bit difference hash of the picture as it fills a Story (cover crop to 9:16, 9x8 grey): near shots of one scene land
 * within a few bits of each other. */
export async function sceneHash(raw: Buffer): Promise<bigint> {
    const px = await sharp(raw, { failOn: 'none' }).rotate().resize(108, 192, { fit: 'cover', position: 'attention' }).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    let h = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
    return h;
}
export function hashDistance(a: bigint, b: bigint): number { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; }
