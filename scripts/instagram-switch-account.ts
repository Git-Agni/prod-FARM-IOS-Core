/** Make the given Instagram account the active one on the posting iPhone, then prove it with a screenshot.
 * Usage: instagram-switch-account.ts [antoniorevenue]
 * Holds the phone lock (waits up to 5 minutes for it), opens Profile, reads the account switcher title and, only when
 * it differs, opens the switcher and taps the target account. Saves before and after screenshots under
 * .scheduler-data/account-switch/. Posts nothing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createDatabaseConnection } from '../src/database/client.js';
import { WdaApp } from '../src/publishing/wda-app.js';

const TARGET = (process.argv[2] ?? 'antoniorevenue').replace(/^@/, ''), PHONE = '00008130-000229EE1AA0001C', BASE = 'http://127.0.0.1:8100';
const out = path.resolve('.scheduler-data/account-switch', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class Switcher extends WdaApp {
    async shot(name: string) {
        const png = (await this.request('/screenshot')).value as string;
        writeFileSync(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
        return path.join(out, name + '.png');
    }
    async active() {
        await this.tapElement('accessibility id', 'profile-tab', 'Profile tab');
        return (await this.read('accessibility id', 'user-switch-title-button', 'label', 'active account')).replace(/^@/, '');
    }
    async run() {
        await this.start('com.burbn.instagram');
        await sleep(2000);
        await this.shot('launch');
        writeFileSync(path.join(out, 'launch.xml'), String((await this.request(this.session + '/source')).value ?? ''));
        // A switcher sheet left open hides the tab bar: pick the account straight from it.
        if (!(await this.visible('accessibility id', 'profile-tab')) && await this.visible('predicate string', `label BEGINSWITH 'INSTAGRAM profile, ${TARGET}'`)) {
            await this.tapElement('predicate string', `label BEGINSWITH 'INSTAGRAM profile, ${TARGET}'`, `${TARGET} in the open switcher`);
            await sleep(3000);
        }
        const before = await this.active();
        await this.shot('before');
        console.log('active before:', before);
        if (before !== TARGET) {
            await this.tapElement('accessibility id', 'user-switch-title-button', 'account switcher');
            await sleep(1500);
            await this.shot('switcher');
            writeFileSync(path.join(out, 'switcher.xml'), String((await this.request(this.session + '/source')).value ?? ''));
            await this.tapElement('predicate string', `label BEGINSWITH 'INSTAGRAM profile, ${TARGET}'`, `${TARGET} in the switcher`);
            await sleep(3000);
        }
        const after = await this.active();
        console.log('active after:', after, 'screenshot:', await this.shot('after'));
        if (after !== TARGET) throw new Error(`Still on ${after}`);
    }
}

const db = createDatabaseConnection(), c = await db.pool.connect();
let locked = false;
try {
    for (let i = 0; i < 10 && !locked; i++) {
        locked = (await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l', [PHONE])).rows[0].l;
        if (!locked) { console.log('phone busy, waiting'); await sleep(30_000); }
    }
    if (!locked) throw new Error('The phone stayed busy for 5 minutes');
    await new Switcher(BASE, AbortSignal.timeout(180_000)).run();
    console.log('SWITCH OK');
} catch (e: any) { console.log('SWITCH FAILED:', e.message); process.exitCode = 1; }
finally {
    await fetch(BASE + '/wda/homescreen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    if (locked) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [PHONE]);
    c.release(); await db.close();
}
