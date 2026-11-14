# Phone Farm: what moves to the cloud (2026-10-12)

## Status

- **Done 2026-10-12 08:05 PT (Antonio's go-ahead):** the scheduler database runs on the existing Supabase project **c2c-analytics** (`eukbltrghvgapbmtabqm`, us-east-1). No new vendor, no added cost.
- Still plan only: R2 off-site backups and the Healthchecks.io dead-man's switch.

### How the cloud database is set up

- Dedicated role `phone_farm`, which owns only the schemas `scheduler`, `pgboss` and `drizzle`. It cannot read the content tables in `public` (checked: `has_table_privilege('public.social_posts','select')` is false). Connection limit 40, statement timeout 120 s.
- Connection: Supavisor **session** pooler `aws-1-us-east-1.pooler.supabase.com:5432` (pg-boss uses LISTEN/NOTIFY, which the 6543 transaction pooler breaks). TLS `verify-full` against the pinned Supabase Root 2021 CA in `config/supabase-prod-ca-2021.crt` (sha256 `80:70:25:AD:...:CA:FA`, the same as Supabase's published `prod-ca-2021.crt`).
- Credentials: 1Password Business, vault `c2c-monorepo`, item "Phone Farm — Supabase Postgres (c2c-analytics, role phone_farm)". The password was generated locally and sent to Supabase only as a SCRAM hash. The URL is written only to the git-ignored, mode-600 `.env`.
- `DATABASE_POOL_SIZE=4` caps both the app pool and pg-boss.
- Cutover: `scripts/cutover-to-cloud-db.sh`. It stops the DB jobs only while the phone is idle (phone advisory lock), copies the three schemas, checks every table's row count, switches `.env` and restarts the jobs. All 35 tables matched. `--rollback` points back to the local database.
- The old local database `phone_farm` is kept and set read-only (`default_transaction_read_only = on`) so no stray script can split the data. Dump taken at cutover: `.scheduler-data/backups/cutover-20261012-080453.sql`.
- Nightly backup: launchd `phone-farm.backup` at 03:17 runs `scripts/backup-db.sh` (farm schemas only, 14 local copies; set `BACKUP_REMOTE` in `.env` to also copy to R2).
- Latency: about 150 ms per query from the Mac (local was under 1 ms). The release loop polls every 20 s, so this is fine. If the internet drops, posting pauses; claims are written before Share, so nothing double-posts.

### Cloud status page (read-only), 2026-10-12

https://phone-farm-status.antoniompaulo25.workers.dev shows the farm even when the Mac is off. It cannot arm, disarm, post or touch the phone. Controls stay on the Mac page, https://phonefarm.clicktoclose.ai/publishing, which the cloud page links to.

What it shows (refreshes every 60 s, times in Pacific): the Mac heartbeat from `scheduler.publishing_worker_health` (stopped after 90 s without a tick, the same rule as the Mac), counts, needs-review rows with their recorded reasons (releases, items and `engagement_actions`), the armed queue grouped by day, and the latest 60 published posts with per-platform receipt links. `/api/status` returns the same data as JSON.

| Piece | Detail |
|---|---|
| Code | `cloud/status-page/` (own `package.json`, not part of the root build). `npm run typecheck`, `npm test`, `npm run deploy` |
| Host | Cloudflare Worker `phone-farm-status` on the free `workers.dev` subdomain. Version preview URLs are off. No new DNS record, no paid resource |
| Login | Cloudflare Access app "Phone Farm Status (cloud, read-only)", Antonio only, 12 h session, same rule as phonefarm.clicktoclose.ai. The Worker also verifies the Access JWT (signature, audience, issuer, expiry) and returns 403 without it, so it stays closed if the Access app is ever removed. Secret: `ACCESS_AUD` |
| Database role | `phone_farm_status_ro`: SELECT only on `scheduler.publishing_items`, `publishing_releases`, `engagement_actions` and `publishing_worker_health` (the heartbeat). `default_transaction_read_only=on`, `statement_timeout=15s`, connection limit 5. Writes and other tables were tested and refused. Password generated locally, sent to Supabase only as a SCRAM hash |
| Credential | 1Password Business, vault `c2c-monorepo`, item "Phone Farm — Supabase Postgres read-only (role phone_farm_status_ro)" |
| DB link | Cloudflare Hyperdrive config `phone-farm-status-ro` (`ed3b3fc2866e45c5be2b29a4411850c5`) to the session pooler, `sslmode=verify-full` against the uploaded Supabase Root 2021 CA (Cloudflare CA cert `485f1e8d-6447-4e19-8818-b17a1e4bc854`). Query caching is off. A direct Worker socket cannot be used: the runtime does not trust Supabase's private CA, and the driver retried until it hit the subrequest limit |

Verified 2026-10-12 12:55 PT: anonymous requests to `/` and `/api/status` redirect to Access sign-in; signed in, the page rendered and its counts matched a direct database query (42 armed, 0 running, 17 published in 24 h, 98 published total, 4 needs review, same next slot and last post).

Rotate the DB password: generate a new one, `ALTER ROLE phone_farm_status_ro PASSWORD '<scram hash>'`, update the 1Password item, then `wrangler hyperdrive update ed3b3fc2866e45c5be2b29a4411850c5 --origin-password=...`. To remove the page: `wrangler delete`, delete the Access app and Hyperdrive config, `DROP ROLE phone_farm_status_ro`.

A friendlier name such as `status.phonefarm.clicktoclose.ai` would need a new DNS name; not created without Antonio's approval.

---

Original plan follows (Neon was the first recommendation; Antonio chose the existing Supabase instead).

## Constraint

The iPhone stays plugged into a Mac by USB. WebDriverAgent (WDA), the worker, the release loop and the Appium driver cannot run in a cloud Mac or device farm against that phone. They stay on one Mac (today the laptop, later a home Mac mini). "Cloud" means everything around the phone.

## What runs where

| Piece | Today | Recommendation | Why |
|---|---|---|---|
| WDA, Appium, worker, release loop, awake job | Mac | **Stays on the Mac** | Needs USB to the phone |
| Device alerts (WDA, USB, lock, battery) | Mac, every 5 min | **Stays on the Mac** | Reads the phone directly |
| Burn-in report, monitor, daily summary | Mac, launchd | **Stays on the Mac for now** | They read the phone and the DB; a cloud copy could not see the phone |
| Dead-man's switch (is the Mac alive?) | Nothing | **Move to the cloud: Healthchecks.io** | The Mac cannot report its own power loss |
| Postgres scheduler DB (12 MB) | Local `DATABASE_URL` | **Move to a managed Postgres** (see below) | Survives a dead Mac, cheap, tiny |
| Backups | None automatic | **Nightly `pg_dump` to Cloudflare R2** | Pennies per month |
| Media files (`.scheduler-data/publishing`, 8.6 GB) | Mac disk | **Copy to R2, keep working copies on the Mac** | Not needed to post from a new Mac if the DB points at them |
| Calendar / web UI | Mac port 3000 via Cloudflare tunnel | **Stays on the Mac behind the tunnel** (free) | Arm/disarm actions call the local worker, which needs the phone |

## Recommended option

Total about **$6 to $10 per month**, and one new vendor account at most.

1. **Postgres on Neon (Launch, usage-based) or Supabase Pro.** The database is 12 MB, so usage-based Neon should cost a few dollars a month; Supabase Pro is a flat $25. Recommendation: **Neon, a new project dedicated to Phone Farm**. Do not use the c2c-analytics or platform databases (hard rule: one content database; the farm's scheduler data is separate operational state).
2. **Backups and media on Cloudflare R2**: 10 GB free, then $0.015 per GB per month. Use `scripts/backup-db.sh` with `BACKUP_REMOTE=r2:phone-farm-backups` and an rclone remote.
3. **Healthchecks.io free plan** (20 checks): set `HEARTBEAT_URL` in `.env`; `device-alert.ts` pings it every 5 minutes. If pings stop for 15 minutes the service emails or Slack-DMs Antonio. This is the one alert the Mac cannot send for itself.
4. **Cloudflare Tunnel** stays as is (free).

Prices are from memory and move; confirm on each vendor's pricing page before signing up.

## Database migration plan (not run)

Needs Antonio's explicit approval and a short window with the worker stopped.

1. Create the Neon project. Record the connection string in 1Password (Business account, `c2c-monorepo` vault), never in the repo.
2. Run `scripts/backup-db.sh`, then restore the dump into Neon and compare table row counts.
3. In a quiet moment (no armed release within 30 minutes, no running release), stop the worker with `.scheduler-data/diag/restart-when-idle.ts` semantics, change `DATABASE_URL` in `.env`, and restart worker and web.
4. Watch two hourly cycles. Keep the old local database untouched for 7 days as a rollback.
5. Latency: the worker polls every 20 seconds; a cloud round trip of under 100 ms is fine. Advisory locks used by the backlog job work on Neon's pooled-off (direct) connection string only; use the direct string, not the pooler.

Risk: the worker then depends on the internet. A short outage delays posting but never double-posts, because claims are written before Share. The local Postgres can stay as a read replica target later if wanted.

## Reports and alerts in the cloud

The burn-in report and monitor need the phone and the Mac's launchd, so they stay put. Cloud adds only the heartbeat check above. A later option, once the DB is cloud-hosted: a small GitHub Actions or Cloudflare Worker cron that reads release rows and DMs the same summary if the Mac heartbeat is red. Not needed now.

## What the Mac mini needs

See `docs/new-mac-setup.md` and `scripts/setup-new-mac.sh`. With a cloud DB the move becomes: clone repo, copy `.env` and the tunnel files, plug in the phone, run the script.

## Open decisions for Antonio

- Approve Neon (or choose Supabase) and the R2 account.
- Approve the DB migration window.
- Tell me the Mac mini arrival date; the setup script is ready.
