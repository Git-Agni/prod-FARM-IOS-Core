/** Burn-in report. Deterministic: no AI, no phone input, no posting. Runs every 3 hours under launchd.
 * Lists releases updated in the last N hours (default 3) with platform, public link (scripts/post-links.ts),
 * comment and pin status, needs-review reasons, phone/WDA state and battery, then sends one Slack DM.
 * Nothing changed: one short line. Usage: burn-in-report.ts [--hours=3] [--dry-run] */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Message, Blocks, Md } from 'slack-block-builder';
import { createDatabaseConnection } from '../src/database/client.js';
import { probeDevice, deviceIssues } from './lib/device-health.js';
import { sendAlert } from './lib/ops-notify.js';
import { engagementSummary, type Engagement } from './lib/engagement.js';

const hours = Number(process.argv.find(a => a.startsWith('--hours='))?.split('=')[1] ?? 3);
const dryRun = process.argv.includes('--dry-run');
const dashboard = 'https://phonefarm.clicktoclose.ai/publishing';
const pt = (d: string | Date) => new Date(d).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const run = promisify(execFile);

type Row = { item_id: string; name: string; platform: string; state: string; updated_at: string; error: string | null; shared: boolean };
const mark = (s: string) => s === 'done' ? 'done' : s === 'none' ? '-' : `*${s}*`;

async function links(name: string): Promise<Record<string, string>> {
    try {
        const { stdout } = await run(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'scripts/post-links.ts', name], { timeout: 150_000 });
        return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
    } catch { return {}; }
}

const db = createDatabaseConnection();
try {
    const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args).then(r => r.rows);
    const rows = await q(`SELECT i.id item_id,i.media->>'name' name,i.input->'targets'->0->>'platform' platform,r.state,r.updated_at,
        r.result->>'error' error,r.share_claimed_at IS NOT NULL shared
        FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
        WHERE r.updated_at>now()-make_interval(hours=>$1) AND r.state IN ('published','needs_review','running')
        ORDER BY r.updated_at` , [hours]) as Row[];
    const eng = rows.length ? await q(`SELECT claim_key,status,result->>'error' error FROM scheduler.engagement_actions WHERE ${rows.map((_, n) => `claim_key LIKE '%item:' || $${n + 1}`).join(' OR ')}`, rows.map(r => r.item_id)) as Engagement[] : [];
    const probe = await probeDevice();
    const issues = deviceIssues(probe);
    const phone = !probe.usbConnected ? 'unplugged' : !probe.wdaReady ? 'WDA not ready' : probe.locked ? 'locked' : 'ready';
    const bat = probe.battery ? `${probe.battery.pct}%${probe.battery.charging ? ' charging' : probe.battery.external ? ' on power' : ' on battery'}` : 'n/a';
    const status = `Phone ${phone} · battery ${bat}`;

    let message: any;
    if (!rows.length && !issues.length) {
        message = Message({ text: `Phone Farm: no post activity in the last ${hours}h. ${status}.` }).blocks(
            Blocks.Section({ text: `Phone Farm: no post activity in the last ${hours}h. ${status}.` })).buildToObject();
    } else {
        const published = [...new Set(rows.filter(r => r.state === 'published').map(r => r.name))];
        const linkMap = new Map<string, Record<string, string>>();
        for (const n of published.slice(0, 6)) linkMap.set(n, await links(n));
        const blocks: any[] = [Blocks.Header({ text: `Phone Farm burn-in · last ${hours}h` }), Blocks.Section({ text: `${status} · ${rows.length} release update(s)` })];
        for (const r of rows.slice(-15)) {
            const e = engagementSummary(r.item_id, eng), l = linkMap.get(r.name)?.[r.platform === 'instagram' ? 'instagram' : r.platform];
            const where = r.platform === 'instagram' ? 'instagram + facebook' : r.platform;
            let text = `*${r.name}* · ${where} · ${r.state.replace(/_/g, ' ')} · ${pt(r.updated_at)} PT`;
            if (r.state === 'published') text += `\nLink: ${l ? Md.link(l, 'open post') : 'pending'}${linkMap.get(r.name)?.facebook && r.platform === 'instagram' ? ` · ${Md.link(linkMap.get(r.name)!.facebook!, 'facebook')}` : ''} · Comment: ${mark(e.comment)} · Pin: ${mark(e.pin)}`;
            if (r.state === 'needs_review') text += `\nNeeds review (${r.shared ? 'Share was tapped' : 'stopped before Share'}): ${r.error ?? 'no error text'}`;
            blocks.push(Blocks.Section({ text }));
        }
        if (rows.length > 15) blocks.push(Blocks.Context().elements(`${rows.length - 15} older update(s) not shown. See the calendar.`));
        for (const i of issues) blocks.push(Blocks.Section({ text: ':warning: ' + i.text }));
        blocks.push(Blocks.Context().elements(Md.link(dashboard, 'Open the calendar')));
        message = Message({ text: `Phone Farm burn-in: ${rows.length} release update(s). ${status}.` }).blocks(...blocks).buildToObject();
    }
    if (dryRun) console.log(JSON.stringify(message, null, 1));
    else {
        const sent = await sendAlert(message.blocks, message.text, { title: 'Phone Farm burn-in report' });
        console.log(`${new Date().toISOString()} burn-in ${sent.ok ? 'sent ' + (sent.permalink ?? sent.channel + ' ' + sent.ts) : 'not sent: ' + sent.reason}`);
    }
} finally { await db.close(); }
