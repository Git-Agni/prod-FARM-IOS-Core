export function diagnoseWdaLaunchFailure(output: string): string | undefined {
    if (/Developer Mode.*disabled|enable Developer Mode|requires Developer Mode/i.test(output)) {
        return 'Enable Developer Mode in Settings > Privacy & Security, restart the device, then confirm Enable after it restarts';
    }
    if (/not paired|pairing.*failed|trust.*computer|InvalidHostID/i.test(output)) {
        return 'Unlock the device, reconnect USB, and accept Trust This Computer on both the Mac and device';
    }
    if (/invalid code signature|profile has not been explicitly trusted by the user/i.test(output)) {
        return 'Trust the WebDriverAgent developer profile in iPhone Settings > General > VPN & Device Management';
    }
    if (/Unlock .+ to Continue|device is locked/i.test(output)) {
        return 'Unlock the phone to continue starting WDA';
    }
    if (/license agreement|requires that you accept/i.test(output)) {
        return 'Accept the current Apple developer license agreement, then retry WDA preparation';
    }
    if (/No profiles for|provisioning profile|does not include the selected device/i.test(output)) {
        return 'Register this device with the configured Apple Developer team and refresh the WDA provisioning profile';
    }
    if (/No signing certificate|signing certificate.*not found|requires a development team/i.test(output)) {
        return 'Sign in under Xcode Settings > Accounts and install an Apple Development signing certificate';
    }
    if (/iOS .* is not installed|platform.*not installed|Ineligible destinations/i.test(output)) {
        return 'Install the matching iOS platform support from Xcode Settings > Components';
    }
    if (/Executable Path is a Directory|Failed to install or launch the test runner/i.test(output)) {
        return 'WDA build is stale or was corrupted by a concurrent build/launch — run `npm run wda:prepare` again '
            + '(delete the WebDriverAgentRunner DerivedData folder first if it keeps producing an empty .app)';
    }
    return;
}

export function wdaUnavailableTooLong({
    now,
    launchedAt,
    lastReadyAt,
    timeoutMs,
}: {
    now: number;
    launchedAt: number;
    lastReadyAt?: number;
    timeoutMs: number;
}): boolean {
    return now - (lastReadyAt ?? launchedAt) > timeoutMs;
}
