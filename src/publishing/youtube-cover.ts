import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { inspectShortsVideo } from './youtube-shorts.js';

const exec = promisify(execFile);
export async function fileHash(file: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

/** Replace one decoded frame, never prepend time or alter the soundtrack. Caller owns an isolated directory. */
export async function prepareYouTubeCover(source: string, cover: string, directory: string) {
    const original = await inspectShortsVideo(source);
    if (original.width % 2 || original.height % 2 || original.width > 2160 || original.height > 3840)
        throw new Error('Cover preparation requires even dimensions up to 2160 by 3840');
    const renderDirectory = path.join(directory, 'youtube-cover-render');
    await mkdir(renderDirectory, { mode: 0o700 }); // Exclusive creation also protects earlier derivatives.
    const normalized = path.join(renderDirectory, 'youtube-cover-normalized.png');
    const output = path.join(renderDirectory, 'youtube-first-frame.mp4');
    if ([source, cover].some(f => [output, normalized].includes(path.resolve(f)))) throw new Error('Cover output must be separate from source files');
    try {
        await sharp(cover, { limitInputPixels: 40_000_000 }).rotate()
            .resize(original.width, original.height, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).png().toFile(normalized);
        await exec('ffmpeg', ['-v','error','-n','-i',source,'-i',normalized,
            '-filter_complex',"[0:v][1:v]overlay=enable='eq(n,0)':eof_action=repeat:repeatlast=1[v]",
            '-map','[v]','-map','0:a?','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
            '-fps_mode','passthrough','-c:a','copy','-map_metadata','-1','-movflags','+faststart',output],
            { timeout: 300_000, maxBuffer: 1024 * 1024 });
        const prepared = await inspectShortsVideo(output);
        if (prepared.width !== original.width || prepared.height !== original.height || Math.abs(prepared.durationSeconds - original.durationSeconds) > 0.05)
            throw new Error('Prepared video timing or dimensions changed; review the source export');
        const size = (await stat(output)).size;
        if (size > 350 * 1024 * 1024) throw new Error('Prepared video exceeds 350 MiB');
        return { media: { path: output, name: 'youtube-first-frame.mp4', mimeType: 'video/mp4', size, sha256: await fileHash(output) },
            receipt: { mode: 'replace_first_frame' as const, sourceSha256: await fileHash(source), coverSha256: await fileHash(cover),
                preparedSha256: await fileHash(output), original, prepared, audio: 'copied_without_reencoding',
                thumbnailSelectionVerified: false, reviewRequired: true } };
    } catch (error) {
        await rm(output, { force: true });
        if (error && typeof error === 'object' && 'code' in error) throw new Error('Cover rendering failed. Check the image, video and ffmpeg installation.');
        throw error;
    }
}
