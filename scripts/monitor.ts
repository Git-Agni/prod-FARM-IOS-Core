/** Phone Farm autopilot monitor. Deterministic: no AI calls, no phone input, no posting.
 * `check` (every 15 minutes) sends a Slack DM only for new problems; silent when healthy.
 * `summary` (daily) sends the day's posts, comments and open items.
 * Slack delivery lives in scripts/lib/ops-notify.ts: it reads the bot token from the 1Password SDK reader with retries and falls back to a macOS notification. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Message, Blocks, Md } from 'slack-block-builder';
import { createDatabaseConnection } from '../src/database/client.js';
import { sendAlert } from './lib/ops-notify.js';

const mode = process.argv[2] === 'summary' ? 'summary' : 'check';
const dashboard = 'https://phonefarm.clicktoclose.ai/publishing';
const statePath = '.scheduler-data/monitor-state.json';
const REALERT_MS = 3 * 60 * 60_000;
const pt = (d: string | Date) => new Date(d).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

type Issue = { key: string; text: string };

const db = createDatabaseConnection();
try {
    const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args).then(r => r.rows);
    if (mode === 'check') {
        const issues: Issue[] = [];
        // Services
        const listed = execFileSync('launchctl', ['list'], { encoding: 'utf8' });
        for (const label of ['worker', 'web', 'wda', 'appium', 'backlog']) {
            const row = listed.split('\n').find(l => l.endsWith('ai.clicktoclose.phone-farm.' + label));
            if (!row) issues.push({ key: 'service:' + label, text: `Service *${label}* is not loaded.` });
            else if (label !== 'backlog' && row.split('\t')[0] === '-') issues.push({ key: 'service:' + label, text: `Service *${label}* is loaded but not running.` });
        }
        // Phone connection, lock state and battery are owned by scripts/device-alert.ts (every 5 minutes).
        // Posts that stopped in the last 20 minutes
        for (const r of await q(`SELECT i.id,i.media->>'name' n,i.input->'targets'->0->>'platform' pl,r.share_claimed_at IS NOT NULL c,r.result->>'error' e,r.result->>'failureEvidence' ev
            FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
            WHERE r.state='needs_review' AND r.updated_at>now()-interval '20 minutes'`))
            issues.push({ key: `release:${r.id}:${r.e}`, text: `*${r.pl}* · ${r.n}: ${r.c ? 'Share was tapped but the post is not confirmed yet (the worker re-checks up to 3 times).' : 'stopped before Share. It moves to the front of the queue at :05.'}\n> ${r.e ?? 'no error text'}${r.ev ? `\nEvidence: \`${r.ev}.png\`` : ''}` });
        // Shared posts still unconfirmed after all re-checks
        for (const r of await q(`SELECT i.id,i.media->>'name' n,i.input->'targets'->0->>'platform' pl FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
            WHERE r.state='needs_review' AND r.share_claimed_at IS NOT NULL AND COALESCE((r.result->>'receiptChecks')::int,0)>=3`))
            issues.push({ key: `unconfirmed:${r.id}`, text: `*${r.pl}* · ${r.n}: posted but never confirmed after 3 checks. Please check the app.` });
        // Comments that need a person
        for (const r of await q(`SELECT claim_key,status,result->>'error' e FROM scheduler.engagement_actions
            WHERE (status='uncertain_review' OR (status='failed_before_action' AND COALESCE((result->>'retries')::int,0)>=3)) AND updated_at>now()-interval '24 hours'`))
            issues.push({ key: `comment:${r.claim_key}:${r.status}`, text: `Comment \`${r.claim_key}\` is *${r.status.replace(/_/g, ' ')}*${r.e ? `: ${r.e}` : ''}.` });
        // Armed posts far past their time: the worker is not taking work
        const late = (await q(`SELECT count(*)::int n FROM scheduler.publishing_releases WHERE state='armed' AND run_at<now()-interval '60 minutes'`))[0].n;
        if (late) issues.push({ key: 'late', text: `${late} armed post(s) are more than an hour late. The worker may be stuck.` });
        // Queue depth
        const last = (await q(`SELECT max(run_at) t FROM scheduler.publishing_releases WHERE state='armed'`))[0].t;
        if (!last || new Date(last).getTime() - Date.now() < 12 * 60 * 60_000) issues.push({ key: 'queue:' + new Date().toISOString().slice(0, 10), text: `The queue runs out ${last ? 'at ' + pt(last) : 'now'}. Add videos to keep hourly posting.` });

        const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}')) as Record<string, number>;
        const now = Date.now(), fresh = issues.filter(i => !state[i.key] || now - state[i.key]! > REALERT_MS);
        for (const k of Object.keys(state)) if (!issues.some(i => i.key === k)) delete state[k];
        if (fresh.length) {
            const message = Message({ text: `Phone Farm: ${fresh.length} issue(s)` }).blocks(
                Blocks.Header({ text: 'Phone Farm needs attention' }),
                ...fresh.map(i => Blocks.Section({ text: i.text })),
                Blocks.Context().elements(`${pt(new Date())} PT · ${Md.link(dashboard, 'Open the calendar')}`),
            ).buildToObject() as any;
            // Only remember an alert once Slack accepted it; a failed send raised a Mac notification and retries next check.
            if ((await sendAlert(message.blocks, message.text, { title: 'Phone Farm needs attention' })).ok) for (const i of fresh) state[i.key] = now;
        }
        await mkdir('.scheduler-data', { recursive: true });
        await writeFile(statePath, JSON.stringify(state, null, 2));
        console.log(`${new Date().toISOString()} check: ${issues.length} issue(s), ${fresh.length} alerted`);
    } else {
        const posted = await q(`SELECT i.input->'targets'->0->>'platform' pl,count(*)::int n FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
            WHERE r.state='published' AND (r.updated_at AT TIME ZONE 'America/Los_Angeles')::date=(now() AT TIME ZONE 'America/Los_Angeles')::date GROUP BY 1`);
        const comments = await q(`SELECT split_part(claim_key,':',1)||CASE WHEN claim_key LIKE 'comment:%' THEN ' '||split_part(claim_key,':',2) ELSE ' instagram' END k,count(*)::int n
            FROM scheduler.engagement_actions WHERE status='done' AND (updated_at AT TIME ZONE 'America/Los_Angeles')::date=(now() AT TIME ZONE 'America/Los_Angeles')::date GROUP BY 1`);
        const review = (await q(`SELECT count(*)::int n FROM scheduler.publishing_releases WHERE state='needs_review'`))[0].n;
        const queue = (await q(`SELECT count(*)::int n,max(run_at) t FROM scheduler.publishing_releases WHERE state='armed'`))[0];
        const line = (rows: any[], key: string) => rows.length ? rows.map(r => `${r[key]}: ${r.n}`).join(' · ') : 'none';
        const message = Message({ text: 'Phone Farm daily summary' }).blocks(
            Blocks.Header({ text: 'Phone Farm daily summary' }),
            Blocks.Section({ text: `*Posted today:* ${line(posted, 'pl')}\n(Facebook is counted with Instagram, its linked share.)` }),
            Blocks.Section({ text: `*Comments today:* ${line(comments, 'k')}` }),
            Blocks.Section({ text: `*Needs review:* ${review}\n*Queue:* ${queue.n} armed posts${queue.t ? ', through ' + pt(queue.t) : ''}` }),
            Blocks.Context().elements(Md.link(dashboard, 'Open the calendar')),
        ).buildToObject() as any;
        const sent = await sendAlert(message.blocks, message.text, { title: 'Phone Farm daily summary' });
        console.log(`${new Date().toISOString()} summary ${sent.ok ? 'sent' : 'not sent: ' + sent.reason}`);
    }
} finally { await db.close(); }
