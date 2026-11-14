import test from 'node:test';
import assert from 'node:assert/strict';
import { POSTING_ACCOUNTS, isSecondaryAccount, postingAccountFor } from '../src/publishing/posting-accounts.js';
import { InstagramRelease } from '../src/publishing/instagram-release.js';

const ig = (account: string, facebook?: string) => ({ targets: [
    { platform: 'instagram', account }, ...(facebook ? [{ platform: 'facebook', account: facebook }] : []),
] }) as any;
const REVENUE_FB = 'https://www.facebook.com/profile.php?id=61584693917444';
const AMAI_FB = 'https://www.facebook.com/1335852916285633';

test('antoniorevenue keeps its exact Facebook label and is not a secondary account', () => {
    const a = postingAccountFor(ig('@antoniorevenue', REVENUE_FB));
    assert.equal(a.facebookComposerLabel, 'Antonio Revenue, Facebook · Public, On');
    assert.equal(a.facebookAppCheck, true);
    assert.equal(isSecondaryAccount(ig('antoniorevenue')), false);
});

test('antoniomonteiroai is calibrated with its own Page and must name it exactly', () => {
    const a = postingAccountFor(ig('antoniomonteiroai', AMAI_FB));
    assert.equal(a.facebookPageId, '1335852916285633');
    assert.equal(a.facebookAppCheck, false);
    assert.equal(isSecondaryAccount(ig('@antoniomonteiroai')), true);
    assert.throws(() => postingAccountFor(ig('antoniomonteiroai', REVENUE_FB)), /not the linked Page of @antoniomonteiroai/);
});

test('an uncalibrated Instagram account fails before any phone input', () => {
    assert.throws(() => postingAccountFor(ig('someoneelse')), /Instagram account is not calibrated/);
    assert.equal(Object.keys(POSTING_ACCOUNTS).sort().join(','), 'antoniomonteiroai,antoniorevenue');
});

class SwitchProbe extends InstagramRelease {
    switched: string[] = [];
    failSwitch = false;
    override async switchInstagramAccount(expected: string) { this.switched.push(expected); if (this.failSwitch) throw new Error('switcher missing'); return expected; }
    setInput(input: any) { this.input = input; }
}

async function withHome<T>(run: () => Promise<T>) {
    const original = globalThis.fetch; const calls: string[] = [];
    globalThis.fetch = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ value: null }), { status: 200 }); }) as any;
    try { return { result: await run(), calls }; } finally { globalThis.fetch = original; }
}

test('after an antoniomonteiroai release the app is switched back to antoniorevenue, then Home', async () => {
    const d = new SwitchProbe('http://fake-wda', new AbortController().signal);
    d.setInput(ig('antoniomonteiroai', AMAI_FB));
    const { calls } = await withHome(() => d.leaveVideo());
    assert.deepEqual(d.switched, ['antoniorevenue']);
    assert.ok(calls.some(c => c.endsWith('/wda/homescreen')));
});

test('an antoniorevenue release never switches accounts on the way out', async () => {
    const d = new SwitchProbe('http://fake-wda', new AbortController().signal);
    d.setInput(ig('antoniorevenue', REVENUE_FB));
    await withHome(() => d.leaveVideo());
    assert.deepEqual(d.switched, []);
});

test('a failed switch-back still goes Home and then reports for review', async () => {
    const d = new SwitchProbe('http://fake-wda', new AbortController().signal);
    d.setInput(ig('antoniomonteiroai', AMAI_FB)); d.failSwitch = true;
    const original = globalThis.fetch; const calls: string[] = [];
    globalThis.fetch = (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ value: null }), { status: 200 }); }) as any;
    try { await assert.rejects(() => d.leaveVideo(), /not switched back to @antoniorevenue: switcher missing/); }
    finally { globalThis.fetch = original; }
    assert.ok(calls.some(c => c.endsWith('/wda/homescreen')));
});
