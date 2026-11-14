#!/bin/bash
# Phone Farm Mac setup. Checks the prerequisites, then installs and loads every launchd job in scripts/launchagents.
#   scripts/setup-new-mac.sh --check            checks only, changes nothing
#   scripts/setup-new-mac.sh                    checks, installs and loads all jobs (stops if a hard check fails)
#   scripts/setup-new-mac.sh --only a,b         install just these jobs (names without the ai.clicktoclose.phone-farm. prefix)
# Paths in the plists are rewritten from the original Mac to this repo and this home folder. Secrets are never printed.
# Full runbook: docs/new-mac-setup.md
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"  # sslrootcert in DATABASE_URL is relative to the repo
SRC_REPO="/Users/antoniomonteiro/Developer/phone-farm"; SRC_HOME="/Users/antoniomonteiro"
DEST="$HOME/Library/LaunchAgents"; UIDN="$(id -u)"
UDID="00008130-000229EE1AA0001C"
CHECK_ONLY=0; ONLY=""
while [ $# -gt 0 ]; do case "$1" in --check) CHECK_ONLY=1;; --only) ONLY="$2"; shift;; *) echo "unknown option $1"; exit 2;; esac; shift; done
FAIL=0; WARN=0
ok()   { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; WARN=$((WARN+1)); }
bad()  { echo "  FAIL  $*"; FAIL=$((FAIL+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo "== Tools"
for t in node npm git psql curl cloudflared idevice_id ideviceinfo; do
  p="$(PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH" command -v $t 2>/dev/null)"; [ -n "$p" ] && ok "$t ($p)" || bad "$t missing (brew install node git libpq cloudflared libimobiledevice)"
done
[ -x "$HOME/.local/bin/node" ] && ok "node at ~/.local/bin/node (the plists use this path)" || bad "~/.local/bin/node missing: symlink it, e.g. ln -s \"\$(which node)\" ~/.local/bin/node"
[ -d "$REPO/node_modules/tsx" ] && ok "npm dependencies installed" || bad "run: cd $REPO && npm ci"

echo "== Xcode and WebDriverAgent signing"
if [ -d /Applications/Xcode.app ]; then
  dev="$(xcode-select -p 2>/dev/null)"; case "$dev" in /Applications/Xcode.app*) ok "xcode-select -> $dev";; *) bad "xcode-select points at '$dev' (sudo xcode-select -s /Applications/Xcode.app/Contents/Developer)";; esac
  xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 && ok "Xcode first-launch tasks done" || warn "open Xcode once and accept the license / install components"
else bad "Xcode.app not installed"; fi
n="$(security find-identity -v -p codesigning 2>/dev/null | grep -c 'Apple Development')"
[ "$n" -gt 0 ] && ok "$n Apple Development signing identity(ies) in the keychain" || bad "no Apple Development signing identity: sign in to Xcode > Settings > Accounts with the Apple ID that owns the team"
[ -d "$REPO/.appium2" ] && ok ".appium2 present (xcuitest driver installed)" || warn "run: cd $REPO && npm run appium:install-driver"
find "$REPO/.wda" "$REPO/.appium2" -maxdepth 6 -name 'WebDriverAgent.xcodeproj' 2>/dev/null | head -1 | grep -q . && ok "WebDriverAgent project found" || warn "WebDriverAgent project not found yet; npm run wda:prepare builds and signs it"
echo "  note  the iPhone must be plugged in by USB, trusted, unlocked once, with Developer Mode on"
if idevice_id -l 2>/dev/null | grep -q "$UDID"; then ok "iPhone $UDID is connected over USB"; else warn "iPhone $UDID not seen over USB"; fi

echo "== 1Password token"
TOK="$HOME/.config/op/sa-token"
if [ -f "$TOK" ]; then
  [ "$(stat -f %Lp "$TOK")" = "600" ] && ok "token file exists, mode 600" || bad "token file mode is $(stat -f %Lp "$TOK"); run chmod 600 $TOK"
  [ -O "$TOK" ] && ok "token owned by $USER" || bad "token not owned by $USER"
else bad "$TOK missing: copy it from the old Mac over a trusted channel (Business service account antonio-monteiro-mac)"; fi
READER="$HOME/.local/share/c2c-secrets/c2c_secrets.py"
if [ -f "$READER" ]; then
  /usr/bin/python3 -c 'import importlib.util,os,sys;s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.fields("c2c-monorepo","Slack App — Ronaldo Marketing (c2c-content Socket Mode)")["SLACK_BOT_TOKEN"]' >/dev/null 2>&1 \
    && ok "SDK reader returns the Slack bot token (value not shown)" || bad "SDK reader could not read the Slack token (check the token file and network)"
else bad "$READER missing: install from the C2C hub scripts/credential-access/"; fi

echo "== Database and config"
if [ -f "$REPO/.env" ]; then
  grep -q '^DATABASE_URL=' "$REPO/.env" && ok ".env has DATABASE_URL" || bad ".env lacks DATABASE_URL"
  url="$(grep '^DATABASE_URL=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"')"
  [ -n "$url" ] && psql "$url" -Atc 'select 1' >/dev/null 2>&1 && ok "database answers" || bad "database does not answer (start it: npm run db:up, or restore from a backup)"
else bad ".env missing in $REPO"; fi
[ -f "$REPO/.env.devices" ] && ok ".env.devices present" || warn ".env.devices missing (device list)"

echo "== Cloudflare tunnel"
CF="$HOME/.cloudflared/phone-farm.yml"
if [ -f "$CF" ]; then
  ok "$CF present"; cred="$(grep -E '^credentials-file:' "$CF" | awk '{print $2}')"; [ -z "$cred" ] || [ -f "$cred" ] && ok "tunnel credentials file present" || bad "tunnel credentials file $cred missing"
else bad "$CF missing: copy ~/.cloudflared/phone-farm.yml and its credentials JSON from the old Mac, or run cloudflared tunnel login/create"; fi
curl -s -m 8 -o /dev/null -w '%{http_code}' https://phonefarm.clicktoclose.ai/ 2>/dev/null | grep -qE '^(200|302|401|403)$' && ok "https://phonefarm.clicktoclose.ai answers" || warn "public URL does not answer yet (normal before the tunnel is loaded)"

echo "== Other"
[ -d "$REPO/.mirroring/Phone Farm Audio Mute.app" ] && ok "audio-mute app present" || warn "'.mirroring/Phone Farm Audio Mute.app' missing; skip the audio-mute job or rebuild it (scripts/build-audio-mute.py)"
pmset -g | grep -q ' sleep  *0' && ok "system sleep disabled" || warn "set: sudo pmset -a sleep 0 disablesleep 1 (the farm needs the Mac awake)"

echo; echo "Checks: $FAIL failed, $WARN warnings"
[ "$CHECK_ONLY" = 1 ] && exit $((FAIL>0))
if [ "$FAIL" -gt 0 ]; then echo "Fix the FAIL lines, then run again. Nothing was installed."; exit 1; fi

echo "== Installing launch agents"
mkdir -p "$DEST" "$REPO/.scheduler-data/logs"
for src in "$REPO"/scripts/launchagents/*.plist; do
  label="$(basename "$src" .plist)"; short="${label#ai.clicktoclose.phone-farm.}"
  [ -n "$ONLY" ] && ! echo ",$ONLY," | grep -q ",$short," && continue
  out="$DEST/$label.plist"
  # A plist whose Label differs from its filename could load a second copy of another job (e.g. a second worker).
  [ "$(plutil -extract Label raw "$src" 2>/dev/null)" = "$label" ] || { bad "$label: Label inside does not match the filename; skipped"; continue; }
  sed -e "s#$SRC_REPO#$REPO#g" -e "s#$SRC_HOME#$HOME#g" "$src" > "$out.new" && plutil -lint "$out.new" >/dev/null || { bad "$label: bad plist"; rm -f "$out.new"; continue; }
  mv "$out.new" "$out"
  launchctl bootout "gui/$UIDN/$label" >/dev/null 2>&1
  if launchctl bootstrap "gui/$UIDN" "$out" 2>/dev/null; then ok "loaded $label"; else bad "could not load $label"; fi
done
echo; echo "Loaded jobs:"; launchctl list | grep phone-farm || true
echo "Next: tail $REPO/.scheduler-data/logs/device-alert.log and confirm one burn-in DM with: node --env-file-if-exists=.env --import tsx scripts/burn-in-report.ts --hours=3"
exit $((FAIL>0))
