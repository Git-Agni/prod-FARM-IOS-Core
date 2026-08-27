import sharp from 'sharp';

export interface EngagementControls {
    like: { x: number; y: number };
    save: { x: number; y: number };
    confidence: number;
}

interface PixelImage {
    data: Buffer;
    width: number;
    height: number;
    channels: number;
}

interface Match {
    x: number;
    y: number;
    score: number;
}

const HEART_PATH = 'M32 56C28 51 7 38 7 21C7 10 20 5 32 17C44 5 57 10 57 21C57 38 36 51 32 56Z';
const BOOKMARK_PATH = 'M13 6Q13 3 17 3H47Q51 3 51 7V59L32 47L13 59Z';
const MIN_PAIR_CONFIDENCE = 0.18;

async function renderTemplate(path: string, size: number): Promise<Float64Array> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="white" d="${path}"/></svg>`;
    const { data } = await sharp(Buffer.from(svg)).resize(size, size).flatten({ background: 'black' })
        .greyscale().raw().toBuffer({ resolveWithObject: true });
    const values = Float64Array.from(data);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    for (let index = 0; index < values.length; index++) values[index] = values[index]! - mean;
    return values;
}

function iconIntensity(image: PixelImage): Float64Array {
    const values = new Float64Array(image.width * image.height);
    for (let index = 0; index < values.length; index++) {
        const offset = index * image.channels;
        values[index] = Math.max(image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!);
    }
    return values;
}

function normalizedCorrelation(
    pixels: Float64Array,
    imageWidth: number,
    template: Float64Array,
    size: number,
    left: number,
    top: number,
): number {
    let patchSum = 0;
    for (let y = 0; y < size; y++) {
        const row = (top + y) * imageWidth + left;
        for (let x = 0; x < size; x++) patchSum += pixels[row + x]!;
    }
    const patchMean = patchSum / template.length;
    let covariance = 0;
    let patchEnergy = 0;
    let templateEnergy = 0;
    for (let y = 0; y < size; y++) {
        const row = (top + y) * imageWidth + left;
        const templateRow = y * size;
        for (let x = 0; x < size; x++) {
            const patchValue = pixels[row + x]! - patchMean;
            const templateValue = template[templateRow + x]!;
            covariance += patchValue * templateValue;
            patchEnergy += patchValue * patchValue;
            templateEnergy += templateValue * templateValue;
        }
    }
    if (patchEnergy === 0 || templateEnergy === 0) return -1;
    return covariance / Math.sqrt(patchEnergy * templateEnergy);
}

function bestMatches(
    pixels: Float64Array,
    width: number,
    height: number,
    template: Float64Array,
    size: number,
    minYRatio: number,
    maxYRatio: number,
): Match[] {
    const half = Math.floor(size / 2);
    const minX = Math.max(half, Math.floor(width * 0.90));
    const maxX = Math.min(width - half - 1, Math.ceil(width * 0.96));
    const minY = Math.max(half, Math.floor(height * minYRatio));
    const maxY = Math.min(height - half - 1, Math.ceil(height * maxYRatio));
    const matches: Match[] = [];
    for (let y = minY; y <= maxY; y += 3) {
        for (let x = minX; x <= maxX; x += 3) {
            matches.push({
                x,
                y,
                score: normalizedCorrelation(pixels, width, template, size, x - half, y - half),
            });
        }
    }
    return matches.sort((left, right) => right.score - left.score).slice(0, 30);
}

export async function detectEngagementControls(screenshot: Buffer, scale: number): Promise<EngagementControls | undefined> {
    const { data, info } = await sharp(screenshot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const image: PixelImage = { data, width: info.width, height: info.height, channels: info.channels };
    const pixels = iconIntensity(image);
    const templateSize = Math.max(42, Math.round(32 * scale));
    const [heartTemplate, bookmarkTemplate] = await Promise.all([
        renderTemplate(HEART_PATH, templateSize),
        renderTemplate(BOOKMARK_PATH, templateSize),
    ]);
    const hearts = bestMatches(pixels, image.width, image.height, heartTemplate, templateSize, 0.25, 0.55);
    const bookmarks = bestMatches(pixels, image.width, image.height, bookmarkTemplate, templateSize, 0.45, 0.76);
    let best: { heart: Match; bookmark: Match; confidence: number } | undefined;
    for (const heart of hearts) {
        for (const bookmark of bookmarks) {
            const separation = bookmark.y - heart.y;
            if (Math.abs(bookmark.x - heart.x) > 24 * scale) continue;
            if (separation < image.height * 0.14 || separation > image.height * 0.25) continue;
            const confidence = Math.min(heart.score, bookmark.score);
            if (!best || confidence > best.confidence) best = { heart, bookmark, confidence };
        }
    }
    if (!best || best.confidence < MIN_PAIR_CONFIDENCE) return;
    return {
        like: { x: Math.round(best.heart.x / scale), y: Math.round(best.heart.y / scale) },
        save: { x: Math.round(best.bookmark.x / scale), y: Math.round(best.bookmark.y / scale) },
        confidence: best.confidence,
    };
}
