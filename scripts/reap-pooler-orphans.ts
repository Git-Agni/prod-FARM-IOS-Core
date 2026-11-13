// Lists the phone_farm sessions the Supabase session pooler still counts but nobody uses: idle over the limit and
// holding no advisory lock. Dry run by default. --apply ends them through the transaction pooler (port 6543).
// Usage: node --env-file-if-exists=.env --import tsx scripts/reap-pooler-orphans.ts [--apply] [--min-idle-seconds=180]
import { DEFAULT_ORPHAN_IDLE_SECONDS, reapOrphanSessions } from '../src/database/orphan-sessions.js';

const apply = process.argv.includes('--apply');
const minIdle = Number(process.argv.find((arg) => arg.startsWith('--min-idle-seconds='))?.split('=')[1] ?? DEFAULT_ORPHAN_IDLE_SECONDS);
const rows = await reapOrphanSessions({ apply, minIdleSeconds: minIdle });
if (!rows) {
    console.log('DATABASE_URL is not a Supabase pooler URL; nothing to do.');
} else {
    for (const row of rows) console.log(`${row.pid}\tidle ${row.idle_seconds}s\t${row.terminated ? 'ended' : 'kept'}\t${row.last_query}`);
    console.log(`${rows.length} orphaned session(s) idle over ${minIdle}s; ${apply ? `ended ${rows.filter((row) => row.terminated).length}` : 'dry run, ended none (pass --apply)'}.`);
}
