/** Make a held YouTube Short armable without a person (Oct 20: kit Shorts could not arm). Two checks, both required:
 * 1. Frame 0 is a real cover (src/publishing/short-cover-check.ts): thumbnail-style headline naming the subject.
 * 2. The Short already links an owned long-form video, or its topic matches one (chooseLongForm score 2+). The catalog default is never used
 *    as a fallback: a Short with no topic match stays held for a person to pick.
 * With --apply and both passing: links the long-form (link-shorts-long-form.ts) and records the cover review
 * (record-shorts-cover-review.ts). Prints one JSON line. Arms nothing; the caller arms.
 * Usage: prepare-short-for-arm.ts <item id> [--apply] */
import { execFileSync } from 'node:child_process';
import { createDatabaseConnection } from '../src/database/client.js';
import { chooseLongForm, longFormById } from '../src/publishing/youtube-longform.js';
import { checkShortCover } from '../src/publishing/short-cover-check.js';

const [id] = process.argv.slice(2), apply = process.argv.includes('--apply');
if (!id) throw Error('Usage: prepare-short-for-arm.ts <item id> [--apply]');
const db = createDatabaseConnection();
const run = (script: string, args: string[]) => execFileSync(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', script, ...args], { encoding: 'utf8' }).trim();
try {
    const i = (await db.pool.query('SELECT * FROM scheduler.publishing_items WHERE id=$1', [id])).rows[0];
    if (!i || i.status !== 'held' || !i.input.targets.some((t: any) => t.platform === 'youtube')) { console.log(JSON.stringify({ id, ready: false, reason: 'not a held Short' })); process.exit(0); }
    const cover = await checkShortCover(i.media.path, i.input.youtube?.title ?? '');
    // A long-form link already on the item (set by hand or by --yt-related) is kept; otherwise the topic match decides.
    const linked = longFormById(i.input.youtube?.publishing?.relatedVideoId);
    const pick = linked ? { video: linked, score: Infinity, topics: ['already linked'] } : chooseLongForm(i.input), matched = pick.score >= 2;
    const ready = cover.pass && matched;
    const reason = !cover.pass ? `cover: ${cover.reason} ("${cover.headline}")` : !matched ? 'no long-form topic match; pick one by hand' : 'ready';
    if (ready && apply) {
        if (!linked) run('scripts/link-shorts-long-form.ts', [`${id}=${pick.video.id}`, '--apply']);
        run('scripts/record-shorts-cover-review.ts', [`frame0-vision:${cover.model}`, id, '--apply']);
    }
    console.log(JSON.stringify({ id, name: i.media.name, ready, applied: ready && apply, reason, longForm: matched ? pick.video.titles[0] : null, topics: pick.topics, cover }));
} finally { await db.close(); }
