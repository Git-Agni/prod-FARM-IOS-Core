#!/bin/bash
# Phone Farm watchdog (Antonio, 2026-10-28): conversation-independent monitor. Hourly via launchd.
# Checks: API up, releases in the last 75 minutes (flag anything not published), IG write-hold latch,
# platform readiness, phone screenshot answers, armed supply for the next 3 hours per lane.
# Writes .scheduler-data/watchdog.jsonl (machine log) and .scheduler-data/watchdog-latest.md (human read).
set -u
ROOT="/Users/antoniomonteiro/Developer/phone-farm"
OUT="$ROOT/.scheduler-data/watchdog.jsonl"
LATEST="$ROOT/.scheduler-data/watchdog-latest.md"
API="http://127.0.0.1:3000"
now_iso=$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat())")

status="ok"; notes=""
# Nov 5: capabilities probes the phone live and took over 8 s while a release held it, so two healthy runs texted
# "API down". Call it down only when capabilities fails twice (30 s each) and the phone-free releases route fails too.
api=$(curl -s -m 30 "$API/api/publishing/capabilities" 2>/dev/null)
[ -z "$api" ] && sleep 20 && api=$(curl -s -m 30 "$API/api/publishing/capabilities" 2>/dev/null)
[ -z "$api" ] && curl -s -f -o /dev/null -m 30 "$API/api/publishing/releases" && api="slow"
if [ -z "$api" ]; then
  status="critical"; notes="API down (launchd KeepAlive should be restarting web)"
  echo "{\"at\":\"$now_iso\",\"status\":\"$status\",\"notes\":\"$notes\"}" >> "$OUT"
  [ "${WATCHDOG_SMS_DRY_RUN:-0}" = 1 ] && echo "SMS DRY RUN: Phone Farm API is down" || osascript -e 'tell application "Messages" to send "Phone Farm: posting is blocked. The Phone Farm API is down at 127.0.0.1:3000." to participant "+18054335835" of account id "35252375-F9B5-4D85-8B97-0CC7AA4CB64E"' >/dev/null 2>&1
  printf '# Watchdog %s\n\nCRITICAL: Phone Farm API is down. launchd should be restarting the web service; check `launchctl list | grep phone-farm`.\n' "$now_iso" > "$LATEST"
  exit 1
fi

python3 - "$API" "$OUT" "$LATEST" "$now_iso" <<'EOF'
import json, sys, urllib.request, datetime, subprocess
API, OUT, LATEST, now_iso = sys.argv[1:5]
from zoneinfo import ZoneInfo
PT = ZoneInfo('America/Los_Angeles')  # Nov 5: was a fixed -7 h, one hour off after the Nov 1 clock change
now = datetime.datetime.now(datetime.timezone.utc)
def get(path, timeout=10):
    try: return json.load(urllib.request.urlopen(API + path, timeout=timeout))
    except Exception as e: return {'__error': str(e)}
NOTIFY_STATE = '/Users/antoniomonteiro/Developer/phone-farm/.scheduler-data/watchdog-notify.json'
def notify(urgent, now):
    """Text Antonio when the set of posting-stopping problems changes, repeat after 3 h, and once when it clears.
    Only his own number (allowlist); override the sender with WATCHDOG_SMS_DRY_RUN=1 for tests."""
    try: state = json.load(open(NOTIFY_STATE))
    except Exception: state = {}
    key = ' | '.join(sorted(u.split(':')[0] for u in urgent))
    last = state.get('key', ''); at = datetime.datetime.fromisoformat(state['at']) if state.get('at') else None
    if key == last and (not key or (at and now - at < datetime.timedelta(hours=3))): return
    text = ('Phone Farm: posting is blocked.\n- ' + '\n- '.join(u[:180] for u in urgent)) if key else 'Phone Farm: recovered. Posting checks are clear again.'
    if os.environ.get('WATCHDOG_SMS_DRY_RUN') == '1': print('SMS DRY RUN:', text)
    else:
        script = 'on run argv\ntell application "Messages" to send (item 1 of argv) to participant "+18054335835" of account id "35252375-F9B5-4D85-8B97-0CC7AA4CB64E"\nend run'
        r = subprocess.run(['osascript', '-e', script, text], capture_output=True, text=True, timeout=30)
        if r.returncode: print('SMS failed:', r.stderr.strip()[:200]); return
    json.dump({'key': key, 'at': now.isoformat()}, open(NOTIFY_STATE, 'w'))
cap = get('/api/publishing/capabilities', 30)
rel = get('/api/publishing/releases', 15)
lines, alerts = [], []

hold = cap.get('instagramWriteHold')
if hold: alerts.append(f"IG WRITE HOLD LATCHED: {hold.get('reason','')[:120]} (not cleared by watchdog; Antonio's call)")
plats = cap.get('platforms', {})
for p in ('instagram', 'tiktok', 'youtube'):
    if not plats.get(p, {}).get('ready'): alerts.append(f"{p} NOT ready: {plats.get(p,{}).get('reason','?')[:100]}")
# Oct 30 (Antonio: "Yes, add it"): after the 14:47 Mac restart WDA stopped with "automatic retries stopped" and stayed
# down until a manual reconnect at 16:18. When that state shows and no release is running, send ONE reconnect through
# the WDA service socket and wait up to 90 s; alert only if it does not come back. Never retries in a loop.
import os
SOCK = os.environ.get('WDA_SERVICE_SOCK', '/Users/antoniomonteiro/Developer/phone-farm/.wda/wda-service.sock')  # override only for tests
def wda_devices():
    try: return json.loads(subprocess.run(['curl', '-s', '-m', '8', '--unix-socket', SOCK, 'http://localhost/devices'], capture_output=True, text=True).stdout).get('devices', [])
    except Exception: return []
running = any(r.get('state') == 'running' for r in rel.get('releases', []))
for d in wda_devices():
    if d.get('wda') == 'error' and 'retries stopped' in (d.get('message') or ''):
        if running: alerts.append(f"WDA stopped ({d['udid'][:8]}); reconnect skipped while a release runs"); continue
        subprocess.run(['curl', '-s', '-m', '15', '--unix-socket', SOCK, '-X', 'POST', f"http://localhost/devices/{d['udid']}/reconnect"], capture_output=True)
        state = ''
        for _ in range(18):
            subprocess.run(['sleep', '5'])
            state = next((x for x in wda_devices() if x.get('udid') == d['udid']), {})
            if state.get('wda') in ('ready', 'error'): break
        if state.get('wda') == 'ready': lines.append(f"WDA was stopped; watchdog reconnected it ({d['udid'][:8]})")
        else: alerts.append(f"WDA reconnect FAILED ({d['udid'][:8]}): {(state.get('message') or '?')[:120]}")
try:
    r = urllib.request.urlopen('http://127.0.0.1:8100/screenshot', timeout=15)
    if r.status != 200: alerts.append(f"phone screenshot HTTP {r.status}")
except Exception as e: alerts.append(f"phone screenshot failed: {e}")

fails, pubs, armed_next = [], [], {'instagram': 0, 'tiktok': 0, 'youtube': 0}
for r in rel.get('releases', []):
    t = datetime.datetime.fromisoformat(r['run_at'].replace('Z', '+00:00'))
    if now - datetime.timedelta(minutes=75) <= t <= now + datetime.timedelta(minutes=5):
        if r['state'] == 'published': pubs.append(f"{r['item_id'][:8]} {t.astimezone(PT).strftime('%H:%M')}")
        elif r['state'] != 'running':
            err = (r.get('result') or {}).get('error', '')[:110]
            fails.append(f"{r['item_id'][:8]} {r['state']} {t.astimezone(PT).strftime('%H:%M')} {err}")
    if r['state'] == 'armed' and now <= t <= now + datetime.timedelta(hours=3):
        lane = 'youtube' if t.minute == 22 else ('tiktok' if False else 'instagram')
        armed_next[lane] = armed_next.get(lane, 0) + 1
# lane guess by item targets is not available here; report the raw count instead
armed3h = sum(1 for r in rel.get('releases', []) if r['state'] == 'armed' and now <= datetime.datetime.fromisoformat(r['run_at'].replace('Z','+00:00')) <= now + datetime.timedelta(hours=3))

# Nov 5 (Antonio: "Yes, add the alert"): WDA died at 12:55 PT when its free 7-day signing profile expired, and nobody
# knew for an hour; earlier a pool jam failed every slot from 08:00 PT. Text Antonio for the states that stop posting.
urgent = [a for a in alerts if a.startswith(('WDA ', 'IG WRITE HOLD'))]
done = sorted([r for r in rel.get('releases', []) if r['state'] in ('published', 'needs_review', 'failed')], key=lambda r: r['run_at'], reverse=True)
if len(done) >= 2 and all(r['state'] != 'published' for r in done[:2]):
    urgent.append('2 slots in a row failed: ' + ', '.join(f"{r['item_id'][:8]} {((r.get('result') or {}).get('error') or '')[:60]}" for r in done[:2]))
import glob, plistlib
profiles = []
for p in glob.glob(os.path.expanduser('~/Library/Developer/Xcode/UserData/Provisioning Profiles/*.mobileprovision')):
    try:
        info = plistlib.loads(subprocess.run(['security', 'cms', '-D', '-i', p], capture_output=True).stdout)
        if 'WebDriverAgentRunner' in info.get('Name', ''): profiles.append(info['ExpirationDate'].replace(tzinfo=datetime.timezone.utc))
    except Exception: pass
if profiles:
    left = max(profiles) - now
    if left < datetime.timedelta(days=2):
        urgent.append(f"WDA signing profile expires {max(profiles).astimezone(PT).strftime('%b %d %H:%M PT')} ({left.total_seconds()/3600:.0f} h left). Run npm run wda:prepare, then trust it on the iPhone")
    lines.append(f"WDA profile expires {max(profiles).astimezone(PT).strftime('%b %d %H:%M PT')}")
alerts += [u for u in urgent if u not in alerts]
notify(urgent, now)

status = 'alert' if (fails or alerts) else 'ok'
summary = '; '.join(alerts + fails) if (alerts or fails) else 'all clear'
with open(OUT, 'a') as f:
    f.write(json.dumps({'at': now_iso, 'status': status, 'published': pubs, 'failures': fails, 'alerts': alerts, 'info': lines, 'armedNext3h': armed3h}) + '\n')
md = ['# Phone Farm watchdog', f'checked {now_iso} ({now.astimezone(PT).strftime("%H:%M PT")})', '',
      f'**status: {status.upper()}**', '']
md += [f'- PUBLISHED: {p}' for p in pubs] or ['- nothing published in the last 75 min']
md += [f'- FAIL: {x}' for x in fails]
md += [f'- ALERT: {a}' for a in alerts]
md += [f'- INFO: {x}' for x in lines]
md.append(f'- armed in next 3h: {armed3h}')
md.append('- note: armed is not published; only a native receipt proves publication')
open(LATEST, 'w').write('\n'.join(md) + '\n')
print(status, '|', summary[:300], ('| ' + '; '.join(lines)) if lines else '')
EOF
