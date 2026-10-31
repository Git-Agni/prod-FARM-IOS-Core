import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validatePostingInput, type PostingInput} from './model.js';
import {chooseRelatedReel, coverHeadline, relatedReelInput, reelByUrl} from './instagram-related.js';
import {isSecondaryAccount} from './posting-accounts.js';

const run = promisify(execFile);

/** The cover headline on a video's opening frame (the same read as scripts/link-reels-by-topic.ts). */
export async function openingHeadline(path: string) {
    const {stdout} = await run('ffmpeg', ['-loglevel', 'error', '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], {encoding: 'buffer', maxBuffer: 64 << 20});
    return coverHeadline(stdout as unknown as Buffer);
}

/** Oct 20: eight posts scheduled after the topic catalog went live had no related Reel until someone ran
 * link-reels-by-topic.ts by hand. Every Instagram item without one now gets the topic-matched Reel when it is created
 * and when it is armed. Returns undefined when nothing should change: not Instagram, a Reel already chosen, an
 * unreadable opening frame (the media check stops that post anyway), or a pick that is this same video. */
export async function linkRelatedReel(input: PostingInput, media: {path: string; sha256: string},
    headlineOf: (path: string) => Promise<string> = openingHeadline) {
    // The Reel catalog is @antoniorevenue's; other accounts get no automatic related Reel (Oct 30).
    if (input.instagramRelatedReel || !input.targets.some(t => t.platform === 'instagram') || isSecondaryAccount(input)) return undefined;
    let headline: string;
    try { headline = await headlineOf(media.path); } catch { return undefined; }
    const pick = chooseRelatedReel({caption: input.caption, sha256: media.sha256, headline});
    if (pick.reel.sha256 === media.sha256 || pick.reel.caption === input.caption) return undefined;
    return {input: validatePostingInput({...input, instagramRelatedReel: relatedReelInput(pick.reel)}),
        choice: {at: new Date().toISOString(), from: null, to: pick.reel.url, score: pick.score, topics: pick.topics, headline, automatic: true}};
}

/** The catalog is imported once, when the worker starts. A Reel added to instagram-reels.json after that is unknown
 * here, and the picker would fail mid-composer, so stop before any phone input. */
export function assertRelatedReelInCatalog(input: PostingInput) {
    const url = input.instagramRelatedReel?.url;
    if (url && !reelByUrl(url))
        throw new Error(`Related Reel ${url} is not in the Reel catalog this worker loaded at start. Restart the worker to load the current instagram-reels.json; nothing was sent to the phone`);
}
