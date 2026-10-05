/**
 * Humanizer - makes automated interactions look human through random delays,
 * jittered coordinates, curved swipe trajectories, and natural typing patterns.
 *
 * All functions are pure and deterministic when seeded with a custom `random` function.
 * The default `random` is `Math.random`. Override for reproducible tests.
 *
 * Disable with environment variable: HUMANIZER=off
 */

export interface HumanizerConfig {
    enabled: boolean;
    delays: {
        maxMultiplier: number;
        jitterStdDev: number;
        minFloorMultiplier: number;
    };
    tap: {
        maxOffsetPx: number;
        durationMinMs: number;
        durationMaxMs: number;
    };
    swipe: {
        startJitterMaxPx: number;
        endJitterMaxPx: number;
        controlPointMaxDeviationPx: number;
        durationMinMs: number;
        durationMaxMs: number;
        steps: number;
    };
    typing: {
        keyDelayMinMs: number;
        keyDelayMaxMs: number;
        pauseChance: number;
        pauseMinMs: number;
        pauseMaxMs: number;
    };
}

function defaultConfig(): HumanizerConfig {
    return {
        enabled: true,
        delays: {
            maxMultiplier: 1.3,
            jitterStdDev: 0.15,
            minFloorMultiplier: 0.7,
        },
        tap: {
            maxOffsetPx: 6,
            durationMinMs: 60,
            durationMaxMs: 160,
        },
        swipe: {
            startJitterMaxPx: 4,
            endJitterMaxPx: 6,
            controlPointMaxDeviationPx: 8,
            durationMinMs: 400,
            durationMaxMs: 550,
            steps: 8,
        },
        typing: {
            keyDelayMinMs: 40,
            keyDelayMaxMs: 120,
            pauseChance: 0.08,
            pauseMinMs: 300,
            pauseMaxMs: 800,
        },
    };
}

function loadConfig(): HumanizerConfig {
    const config = defaultConfig();
    const envDisabled = process.env.HUMANIZER !== undefined
        && process.env.HUMANIZER.toLowerCase() === 'off';
    config.enabled = !envDisabled;
    return config;
}

let _config: HumanizerConfig | null = null;
let _configLoaded = false;

export function getConfig(): HumanizerConfig {
    if (!_configLoaded) {
        _config = loadConfig();
        _configLoaded = true;
    }
    return _config!;
}

export function resetConfig(): void {
    _config = null;
    _configLoaded = false;
}

export function setEnabled(enabled: boolean): void {
    const config = getConfig();
    config.enabled = enabled;
}

export function isEnabled(): boolean {
    return getConfig().enabled;
}

export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function gaussianRandom(random: () => number, mean: number, stddev: number): number {
    const u1 = Math.max(random(), 1e-12);
    const u2 = random();
    const mag = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + stddev * mag;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function clampToScreen(x: number, y: number, screenWidth: number, screenHeight: number): { x: number; y: number } {
    return {
        x: screenWidth === Number.POSITIVE_INFINITY ? Math.round(x) : clamp(Math.round(x), 0, screenWidth),
        y: screenHeight === Number.POSITIVE_INFINITY ? Math.round(y) : clamp(Math.round(y), 0, screenHeight),
    };
}

export function humanDelay(baseMs: number, random: () => number = Math.random): number {
    const config = getConfig();
    if (!config.enabled) return baseMs;

    const stdDev = baseMs * config.delays.jitterStdDev;
    let jittered = gaussianRandom(random, baseMs, stdDev);
    
    const minAllowed = baseMs * config.delays.minFloorMultiplier;
    jittered = Math.max(jittered, minAllowed);
    
    const maxAllowed = baseMs * config.delays.maxMultiplier;
    if (jittered > maxAllowed) {
        const range = maxAllowed - minAllowed;
        jittered = minAllowed + (random() * range);
    }
    
    return Math.round(jittered);
}

export interface JitteredTapPoint {
    x: number;
    y: number;
}

export function jitterTapPoint(
    targetX: number,
    targetY: number,
    screenWidth: number,
    screenHeight: number,
    random: () => number = Math.random,
    maxOffsetPx?: number,
): JitteredTapPoint {
    const config = getConfig();
    if (!config.enabled) return { x: Math.round(targetX), y: Math.round(targetY) };

    const maxOffset = maxOffsetPx ?? config.tap.maxOffsetPx;
    let offsetX = gaussianRandom(random, 0, maxOffset / 2);
    let offsetY = gaussianRandom(random, 0, maxOffset / 2);
    
    offsetX = clamp(offsetX, -maxOffset, maxOffset);
    offsetY = clamp(offsetY, -maxOffset, maxOffset);

    const x = targetX + offsetX;
    const y = targetY + offsetY;
    
    return clampToScreen(x, y, screenWidth, screenHeight);
}

export function pressDuration(random: () => number = Math.random): number {
    const config = getConfig();
    if (!config.enabled) return 100;

    return Math.round(
        config.tap.durationMinMs + random() * (config.tap.durationMaxMs - config.tap.durationMinMs)
    );
}

export interface BezierPoint {
    x: number;
    y: number;
}

export function bezierSwipePath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    screenWidth: number,
    screenHeight: number,
    random: () => number = Math.random,
    stepCount?: number,
): BezierPoint[] {
    const config = getConfig();
    if (!config.enabled) {
        return [
            clampToScreen(startX, startY, screenWidth, screenHeight),
            clampToScreen(endX, endY, screenWidth, screenHeight),
        ];
    }

    const steps = stepCount ?? config.swipe.steps;
    const startJitterMax = config.swipe.startJitterMaxPx;
    const endJitterMax = config.swipe.endJitterMaxPx;
    const controlDeviation = config.swipe.controlPointMaxDeviationPx;

    const actualStartX = startX + gaussianRandom(random, 0, startJitterMax / 2);
    const actualStartY = startY + gaussianRandom(random, 0, startJitterMax / 2);
    const actualEndX = endX + gaussianRandom(random, 0, endJitterMax / 2);
    const actualEndY = endY + gaussianRandom(random, 0, endJitterMax / 2);

    const deltaX = actualEndX - actualStartX;
    const deltaY = actualEndY - actualStartY;
    const controlX = actualStartX + deltaX * 0.5 + gaussianRandom(random, 0, controlDeviation / 2);
    const controlY = actualStartY + deltaY * 0.5 + gaussianRandom(random, 0, controlDeviation / 2);

    const path: BezierPoint[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const t1 = 1 - t;
        const x = t1 * t1 * actualStartX + 2 * t1 * t * controlX + t * t * actualEndX;
        const y = t1 * t1 * actualStartY + 2 * t1 * t * controlY + t * t * actualEndY;
        path.push(clampToScreen(x, y, screenWidth, screenHeight));
    }

    return path;
}

export function swipeDuration(random: () => number = Math.random): number {
    const config = getConfig();
    if (!config.enabled) return 450;

    return Math.round(
        config.swipe.durationMinMs + random() * (config.swipe.durationMaxMs - config.swipe.durationMinMs)
    );
}

export interface TypingStep {
    chunk: string;
    delayMs: number;
}

// Walk grapheme clusters so surrogate pairs, flags, and skin-tone sequences
// stay intact across /keys chunks. text[i] would split UTF-16 code units.
function graphemeClusters(text: string): string[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

function typingKeyDelay(config: HumanizerConfig, random: () => number): number {
    return Math.round(
        config.typing.keyDelayMinMs + random() * (config.typing.keyDelayMaxMs - config.typing.keyDelayMinMs)
    );
}

export function typingPlan(text: string, random: () => number = Math.random): TypingStep[] {
    const config = getConfig();
    if (!config.enabled || !text) return [];

    const units = graphemeClusters(text);
    const steps: TypingStep[] = [];
    let currentChunk = '';
    let currentUnits = 0;
    let targetChunkSize = Math.floor(random() * 6) + 1; // 1-6 graphemes, set once per chunk
    
    for (let i = 0; i < units.length; i++) {
        const char = units[i];
        const isSpace = char.trim() === '';
        const isLastChar = i === units.length - 1;
        
        // Spaces are always submitted as their own chunk
        if (isSpace) {
            if (currentChunk.length > 0) {
                // Submit the current non-space chunk first
                steps.push({ 
                    chunk: currentChunk, 
                    delayMs: steps.length === 0 ? 0 : typingKeyDelay(config, random),
                });
                currentChunk = '';
                currentUnits = 0;
            }
            // Add the space as its own chunk
            steps.push({ 
                chunk: char, 
                delayMs: steps.length === 0 ? 0 : typingKeyDelay(config, random),
            });
            targetChunkSize = Math.floor(random() * 6) + 1;
            continue;
        }
        
        currentChunk += char;
        currentUnits += 1;
        
        // Submit when last grapheme or when chunk reaches random target size
        if (isLastChar || currentUnits >= targetChunkSize) {
            // Random delay with occasional longer "thinking" pause
            let delay: number;
            if (random() < config.typing.pauseChance) {
                delay = Math.round(
                    config.typing.pauseMinMs + random() * (config.typing.pauseMaxMs - config.typing.pauseMinMs)
                );
            } else {
                delay = typingKeyDelay(config, random);
            }
            
            steps.push({ 
                chunk: currentChunk, 
                delayMs: steps.length === 0 ? 0 : delay 
            });
            
            currentChunk = '';
            currentUnits = 0;
            targetChunkSize = Math.floor(random() * 6) + 1;
        }
    }

    return steps;
}

export function easedProgress(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export interface SwipeSequence {
    path: BezierPoint[];
    durations: number[];
    totalDurationMs: number;
}

export function swipeSequence(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    screenWidth: number,
    screenHeight: number,
    random: () => number = Math.random,
): SwipeSequence {
    const path = bezierSwipePath(startX, startY, endX, endY, screenWidth, screenHeight, random);
    const totalDuration = swipeDuration(random);
    const count = path.length - 1;
    
    const durations: number[] = [];
    let remaining = totalDuration;
    for (let i = 0; i < count; i++) {
        const progress = i / count;
        const eased = easedProgress(progress);
        const baseShare = remaining / (count - i);
        const share = baseShare * (0.8 + eased * 0.4);
        durations.push(Math.round(share));
        remaining -= Math.round(share);
    }
    
    if (durations.length > 0 && remaining !== 0) {
        durations[durations.length - 1] += remaining;
    }

    return { path, durations, totalDurationMs: totalDuration };
}

export interface DelaySequence {
    delays: number[];
    totalMs: number;
}

export function delaySequence(baseDelays: number[], random: () => number = Math.random): DelaySequence {
    const config = getConfig();
    if (!config.enabled) {
        return { delays: [...baseDelays], totalMs: baseDelays.reduce((a, b) => a + b, 0) };
    }

    const delays = baseDelays.map((base) => humanDelay(base, random));
    return { delays, totalMs: delays.reduce((a, b) => a + b, 0) };
}
