import { execFileSync } from 'node:child_process';

export function resolveDeveloperDir(): string {
    if (process.env.XCODE_DEVELOPER_DIR) return process.env.XCODE_DEVELOPER_DIR;
    try {
        return execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
    } catch {
        return '/Applications/Xcode.app/Contents/Developer';
    }
}
