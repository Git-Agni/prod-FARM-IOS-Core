# Worker hang and recovery, October 19, 2026

## Result

Posting stopped at 09:37 PT and stayed stopped until 14:34 PT. The fix is in commit `54ff403`.

## Cause

VERIFIED on the live process (PID 60755) through the Node inspector at 14:33 PT:

- The worker's pg pool had `max` 4 (`DATABASE_POOL_SIZE=4`), 4 clients checked out, 0 idle, and 2 callers waiting.
- All 4 clients were dead (`queryable: false`). `lsof` showed no open network socket, so nothing could ever answer.
- The pool had no `connectionTimeoutMillis`, so `pool.connect()` waited forever and the release tick never finished.

How the clients leaked, VERIFIED in `/tmp/phone-farm-worker-service.log` and `src/publishing/timed-release.ts`:

1. The Supabase pooler dropped connections at 08:59, 09:03, 09:19 and 10:48 PT.
2. A drop killed the client in the middle of `TimedReleaseStore.run`. Its failure write (`state='needs_review'`) then
   threw "Client has encountered a connection error and is not queryable".
3. The advisory unlock in `finally` threw on the same dead client, so `c.release()` never ran.
4. Each such drop leaked one client and left one release in `running` with no Share claim: 446abdd6 (09:03 PT) and
   0ced7846 (09:22 PT). 7bceeb5e was in `running` when the tick stopped at about 09:37 PT.

HYPOTHESIS: the other two clients leaked through the same unlock-before-release pattern in `reconcilePending` or a
Story or comment path. The exact moment of the last leak is not proven. The fix closes the pattern in both release
store methods and bounds every wait, so any remaining leak now ends in a timeout instead of a hang.

The heartbeat is written only at the start of a tick, so it froze at 09:37 PT. Nothing watched it.

## Fix

| Where | Change |
|---|---|
| `src/database/client.ts` | 30 s connection timeout, 300 s query timeout, TCP keepalive. |
| `src/publishing/timed-release.ts` | Failure writes fall back to a fresh client. A broken client is always released and destroyed. `recoverStale()` sends unclaimed `running` rows idle 30+ minutes to review, flagged `interruptedBeforeShare`. |
| `src/publishing/release-loop.ts` | Heartbeat refreshed every 30 s during long jobs. After 40 minutes with no progress the worker exits and launchd's KeepAlive restarts it. |
| `scripts/device-alert.ts` (every 5 min) | Slack alert when the heartbeat is 5+ minutes old. Restarts the worker past 15 minutes. |

Re-arming needs no new code: the hourly `autopilot-backlog.ts` already re-arms needs-review posts with no Share
claim (up to three tries, through `TimedReleaseStore.arm` and its duplicate check). It skipped today's stuck rows only
because they still read `running`.

Safety rules kept: one Share claim per item, written before any Share tap; no automatic Share retry; claimed rows are
never re-armed; a video already live, queued or in review for the same platform and account blocks a re-arm.

Tests: `test/worker-hang-recovery.test.ts`. The dead-client test fails on the old code (the client is never released).

## YouTube preflight

The errors in the brief ("Native YouTube tags did not match", "YouTube metadata row is ambiguous: Tags") were fixed
in commit `0e7910d` this morning. No YouTube run reached that code before the hang. The first one after it,
d6671ed2 at 14:41 PT, stopped with a new error: "YouTube metadata row is missing: Tags".

VERIFIED by replaying the OCR on the saved frame (`.scheduler-data/release-failures/2026-10-19T21-41-25-369Z-d6671ed2.png`):
the Tags entry is the end of the Attributes row, read as "Al" (x 158), "use," (x 217), "Tags" (x 324). Commit
`0e7910d` only accepts a row label between x 100 and 300 px, so "Tags" never matched. Commit `5d6b5a6` matches the
whole "AI use, Tags" line from its first word, with I/l folding. A title containing "Tags" still cannot match.
Every stop happened before Upload, with no Share claim.

"Phone control is missing: You..." did not occur in the last 36 hours of release results. Capabilities still report
`youtube: preparation_only`; that field describes the old Mirroring flow, not the WDA worker.
