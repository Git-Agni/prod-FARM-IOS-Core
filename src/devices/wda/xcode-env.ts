export function resolveDeveloperDir(): string {
    return process.env.XCODE_DEVELOPER_DIR ?? '/Applications/Xcode_26.2.app/Contents/Developer';
}
