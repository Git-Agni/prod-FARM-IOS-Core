// After-publish Instagram actions that no provider API offers: pin the reel's first comment, and share a reel to the Story.
// Metricool publishes the reel and posts the first comment; these actions only pin it or share the live reel once.
export type EngageAction = 'pin' | 'story' | 'story_best';
export interface EngagePayload {
    [key: string]: string;
    action: EngageAction;
    postUrl: string;
    captionPrefix: string;
    comment: string;
    claimKey: string;
}

const REEL_URL = /^https:\/\/www\.instagram\.com\/(reel|p)\/[A-Za-z0-9_-]{5,40}\/$/;

export function validateEngagePayload(value: unknown, localDate: string): EngagePayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Engagement payload must be an object');
    const p = value as Record<string, unknown>;
    if (p.action === 'story_best') return { action: 'story_best', postUrl: '', captionPrefix: '', comment: '', claimKey: `story:${localDate}` };
    if (p.action !== 'pin' && p.action !== 'story') throw new Error('Action must be pin, story or story_best');
    if (typeof p.postUrl !== 'string' || !REEL_URL.test(p.postUrl)) throw new Error('Use the exact Instagram reel URL');
    if (typeof p.captionPrefix !== 'string' || p.captionPrefix.trim().length < 12 || p.captionPrefix.length > 80) throw new Error('Caption prefix must be 12 to 80 characters');
    const comment = typeof p.comment === 'string' ? p.comment.trim() : '';
    if (p.action === 'pin' && (comment.length < 12 || comment.length > 300)) throw new Error('Pin needs the exact first-comment text');
    if (/https?:\/\/|www\./i.test(comment)) throw new Error('Pinned comments are URL-free');
    // One pin per reel; one Story per day. The claim key makes a repeat run a no-op instead of a second action.
    const claimKey = p.action === 'pin' ? `pin:${p.postUrl}` : `story:${localDate}`;
    return { action: p.action, postUrl: p.postUrl, captionPrefix: p.captionPrefix.trim(), comment, claimKey };
}

/** Controls these drivers may touch. Share-sheet contact cells and the DM send path are never on this list. */
export const ENGAGE_CONTROLS = ['comment-button', 'send-button', 'Add to story', 'share-to-your-story', 'Pin', 'Pin comment',
    'Dismiss', 'discard-story-preview', 'Discard'] as const;
export type EngageControl = typeof ENGAGE_CONTROLS[number];
export function assertEngageControl(name: string): asserts name is EngageControl {
    if (!(ENGAGE_CONTROLS as readonly string[]).includes(name)) throw new Error(`Control ${name} is not allowed for engagement`);
}

/** Predicate-string literal for WDA: escape quotes and backslashes without truncating exact comment text. */
export function predicateLiteral(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
