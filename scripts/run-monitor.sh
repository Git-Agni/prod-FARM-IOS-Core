#!/bin/sh
# Monitor wrapper. Slack credentials are read inside the process by scripts/lib/ops-notify.ts (1Password SDK reader, retries,
# macOS notification fallback), so nothing secret passes through this shell.
cd "$(dirname "$0")/.." || exit 1
exec "${NODE_BIN:-$HOME/.local/bin/node}" --env-file-if-exists=.env --import tsx scripts/monitor.ts "${1:-check}"
