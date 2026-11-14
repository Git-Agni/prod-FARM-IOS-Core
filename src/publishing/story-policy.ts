/** Draft review only. Passing this policy never authorizes or performs publication. */
export const storyPolicy = {
    version: 2,
    stages: ['moment', 'problem', 'proof', 'lesson', 'reply'],
    nativeText: true,
    distinctImagesRequired: 5, // Legacy version 1
    distinctAssetsRequired: 5,
    supportedVersions: [1, 2],
    formats: ['proof_led', 'post_led', 'reel_spotlight', 'lifestyle'],
    musicStyle: 'music_only',
    publication: 'approval_required',
    automaticPublishingReady: false,
    reference: 'https://www.instagram.com/niksetting/',
} as const;
export function reviewStoryDraft(value: unknown) {
    const draft = value as any;
    const errors: string[] = [];
    if (!draft || typeof draft !== 'object') return { valid: false, errors: ['A Story draft is required.'], policyVersion: 1 };
    const v2 = draft.policyVersion === 2;
    if (v2 && draft.format === 'reel_spotlight') return reviewSpotlight(draft);
    if (v2 && draft.format === 'lifestyle') return reviewLifestyle(draft);
    if (![1, 2].includes(draft.policyVersion)) errors.push('Use Story policy version 1 or 2.');
    if (v2 && !['proof_led', 'post_led'].includes(draft.format)) errors.push('Choose proof_led or post_led format.');
    const stages = v2 && draft.format === 'post_led' ? ['problem', 'mechanism', 'post', 'lesson', 'reply'] : storyPolicy.stages;
    if (draft.nativeText !== true) errors.push('Use native Instagram text.');
    if (draft.musicStyle !== 'music_only') errors.push('Use background music without a visible sticker.');
    const frames = Array.isArray(draft.frames) ? draft.frames : [];
    const imageRefs = frames.map((frame: any) => typeof frame?.assetRef === 'string' ? frame.assetRef.trim() : '');
    if (new Set(imageRefs).size !== 5 || imageRefs.some((ref: string) => !ref)) errors.push('Use five different reviewed assets, one for each frame. Different filenames for the same image do not count.');
    if (frames.length !== 5) errors.push('Include all five frames for the selected format.');
    for (const [index, stage] of stages.entries()) {
        const frame = frames[index];
        if (!frame || frame.stage !== stage) { errors.push(`Frame ${index + 1} must cover ${stage}.`); continue; }
        if (typeof frame.text !== 'string' || !frame.text.trim() || frame.text.trim().split(/\s+/).length > 45) errors.push(`Frame ${index + 1} needs 1 to 45 words.`);
        if (!['gallery_photo', 'work_photo', 'dashboard', 'workflow', 'testimonial', ...(v2 ? ['b_roll', 'native_reel'] : [])].includes(frame.assetKind)) errors.push(`Frame ${index + 1} needs a real photo or evidence asset.`);
        if (v2 && frame.assetKind === 'b_roll' && (!Number.isFinite(frame.clipStartSeconds) || frame.clipStartSeconds < 0 || !Number.isFinite(frame.clipEndSeconds) || frame.clipEndSeconds - frame.clipStartSeconds < 3 || frame.clipEndSeconds - frame.clipStartSeconds > 12)) errors.push(`Frame ${index + 1} needs an exact B-roll trim of 3 to 12 seconds.`);
        if (v2 && frame.assetKind === 'native_reel' && (typeof frame.assetRef !== 'string' || !/^https:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/.test(frame.assetRef))) errors.push(`Frame ${index + 1} needs the exact published Reel URL.`);
        if (v2 && stage === 'post' && (frame.assetKind !== 'native_reel' || frame.claimReview !== 'source_checked')) errors.push('The post frame needs a checked native Reel share.');
        if (typeof frame.assetRef !== 'string' || !frame.assetRef.trim()) errors.push(`Frame ${index + 1} needs an asset reference.`);
        if (frame.visualReviewed !== true) errors.push(`Frame ${index + 1} needs a visual check for text space, relevance and privacy.`);
        if (!['no_factual_claim', 'source_checked'].includes(frame.claimReview)) errors.push(`Frame ${index + 1} needs a claim review.`);
        if (frame.claimReview === 'source_checked' && (typeof frame.sourceRef !== 'string' || !frame.sourceRef.trim())) errors.push(`Frame ${index + 1} needs its claim source.`);
        if (stage === 'proof' && (!['dashboard', 'workflow', 'testimonial'].includes(frame.assetKind) || frame.claimReview !== 'source_checked')) errors.push('The proof frame needs a checked dashboard, workflow or approved testimonial.');
    }
    if (!frames.some((f:any) => ['gallery_photo', 'work_photo', ...(v2 ? ['b_roll'] : [])].includes(f?.assetKind))) errors.push('Include a real personal or work photo.');
    return { valid: errors.length === 0, errors, policyVersion: draft.policyVersion, publicationAllowed: false };
}

/** Script-built sequence from one of Antonio's own published feed Reels (standing approval, Oct 13, 2026): every
 * frame is a distinct automated-checked still of that Reel and every text comes from its caption or fixed lines. */
function reviewSpotlight(draft: any) {
    const errors: string[] = [], frames = Array.isArray(draft.frames) ? draft.frames : [];
    const stages = ['hook', 'point', 'point', 'point', 'reply'];
    if (draft.nativeText !== true) errors.push('Use native Instagram text.');
    if (draft.musicStyle !== 'music_only') errors.push('Use background music without a visible sticker.');
    if (typeof draft.sourceReelId !== 'string' || !/^[a-f0-9-]{36}$/.test(draft.sourceReelId)) errors.push('A spotlight needs its source Reel.');
    if (frames.length !== 5) errors.push('Include all five frames for the selected format.');
    const refs = frames.map((f: any) => typeof f?.assetRef === 'string' ? f.assetRef.trim() : '');
    if (new Set(refs).size !== 5 || refs.some((r: string) => !r)) errors.push('Use five different reviewed assets, one for each frame. Different filenames for the same image do not count.');
    const sources = new Set(frames.map((f: any) => f?.sourceRef));
    if (sources.size !== 1 || ![...sources].every(u => typeof u === 'string' && /^https:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/.test(u))) errors.push('Every spotlight frame must come from the same published Reel.');
    for (const [i, stage] of stages.entries()) {
        const f = frames[i];
        if (!f || f.stage !== stage) { errors.push(`Frame ${i + 1} must cover ${stage}.`); continue; }
        if (typeof f.text !== 'string' || !f.text.trim() || f.text.trim().split(/\s+/).length > 45 || f.text.length > 300) errors.push(`Frame ${i + 1} needs 1 to 45 words.`);
        if (f.assetKind !== 'reel_frame' || f.automatedChecks !== true || f.claimReview !== 'source_checked') errors.push(`Frame ${i + 1} needs an automated-checked Reel frame.`);
    }
    return { valid: errors.length === 0, errors, policyVersion: draft.policyVersion, publicationAllowed: false };
}

/** Weekly lifestyle sequence (Antonio, Oct 15 2026): five of his approved photos or video stills with words drawn in,
 * two real proof cards, and a link sticker to one of his own Reels on the last frame. Script-built, no model. */
function reviewLifestyle(draft: any) {
    const errors: string[] = [], frames = Array.isArray(draft.frames) ? draft.frames : [];
    const reel = /^https:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/;
    if (draft.musicStyle !== 'music_only') errors.push('Use background music without a visible sticker.');
    if (frames.length !== 5) errors.push('Include all five frames for the selected format.');
    const refs = frames.map((f: any) => typeof f?.assetRef === 'string' ? f.assetRef.trim() : '');
    if (new Set(refs).size !== 5 || refs.some((r: string) => !r)) errors.push('Use five different reviewed assets, one for each frame. Different filenames for the same image do not count.');
    const photos = new Set(frames.map((f: any) => f?.photoSha256));
    if (photos.size !== 5 || photos.has(undefined)) errors.push('Each frame needs a different source photo.');
    for (const [i, f] of frames.entries()) {
        if (f?.assetKind !== 'lifestyle_frame' || f.automatedChecks !== true || f.textBurnedIn !== true) errors.push(`Frame ${i + 1} needs an automated-checked lifestyle frame with its words drawn in.`);
        if (typeof f?.text !== 'string' || !f.text.trim() || f.text.trim().split(/\s+/).length > 30) errors.push(`Frame ${i + 1} needs 1 to 30 words.`);
        if (f?.claimReview !== 'source_checked' || typeof f.sourceRef !== 'string' || !f.sourceRef) errors.push(`Frame ${i + 1} needs its text source.`);
    }
    if (frames.filter((f: any) => f?.proofCard).length < 1) errors.push('Include at least one real proof card.');
    const last = frames[4];
    if (!last || typeof last.linkUrl !== 'string' || !reel.test(last.linkUrl)) errors.push('The last frame needs a link sticker to one of our Reels.');
    if (frames.slice(0, 4).some((f: any) => f?.linkUrl)) errors.push('Only the last frame carries the Reel link.');
    return { valid: errors.length === 0, errors, policyVersion: draft.policyVersion, publicationAllowed: false };
}
