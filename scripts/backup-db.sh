#!/bin/bash
# Nightly database backup. Dumps the scheduler database, keeps 14 local copies, and uploads the newest one when
# BACKUP_REMOTE is set (an rclone remote path such as r2:phone-farm-backups). Runs nightly via launchd (phone-farm.backup).
# Dumps only the farm's schemas: the phone_farm role cannot read the rest of c2c-analytics.
# Restore: gunzip -c FILE | psql "$DATABASE_URL"
set -eu
cd "$(dirname "$0")/.."
DATABASE_URL="${DATABASE_URL:-$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')}"
BACKUP_REMOTE="${BACKUP_REMOTE:-$(grep -m1 '^BACKUP_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)}"
: "${DATABASE_URL:?DATABASE_URL is not set}"
DIR=".scheduler-data/backups"; mkdir -p "$DIR"
FILE="$DIR/phone-farm-$(date +%Y%m%d-%H%M).sql.gz"
pg_dump --no-owner --no-privileges -n scheduler -n pgboss -n drizzle "$DATABASE_URL" | gzip -9 > "$FILE"
[ "$(gzip -l "$FILE" | awk 'NR==2{print $2}')" -gt 10000 ] || { echo "backup suspiciously small: $FILE"; rm -f "$FILE"; exit 1; }
ls -1t "$DIR"/phone-farm-*.sql.gz | tail -n +15 | xargs -I{} rm -f {}
if [ -n "${BACKUP_REMOTE:-}" ]; then rclone copy "$FILE" "$BACKUP_REMOTE" --quiet && echo "uploaded to $BACKUP_REMOTE"; fi
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
