import { recognize } from 'node-native-ocr';

// node-native-ocr@0.4.18 ships a stale .d.ts declaring an `output` option,
// but the installed runtime (src/index.js) actually reads `format` — confirmed
// by reading the package source directly and testing both against a real
// image. Recast the call to the option name that's actually honored.
type RealRecognizeOptions = { lang?: string; format?: 'txt' | 'tsv' };
const recognizeRaw = recognize as unknown as (image: Buffer, options?: RealRecognizeOptions) => Promise<string>;

export interface OcrWord {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

const MIN_CONFIDENCE = 40;

// Tesseract TSV: level, page_num, block_num, par_num, line_num, word_num,
// left, top, width, height, conf, text. Only level 5 rows are individual
// words; levels 1-4 are page/block/paragraph/line aggregates with conf -1.
export function parseTsv(tsv: string): OcrWord[] {
    const words: OcrWord[] = [];
    for (const line of tsv.split('\n')) {
        if (!line.trim()) continue;
        const columns = line.split('\t');
        if (columns.length < 12 || columns[0] !== '5') continue;
        const confidence = Number(columns[10]);
        const text = columns[11].trim();
        if (!text || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
        words.push({
            text,
            x: Number(columns[6]),
            y: Number(columns[7]),
            width: Number(columns[8]),
            height: Number(columns[9]),
            confidence,
        });
    }
    return words;
}

export async function recognizeWords(image: Buffer): Promise<OcrWord[]> {
    const tsv = await recognizeRaw(image, { format: 'tsv' });
    return parseTsv(tsv);
}

function normalizeHandle(handle: string): string {
    return handle.trim().toLowerCase().replace(/^@/, '');
}

// Exact match first; substring containment as a fuzzy fallback for OCR
// noise. The fallback is logged because it can false-positive between
// similar handles (e.g. "@jenny.doe" is a substring of "@jenny.doe2"). A
// length-ratio guard keeps it from also matching short garbage tokens
// (misread icons/glyphs, e.g. a lone "o") against any longer target — every
// short string is trivially a substring of a long one.
export function findHandleMatch(words: OcrWord[], targetHandle: string): OcrWord | undefined {
    const target = normalizeHandle(targetHandle);
    if (!target) return undefined;
    const exact = words.find((word) => normalizeHandle(word.text) === target);
    if (exact) return exact;
    const fuzzy = words.find((word) => {
        const normalized = normalizeHandle(word.text);
        if (normalized.length < 4 || target.length < 4) return false;
        const [shorter, longer] = normalized.length <= target.length ? [normalized, target] : [target, normalized];
        return shorter.length / longer.length >= 0.5 && longer.includes(shorter);
    });
    if (fuzzy) {
        console.log(`Account handle matched fuzzily: OCR saw "${fuzzy.text}" for target "${targetHandle}"`);
    }
    return fuzzy;
}

// Screenshots are device-pixel resolution; WDA taps are point-space.
export function pointFromWord(word: OcrWord, scale: number): { x: number; y: number } {
    return {
        x: Math.round((word.x + word.width / 2) / scale),
        y: Math.round((word.y + word.height / 2) / scale),
    };
}
