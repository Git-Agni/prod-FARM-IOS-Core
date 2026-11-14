/** Stop launchd jobs only while the phone is idle: holds the phone advisory lock (as the worker's jobs do) and checks
 * no release is running, mirroring .scheduler-data/diag/restart-when-idle.ts. Usage: stop-when-idle.ts LABEL...
 * Waits up to 10 minutes; exits 1 if the phone never goes idle. */
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const labels = process.argv.slice(2);
const phone = '00008130-000229EE1AA0001C';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const c = await pool.connect();
const end = Date.now() + 10 * 60_000;
let stopped = false;
try {
    while (Date.now() < end && !stopped) {
        const busy = Number((await c.query(`SELECT count(*) n FROM scheduler.publishing_releases WHERE state='running'`)).rows[0].n);
        if (!busy && (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l', [phone])).rows[0].l) {
            try {
                for (const l of labels) try { execFileSync('launchctl', ['bootout', `gui/${process.getuid!()}/${l}`], { stdio: 'ignore' }); console.log('stopped', l); } catch { console.log('not loaded', l); }
                stopped = true;
            } finally { await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [phone]); }
        } else await new Promise(z => setTimeout(z, 10_000));
    }
} finally { c.release(); await pool.end(); }
if (!stopped) { console.error('phone never went idle within 10 minutes'); process.exit(1); }
