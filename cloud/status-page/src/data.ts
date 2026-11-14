import postgres from 'postgres';

// Read-only snapshot of the Phone Farm queue. The database role (phone_farm_status_ro) can only SELECT
// these four tables and every session is read-only, so nothing here can change posting state.

export interface Target { platform: string; account?: string }
export interface Heartbeat { lastTick: string | null; ageSeconds: number | null; healthy: boolean; controlMode: string | null; state: string; blockers: string[] }
export interface QueueRow { itemId: string; runAt: string; state: string; targets: Target[]; caption: string }
export interface PublishedRow extends QueueRow { updatedAt: string; receipts: { platform: string; verified: boolean; url: string | null }[] }
export interface ReviewRow { kind: string; id: string; when: string; label: string; reasons: string[] }
export interface Snapshot {
    generatedAt: string;
    heartbeat: Heartbeat;
    counts: { armed: number; running: number; published24h: number; publishedTotal: number; needsReview: number };
    queue: QueueRow[];
    published: PublishedRow[];
    review: ReviewRow[];
}

const REASON_KEYS = new Set(['reason', 'error', 'receiptCheckError', 'originalReceiptError', 'previousVerificationError', 'nativeNotice', 'note']);

/** Collects human-readable reason strings from a result document, labelled by their top-level section. */
export function extractReasons(doc: unknown, limit = 4): string[] {
    const found: string[] = [];
    const walk = (value: unknown, section: string, depth: number) => {
        if (found.length >= limit || depth > 3 || !value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (typeof child === 'string' && REASON_KEYS.has(key) && child.trim()) {
                const text = child.trim().slice(0, 400);
                found.push(section ? `${section}: ${text}` : text);
                if (found.length >= limit) return;
            } else if (child && typeof child === 'object') {
                walk(child, depth === 0 ? key : section, depth + 1);
            }
        }
    };
    walk(doc, '', 0);
    return found;
}

/** Same rule as the Mac's releaseWorkerHealth: a tick older than 90 seconds means the worker is stopped. */
export function heartbeatFrom(row: { last_tick: Date | string | null; control_mode: string | null; state: string | null; blockers: unknown } | undefined, now = new Date()): Heartbeat {
    const tick = row?.last_tick ? new Date(row.last_tick) : null;
    const age = tick ? now.getTime() - tick.getTime() : Infinity;
    const healthy = Number.isFinite(age) && age >= 0 && age < 90_000;
    const blockers = Array.isArray(row?.blockers) ? (row!.blockers as unknown[]).map(String) : [];
    const blocked = row?.state !== 'running' || blockers.length > 0;
    return {
        lastTick: tick?.toISOString() ?? null,
        ageSeconds: tick ? Math.round(age / 1000) : null,
        healthy,
        controlMode: row?.control_mode ?? null,
        state: healthy ? (blocked ? 'blocked' : 'running') : 'stopped',
        blockers: healthy ? blockers : ['No heartbeat from the Mac in the last 90 seconds.'],
    };
}

function receiptsFrom(result: any, targets: Target[]) {
    const receipts = result?.receipts && typeof result.receipts === 'object' ? result.receipts : {};
    const platforms = new Set<string>([...targets.map(t => t.platform), ...Object.keys(receipts)]);
    return [...platforms].map(platform => ({
        platform,
        verified: receipts[platform]?.verified === true,
        url: typeof receipts[platform]?.url === 'string' ? receipts[platform].url : null,
    }));
}

const iso = (v: Date | string) => new Date(v).toISOString();
const targetsOf = (v: unknown): Target[] => Array.isArray(v) ? v.filter(t => t && typeof t === 'object').map((t: any) => ({ platform: String(t.platform), account: t.account ? String(t.account) : undefined })) : [];

export async function loadSnapshot(databaseUrl: string): Promise<Snapshot> {
    // databaseUrl is the Hyperdrive binding's local connection string; Hyperdrive holds the verified TLS link.
    const sql = postgres(databaseUrl, { max: 5, fetch_types: false, idle_timeout: 5, connect_timeout: 10 });
    try {
        const [health, queue, published, counts, reviewReleases, reviewItems, reviewActions] = await Promise.all([
            sql`SELECT last_tick, control_mode, state, blockers FROM scheduler.publishing_worker_health WHERE id=1`,
            sql`SELECT r.item_id, r.run_at, r.state, i.input->'targets' AS targets, left(i.input->>'caption', 160) AS caption
                FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
                WHERE r.state IN ('armed','running') ORDER BY r.run_at LIMIT 300`,
            sql`SELECT r.item_id, r.run_at, r.updated_at, r.state, i.input->'targets' AS targets, left(i.input->>'caption', 160) AS caption, r.result->'receipts' AS receipts
                FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
                WHERE r.state='published' ORDER BY r.run_at DESC LIMIT 60`,
            sql`SELECT count(*) FILTER (WHERE state='armed')::int AS armed, count(*) FILTER (WHERE state='running')::int AS running,
                count(*) FILTER (WHERE state='published' AND run_at > now() - interval '24 hours')::int AS published24h,
                count(*) FILTER (WHERE state='published')::int AS published_total FROM scheduler.publishing_releases`,
            sql`SELECT r.item_id, r.updated_at, r.result, i.input->'targets' AS targets, left(i.input->>'caption', 120) AS caption
                FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
                WHERE r.state='needs_review' ORDER BY r.updated_at DESC LIMIT 50`,
            sql`SELECT i.id, i.updated_at, i.results, i.input->'targets' AS targets, left(i.input->>'caption', 120) AS caption
                FROM scheduler.publishing_items i LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id
                WHERE i.status='needs_review' AND (r.state IS NULL OR r.state<>'needs_review') ORDER BY i.updated_at DESC LIMIT 50`,
            sql`SELECT claim_key, action, post_url, updated_at, result FROM scheduler.engagement_actions
                WHERE status='needs_review' ORDER BY updated_at DESC LIMIT 50`,
        ]);
        const label = (targets: unknown, caption: string | null) =>
            `${targetsOf(targets).map(t => t.platform).join(' + ') || 'unknown'}: ${caption ?? ''}`.trim();
        const review: ReviewRow[] = [
            ...reviewReleases.map(r => ({ kind: 'release', id: r.item_id, when: iso(r.updated_at), label: label(r.targets, r.caption), reasons: extractReasons(r.result) })),
            ...reviewItems.map(r => ({ kind: 'item', id: r.id, when: iso(r.updated_at), label: label(r.targets, r.caption), reasons: extractReasons(r.results) })),
            ...reviewActions.map(r => ({ kind: r.action, id: r.claim_key, when: iso(r.updated_at), label: `${r.action} on ${r.post_url}`, reasons: extractReasons(r.result) })),
        ].sort((a, b) => b.when.localeCompare(a.when));
        const c = counts[0];
        return {
            generatedAt: new Date().toISOString(),
            heartbeat: heartbeatFrom(health[0] as any),
            counts: { armed: c.armed, running: c.running, published24h: c.published24h, publishedTotal: c.published_total, needsReview: review.length },
            queue: queue.map(r => ({ itemId: r.item_id, runAt: iso(r.run_at), state: r.state, targets: targetsOf(r.targets), caption: r.caption ?? '' })),
            published: published.map(r => {
                const targets = targetsOf(r.targets);
                return { itemId: r.item_id, runAt: iso(r.run_at), updatedAt: iso(r.updated_at), state: r.state, targets, caption: r.caption ?? '', receipts: receiptsFrom({ receipts: r.receipts }, targets) };
            }),
            review,
        };
    } finally {
        await sql.end({ timeout: 2 });
    }
}
