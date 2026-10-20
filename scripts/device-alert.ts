/** Immediate phone alerts. Deterministic, read-only. Runs every 5 minutes under launchd.
 * Alerts (Slack DM, macOS notification if Slack fails) when WDA is not ready, the phone is unplugged or locked,
 * or the battery is under 15% and falling. One alert per problem, repeated every 3 hours while it lasts.
 * Pings HEARTBEAT_URL (optional, from .env) after each run, or HEARTBEAT_URL/fail when the posting worker is stuck. Also retries the WDA runner when it reports "retries stopped" so posting resumes after the passcode is entered. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Message, Blocks, Md } from 'slack-block-builder';
import { probeDevice, deviceIssues, PHONE_UDID } from './lib/device-health.js';
import { sendAlert } from './lib/ops-notify.js';
import { createDatabaseConnection } from '../src/database/client.js';
import { workerHeartbeatIssue } from '../src/publishing/worker-health.js';

const statePath = '.scheduler-data/device-alert-state.json';
const REALERT_MS = 3 * 60 * 60_000;
const dashboard = 'https://phonefarm.clicktoclose.ai/publishing';
type State = { alerts: Record<string, number>; batteryPct?: number };

const state: State = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
state.alerts ??= {};
const probe = await probeDevice();
if (!probe.wdaReady && probe.usbConnected && /retries stopped|error/i.test(probe.serviceMessage))
    try { execFileSync('curl', ['-s', '-m', '20', '-X', 'POST', '--unix-socket', '.wda/wda-service.sock', `http://localhost/devices/${PHONE_UDID}/reconnect`], { stdio: 'ignore' }); } catch { /* next run tries again */ }
const issues = deviceIssues(probe, state.batteryPct);
// Posting worker heartbeat (Oct 19). A stuck worker is restarted; startup sends its interrupted job to review.
let workerHealthy = true;
{
    const db = createDatabaseConnection();
    try {
        const row = (await db.pool.query('SELECT last_tick FROM scheduler.publishing_worker_health WHERE id=1')).rows[0];
        const issue = workerHeartbeatIssue(row?.last_tick ? new Date(row.last_tick) : null);
        if (issue) {
            issues.push({ key: issue.key, text: issue.text + (issue.restart ? ' Restarting it now.' : '') });
            if (issue.restart) workerHealthy = false;
            if (issue.restart) try { execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid?.()}/ai.clicktoclose.phone-farm.worker`], { stdio: 'ignore', timeout: 60_000 }); } catch { /* alert still goes out */ }
        }
    } catch (error) {
        workerHealthy = false;
        issues.push({ key: 'worker:unreadable', text: `Cannot read the posting worker's heartbeat: ${error instanceof Error ? error.message : String(error)}` });
    } finally { await db.close().catch(() => undefined); }
}
if (probe.battery) state.batteryPct = probe.battery.pct;
const now = Date.now();
const fresh = issues.filter(i => !state.alerts[i.key] || now - state.alerts[i.key]! > REALERT_MS);
for (const k of Object.keys(state.alerts)) if (!issues.some(i => i.key === k)) delete state.alerts[k];
if (fresh.length) {
    const message = Message({ text: `Phone Farm device: ${fresh.length} issue(s)` }).blocks(
        Blocks.Header({ text: 'Phone Farm device alert' }),
        ...fresh.map(i => Blocks.Section({ text: i.text })),
        Blocks.Context().elements(Md.link(dashboard, 'Open the calendar')),
    ).buildToObject() as any;
    if ((await sendAlert(message.blocks, message.text, { title: 'Phone Farm device alert' })).ok) for (const i of fresh) state.alerts[i.key] = now;
}
// Dead-man's switch: a cloud monitor (Healthchecks.io, see docs/cloud-architecture.md) alerts if these pings stop, e.g. the Mac is off.
// Oct 20: the Mac rebooted at 05:28 PT and waited at the FileVault screen for 2.5 hours with no alert. Silence from this
// ping is the alert for a dead Mac; /fail alerts at once when the Mac is up but the posting worker is stuck.
if (process.env.HEARTBEAT_URL) await fetch(process.env.HEARTBEAT_URL.replace(/\/$/, '') + (workerHealthy ? '' : '/fail'), { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
await mkdir('.scheduler-data', { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2));
console.log(`${new Date().toISOString()} device: ${issues.length} issue(s), ${fresh.length} alerted, battery ${probe.battery?.pct ?? 'n/a'}%`);
