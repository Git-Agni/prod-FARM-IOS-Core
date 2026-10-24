/** Replace the caption on armed, unclaimed calendar items (Oct 23 caption standard: 400 characters or fewer, 1 to 5
 * hashtags). Usage: fix-armed-captions.ts changes.json [--apply]   changes.json = [{"id": "...", "caption": "..."}]
 * Validates with validatePostingInput, bumps the item and release versions together and keeps the run time. Database only. */
import { readFileSync } from 'node:fs';
import { createDatabaseConnection } from '../src/database/client.js';
import { requestHash, validatePostingInput } from '../src/publishing/model.js';
const changes: { id: string; caption: string }[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8')), apply = process.argv.includes('--apply');
const db = createDatabaseConnection(), c = await db.pool.connect();
try {
    await c.query('BEGIN');
    for (const ch of changes) {
        const i = (await c.query(`SELECT i.*, r.state, r.share_claimed_at, r.run_at FROM scheduler.publishing_items i JOIN scheduler.publishing_releases r ON r.item_id=i.id
            WHERE i.id=$1 FOR UPDATE OF i, r`, [ch.id])).rows[0];
        if (!i || i.state !== 'armed' || i.share_claimed_at) throw Error(`${ch.id} is not armed and unclaimed`);
        if (Date.parse(i.run_at) < Date.now() + 10 * 60_000) throw Error(`${ch.id} posts within 10 minutes`);
        const input = validatePostingInput({ ...i.input, caption: ch.caption });
        console.log(ch.id.slice(0, 8), i.input.caption.length, '->', input.caption.length);
        await c.query('UPDATE scheduler.publishing_items SET input=$2, request_hash=$3, version=version+1, updated_at=now() WHERE id=$1', [i.id, input, requestHash(input, i.media.sha256)]);
        await c.query('UPDATE scheduler.publishing_releases SET item_version=item_version+1, updated_at=now() WHERE item_id=$1', [i.id]);
    }
    await c.query(apply ? 'COMMIT' : 'ROLLBACK'); console.log(apply ? 'APPLIED' : 'DRY RUN (rolled back)');
} catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await db.close(); }
