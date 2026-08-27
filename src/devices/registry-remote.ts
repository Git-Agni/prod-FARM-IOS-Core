import { coordinatesForProfile } from './coordinates.js';
import { loadRegisteredDevices } from './registry.js';
import { WdaRemoteControl, type RemoteAction, type RemoteControl, type ScreenInfo } from './wda-remote.js';
import { passcodeForDevice } from './secrets.js';

export class RegistryWdaRemoteControl implements RemoteControl {
    private readonly controls = new Map<string, WdaRemoteControl>();

    async control(udid: string): Promise<WdaRemoteControl> {
        const cached = this.controls.get(udid);
        if (cached) return cached;
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device) return new WdaRemoteControl();
        const control = new WdaRemoteControl({
            deviceUdid: udid,
            passcode: device.passcode ?? await passcodeForDevice(udid),
            passcodeKeypadLayout: coordinatesForProfile(device.coordinateProfile).passcodeKeypad,
            wdaUrl: `http://127.0.0.1:${device.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100)}`,
            mjpegUrl: `http://127.0.0.1:${device.mjpegLocalPort ?? Number(process.env.MJPEG_LOCAL_PORT ?? 9100)}`,
        });
        this.controls.set(udid, control);
        return control;
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> { return (await this.control(udid)).getScreenInfo(udid); }
    async getScreenshot(udid: string): Promise<Buffer> { return (await this.control(udid)).getScreenshot(udid); }
    async getMjpegStream(udid: string): Promise<Response> { return (await this.control(udid)).getMjpegStream(udid); }
    async performAction(udid: string, action: RemoteAction): Promise<void> { return (await this.control(udid)).performAction(udid, action); }
    async isLocked(udid: string): Promise<boolean> { return (await this.control(udid)).isLocked(udid); }
}
