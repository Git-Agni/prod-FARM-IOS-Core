/** Point a held YouTube Short at a version of its video with a branded cover on frames 0 to 5 (Oct 20: three kit Shorts
 * opened on a caption line, so they could not pass the frame-zero cover check). The new file must keep every frame and the
 * duration of the old one; only the cover frames change. The Short's Instagram and TikTok items keep their own file.
 * Usage: swap-short-cover.ts <item id> <new mp4> <cover png> [--apply]. Database and local files only; arms nothing. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createDatabaseConnection } from '../src/database/client.js';
import { validatePostingInput, requestHash } from '../src/publishing/model.js';

const [id, file, cover] = process.argv.slice(2), apply = process.argv.includes('--apply');
if (!id || !file || !cover) throw Error('Usage: swap-short-cover.ts <item id> <new mp4> <cover png> [--apply]');
const frames = (p: string) => parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', p], { encoding: 'utf8' }), 10);
const seconds = (p: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }));
const sha256 = async (p: string) => { const h = createHash('sha256'); for await (const c of createReadStream(p)) h.update(c); return h.digest('hex'); };
const db = createDatabaseConnection(), c = await db.pool.connect();
try {
    await c.query('BEGIN');
    const i = (await c.query(`SELECT i.*,r.state rstate FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.id=$1 FOR UPDATE OF i`, [id])).rows[0];
    if (!i || i.status !== 'held' || !i.input.targets.some((t: any) => t.platform === 'youtube')) throw Error('Not a held Short');
    if (i.rstate && i.rstate !== 'cancelled') throw Error('Release is ' + i.rstate + '; disarm before swapping the file');
    const [fo, fn, so, sn] = [frames(i.media.path), frames(file), seconds(i.media.path), seconds(file)];
    if (fo !== fn || Math.abs(so - sn) > 0.05) throw Error(`New file differs: ${fo} vs ${fn} frames, ${so} vs ${sn} s`);
    const newSha = await sha256(file);
    let input = i.input;
    if (!input.firstComment) {
        const sib = (await c.query(`SELECT input->>'firstComment' fc FROM scheduler.publishing_items WHERE media->>'sha256'=$1 AND input ? 'firstComment' LIMIT 1`, [i.media.sha256])).rows[0]?.fc;
        if (sib) input = { ...input, firstComment: sib };
    }
    input = validatePostingInput(input);
    const media = { ...i.media, path: file, name: basename(file), sha256: newSha, size: statSync(file).size };
    const { directYouTubeReview: _stale, ...rest } = i.results ?? {};
    const results = { ...rest, coverSwap: { at: new Date().toISOString(), fromSha256: i.media.sha256, fromPath: i.media.path, cover, coverFrames: '0-5', frames: fn } };
    await c.query('UPDATE scheduler.publishing_items SET media=$2,input=$3,request_hash=$4,results=$5,version=version+1,updated_at=now() WHERE id=$1', [id, media, input, requestHash(input, newSha), results]);
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? 'swapped' : 'would swap', i.media.name, '->', media.name, `(${fn} frames, ${sn.toFixed(2)} s)`);
} catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); await db.close(); }
