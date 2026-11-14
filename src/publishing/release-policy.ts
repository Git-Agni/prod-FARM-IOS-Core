import { validatePostingInput, type PostingInput } from './model.js';

export interface ReleaseEvidence {
    nativeFlowFingerprint?:string;
    youtubeRelatedVideo?: { id: string; format: 'long_form'; verified: boolean };
    exactMedia: boolean;
    videoFrameCover: boolean;
    caption: boolean;
    account: boolean;
    automaticPromotion: boolean;
    /** How the Reel became a Trial: the old share-screen switch, or Instagram's Create trial reel entry (Oct 10). */
    trialEntry?: 'share_switch' | 'create_trial_reel';
    linkedFacebook: boolean;
    relatedReel?: { url: string; label: string; verified: boolean };
}
/** A preflight result can authorize one attempt, never a retry after Share. */
export function assertRelease(input: PostingInput, evidence: ReleaseEvidence, options: {nativeYouTubeLayout?:boolean} = {}): void {
    if (/https?:\/\/|www\./i.test(input.caption)) throw new Error('Remove URLs from the public caption');
    validatePostingInput(input);
    assertReleaseTargets(input, options);
    if (input.targets.some(t=>t.platform==='youtube')) {
        const related=input.youtube?.publishing?.relatedVideoId;
        if(!related||evidence.youtubeRelatedVideo?.id!==related
            ||evidence.youtubeRelatedVideo.format!=='long_form'||!evidence.youtubeRelatedVideo.verified)
            throw new Error('YouTube Shorts require a verified related long-form video');
    }

    if (!evidence.account || !evidence.caption || !evidence.exactMedia || !evidence.videoFrameCover)
        throw new Error('Account, caption, exact video and video-frame cover must pass preflight');
    if (input.instagramRelatedReel && (!evidence.relatedReel?.verified
        || evidence.relatedReel.url !== input.instagramRelatedReel.url
        || evidence.relatedReel.label !== input.instagramRelatedReel.label))
        throw new Error('The exact related Reel and link label must pass native preflight');
    if (input.instagramTrial && (!input.automaticPromotion || !evidence.automaticPromotion))
        throw new Error('Automatic promotion must be verified before publishing');
    if (input.targets.some(t => t.platform === 'facebook') && (input.facebookMode !== 'linked_from_instagram' || !evidence.linkedFacebook))
        throw new Error('Linked Facebook sharing must be verified before publishing');
}

/** One TikTok item has one Post claim; Instagram and linked Facebook keep their shared claim. */
export function assertReleaseTargets(input: PostingInput, options: {nativeYouTubeLayout?:boolean} = {}) {
    if (input.targets.some(t => t.platform === 'youtube') && !options.nativeYouTubeLayout) throw new Error('YouTube Shorts are preparation only. Native upload verification is pending.');
    if(input.targets.some(t=>t.platform==='youtube')){
        if(input.targets.length!==1||!input.youtube?.publishing)throw new Error('YouTube requires one target and complete reviewed publishing details');
        return;
    }
    const tiktok=input.targets.some(t=>t.platform==='tiktok');
    if(tiktok && input.targets.length!==1) throw new Error('Schedule TikTok as its own calendar item');
    if(!tiktok && !input.targets.some(t=>t.platform==='instagram')) throw new Error('This release flow requires Instagram or TikTok');
}

export interface ReleaseDriver {
    readonly youtubeNative?:boolean;
    nativeFlowFingerprint?:string;
    preflight(input: PostingInput, media: unknown): Promise<ReleaseEvidence>;
    shareOnce(): Promise<void>;
    /** A receipt is verified by a provider URL or by native on-phone evidence (iOS blocks reading the copied link). */
    verify(): Promise<Record<string, { url?: string; verified: boolean; evidence?: string; source?: string }>>;
}
export class ReceiptVerificationError extends Error {
 constructor(message:string,public receipts:Awaited<ReturnType<ReleaseDriver['verify']>>){super(message);}
}
export interface ReleaseJournal {
    claimShare(): Promise<boolean>;
    save(state: 'published' | 'needs_review', result: unknown): Promise<void>;
}
export async function releaseOnce(input: PostingInput, media: unknown, driver: ReleaseDriver, journal: ReleaseJournal) {
    let claimed = false, evidence: ReleaseEvidence | undefined;
    try {
        validatePostingInput(input);
        const options={nativeYouTubeLayout:driver.youtubeNative===true};
        assertReleaseTargets(input,options);
        if (/https?:\/\/|www\./i.test(input.caption)) throw new Error('Remove URLs from the public caption');
        evidence = await driver.preflight(input, media);
        assertRelease(input, evidence,options);
        claimed = await journal.claimShare();
        if (!claimed) throw new Error('This post already has a Share attempt; inspect it before any further action');
        await driver.shareOnce();
        const receipts = await driver.verify();
        assertReceipts(input, receipts);
        await journal.save('published', { receipts, evidence, ...(driver.nativeFlowFingerprint?{nativeFlowFingerprint:driver.nativeFlowFingerprint}:{}) });
    } catch (error) {
        await journal.save('needs_review', { error: error instanceof Error ? error.message : String(error), shareAttempted: claimed, ...(evidence?{evidence}:{}), ...(error instanceof ReceiptVerificationError?{receipts:error.receipts}:{}), ...(driver.nativeFlowFingerprint?{nativeFlowFingerprint:driver.nativeFlowFingerprint}:{}) });
        throw error;
    }
}

/** Shared by first-pass verification and later read-only reconciliation. */
export function assertReceipts(input: PostingInput, receipts: Awaited<ReturnType<ReleaseDriver["verify"]>>) {
        for (const target of input.targets) {
            const receipt = receipts[target.platform];
            if (!receipt?.verified || (!receipt.url && !receipt.evidence)) throw new Error(`The ${target.platform} post still needs verification`);
            // Independent proof: the platform's own app, or its official public data (Graph API, channel feed).
            if (target.platform === 'facebook' && !['facebook_app','facebook_graph'].includes(String(receipt.source))) throw new Error('Independent Facebook app verification is required');
            if (target.platform === 'tiktok' && receipt.source !== 'tiktok_app') throw new Error('Native TikTok post verification is required');
            if(target.platform==='youtube'&&!['youtube_app','youtube_public_feed','youtube_shorts_page'].includes(String(receipt.source)))throw new Error('Native YouTube post verification is required');
            if (receipt.url) {
                const host = new URL(receipt.url).hostname;
                const domain = target.platform === 'instagram' ? 'instagram.com' : target.platform === 'tiktok' ? 'tiktok.com' : target.platform==='youtube'?'youtube.com':'facebook.com';
                if (host !== domain && !host.endsWith('.' + domain)) throw new Error('Unexpected post receipt URL');
            }
        }
}
