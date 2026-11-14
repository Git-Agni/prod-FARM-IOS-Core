import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionPoolerUrl } from '../src/database/client.js';
import { createFullPoolReaper, isSessionPoolFull, orphanSessionSql } from '../src/database/orphan-sessions.js';
import { pgBossListenNotify, queueDatabaseUrl } from '../src/scheduler/queue.js';

const session = 'postgresql://phone_farm.abc:p%40ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';

test('the transaction pooler URL keeps host, user, password and options; only the port changes', () => {
    const url = new URL(transactionPoolerUrl(session)!);
    assert.equal(url.port, '6543');
    assert.equal(url.hostname, 'aws-0-us-east-1.pooler.supabase.com');
    assert.equal(url.username, 'phone_farm.abc');
    assert.equal(url.password, 'p%40ss');
    assert.equal(url.searchParams.get('sslmode'), 'verify-full');
    assert.equal(transactionPoolerUrl('postgres://user@127.0.0.1:5432/farm'), undefined);
});

test('pg-boss uses the transaction pooler and polls by default (Nov 13 orphaned LISTEN sessions)', () => {
    const saved = { ...process.env };
    try {
        process.env.DATABASE_URL = session;
        delete process.env.PGBOSS_DATABASE_URL; delete process.env.PGBOSS_LISTEN_NOTIFY;
        assert.equal(pgBossListenNotify(), false);
        assert.equal(new URL(queueDatabaseUrl()).port, '6543');
        assert.equal(queueDatabaseUrl({ migrate: true }), session);
        process.env.PGBOSS_LISTEN_NOTIFY = '1';
        assert.equal(queueDatabaseUrl(), session, 'LISTEN needs a session');
        process.env.PGBOSS_DATABASE_URL = 'postgres://override@db/x';
        assert.equal(queueDatabaseUrl(), 'postgres://override@db/x');
    } finally {
        process.env = saved;
    }
});

test('the reaper only ends idle, lock-free sessions of its own role', () => {
    assert.match(orphanSessionSql, /a\.usename = current_user/);
    assert.match(orphanSessionSql, /a\.state = 'idle'/);
    assert.match(orphanSessionSql, /a\.pid <> pg_backend_pid\(\)/);
    assert.match(orphanSessionSql, /NOT EXISTS \(SELECT 1 FROM pg_locks l WHERE l\.pid = a\.pid AND l\.locktype = 'advisory' AND l\.granted\)/);
    assert.match(orphanSessionSql, /CASE WHEN \$2::boolean THEN pg_terminate_backend/);
});

test('the reaper runs only for a full session pool, and stays off when disabled', async () => {
    assert.equal(isSessionPoolFull(new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15')), true);
    assert.equal(isSessionPoolFull(new Error('Connection terminated unexpectedly')), false);
    const saved = process.env.ORPHAN_REAPER;
    const logs: unknown[][] = [];
    try {
        process.env.ORPHAN_REAPER = 'off';
        await createFullPoolReaper({ log: (...args: unknown[]) => { logs.push(args); } })(new Error('EMAXCONNSESSION'));
        assert.equal(logs.length, 0);
    } finally {
        if (saved === undefined) delete process.env.ORPHAN_REAPER; else process.env.ORPHAN_REAPER = saved;
    }
});
