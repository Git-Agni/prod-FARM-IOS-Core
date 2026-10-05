import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'webdriverio';

import type { WdaRemoteControl } from '@git-agni/phone-farm-core';
import { findHandleMatch, pointFromWord, recognizeWords, type OcrWord } from './ocr.js';
import { isEnabled, jitterTapPoint, pressDuration, humanDelay } from './humanizer.js';

// Module-level cached screen size for clamping jittered taps.
// Set once per session after resolving device coordinates.
let cachedScreenSize: { width: number; height: number } | undefined;

export function setScreenSize(size: { width: number; height: number } | undefined): void {
    cachedScreenSize = size;
}

export interface TapCoordinateOptions {
    // When false, skip the Gaussian offset and tap the exact point.
    // Use for registration readiness checks and small targets (checkboxes, keyboard Back).
    jitter?: boolean;
}

export async function tapCoordinate(
    driver: Browser,
    x: number,
    y: number,
    label: string,
    options: TapCoordinateOptions = {},
): Promise<void> {
    if (isEnabled()) {
        const applyJitter = options.jitter !== false;
        const point = applyJitter
            ? (cachedScreenSize
                ? jitterTapPoint(x, y, cachedScreenSize.width, cachedScreenSize.height)
                : jitterTapPoint(x, y, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY))
            : { x: Math.round(x), y: Math.round(y) };
        const duration = pressDuration();
        
        await driver.performActions([{
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 50, x: point.x, y: point.y },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration },
                { type: 'pointerUp', button: 0 },
            ],
        }]);
        await driver.releaseActions();
        console.log(`Tapped ${label} at (${point.x}, ${point.y}) with ${duration}ms hold`);
    } else {
        await driver.performActions([{
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x, y },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 100 },
                { type: 'pointerUp', button: 0 },
            ],
        }]);
        await driver.releaseActions();
        console.log(`Tapped ${label} at (${x}, ${y})`);
    }
}

export interface AccountSwitchCoords {
    profileTabX: number;
    profileTabY: number;
    switcherTriggerX: number;
    switcherTriggerY: number;
}

function switcherIsOpen(words: OcrWord[]): boolean {
    return words.some((word) => word.text.trim().toLowerCase() === 'switch');
}

// Switches the open TikTok session to `targetHandle`. The switcher trigger
// tap is retried: a fresh app launch can show a transient tooltip over the
// profile header that swallows taps in that area (seen live, with
// different tooltip text each time — a dynamic OCR-located trigger tap was
// tried first and was NOT reliable enough to keep; this fixed,
// live-tap-calibrated coordinate plus retries is what held up under
// repeated real-device runs).
export async function switchTikTokAccount(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    targetHandle: string,
    coords: AccountSwitchCoords,
): Promise<void> {
    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab');
    // Longer than the other settle pauses here: a fresh app launch can pop
    // up a transient tooltip/announcement bubble over the profile header
    // (seen live — different text each time, e.g. "What's good?", a
    // "Whisper" feature prompt), and it needs time to appear and, in some
    // cases, auto-dismiss before it stops intercepting taps in that area.
    await driver.pause(isEnabled() ? humanDelay(2000) : 2000);

    const { scale } = await remote.getScreenInfo(udid);
    const profileWords = await recognizeWords(await remote.getScreenshot(udid));

    if (findHandleMatch(profileWords, targetHandle)) {
        console.log(`Already on TikTok account ${targetHandle}`);
        return;
    }

    const MAX_SWITCHER_OPEN_ATTEMPTS = 4;
    let switcherWords: OcrWord[] = [];
    let opened = false;
    for (let attempt = 1; attempt <= MAX_SWITCHER_OPEN_ATTEMPTS && !opened; attempt += 1) {
        await tapCoordinate(driver, coords.switcherTriggerX, coords.switcherTriggerY, `Account switcher (attempt ${attempt})`);
        await driver.pause(isEnabled() ? humanDelay(1500) : 1500);
        switcherWords = await recognizeWords(await remote.getScreenshot(udid));
        opened = switcherIsOpen(switcherWords);
    }
    if (!opened) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not open the TikTok account switcher after ${MAX_SWITCHER_OPEN_ATTEMPTS} attempts. OCR saw: ${seen}`);
    }

    const targetMatch = findHandleMatch(switcherWords, targetHandle);
    if (!targetMatch) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not find TikTok account "${targetHandle}" in the account switcher. OCR saw: ${seen}`);
    }
    const targetPoint = pointFromWord(targetMatch, scale);
    await tapCoordinate(driver, targetPoint.x, targetPoint.y, `Account row for ${targetHandle}`);
    // TikTok fully reloads app state after switching accounts.
    await driver.pause(isEnabled() ? humanDelay(4000) : 4000);

    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab (verify)');
    await driver.pause(isEnabled() ? humanDelay(1000) : 1000);

    const verifyWords = await recognizeWords(await remote.getScreenshot(udid));
    if (!findHandleMatch(verifyWords, targetHandle)) {
        const screenshotPath = path.resolve('.wda', `account-switch-failed-${udid}.png`);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, await remote.getScreenshot(udid));
        throw new Error(`Switched but could not confirm TikTok account "${targetHandle}" is active afterward. Screenshot saved to ${screenshotPath}`);
    }
    console.log(`Confirmed active TikTok account: ${targetHandle}`);
}
