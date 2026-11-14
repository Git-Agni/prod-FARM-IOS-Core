export interface NativeDriverStatus { ready: boolean; serviceReady: boolean; unlocked: boolean; reason: string }
/** A supervisor error explains an offline driver. It cannot prove an unlocked phone. */
export function withSupervisorReason(native: NativeDriverStatus, supervisor?: {wda:string;message:string}) {
    if (native.serviceReady || !supervisor || !['error','disconnected','unlock-required'].includes(supervisor.wda) || !supervisor.message.trim()) return native;
    return {...native, reason:supervisor.message};
}
/** Both checks are read-only. A live WDA server can still be attached to a locked phone. */
export async function nativeDriverStatus(base: string, signal: AbortSignal): Promise<NativeDriverStatus> {
    let serviceReady = false;
    try {
        const response = await fetch(base + '/status', { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
        if (!response.ok) throw new Error('Phone control is unavailable.');
        const body = await response.json() as { value?: { ready?: boolean; error?: string } };
        serviceReady = body.value?.ready === true && !body.value.error;
        if (!serviceReady) throw new Error('Phone control is unavailable.');
        const lockedResponse = await fetch(base + '/wda/locked', { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
        if (!lockedResponse.ok) throw new Error('Could not verify whether the iPhone is unlocked.');
        const locked = (await lockedResponse.json() as {value?: unknown}).value;
        if (locked !== true && locked !== false) throw new Error('Could not verify whether the iPhone is unlocked.');
        return {ready:!locked,serviceReady,unlocked:!locked,reason:locked?'Unlock the iPhone to allow posting.':'The iPhone is connected and unlocked.'};
    } catch (error) {
        return {ready:false,serviceReady,unlocked:false,reason:serviceReady?'Could not verify whether the iPhone is unlocked.':'Phone control is unavailable.'};
    }
}
/** Offline or locked phones keep their unclaimed releases armed. */
export async function nativeDriverReady(base: string, signal: AbortSignal): Promise<boolean> {
    return (await nativeDriverStatus(base, signal)).ready;
}
