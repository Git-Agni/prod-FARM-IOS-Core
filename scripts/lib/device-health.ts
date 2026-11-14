/** Phone health probe shared by the burn-in report and the device alert job. Read-only: no phone input, no posting.
 * Sources: WDA over its local port, the WDA service socket (.wda/wda-service.sock /devices) and ideviceinfo for battery. */
import { execFileSync } from 'node:child_process';

export const PHONE_UDID = '00008130-000229EE1AA0001C';
export type Battery = { pct: number; charging: boolean; external: boolean };
export type DeviceProbe = {
    usbConnected: boolean;
    wdaReady: boolean;
    locked: boolean | null;
    serviceMessage: string;
    battery: Battery | null;
};
export type DeviceIssue = { key: string; text: string };

const sh = (cmd: string, args: string[], timeout = 8_000) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

export function parseBattery(raw: string): Battery | null {
    const get = (k: string) => raw.match(new RegExp(`^${k}:\\s*(\\S+)`, 'm'))?.[1];
    const pct = Number(get('BatteryCurrentCapacity'));
    if (!get('BatteryCurrentCapacity') || !Number.isFinite(pct)) return null;
    return { pct, charging: get('BatteryIsCharging') === 'true', external: get('ExternalConnected') === 'true' };
}

async function wdaJson(route: string) {
    const r = await fetch('http://127.0.0.1:8100' + route, { signal: AbortSignal.timeout(8_000) });
    return await r.json() as any;
}

export async function probeDevice(): Promise<DeviceProbe> {
    const usbConnected = sh('/opt/homebrew/bin/idevice_id', ['-l']).split('\n').includes(PHONE_UDID);
    let wdaReady = false, locked: boolean | null = null;
    try {
        wdaReady = !!(await wdaJson('/status')).value?.ready;
        if (wdaReady) locked = (await wdaJson('/wda/locked')).value !== false;
    } catch { /* WDA down; the service message below explains why */ }
    let serviceMessage = '';
    try { serviceMessage = JSON.parse(sh('curl', ['-s', '-m', '5', '--unix-socket', '.wda/wda-service.sock', 'http://localhost/devices'])).devices?.[0]?.message ?? ''; } catch { /* service down */ }
    const battery = usbConnected ? parseBattery(sh('/opt/homebrew/bin/ideviceinfo', ['-q', 'com.apple.mobile.battery'])) : null;
    return { usbConnected, wdaReady, locked, serviceMessage, battery };
}

/** Pure rule set. `prevPct` is the previous sample's battery percent, used for the "falling" test. */
export function deviceIssues(p: DeviceProbe, prevPct?: number): DeviceIssue[] {
    const issues: DeviceIssue[] = [];
    if (!p.usbConnected) issues.push({ key: 'device:unplugged', text: 'The iPhone is *not connected by USB* to the Mac. Posting is paused until it is plugged back in.' });
    else if (!p.wdaReady) {
        const passcode = /automation approval prompt|enabling automation/i.test(p.serviceMessage);
        issues.push({ key: 'device:wda:' + (passcode ? 'passcode' : 'other'), text: passcode
            ? '*The iPhone needs its passcode for XCTest.* Unlock the phone and enter the passcode on the "Enter iPhone Passcode for XCTest" prompt. Posting is paused until then.'
            : `The phone connection (WebDriverAgent) is *not ready*.${p.serviceMessage ? `\n> ${p.serviceMessage}` : ''}` });
    } else if (p.locked) issues.push({ key: 'device:locked', text: 'The iPhone is *locked*. Posts wait until it is unlocked.' });
    const b = p.battery;
    if (b && b.pct < 15 && (b.charging ? false : prevPct === undefined || b.pct <= prevPct))
        issues.push({ key: 'device:battery', text: `Phone battery is *${b.pct}%* and falling${b.external ? ' even though it reports external power' : ' (not charging)'}. Check the USB cable and Mac power.` });
    return issues;
}
