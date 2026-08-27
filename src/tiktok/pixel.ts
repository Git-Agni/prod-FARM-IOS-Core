import sharp from 'sharp';

const RED_MIN_R = 200;
const RED_MAX_G = 90;
const RED_MAX_B = 110;
const CHECK_RADIUS = 20;
const CHECKED_PIXEL_THRESHOLD = 50;

// Detects TikTok's red checkbox fill within a small radius of a
// point-space coordinate. Toggle state (filled vs. outlined circle) isn't
// text, so OCR can't read it — this is a color check instead.
export async function isRedCheckboxChecked(
    screenshot: Buffer,
    point: { x: number; y: number },
    scale: number,
): Promise<boolean> {
    const { data, info } = await sharp(screenshot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const centerX = Math.round(point.x * scale);
    const centerY = Math.round(point.y * scale);
    let redCount = 0;
    for (let y = centerY - CHECK_RADIUS; y <= centerY + CHECK_RADIUS; y++) {
        if (y < 0 || y >= info.height) continue;
        for (let x = centerX - CHECK_RADIUS; x <= centerX + CHECK_RADIUS; x++) {
            if (x < 0 || x >= info.width) continue;
            const idx = (y * info.width + x) * info.channels;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            if (r > RED_MIN_R && g < RED_MAX_G && b < RED_MAX_B) redCount += 1;
        }
    }
    return redCount > CHECKED_PIXEL_THRESHOLD;
}
