import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { access } from 'node:fs/promises';
const run = promisify(execFile);

export const mirroringHelperPath = () => path.resolve('.mirroring/Phone Farm Mirroring.app/Contents/MacOS/PhoneFarmMirroring');
export interface MirroringStatus {
    installed: boolean;
    accessibility: boolean;
    screenCapture: boolean;
    windowPresent: boolean;
    macLocked: boolean;
    controlReady: boolean;
    protocolCurrent: boolean;
    publicationReady: false;
    reason: string;
}
export function mirroringConnectionBlocker(text: string): string | undefined {
    const value=text.replace(/\s+/g,' ').toLowerCase();
    if(value.includes('unlock your iphone'))return 'Apple requires a one-time iPhone unlock to reconnect. Follow the phone prompt, then lock it again.';
    if(value.includes('iphone in use')||value.includes('lock your iphone'))return 'Lock the physical iPhone to resume Mirroring.';
    if(value.includes('an error occurred')||value.includes('iphone mirroring ended'))return 'iPhone Mirroring disconnected. Reconnect before posting.';
    if(value.includes('connecting to'))return 'iPhone Mirroring is still connecting.';
    return undefined;
}
/** Reads existing permissions and the Mirroring screen. Never requests access or sends input. */
export async function mirroringStatus(): Promise<MirroringStatus> {
    try {
        const { stdout } = await run(mirroringHelperPath(), ['client-status'], {timeout: 5000, maxBuffer: 64_000});
        const value = JSON.parse(stdout);
        if (value.appController !== true) throw new Error('Standalone controller status is required');
        for (const key of ['accessibility','screenCapture','windowPresent','macLocked','controlReady'])
            if (typeof value[key] !== 'boolean') throw new Error('Invalid helper status');
        const protocolCurrent=value.protocolVersion===4;
        let connectionBlocker: string | undefined;
        if(value.controlReady&&protocolCurrent) {
            try {
                const { mirrorCommand }=await import('./screen.js');
                const screen=await mirrorCommand({command:'snapshot'},AbortSignal.timeout(8_000));
                if(!Array.isArray(screen.text)||!screen.text.length)throw new Error('No readable phone screen');
                connectionBlocker=mirroringConnectionBlocker(screen.text.join(' '));
            } catch { connectionBlocker='The connected iPhone screen could not be verified.'; }
        }
        return {...value, installed:true, protocolCurrent,controlReady:value.controlReady&&protocolCurrent&&!connectionBlocker,publicationReady:false,
            reason: !protocolCurrent ? 'Restart the rebuilt Phone Farm Mirroring controller and refresh its existing permissions.'
                : !value.accessibility || !value.screenCapture ? 'Mac controller permissions are required.'
                : value.macLocked ? 'The Mac must be unlocked.'
                : !value.windowPresent ? 'Open iPhone Mirroring with the physical phone locked.'
                : connectionBlocker ? connectionBlocker
                : 'Controller permissions are ready. Native posting flows still need calibration and receipts.'};
    } catch {
        const installed = await access(mirroringHelperPath()).then(()=>true,()=>false);
        return {installed, accessibility:false, screenCapture:false, windowPresent:false, macLocked:true,
            controlReady:false, protocolCurrent:false,publicationReady:false, reason:installed ? 'Open the standalone Phone Farm Mirroring controller.' : 'The Mac controller is not installed.'};
    }
}
