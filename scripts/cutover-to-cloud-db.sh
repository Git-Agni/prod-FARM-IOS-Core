#!/bin/bash
# Move the scheduler database (schemas scheduler, pgboss, drizzle) from the Mac's local Postgres to Supabase c2c-analytics,
# role phone_farm. The connection string comes from 1Password ("Phone Farm — Supabase Postgres ..." in c2c-monorepo) and
# is written only to the mode-600, git-ignored .env. Nothing secret is printed.
#   scripts/cutover-to-cloud-db.sh            preflight, stop DB jobs, copy, verify, switch .env, start jobs
#   scripts/cutover-to-cloud-db.sh --rollback point .env back at the local database (cloud rows written since are NOT copied back)
# Safe window: refuses while a release is running or an armed release is due within 20 minutes.
set -euo pipefail
cd "$(dirname "$0")/.."
UIDN="$(id -u)"; LOCAL_URL="postgresql://$USER@localhost/phone_farm?host=/tmp"
JOBS="worker web backlog monitor summary burn-in"
ITEM="Phone Farm — Supabase Postgres (c2c-analytics, role phone_farm)"
log() { echo "$(date '+%H:%M:%S') $*"; }
stop_jobs()  { for j in $JOBS; do launchctl bootout "gui/$UIDN/ai.clicktoclose.phone-farm.$j" 2>/dev/null && log "stopped $j" || true; done; }
start_jobs() { for j in $JOBS; do launchctl bootstrap "gui/$UIDN" "$HOME/Library/LaunchAgents/ai.clicktoclose.phone-farm.$j.plist" 2>/dev/null && log "started $j" || log "WARN could not start $j"; done; }
set_env() {  # set_env KEY VALUE (value via env var to keep it out of argv)
  KEY="$1" VAL="$2" /usr/bin/python3 - <<'PY'
import os,re
p=".env"; k=os.environ["KEY"]; v=os.environ["VAL"]
lines=open(p).read().splitlines()
out=[l for l in lines if not l.startswith(k+"=")]; out.append(f"{k}={v}")
open(p,"w").write("\n".join(out)+"\n"); os.chmod(p,0o600)
PY
}

if [ "${1:-}" = "--rollback" ]; then
  stop_jobs; psql "$LOCAL_URL" -qc "ALTER DATABASE phone_farm SET default_transaction_read_only = off"; set_env DATABASE_URL "$LOCAL_URL"; start_jobs; log "rolled back to the local database"; exit 0
fi

CLOUD_URL="$(/usr/bin/python3 -c 'import importlib.util,os,sys;s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.fields("c2c-monorepo",sys.argv[1])["DATABASE_URL"])' "$ITEM")"
[ -n "$CLOUD_URL" ] || { log "could not read the cloud URL from 1Password"; exit 1; }
psql "$CLOUD_URL" -Atc 'select 1' >/dev/null || { log "cloud database does not answer"; exit 1; }

busy="$(psql "$LOCAL_URL" -Atc "select count(*) filter (where state='running') || ',' || count(*) filter (where state='armed' and run_at < now()+interval '20 minutes') from scheduler.publishing_releases")"
active="$(psql "$LOCAL_URL" -Atc "select count(*) from pgboss.job where state='active'" 2>/dev/null || echo 0)"
[ "$busy" = "0,0" ] && [ "$active" = "0" ] || { log "not idle (running,due-soon=$busy active-jobs=$active); try again later"; exit 1; }

# Stop the DB jobs only while the phone is idle (phone advisory lock held, no running release).
DATABASE_URL="$LOCAL_URL" "$HOME/.local/bin/node" --import tsx scripts/lib/stop-when-idle.ts $(for j in $JOBS; do printf 'ai.clicktoclose.phone-farm.%s ' "$j"; done) || { log "phone not idle; nothing changed"; start_jobs; exit 1; }
DUMP=".scheduler-data/backups/cutover-$(date +%Y%m%d-%H%M%S).sql"; mkdir -p .scheduler-data/backups
pg_dump --no-owner --no-privileges -n scheduler -n pgboss -n drizzle "$LOCAL_URL" \
  | sed -E '/^CREATE SCHEMA (scheduler|pgboss|drizzle);/d' > "$DUMP"
log "dumped $(du -h "$DUMP" | cut -f1) to $DUMP"
# Empty the cloud schemas (owned by phone_farm; the schemas themselves stay), then load in one transaction.
WIPE="$(mktemp)"; cat > "$WIPE" <<'SQL'
SELECT format('DROP TABLE IF EXISTS %I.%I CASCADE', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('scheduler','pgboss','drizzle') AND c.relkind IN ('r','p') AND NOT c.relispartition \gexec
SELECT format('DROP %s IF EXISTS %I.%I CASCADE', CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' ELSE 'MATERIALIZED VIEW' END, n.nspname, c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('scheduler','pgboss','drizzle') AND c.relkind IN ('S','v','m') \gexec
SELECT format('DROP ROUTINE IF EXISTS %I.%I(%s) CASCADE', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('scheduler','pgboss','drizzle') \gexec
SELECT format('DROP TYPE IF EXISTS %I.%I CASCADE', n.nspname, t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname IN ('scheduler','pgboss','drizzle') AND t.typtype IN ('e','c','d') AND (t.typrelid=0 OR (SELECT relkind FROM pg_class WHERE oid=t.typrelid)='c') \gexec
SQL
if ! psql "$CLOUD_URL" -v ON_ERROR_STOP=1 -q -1 -f "$WIPE" -f "$DUMP" >/dev/null; then log "restore failed; jobs restarted on the LOCAL database"; start_jobs; exit 1; fi

mismatch=0
for t in $(psql "$LOCAL_URL" -Atc "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('scheduler','pgboss','drizzle') and table_type='BASE TABLE' order by 1"); do
  a="$(psql "$LOCAL_URL" -Atc "select count(*) from $t")"; b="$(psql "$CLOUD_URL" -Atc "select count(*) from $t")"
  [ "$a" = "$b" ] || { log "MISMATCH $t local=$a cloud=$b"; mismatch=1; }
done
if [ "$mismatch" = 1 ]; then log "row counts differ; jobs restarted on the LOCAL database"; start_jobs; exit 1; fi
log "all table row counts match"

cp .env ".scheduler-data/backups/env-before-cutover-$(date +%Y%m%d-%H%M%S)"; chmod 600 .scheduler-data/backups/env-before-cutover-*
set_env DATABASE_URL "$CLOUD_URL"; set_env DATABASE_POOL_SIZE 4
# The old local copy becomes read-only so a stray script with the old URL cannot split the data. --rollback undoes this.
psql "$LOCAL_URL" -qc "ALTER DATABASE phone_farm SET default_transaction_read_only = on"
start_jobs
log "cutover done: the farm now uses Supabase c2c-analytics (role phone_farm). The local database is kept untouched for rollback."
