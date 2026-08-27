import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const defaultSecretsPath = path.resolve('.env.devices');

export function passcodeEnvironmentKey(udid: string): string {
    return `IOS_PASSCODE_${udid.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function passcodeForDevice(udid: string, { allowLegacyFallback = true }: { allowLegacyFallback?: boolean } = {}): string | undefined {
    return process.env[passcodeEnvironmentKey(udid)] ?? (allowLegacyFallback ? process.env.IOS_PASSCODE : undefined);
}

function parseEnvironment(raw: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of raw.split(/\r?\n/)) {
        if (!line || line.trimStart().startsWith('#')) continue;
        const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
        if (match) values.set(match[1]!, match[2]!);
    }
    return values;
}

export async function saveDevicePasscode(
    udid: string,
    passcode: string,
    secretsPath: string = process.env.DEVICE_SECRETS_PATH ?? defaultSecretsPath,
): Promise<void> {
    if (!/^\d{4,}$/.test(passcode)) throw new Error('Device passcode must contain at least four digits');
    let raw = '';
    try {
        raw = await readFile(secretsPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const values = parseEnvironment(raw);
    values.set(passcodeEnvironmentKey(udid), passcode);
    const content = `${Array.from(values, ([key, value]) => `${key}=${value}`).join('\n')}\n`;
    await mkdir(path.dirname(secretsPath), { recursive: true });
    const temporaryPath = `${secretsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, secretsPath);
    process.env[passcodeEnvironmentKey(udid)] = passcode;
}
