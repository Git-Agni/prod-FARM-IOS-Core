import test from 'node:test';
import assert from 'node:assert/strict';
import { readSlackToken } from '../scripts/lib/ops-notify.js';

test('token reader retries then succeeds', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    let n = 0;
    const t = await readSlackToken(3, 1, async () => { if (++n < 3) throw Error('sdk down'); return 'xoxb-test\n'; });
    assert.equal(t, 'xoxb-test'); assert.equal(n, 3);
});
test('token reader returns null after all retries fail', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    let n = 0;
    assert.equal(await readSlackToken(2, 1, async () => { n++; throw Error('sdk down'); }), null); assert.equal(n, 2);
});
test('environment token is only a fallback', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env';
    assert.equal(await readSlackToken(1, 1, async () => 'xoxb-reader'), 'xoxb-reader');
    assert.equal(await readSlackToken(1, 1, async () => { throw Error('sdk down'); }), 'xoxb-env');
    delete process.env.SLACK_BOT_TOKEN;
});
