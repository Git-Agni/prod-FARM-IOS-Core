import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
export interface PhoneAudioStatus {
    ready: boolean;
    scope: 'iphone_mirroring_only';
    targetBundle?: string;
    audioRecorded?: false;
    masterVolumeChanged?: false;
    bindingVerified?: boolean;
    audibilityVerified?: boolean;
    muteArmed?: boolean;
    aggregateId?: number;
    physicalOutputDevices?: number;
    audioIOStarted?: boolean;
    targetProcessIds?: number[];
    tapId?: number;
    serviceGeneration?: string;
    silenceConfirmedAt?: string | null;
    verificationMethod?: 'coreaudio_process_muter' | 'owner_playback_report' | 'none';
    systemMuteVerifiedAt?: string | null;
    targetPIDs?: number[];
    reason: string;
}
export interface SilenceConfirmation {
    confirmation:'owner_confirmed_silent_playback';
    serviceGeneration:string;
    tapId:number;
    aggregateId:number;
    targetProcessIds:number[];
}
export const audioHelperPath = () => path.resolve('.mirroring/Phone Farm Audio Mute.app/Contents/MacOS/PhoneFarmAudioMute');
export function verifiedPhoneMute(value: unknown): value is PhoneAudioStatus {
    const status = value as Partial<PhoneAudioStatus> | null;
    return status?.ready === true && status.scope === 'iphone_mirroring_only'
        && status.targetBundle === 'com.apple.ScreenContinuity'
        && status.audioRecorded === false && status.masterVolumeChanged === false
        && status.bindingVerified === true && status.audibilityVerified === true
        && status.muteArmed === true && Number.isSafeInteger(status.aggregateId) && status.aggregateId! > 0
        && status.physicalOutputDevices === 0 && status.audioIOStarted === false
        && Array.isArray(status.targetProcessIds) && status.targetProcessIds.length > 0
        && status.targetProcessIds.every(id => Number.isSafeInteger(id) && id > 0)
        && new Set(status.targetProcessIds).size === status.targetProcessIds.length
        && (status.verificationMethod === 'owner_playback_report' && typeof status.silenceConfirmedAt === 'string'
            || status.verificationMethod === 'coreaudio_process_muter'
                && typeof status.systemMuteVerifiedAt === 'string' && Number.isFinite(Date.parse(status.systemMuteVerifiedAt))
                && typeof status.serviceGeneration === 'string' && /^[0-9a-f-]{36}$/i.test(status.serviceGeneration)
                && Array.isArray(status.targetPIDs) && status.targetPIDs.length === 1
                && Number.isSafeInteger(status.targetPIDs[0]) && status.targetPIDs[0]! > 0);
}
/** This validates route identity only. It does not claim the owner heard silence. */
export function silenceConfirmationMatches(value:unknown,status:PhoneAudioStatus):value is SilenceConfirmation {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const report=value as Partial<SilenceConfirmation>;
    return report.confirmation==='owner_confirmed_silent_playback'
        &&typeof status.serviceGeneration==='string'&&/^[0-9a-f-]{36}$/i.test(status.serviceGeneration)
        &&report.serviceGeneration===status.serviceGeneration
        &&status.scope==='iphone_mirroring_only'&&status.targetBundle==='com.apple.ScreenContinuity'
        &&status.audioRecorded===false&&status.masterVolumeChanged===false
        &&status.bindingVerified===true&&status.muteArmed===true
        &&status.physicalOutputDevices===0&&status.audioIOStarted===false
        &&Number.isSafeInteger(status.tapId)&&status.tapId!>0&&report.tapId===status.tapId
        &&Number.isSafeInteger(status.aggregateId)&&status.aggregateId!>0&&report.aggregateId===status.aggregateId
        &&Array.isArray(status.targetProcessIds)&&status.targetProcessIds.length>0
        &&status.targetProcessIds.every(id=>Number.isSafeInteger(id)&&id>0)
        &&Array.isArray(report.targetProcessIds)&&report.targetProcessIds.length===status.targetProcessIds.length
        &&new Set(report.targetProcessIds).size===report.targetProcessIds.length
        &&report.targetProcessIds.every(id=>status.targetProcessIds!.includes(id));
}
/** Record only an explicit owner's report after real Mirroring video playback. Never call from a simulated test. */
export async function recordOwnerSilenceCheck(report:unknown):Promise<PhoneAudioStatus> {
    const current=await phoneAudioStatus();
    if(!silenceConfirmationMatches(report,current))throw new Error('The mute session changed. Repeat the silence check before confirming.');
    const value:unknown=await new Promise((resolve,reject)=>{
        const child=spawn(audioHelperPath(),['confirm-silence'],{stdio:['pipe','pipe','pipe'],timeout:4000});
        const chunks:Buffer[]=[];let size=0;
        child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>8000)child.kill();else chunks.push(b);});
        child.stderr.resume();child.on('error',reject);
        child.on('close',code=>{
            try {const result=JSON.parse(Buffer.concat(chunks).toString());
                if(code!==0||result.error)throw new Error(result.error||'The mute helper rejected the silence report');
                resolve(result);
            } catch(error){reject(error);}
        });
        child.stdin.end(JSON.stringify(report));
    });
    if(!verifiedPhoneMute(value))throw new Error('The mute check was not accepted. Playback stays blocked.');
    return value;
}
/** Reads the mute helper. Does not start it, alter volume, capture audio or send phone input. */
export async function phoneAudioStatus(): Promise<PhoneAudioStatus> {
    try {
        const { stdout } = await run(audioHelperPath(), ['status'], { timeout: 4000, maxBuffer: 8000 });
        const value: unknown = JSON.parse(stdout);
        if (!verifiedPhoneMute(value)) {
            const diagnostic=value as Partial<PhoneAudioStatus>;
            if(diagnostic.scope==='iphone_mirroring_only'&&diagnostic.targetBundle==='com.apple.ScreenContinuity'
                &&diagnostic.audioRecorded===false&&diagnostic.masterVolumeChanged===false) {
                return {...diagnostic,ready:false,scope:'iphone_mirroring_only',
                    reason:'Phone audio mute is not verified. Keep playback stopped.'};
            }
            throw new Error('The phone audio mute is not verified');
        }
        return { ...value, reason: 'Phone audio is muted. Meeting audio is unchanged.' };
    } catch {
        return { ready: false, scope: 'iphone_mirroring_only', reason: 'Phone audio mute is not verified. Keep playback stopped.' };
    }
}
