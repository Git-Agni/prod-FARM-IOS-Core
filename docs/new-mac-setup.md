# Moving the Phone Farm to a new Mac (about one hour)

1. Install Xcode, accept the license, open it once, and sign in under Settings > Accounts with the Apple ID that owns the signing team.
2. `brew install node git libpq cloudflared libimobiledevice rclone`, then link node: `mkdir -p ~/.local/bin && ln -s "$(which node)" ~/.local/bin/node`.
3. Copy from the old Mac over a trusted channel: `~/.config/op/sa-token` (mode 600), `~/.local/share/c2c-secrets/`, `~/.cloudflared/phone-farm.yml` plus its credentials JSON, and the repo's `.env` and `.env.devices`.
4. `git clone` the repo (branch `codex/phone-farm-publishing`), `cd` into it, `npm ci`, `npm run appium:install-driver`, `npm run wda:prepare`.
5. Database: nothing to move. Since 2026-10-12 it lives in Supabase c2c-analytics. Copy `.env` (it holds `DATABASE_URL` from the 1Password item "Phone Farm — Supabase Postgres (c2c-analytics, role phone_farm)") and keep `config/supabase-prod-ca-2021.crt` in the repo.
6. Plug in the iPhone, trust the Mac, enter the passcode when XCTest asks, turn on Developer Mode.
7. Run `scripts/setup-new-mac.sh --check`, fix every FAIL, then `scripts/setup-new-mac.sh` to install and load every launchd job.
8. Stop the old Mac's jobs first (`launchctl bootout gui/$(id -u)/ai.clicktoclose.phone-farm.worker`, and the others) so two machines never drive the phone or hold the same tunnel.
9. Confirm with `node --env-file-if-exists=.env --import tsx scripts/burn-in-report.ts --hours=3`: one Slack DM arrives.
