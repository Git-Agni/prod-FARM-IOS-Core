import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import type {PostingInput} from './model.js';
import catalog from './instagram-reels.json' with {type: 'json'};
import {recognizeWords,type OcrWord} from '../tiktok/ocr.js';

export const reviewedRelatedReel = 'https://www.instagram.com/reel/Dd7K1yvCIgq/';
const reference = new URL('../../docs/evidence/hourly-recovery-2026-10-05/chatcut-b-ig/related-picker-reference.png',import.meta.url);

/** Identify the reviewed cover, even after a new Reel shifts the grid. Never select by rank alone. */
export function uniqueCoverMatch(scores:number[]) {
    const ranked=scores.map((score,index)=>({score,index})).sort((a,b)=>a.score-b.score);
    if(!ranked[0]||!Number.isFinite(ranked[0].score)||ranked[0].score>.045
       ||ranked[1]&&ranked[1].score-ranked[0].score<.035)
        throw Error('Related Reel cover is missing or ambiguous; no Reel selected');
    return ranked[0].index;
}
export async function locateRelatedCover(png:Buffer,related:NonNullable<PostingInput['instagramRelatedReel']>) {
    if(related.url!==reviewedRelatedReel)throw Error('This related Reel needs its own reviewed cover reference');
    const meta=await sharp(png).metadata();
    if(meta.width!==1290||meta.height!==2796)throw Error('Related Reel screen size changed');
    const crop=(bytes:Buffer,left:number,top:number)=>sharp(bytes).extract({left,top,width:420,height:610}).resize(32,48).removeAlpha().raw().toBuffer();
    const target=await crop(await readFile(reference),0,402);
    const positions=[0,1,2].flatMap(row=>[0,1,2].map(col=>({left:col*430,top:402+row*760})));
    const scores=[];
    for(const p of positions){
        const bytes=await crop(png,p.left,p.top);let total=0;
        for(let i=0;i<target.length;i++)total+=Math.abs(target[i]!-bytes[i]!);
        scores.push(total/(target.length*255));
    }
    const index=uniqueCoverMatch(scores),p=positions[index]!;
    return {x:(p.left+210)/3,y:(p.top+290)/3,difference:scores[index]};
}

/** Oct 11: new Reels pushed the reviewed Reel below the first nine tiles. Match against the picker's actual cells
 * (rects in points from the screen tree), so the caller can scroll and look again. Same thresholds as above. */
export async function locateRelatedCoverInCells(png:Buffer,cells:Cell[],related:NonNullable<PostingInput['instagramRelatedReel']>) {
    if(related.url!==reviewedRelatedReel)throw Error('This related Reel needs its own reviewed cover reference');
    const meta=await sharp(png).metadata();
    if(meta.width!==1290||meta.height!==2796)throw Error('Related Reel screen size changed');
    const visible=visibleCells(cells);
    if(!visible.length)throw Error('Related Reel cover is missing or ambiguous; no Reel selected');
    const crop=(bytes:Buffer,left:number,top:number)=>sharp(bytes).extract({left,top,width:420,height:610}).resize(32,48).removeAlpha().raw().toBuffer();
    const target=await crop(await readFile(reference),0,402);
    const scores=[];
    for(const c of visible){
        const bytes=await crop(png,Math.round(c.x*3),Math.round(c.y*3));let total=0;
        for(let i=0;i<target.length;i++)total+=Math.abs(target[i]!-bytes[i]!);
        scores.push(total/(target.length*255));
    }
    const index=uniqueCoverMatch(scores),c=visible[index]!;
    return {x:c.x+70,y:c.y+97,difference:scores[index]};
}

type Cell={x:number,y:number,width:number,height:number};
const visibleCells=(cells:Cell[])=>cells.filter(c=>c.y>=100&&(c.y*3+610)<=2796&&c.y+c.height<=932&&c.x>=0&&c.x*3+420<=1290);

/** Antonio, Oct 19: every Trial Reel linked the same Reel. Link the owned Reel that matches the post's topic instead,
 * chosen from instagram-reels.json (built by scripts/refresh-instagram-reels.ts). Deterministic: no model call.
 * The picker tiles have no accessibility text, so each Reel is found by the cover headline OCR reads on its tile. */
export interface CatalogReel { url: string; caption: string; label: string; headline: string; sha256: string; topics: string[]; inPicker: boolean }
export const reelCatalog = catalog as {defaultUrl: string; generic: string[]; vocabulary: string[]; reels: CatalogReel[]};
export const reelByUrl = (url: string | undefined) => reelCatalog.reels.find(r => r.url === url);

const words = (value: string) => ' ' + value.toLowerCase().replace(/[’']/g, '').replace(/#/g, ' ').replace(/[^a-z0-9$/+.-]+/g, ' ').replace(/(\S)[.]+(?=\s)/g, '$1').trim() + ' ';
/** The vocabulary phrases that appear as whole words in the text. */
export const topicsIn = (text: string, vocabulary = reelCatalog.vocabulary) => { const t = words(text); return vocabulary.filter(v => t.includes(words(v))); };

/** A shared topic counts 1, a generic one 0.5, and at least one must be specific. Below 2 keeps the default Reel. Never the post itself, a Reel with the same video, or a
 * Reel with the same cover headline (a re-cut of the same video), and only Reels the native picker lists. Ties keep the catalog order (newest first). */
export function chooseRelatedReel(post: {caption: string; sha256: string; headline?: string}) {
    const text = words(post.caption), own = post.headline ? headlineKey(post.headline) : '';
    const fallback = reelByUrl(reelCatalog.defaultUrl)!;
    let best = {reel: fallback, score: 0, topics: [] as string[]};
    for (const reel of reelCatalog.reels) {
        if (reel.url === fallback.url || reel.sha256 === post.sha256 || reel.caption === post.caption
            || !reel.inPicker || !reel.headline || (own && headlineSimilarity(own, headlineKey(reel.headline)) >= .8)) continue;
        const topics = reel.topics.filter(t => text.includes(words(t)));
        const score = topics.reduce((sum, t) => sum + (reelCatalog.generic.includes(t) ? .5 : 1), 0);
        if (score > best.score && topics.some(t => !reelCatalog.generic.includes(t))) best = {reel, score, topics};
    }
    return best.score >= 2 ? best : {reel: fallback, score: best.score, topics: [] as string[]};
}
export const relatedReelInput = (reel: CatalogReel) => ({url: reel.url, caption: reel.caption, label: reel.label});

/** Letters and digits only, so OCR spacing and punctuation do not matter. */
export const headlineKey = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** How well the headline appears inside the tile text: 1 minus the best substring edit distance over its length. */
export function headlineSimilarity(headline: string, tileText: string) {
    const a = headlineKey(headline), b = headlineKey(tileText);
    if (!a.length) return 0;
    let prev = new Array(b.length + 1).fill(0), cur = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= b.length; j++)
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        [prev, cur] = [cur, prev];
    }
    return 1 - Math.min(...prev) / a.length;
}

/** Order-free score: the share of the headline's letters (words of 2+ characters) found as exact pieces anywhere in
 * the tile text. Two OCR passes can split one headline in a different order ("CLAUDECANPLAN IN6DOCS | YOURWEBSITE"). */
export function headlineCoverage(headline: string, tileText: string) {
    const text = headlineKey(tileText), parts = headline.split(/\s+/).map(headlineKey).filter(w => w.length >= 2);
    const total = parts.reduce((n, w) => n + w.length, 0);
    return total ? parts.reduce((n, w) => n + (text.includes(w) ? w.length : 0), 0) / total : 0;
}

/** The cover headline: the large words only (OCR heights are in source pixels), in reading order. */
export function headlineFromWords(found: OcrWord[], minHeight: number) {
    return found.filter(w => w.height >= minHeight && w.confidence >= 60 && /[A-Za-z0-9]{2,}|^[0-9$+=]$/.test(w.text))
        .map(w => w.text).join(' ').trim();
}

/** OCR an image as is (dark text on light boxes) and as bright-text masks: white or yellow on dark at 190, and at
 * 110 for red, peach and green words, which turn mid-grey (Oct 20 picker: "NEVER", "HERE?" were lost at 190). */
export async function readCoverText(image: Buffer, region?: {left: number; top: number; width: number; height: number}, scale = 1, thresholds = [190]) {
    let base = sharp(image);
    if (region) base = base.extract(region);
    if (scale !== 1) { const m = await sharp(image).metadata(); const w = region?.width ?? m.width!; base = base.resize(Math.round(w * scale)); }
    const out = [await recognizeWords(await base.clone().greyscale().png().toBuffer())];
    for (const t of thresholds) out.push(await recognizeWords(await base.clone().greyscale().threshold(t).negate().png().toBuffer()));
    return out;
}

/** The headline from a source video's opening frame (1080 px wide or more): text at least 3.5% of the width tall. */
export async function coverHeadline(frame: Buffer) {
    const m = await sharp(frame).metadata();
    const region = {left: 0, top: 0, width: m.width!, height: Math.round(m.height! * .55)};
    const [plain, bright] = await readCoverText(frame, region);
    const min = m.width! * .035;
    const a = headlineFromWords(plain, min), b = headlineFromWords(bright, min);
    return headlineKey(b).length >= headlineKey(a).length ? b : a;
}

/** Find the one picker tile whose headline matches. Returns undefined when no visible tile matches (scroll and look
 * again); throws when two tiles match, so nothing is tapped. The tile's top 60% holds the headline. */
export async function locateHeadlineInCells(png: Buffer, cells: Cell[], headline: string, threshold = .8) {
    const meta = await sharp(png).metadata();
    if (meta.width !== 1290 || meta.height !== 2796) throw Error('Related Reel screen size changed');
    if (headlineKey(headline).length < 8) throw Error('Related Reel headline is too short to identify its tile');
    const scores: {cell: Cell; score: number; text: string}[] = [];
    for (const c of visibleCells(cells)) {
        const region = {left: Math.round(c.x * 3), top: Math.round(c.y * 3), width: Math.round(c.width * 3), height: Math.round(c.height * 3 * .6)};
        const texts = (await readCoverText(png, region, 2, [190, 110])).map(w => w.map(x => x.text).join(' '));
        const best = Math.max(...texts.map(t => headlineSimilarity(headline, t)), headlineCoverage(headline, texts.join(' ')));
        scores.push({cell: c, score: best, text: texts.join(' | ')});
    }
    const ranked = [...scores].sort((a, b) => b.score - a.score), hit = ranked[0] && ranked[0].score >= threshold ? ranked[0] : undefined;
    if (hit && ranked[1] && ranked[1].score > hit.score - .15) throw Error('Related Reel headline matches two picker tiles; no Reel selected');
    return {found: hit ? {x: hit.cell.x + 70, y: hit.cell.y + 97, score: hit.score} : undefined, scores};
}
