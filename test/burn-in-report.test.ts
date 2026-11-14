import test from 'node:test';
import assert from 'node:assert/strict';
test('engagement summary pairs rows to their item', async () => {
    const { engagementSummary } = await import('../scripts/lib/engagement.js');
    const rows = [{ claim_key: 'comment:tiktok:item:A', status: 'done', error: null }, { claim_key: 'pin:item:A', status: 'uncertain_review', error: null }, { claim_key: 'pin:item:B', status: 'done', error: null }];
    assert.deepEqual(engagementSummary('A', rows), { comment: 'done', pin: 'uncertain review' });
    assert.deepEqual(engagementSummary('C', rows), { comment: 'none', pin: 'none' });
});
