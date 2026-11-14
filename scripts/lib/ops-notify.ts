/** Shared alert delivery for the monitor and the burn-in report. Deterministic: no AI, no phone input.
 * Slack credentials come from the 1Password Business SDK reader (account 7M4X7TUMOVDGLDFNR6KHJH2HXI) inside this
 * process and are never printed, logged or written to disk. A read failure is retried, then a macOS notification fires. */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export const ALERT_USER = process.env.SLACK_ALERT_USER || 'U07K58XAD97';
const channelPath = '.scheduler-data/slack-dm-channel.json';
const run = promisify(execFile);

const READER = `
import importlib.util,os,json
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.fields("c2c-monorepo","Slack App — Ronaldo Marketing (c2c-content Socket Mode)")["SLACK_BOT_TOKEN"])`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The 1Password SDK reader first, with retries; SLACK_BOT_TOKEN from the environment is only a fallback because an
 * inherited shell token can be stale (a stale one answered account_inactive on 2026-10-12). Returns null when unreadable. */
export async function readSlackToken(attempts = 3, delayMs = 5_000, reader: () => Promise<string> = defaultReader): Promise<string | null> {
    for (let n = 1; n <= attempts; n++) {
        try { const t = (await reader()).trim(); if (t) return t; } catch { /* retry; never log the reader output */ }
        if (n < attempts) await sleep(delayMs * n);
    }
    return process.env.SLACK_BOT_TOKEN || null;
}
async function defaultReader() { return (await run('/usr/bin/python3', ['-c', READER], { timeout: 60_000 })).stdout; }

/** Local alert that needs no network and no credentials. */
export function macNotify(title: string, message: string) {
    const esc = (v: string) => v.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').slice(0, 220);
    try { execFileSync('/usr/bin/osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}" sound name "Basso"`], { timeout: 10_000 }); } catch { /* nothing else to try */ }
}

async function call(token: string, method: string, body: unknown) {
    const r = await fetch('https://slack.com/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const j = await r.json() as any; if (!j.ok) throw Error(`Slack ${method}: ${j.error}`); return j;
}

/** DM channel ID (D...). Opened once, then cached so later sends need only chat.postMessage. */
async function dmChannel(token: string) {
    const cached = JSON.parse(await readFile(channelPath, 'utf8').catch(() => '{}')) as { user?: string; channel?: string };
    if (cached.user === ALERT_USER && /^D[A-Z0-9]+$/.test(cached.channel ?? '')) return cached.channel!;
    const channel = (await call(token, 'conversations.open', { users: ALERT_USER })).channel.id as string;
    await mkdir('.scheduler-data', { recursive: true });
    await writeFile(channelPath, JSON.stringify({ user: ALERT_USER, channel }));
    return channel;
}

export type SendResult = { ok: true; channel: string; ts: string; permalink?: string } | { ok: false; reason: string };

/** Send a Slack DM. On any failure, raise a macOS notification so the alert is never lost. Never throws. */
export async function sendAlert(blocks: unknown[], text: string, opts: { title?: string; sendAttempts?: number } = {}): Promise<SendResult> {
    const token = await readSlackToken();
    let reason = token ? '' : 'Slack credentials could not be read from 1Password';
    if (token) for (let n = 1; n <= (opts.sendAttempts ?? 3); n++) {
        try {
            const channel = await dmChannel(token);
            const res = await call(token, 'chat.postMessage', { channel, text, blocks, unfurl_links: false });
            const permalink = await fetch('https://slack.com/api/chat.getPermalink?' + new URLSearchParams({ channel, message_ts: res.ts }), { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10_000) }).then(r => r.json() as Promise<any>).then(j => j.ok ? j.permalink as string : undefined, () => undefined);
            return { ok: true, channel, ts: res.ts as string, permalink };
        } catch (e) { reason = (e as Error).message.replace(token, '***'); if (n < (opts.sendAttempts ?? 3)) await sleep(3_000 * n); }
    }
    macNotify(opts.title ?? 'Phone Farm alert', `${text} (Slack failed: ${reason})`);
    return { ok: false, reason };
}
