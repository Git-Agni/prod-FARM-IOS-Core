import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const youtubeShortsReadiness = {
    ready: false,
    preparationReady: true,
    reason: 'A prepared Short passed a native upload and long-form link check. Fresh uploads still need a worker pilot. General arming remains disabled.',
};

export interface YouTubeDetails {
    title: string;
    channelId: string;
    visibility: 'private' | 'unlisted' | 'public';
    madeForKids: boolean;
    publishing?: {
        category: 'Howto & Style' | 'Education' | 'Science & Technology';
        tags: string[];
        hashtags: string[];
        commentKeyword: string;
        relatedVideoId?: string;
        aiUse: 'no' | 'yes' | 'review';
        coverMode: 'existing_frame' | 'replace_first_frame';
    };
}

export function validateYouTubeDetails(value: unknown): YouTubeDetails {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('YouTube details are required');
    const v = value as Record<string, unknown>;
    if (typeof v.title !== 'string' || !v.title.trim() || Array.from(v.title).length > 100 || /[<>\r\n]/.test(v.title))
        throw new Error('YouTube title must be 1 to 100 characters, with no angle brackets or line breaks');
    if (typeof v.channelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(v.channelId)) throw new Error('Use the exact YouTube channel ID');
    if (!['private', 'unlisted', 'public'].includes(String(v.visibility))) throw new Error('Choose YouTube visibility');
    if (typeof v.madeForKids !== 'boolean') throw new Error('Choose whether the Short is made for kids');
    let publishing: YouTubeDetails['publishing'];
    if (v.publishing !== undefined) {
        const p = v.publishing as Record<string, unknown>;
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid YouTube publishing details');
        if (!['Howto & Style','Education','Science & Technology'].includes(String(p.category))) throw new Error('Choose a supported YouTube category');
        if (!Array.isArray(p.tags) || !p.tags.length || p.tags.length > 30 || p.tags.some(t => typeof t !== 'string' || !t.trim() || /[<>\r\n]/.test(t)) || p.tags.join(',').length > 450) throw new Error('Add relevant tags, up to 450 characters combined');
        if (!Array.isArray(p.hashtags) || !p.hashtags.length || p.hashtags.length > 5 || p.hashtags.some(t => typeof t !== 'string' || !/^#[\p{L}\p{N}_]+$/u.test(t))) throw new Error('Add 1 to 5 valid hashtags');
        if (typeof p.commentKeyword !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/.test(p.commentKeyword)) throw new Error('Use a comment keyword with 2 to 40 letters, digits, underscores or hyphens');
        if (p.relatedVideoId !== undefined && (typeof p.relatedVideoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(p.relatedVideoId))) throw new Error('Use an exact 11-character related video ID');
        if (!['no','yes','review'].includes(String(p.aiUse))) throw new Error('Review the YouTube AI use setting');
        if (!['existing_frame','replace_first_frame'].includes(String(p.coverMode))) throw new Error('Choose a cover preparation mode');
        publishing = { category: p.category as any, tags: [...new Set((p.tags as string[]).map(t => t.trim()))], hashtags: [...new Set(p.hashtags as string[])], commentKeyword: p.commentKeyword, aiUse: p.aiUse as any, coverMode: p.coverMode as any, ...(p.relatedVideoId ? { relatedVideoId: p.relatedVideoId as string } : {}) };
    }
    return { ...(publishing ? { publishing } : {}), title: v.title.trim(), channelId: v.channelId, visibility: v.visibility as YouTubeDetails['visibility'], madeForKids: v.madeForKids };
}

/** Validate the real file. Declared dimensions or a filename are not media evidence. */
export function validateShortsProbe(probe: any) {
    const streams = probe?.streams?.filter((s: any) => s.codec_type === 'video' && !s.disposition?.attached_pic) ?? [];
    if (streams.length !== 1) throw new Error('A Short needs exactly one video stream');
    const stream = streams[0];
    let width = Number(stream.width), height = Number(stream.height);
    const duration = Number(probe.format?.duration ?? stream.duration);
    const rotation = Number(stream.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
    if (![width, height, duration, rotation].every(Number.isFinite) || width <= 0 || height <= 0 || duration <= 0)
        throw new Error('Video dimensions, duration or rotation could not be verified');
    if (rotation % 90 !== 0) throw new Error('Unsupported video rotation');
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    if (stream.sample_aspect_ratio && !['1:1', 'N/A'].includes(stream.sample_aspect_ratio)) throw new Error('Export the Short with square pixels');
    if (width > height) throw new Error('YouTube Shorts must be square or vertical');
    if (duration > 180) throw new Error('YouTube Shorts must be 3 minutes or shorter');
    return { width, height, durationSeconds: duration, rotation, eligible: true as const };
}

export async function inspectShortsVideo(file: string) {
    try {
        const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 20_000, maxBuffer: 1024 * 1024 });
        return validateShortsProbe(JSON.parse(stdout));
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) throw new Error('Video inspection failed. Check that ffprobe is installed and the video opens.');
        throw error;
    }
}
