import { coordinatesForProfile } from './coordinates.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ScreenSize {
    width: number;
    height: number;
}

export interface ScreenInfo {
    screenSize: ScreenSize;
    scale: number;
    statusBarSize?: ScreenSize;
}

export type RemoteAction =
    | { type: 'tap'; x: number; y: number }
    | { type: 'home' }
    | { type: 'lock' }
    | { type: 'wake' }
    | { type: 'unlock' }
    | { type: 'volumeUp' }
    | { type: 'volumeDown' }
    | {
        type: 'swipe';
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        durationMs: number;
    };

export interface PasscodeKeypadLayout {
    // x for columns [1,4,7/0], [2,5,8], [3,6,9]
    columnX: [number, number, number];
    // y for rows [1,2,3], [4,5,6], [7,8,9], [0]
    rowY: [number, number, number, number];
}

// Standard iOS numeric keypad: 1-9 in a 3x3 grid, 0 centered beneath it.
// Row spacing may vary by device profile, so rows are stored explicitly.
export function passcodeDigitPoint(digit: number, layout: PasscodeKeypadLayout): { x: number; y: number } {
    if (digit === 0) {
        return { x: layout.columnX[1], y: layout.rowY[3] };
    }
    const index = digit - 1;
    return {
        x: layout.columnX[index % 3],
        y: layout.rowY[Math.floor(index / 3)],
    };
}

interface WdaPayload<T> {
    value: T;
}

interface W3cActionItem {
    type: 'pointerMove' | 'pointerDown' | 'pointerUp' | 'pause';
    duration?: number;
    x?: number;
    y?: number;
    origin?: 'viewport';
    button?: number;
}

interface W3cPointerSource {
    type: 'pointer';
    id: string;
    parameters: { pointerType: 'touch' };
    actions: W3cActionItem[];
}

export interface RemoteControl {
    getScreenInfo(udid: string): Promise<ScreenInfo>;
    getScreenshot(udid: string): Promise<Buffer>;
    getMjpegStream(udid: string): Promise<Response>;
    performAction(udid: string, action: RemoteAction): Promise<void>;
    isLocked(udid: string): Promise<boolean>;
    /** Drop any cached client for this device so its next use re-reads devices.json. */
    forget?(udid: string): void;
}

export class RemoteDeviceError extends Error {}

export class WdaRemoteControl {
    readonly wdaUrl: string;
    readonly mjpegUrl: string;
    readonly deviceUdid: string | undefined;
    readonly fetch: typeof fetch;
    readonly timeoutMs: number;
    readonly passcode: string | undefined;
    readonly passcodeKeypadLayout: PasscodeKeypadLayout;
    private cachedScreenInfo: ScreenInfo | undefined;

    constructor({
        wdaUrl = process.env.WDA_URL ?? 'http://127.0.0.1:8100',
        mjpegUrl = process.env.MJPEG_URL ?? 'http://127.0.0.1:9100',
        deviceUdid = process.env.IOS_UDID,
        fetchImpl = fetch,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        passcode = process.env.IOS_PASSCODE,
        passcodeKeypadLayout = coordinatesForProfile().passcodeKeypad,
    }: {
        wdaUrl?: string;
        mjpegUrl?: string;
        deviceUdid?: string;
        fetchImpl?: typeof fetch;
        timeoutMs?: number;
        passcode?: string;
        passcodeKeypadLayout?: PasscodeKeypadLayout;
    } = {}) {
        this.wdaUrl = wdaUrl.replace(/\/$/, '');
        this.mjpegUrl = mjpegUrl.replace(/\/$/, '');
        this.deviceUdid = deviceUdid;
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.passcode = passcode;
        this.passcodeKeypadLayout = passcodeKeypadLayout;
    }

    assertTarget(udid: string): void {
        if (!this.deviceUdid || udid !== this.deviceUdid) {
            throw new RemoteDeviceError('Remote control is not configured for this device');
        }
    }

    async request(pathname: string, options: RequestInit = {}): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetch(`${this.wdaUrl}${pathname}`, {
                ...options,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            throw new RemoteDeviceError(`WebDriverAgent is unavailable: ${errorMessage(error)}`);
        }
        if (!response.ok) {
            const detail = await response.text();
            throw new RemoteDeviceError(`WebDriverAgent returned ${response.status}${detail ? `: ${detail}` : ''}`);
        }
        return response;
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> {
        this.assertTarget(udid);
        const response = await this.request('/wda/screen');
        const payload = await response.json() as WdaPayload<ScreenInfo>;
        this.cachedScreenInfo = payload.value;
        return payload.value;
    }

    async getScreenshot(udid: string): Promise<Buffer> {
        this.assertTarget(udid);
        const response = await this.request('/screenshot');
        const payload = await response.json() as WdaPayload<unknown>;
        if (typeof payload.value !== 'string') {
            throw new RemoteDeviceError('WebDriverAgent returned an invalid screenshot');
        }
        return Buffer.from(payload.value, 'base64');
    }

    async getMjpegStream(udid: string): Promise<Response> {
        this.assertTarget(udid);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
            response = await this.fetch(`${this.mjpegUrl}/`, { signal: controller.signal });
        } catch (error) {
            throw new RemoteDeviceError(`WDA video stream is unavailable: ${errorMessage(error)}`);
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok || !response.body) {
            throw new RemoteDeviceError(`WDA video stream returned ${response.status}`);
        }
        return response;
    }

    async isLocked(udid: string): Promise<boolean> {
        this.assertTarget(udid);
        const response = await this.request('/wda/locked');
        const payload = await response.json() as WdaPayload<boolean>;
        return payload.value;
    }

    async unlock(udid: string): Promise<void> {
        this.assertTarget(udid);
        if (!(await this.isLocked(udid))) return;
        if (!this.passcode) {
            throw new RemoteDeviceError('IOS_PASSCODE is not configured; cannot unlock the device');
        }
        // WDA's /wda/unlock presses Home twice, which wakes the screen and
        // surfaces the passcode keypad, but it then waits for the screen to
        // report unlocked and errors out because a passcode is still required.
        // That's expected here — the keypad is up, so ignore the error and
        // move on to entering the passcode.
        try {
            await this.request('/wda/unlock', { method: 'POST' });
        } catch {
            // ignore — see comment above
        }
        for (const character of this.passcode) {
            const digit = Number(character);
            if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
                throw new RemoteDeviceError('IOS_PASSCODE must contain only digits');
            }
            const { x, y } = passcodeDigitPoint(digit, this.passcodeKeypadLayout);
            await this.request('/wda/absolute-actions', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ actions: tapActions({ type: 'tap', x, y }) }),
            });
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (await this.isLocked(udid)) {
            throw new RemoteDeviceError('Device is still locked after entering the passcode');
        }
    }

    async performAction(udid: string, action: RemoteAction): Promise<void> {
        this.assertTarget(udid);
        if (action.type === 'home') {
            await this.request('/wda/homescreen', { method: 'POST' });
            return;
        }
        if (action.type === 'unlock') {
            await this.unlock(udid);
            return;
        }
        if (action.type === 'lock' || action.type === 'wake') {
            await this.request(action.type === 'lock' ? '/wda/lock' : '/wda/unlock', { method: 'POST' });
            return;
        }
        if (action.type === 'volumeUp' || action.type === 'volumeDown') {
            await this.request('/wda/pressButton', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: action.type === 'volumeUp' ? 'volumeup' : 'volumedown' }),
            });
            return;
        }
        // Screen size is static hardware info — reuse the cached value from a
        // prior getScreenInfo() call instead of paying a full WDA round trip
        // just to validate coordinates on every single tap/swipe.
        const screen = this.cachedScreenInfo ?? await this.getScreenInfo(udid);
        validateAction(action, screen.screenSize);
        const actions = action.type === 'tap' ? tapActions(action) : swipeActions(action);
        await this.request('/wda/absolute-actions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ actions }),
        });
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validatePoint(x: number, y: number, { width, height }: ScreenSize): boolean {
    return Number.isFinite(x) && Number.isFinite(y)
        && x >= 0 && x <= width && y >= 0 && y <= height;
}

function validateAction(action: RemoteAction, screenSize: ScreenSize): void {
    if (action.type !== 'tap' && action.type !== 'swipe') return;
    const valid = action.type === 'tap'
        ? validatePoint(action.x, action.y, screenSize)
        : validatePoint(action.startX, action.startY, screenSize)
            && validatePoint(action.endX, action.endY, screenSize);
    if (!valid) {
        throw new RemoteDeviceError('Touch coordinates are outside the device screen');
    }
}

function pointerSource(actions: W3cActionItem[]): W3cPointerSource[] {
    return [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions,
    }];
}

function tapActions({ x, y }: Extract<RemoteAction, { type: 'tap' }>): W3cPointerSource[] {
    return pointerSource([
        { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 80 },
        { type: 'pointerUp', button: 0 },
    ]);
}

function swipeActions({
    startX, startY, endX, endY, durationMs,
}: Extract<RemoteAction, { type: 'swipe' }>): W3cPointerSource[] {
    return pointerSource([
        { type: 'pointerMove', duration: 0, x: startX, y: startY, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: durationMs, x: endX, y: endY, origin: 'viewport' },
        { type: 'pointerUp', button: 0 },
    ]);
}
