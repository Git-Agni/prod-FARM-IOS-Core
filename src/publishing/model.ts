import { createHash } from 'node:crypto';
import { validateYouTubeDetails, youtubeShortsReadiness, type YouTubeDetails } from './youtube-shorts.js';

export const platforms = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Platform = typeof platforms[number];
export interface PostingInput {
    requestId: string;
    deviceUdid: string;
    caption: string;
    runAt: string;
    timezone: string;
    targets: { platform: Platform; account: string }[];
    instagramTrial: boolean;
    automaticPromotion: boolean;
    facebookMode: 'linked_from_instagram' | 'direct';
    /** Question posted after native verification. Instagram and Facebook pin it; TikTok reports when pinning is unavailable. */
    firstComment?: string;
    youtube?: YouTubeDetails;
    /** Exact public Reel and the native link title reviewed before release. */
    instagramRelatedReel?: { url: string; caption: string; label: string };
}
export const readiness = {
    youtube: youtubeShortsReadiness,
    instagram: { ready: true, reason: 'Armed Trial Reels post at their time: exact video by length and date, caption, manual AI label off, Trial, automatic promotion, one Share, native receipt, first comment pinned. Live since 2026-09-30.' },
    facebook: { ready: true, reason: 'Native linked sharing to Antonio Revenue, followed by an independent full-caption check inside the Facebook app.' },
    tiktok: { ready: true, reason: 'Native iPhone posting with exact video, account, caption, opening-frame cover and public visibility checks. TikTok uses its own calendar item and requires a native publication receipt.' },
};
export function validatePostingInput(value: unknown): PostingInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Post must be an object');
    const p = value as Record<string, unknown>;
    for (const key of ['requestId', 'deviceUdid', 'caption', 'runAt', 'timezone']) {
        if (typeof p[key] !== 'string') throw new Error(`${key} must be text`);
    }
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(p.requestId as string)) throw new Error('Use a unique requestId with 8 to 128 letters, digits, underscores or hyphens');
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(p.deviceUdid as string)) throw new Error('Choose a registered phone');
    if (/^\s*(?:AI avatar with narration generated from my voice\.|(?:this (?:video|reel) (?:was|is) )?AI[- ]generated (?:avatar|voice|video|content)[^\n]*)\s*$/im.test(p.caption as string)) throw new Error('Remove the added AI disclosure from the caption');
    const youtubeRequested = Array.isArray(p.targets) && p.targets.some((t: any) => t?.platform === 'youtube');
    const captionLimit = youtubeRequested ? 5000 : 2200;
    if ((p.caption as string).length > captionLimit) throw new Error(`Caption must be ${captionLimit.toLocaleString('en-US')} characters or fewer`);
    // Oct 23 (Antonio): every Instagram, Facebook and TikTok caption is Harvey-sized (the Harvey reel caption was 384
    // characters: hook, one short line, Comment KEYWORD, hashtags). Facebook's Reel checklist flags over 400 (Oct 22).
    if (!youtubeRequested) {
        const caption = (p.caption as string).trim(), tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        if (caption.length > 400) throw new Error(`Caption is ${caption.length} characters; keep it at 400 or fewer (Harvey size)`);
        if (tags.length < 1 || tags.length > 5) throw new Error(`Caption has ${tags.length} hashtags; use 1 to 5`);
    }
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(p.runAt as string) || !Number.isFinite(Date.parse(p.runAt as string))) throw new Error('runAt must include a UTC offset or Z');
    try { new Intl.DateTimeFormat('en', { timeZone: p.timezone as string }); } catch { throw new Error('Use a valid IANA timezone'); }
    if (!Array.isArray(p.targets) || p.targets.length < 1 || p.targets.length > 3) throw new Error('Choose one to three platforms');
    const seen = new Set<string>();
    const targets = p.targets.map((v: unknown) => {
        if (!v || typeof v !== 'object') throw new Error('Invalid target');
        const t = v as Record<string, unknown>;
        if (!platforms.includes(t.platform as Platform)) throw new Error('Supported platforms: Instagram, Facebook, TikTok and YouTube Shorts');
        if (seen.has(t.platform as string)) throw new Error('Choose each platform once');
        seen.add(t.platform as string);
        if (typeof t.account !== 'string' || !t.account.trim() || t.account.length > 200) throw new Error('Every target needs an account');
        if (t.platform !== 'facebook' && !(t.platform === 'youtube' ? /^@?[A-Za-z0-9._-]{3,30}$/ : /^@?[A-Za-z0-9._]{1,64}$/).test(t.account)) throw new Error('Use the exact account handle');
        if (t.platform === 'facebook') {
            const url = new URL(t.account);
            if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(url.hostname) || url.username || url.password || url.hash) throw new Error('Use the exact HTTPS Facebook Page URL');
        }
        return { platform: t.platform as Platform, account: t.account.trim() };
    }).sort((a,b) => a.platform.localeCompare(b.platform));
    if (typeof p.instagramTrial !== 'boolean') throw new Error('Choose whether this is an Instagram trial Reel');
    if (typeof p.automaticPromotion !== 'boolean' || p.automaticPromotion !== p.instagramTrial) throw new Error('Trial Reels require automatic promotion on; other posts require it off');
    if (p.facebookMode !== 'linked_from_instagram' && p.facebookMode !== 'direct') throw new Error('Choose how Facebook receives this post');
    if (seen.has('facebook') && p.facebookMode === 'linked_from_instagram' && !seen.has('instagram')) throw new Error('Linked Facebook sharing requires Instagram on the same item');
    if (p.instagramTrial && !seen.has('instagram')) throw new Error('Trial Reels require an Instagram target');
    const youtube = youtubeRequested ? validateYouTubeDetails(p.youtube) : undefined;
    if (youtube?.publishing) {
        const desc = p.caption as string;
        const config = youtube.publishing;
        if (!new RegExp('(?:^|[^A-Za-z0-9_-])' + config.commentKeyword + '(?![A-Za-z0-9_-])', 'i').test(desc)) throw new Error('Include the exact comment keyword in the description');
        for (const tag of config.hashtags) if (!desc.split(/\s+/).includes(tag)) throw new Error('Include each selected hashtag in the description');
    }
    if (youtubeRequested && targets.length !== 1) throw new Error('Prepare YouTube as its own calendar item');
    if (!youtubeRequested && p.youtube !== undefined) throw new Error('YouTube details require a YouTube target');
    if (youtubeRequested && /[<>]/.test(p.caption as string)) throw new Error('YouTube descriptions cannot contain angle brackets');
    let instagramRelatedReel: PostingInput['instagramRelatedReel'];
    if (p.instagramRelatedReel !== undefined) {
        if (!seen.has('instagram')) throw new Error('A related Reel requires an Instagram target');
        const reel = p.instagramRelatedReel as Record<string, unknown>;
        if (!reel || typeof reel !== 'object' || Array.isArray(reel)) throw new Error('Related Reel must be an object');
        if (typeof reel.url !== 'string' || typeof reel.caption !== 'string' || typeof reel.label !== 'string')
            throw new Error('Related Reel needs its public URL, exact caption and link label');
        const url = new URL(reel.url);
        if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)
            || url.username || url.password || url.search || url.hash || !/^\/reel\/[A-Za-z0-9_-]+\/$/.test(url.pathname))
            throw new Error('Use the exact public Instagram Reel URL');
        // Oct 20: Instagram's link title field keeps 15 characters ("Plan your website in 6 docs" saved as "Plan your websi").
        if (!reel.caption.trim() || reel.caption.length > 2200 || !reel.label.trim() || reel.label.trim().length > 15)
            throw new Error('Related Reel needs an exact caption and a link label of at most 15 characters');
        instagramRelatedReel = { url: url.href, caption: reel.caption, label: reel.label.trim() };
    }
    let firstComment: string | undefined;
    if (p.firstComment !== undefined) {
        if (typeof p.firstComment !== 'string' || p.firstComment.trim().length < 12 || p.firstComment.length > 300) throw new Error('First comment must be 12 to 300 characters');
        if (/https?:\/\/|www\./i.test(p.firstComment)) throw new Error('First comments are URL-free');
        firstComment = p.firstComment.trim();
    }
    return { requestId: p.requestId as string, deviceUdid: p.deviceUdid as string, caption: p.caption as string,
        runAt: new Date(p.runAt as string).toISOString(), timezone: p.timezone as string, targets,
        instagramTrial: p.instagramTrial, automaticPromotion: p.automaticPromotion, facebookMode: p.facebookMode,
        ...(firstComment ? { firstComment } : {}), ...(youtube ? { youtube } : {}), ...(instagramRelatedReel ? { instagramRelatedReel } : {}) };
}
export function requestHash(input: PostingInput, videoHash: string, coverHash?: string): string {
    return createHash('sha256').update(JSON.stringify({ input, videoHash, coverHash: coverHash ?? null })).digest('hex');
}
