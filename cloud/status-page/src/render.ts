import type { Snapshot, Target } from './data.ts';

const TZ = 'America/Los_Angeles';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (iso: string) => dayFmt.format(new Date(iso));
const time = (iso: string) => timeFmt.format(new Date(iso));
const full = (iso: string) => `${fullFmt.format(new Date(iso))} PT`;
const platforms = (targets: Target[]) => targets.map(t => `<span class="chip">${esc(t.platform)}</span>`).join(' ');

function age(seconds: number | null) {
    if (seconds === null) return 'never';
    if (seconds < 120) return `${seconds} s ago`;
    if (seconds < 7200) return `${Math.round(seconds / 60)} min ago`;
    return `${Math.round(seconds / 3600)} h ago`;
}

function groupByDay<T extends { runAt: string }>(rows: T[]) {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const key = day(row.runAt);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return groups;
}

export function renderPage(s: Snapshot, controlUrl: string, viewer: string) {
    const hb = s.heartbeat;
    const hbClass = hb.state === 'running' ? 'ok' : hb.state === 'blocked' ? 'warn' : 'bad';
    const hbLabel = hb.state === 'running' ? 'Mac worker running' : hb.state === 'blocked' ? 'Mac worker blocked' : 'Mac worker stopped';

    const queue = [...groupByDay(s.queue)].map(([d, rows]) => `
      <h3>${esc(d)} <span class="muted">${rows.length}</span></h3>
      <table><tbody>${rows.map(r => `<tr>
        <td class="t">${esc(time(r.runAt))}</td>
        <td>${platforms(r.targets)}</td>
        <td class="cap">${esc(r.caption)}</td>
        <td><span class="state ${r.state === 'running' ? 'warn' : 'ok'}">${esc(r.state)}</span></td>
      </tr>`).join('')}</tbody></table>`).join('') || '<p class="muted">Nothing armed.</p>';

    const published = `<table><thead><tr><th>Slot (PT)</th><th>Receipts</th><th>Caption</th></tr></thead><tbody>${s.published.map(r => `<tr>
        <td class="t">${esc(day(r.runAt))} ${esc(time(r.runAt))}</td>
        <td>${r.receipts.map(x => x.url
            ? `<a class="chip ${x.verified ? 'okc' : 'badc'}" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.platform)} ${x.verified ? 'verified' : 'unverified'}</a>`
            : `<span class="chip ${x.verified ? 'okc' : 'badc'}">${esc(x.platform)} ${x.verified ? 'verified' : 'no receipt'}</span>`).join(' ')}</td>
        <td class="cap">${esc(r.caption)}</td>
      </tr>`).join('')}</tbody></table>`;

    const review = s.review.length ? `<ul class="review">${s.review.map(r => `<li>
        <div><span class="state warn">${esc(r.kind)}</span> <span class="muted">${esc(full(r.when))}</span></div>
        <div class="cap">${esc(r.label)}</div>
        ${r.reasons.length ? `<ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">No reason recorded.</p>'}
      </li>`).join('')}</ul>` : '<p class="muted">Nothing needs review.</p>';

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Phone Farm status</title>
<style>
:root{--bg:#f5f5f2;--surface:#fff;--text:#1c1c1a;--muted:#66665f;--border:#e4e4df;--ok:#15803d;--okbg:#dcfce7;--warn:#a16207;--warnbg:#fef9c3;--bad:#b91c1c;--badbg:#fee2e2;--bar:#1c1c1a}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--surface:#1c1c1a;--text:#ededea;--muted:#a3a39b;--border:#33332f;--okbg:#14532d;--ok:#bbf7d0;--warnbg:#713f12;--warn:#fef08a;--badbg:#7f1d1d;--bad:#fecaca;--bar:#000}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
header{background:var(--bar);color:#fff;padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
header a{color:#93c5fd}main{max-width:1100px;margin:0 auto;padding:16px}
section{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;overflow-x:auto}
h1{font-size:16px;margin:0}h2{font-size:15px;margin:0 0 12px}h3{font-size:13px;margin:16px 0 6px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{border:1px solid var(--border);border-radius:8px;padding:10px}.stat b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-top:1px solid var(--border);text-align:left;vertical-align:top}th{font-weight:600;color:var(--muted)}
.t{white-space:nowrap}.cap{max-width:520px;overflow-wrap:anywhere}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid var(--border);font-size:12px;text-decoration:none;color:inherit;margin:1px 0}
.okc{background:var(--okbg);color:var(--ok);border-color:transparent}.badc{background:var(--badbg);color:var(--bad);border-color:transparent}
.state{font-size:12px;padding:1px 8px;border-radius:999px}.ok{background:var(--okbg);color:var(--ok)}.warn{background:var(--warnbg);color:var(--warn)}.bad{background:var(--badbg);color:var(--bad)}
.hb{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}.hb .state{font-size:14px;padding:4px 12px}
.review{list-style:none;padding:0;margin:0}.review>li{border-top:1px solid var(--border);padding:10px 0}.review ul{margin:6px 0 0;padding-left:18px}
</style></head><body>
<header><h1>Phone Farm status <span class="muted" style="color:#a3a39b;font-weight:400">read-only cloud view</span></h1>
<div>Controls (arm, disarm, phone) live on the Mac: <a href="${esc(controlUrl)}">${esc(controlUrl.replace(/^https:\/\//, ''))}</a></div></header>
<main>
<section><h2>Mac heartbeat</h2><div class="hb"><span class="state ${hbClass}">${hbLabel}</span>
<span>Last tick ${hb.lastTick ? esc(full(hb.lastTick)) : 'never'} (${esc(age(hb.ageSeconds))})</span>
<span class="muted">Control mode: ${esc(hb.controlMode ?? 'unknown')}</span></div>
${hb.blockers.length ? `<ul>${hb.blockers.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
<p class="muted">The page only reads the database. When the Mac is off it shows the last state the Mac wrote.</p></section>
<section><div class="grid">
<div class="stat"><span class="muted">Armed</span><b>${s.counts.armed}</b></div>
<div class="stat"><span class="muted">Running now</span><b>${s.counts.running}</b></div>
<div class="stat"><span class="muted">Published, last 24 h</span><b>${s.counts.published24h}</b></div>
<div class="stat"><span class="muted">Published, all time</span><b>${s.counts.publishedTotal}</b></div>
<div class="stat"><span class="muted">Needs review</span><b>${s.counts.needsReview}</b></div>
</div></section>
<section><h2>Needs review</h2>${review}</section>
<section><h2>Armed queue (Pacific time)</h2>${queue}</section>
<section><h2>Published (latest 60)</h2>${published}</section>
<p class="muted">Data read ${esc(full(s.generatedAt))} as ${esc(viewer)}. Refreshes every 60 seconds. JSON: <a href="/api/status">/api/status</a></p>
</main></body></html>`;
}
