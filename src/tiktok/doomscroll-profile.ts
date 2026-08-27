export type Personality = 'skimmer' | 'casual' | 'engaged';

export interface ProfileConfig {
    watchMinMs: number;
    watchMaxMs: number;
    likeChance: number;
    saveChance: number;
    lingerChance: number;
    lingerMinMs: number;
    lingerMaxMs: number;
}

export const PROFILES: Record<Personality, ProfileConfig> = {
    skimmer: {
        watchMinMs: 1500, watchMaxMs: 4000,
        likeChance: 0.08, saveChance: 0.02,
        lingerChance: 0.05, lingerMinMs: 4000, lingerMaxMs: 8000,
    },
    casual: {
        watchMinMs: 4000, watchMaxMs: 9000,
        likeChance: 0.18, saveChance: 0.06,
        lingerChance: 0.10, lingerMinMs: 8000, lingerMaxMs: 15000,
    },
    engaged: {
        watchMinMs: 8000, watchMaxMs: 18000,
        likeChance: 0.35, saveChance: 0.15,
        lingerChance: 0.20, lingerMinMs: 15000, lingerMaxMs: 30000,
    },
};

export function isPersonality(value: string): value is Personality {
    return value === 'skimmer' || value === 'casual' || value === 'engaged';
}

function between(min: number, max: number, random: () => number): number {
    return Math.round(min + random() * (max - min));
}

export function pickWatchDurationMs(profile: ProfileConfig, random: () => number = Math.random): number {
    return between(profile.watchMinMs, profile.watchMaxMs, random);
}

export interface LingerDecision {
    linger: boolean;
    extraMs: number;
}

// Consumes one random() draw against lingerChance, and — only when lingering —
// a second draw to size the extra wait. Callers that need a fixed random-call
// count regardless of outcome should not rely on this function.
export function decideLinger(profile: ProfileConfig, random: () => number = Math.random): LingerDecision {
    const linger = random() < profile.lingerChance;
    return { linger, extraMs: linger ? between(profile.lingerMinMs, profile.lingerMaxMs, random) : 0 };
}

export function decideLike(profile: ProfileConfig, random: () => number = Math.random): boolean {
    return random() < profile.likeChance;
}

export function decideSave(profile: ProfileConfig, random: () => number = Math.random): boolean {
    return random() < profile.saveChance;
}

export function clampToDeadline(nowMs: number, deadlineMs: number, desiredMs: number): number {
    return Math.max(0, Math.min(desiredMs, deadlineMs - nowMs));
}

export function hasTimeRemaining(nowMs: number, deadlineMs: number): boolean {
    return nowMs < deadlineMs;
}
