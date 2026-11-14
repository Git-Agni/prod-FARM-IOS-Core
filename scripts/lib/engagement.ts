export type Engagement = { claim_key: string; status: string; error: string | null };

/** Comment and pin status for one item from its engagement_actions rows. */
export function engagementSummary(itemId: string, rows: Engagement[]) {
    const mine = rows.filter(r => r.claim_key.endsWith('item:' + itemId));
    const part = (prefix: string) => {
        const r = mine.find(m => m.claim_key.startsWith(prefix)); return r ? r.status.replace(/_/g, ' ') : 'none';
    };
    return { comment: part('comment:'), pin: part('pin:') };
}
