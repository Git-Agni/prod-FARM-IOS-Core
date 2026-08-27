import { spawn, type SpawnOptions } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDeveloperDir } from './xcode-env.js';
import { resolveBuildTargets } from './target-device.js';

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required in .env`);
    }
    return value;
}

function run(command: string, args: string[], options: SpawnOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', ...options });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} failed (${signal ?? `exit ${code}`})`));
            }
        });
    });
}

const workspaceRoot = process.cwd();
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const driverPath = path.resolve(process.env.XCUITEST_DRIVER_PATH
    ?? '.appium2/node_modules/appium-xcuitest-driver');
const wdaRoot = path.join(driverPath, 'node_modules/appium-webdriveragent');
const projectPath = path.join(wdaRoot, 'WebDriverAgent.xcodeproj');
const touchCommandsPath = path.join(
    wdaRoot,
    'WebDriverAgentLib/Commands/FBTouchActionCommands.m',
);
const runnerInfoPlistPath = path.join(wdaRoot, 'WebDriverAgentRunner/Info.plist');
const customCommandsPath = path.join(wdaRoot, 'WebDriverAgentLib/Commands/FBCustomCommands.m');
const patchPath = path.join(
    packageRoot,
    'Patches/appium-webdriveragent-8.9.1-absolute-touch.patch',
);
const buttonsPatchPath = path.join(
    packageRoot,
    'Patches/appium-webdriveragent-8.9.1-sessionless-buttons.patch',
);

await Promise.all([
    access(projectPath), access(touchCommandsPath), access(runnerInfoPlistPath), access(customCommandsPath),
    access(patchPath), access(buttonsPatchPath),
]);
const touchCommands = await readFile(touchCommandsPath, 'utf8');
const runnerInfoPlist = await readFile(runnerInfoPlistPath, 'utf8');
if (touchCommands.includes('FBImportMedia') && runnerInfoPlist.includes('NSPhotoLibraryAddUsageDescription')) {
    console.log('WDA absolute-touch and Photos-import patch is already applied');
} else {
    await run('/usr/bin/patch', ['-p0', '-i', patchPath], { cwd: workspaceRoot });
    console.log('Applied WDA absolute-touch patch');
}
const customCommands = await readFile(customCommandsPath, 'utf8');
if (customCommands.includes('POST:@"/wda/pressButton"].withoutSession')) {
    console.log('WDA sessionless device-button patch is already applied');
} else {
    await run('/usr/bin/patch', ['-p0', '-i', buttonsPatchPath], { cwd: workspaceRoot });
    console.log('Applied WDA sessionless device-button patch');
}

const developerDir = resolveDeveloperDir();
const teamId = required('XCODE_ORG_ID');
const bundleId = required('WDA_BUNDLE_ID');

// `--udid <udid>`, or `--all` for every registered device, or the sole
// registered / connected device, or IOS_UDID. Xcode needs a concrete device
// for a signed device build.
const targets = await resolveBuildTargets();

for (const udid of targets) {
    if (targets.length > 1) console.log(`\n=== WebDriverAgent build for ${udid} ===`);
    await run('xcodebuild', [
        'build-for-testing',
        '-allowProvisioningUpdates',
        ...(process.env.ALLOW_PROVISIONING_DEVICE_REGISTRATION === 'true'
            ? ['-allowProvisioningDeviceRegistration']
            : []),
        '-project', projectPath,
        '-scheme', 'WebDriverAgentRunner',
        '-destination', `id=${udid}`,
        `IPHONEOS_DEPLOYMENT_TARGET=${process.env.IOS_PLATFORM_VERSION ?? '16.7'}`,
        `DEVELOPMENT_TEAM=${teamId}`,
        `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
        `CODE_SIGN_IDENTITY=${process.env.XCODE_SIGNING_ID ?? 'Apple Development'}`,
        'CODE_SIGN_STYLE=Automatic',
        'GCC_TREAT_WARNINGS_AS_ERRORS=0',
        'COMPILER_INDEX_STORE_ENABLE=NO',
    ], { env: { ...process.env, DEVELOPER_DIR: developerDir } });
}
