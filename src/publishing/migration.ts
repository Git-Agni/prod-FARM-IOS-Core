/** Read-only migration planning. This module cannot change either provider queue. */
export interface MigrationSource {
    id: number;
    date: { dateTime: string; timezone: string };
    providers: Array<{ network: string; status: string }>;
}
export function planMigration(items: MigrationSource[]) {
    const seen = new Set<number>();
    return items.map(item => {
        if (!Number.isSafeInteger(item.id) || seen.has(item.id)) throw new Error('Missing or duplicate Metricool item ID');
        seen.add(item.id);
        if (!item.date?.dateTime || !item.date?.timezone) throw new Error('Original time and timezone are required');
        const migrate = item.providers.filter(p => ['instagram','facebook','tiktok'].includes(p.network) && p.status === 'PENDING').map(p=>p.network);
        const preserve = item.providers.filter(p => !migrate.includes(p.network)).map(p=>({ ...p }));
        return { metricoolId:item.id, originalTime:{...item.date}, migrate, preserve,
            action:migrate.length ? 'review_only' : 'leave_unchanged',
            removeWholeMetricoolItem:false, phoneEnabled:false,
            blockers:migrate.length ? ['Verify media hash and canonical content ID','Reconcile Instagram and Facebook timing','Verify native publication and platform receipts','Read back Metricool destination removal before enabling phone item'] : [] };
    });
}
