import { CronExpressionParser } from 'cron-parser';

import type { ScheduleTiming } from '../types.js';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function cronFor(timing: Extract<ScheduleTiming, { kind: 'daily' | 'weekly' }>): string {
    if (!TIME_PATTERN.test(timing.localTime)) throw new Error('localTime must use HH:mm');
    const [hour, minute] = timing.localTime.split(':').map(Number);
    if (timing.kind === 'daily') return `${minute} ${hour} * * *`;
    const weekdays = [...new Set(timing.weekdays)].sort();
    if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new Error('weekly schedules require weekdays numbered 0 through 6');
    }
    return `${minute} ${hour} * * ${weekdays.join(',')}`;
}

function parseRecurring(timing: Extract<ScheduleTiming, { kind: 'daily' | 'weekly' }>, currentDate: Date) {
    try {
        return CronExpressionParser.parse(cronFor(timing), { currentDate, tz: timing.timezone });
    } catch (error) {
        throw new Error(`Invalid recurring schedule: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function validateTiming(timing: ScheduleTiming, now = new Date()): void {
    if (timing.kind === 'now') return;
    if (timing.kind === 'once') {
        const runAt = new Date(timing.runAt);
        if (!Number.isFinite(runAt.getTime())) throw new Error('runAt must be an ISO timestamp');
        if (runAt.getTime() < now.getTime() - 60_000) throw new Error('runAt cannot be in the past');
        return;
    }
    void parseRecurring(timing, now).next();
}

export function initialRunAt(timing: ScheduleTiming, now = new Date()): Date {
    if (timing.kind === 'now') return now;
    if (timing.kind === 'once') return new Date(timing.runAt);
    return parseRecurring(timing, new Date(now.getTime() - 1_000)).next().toDate();
}

export function latestDueOccurrence(
    timing: ScheduleTiming,
    storedNextRunAt: Date,
    now = new Date(),
): { scheduledFor: Date; nextRunAt: Date | null } | null {
    if (storedNextRunAt > now) return null;
    if (timing.kind === 'now' || timing.kind === 'once') {
        return { scheduledFor: storedNextRunAt, nextRunAt: null };
    }
    const latest = parseRecurring(timing, new Date(now.getTime() + 1_000)).prev().toDate();
    const next = parseRecurring(timing, now).next().toDate();
    return { scheduledFor: latest < storedNextRunAt ? storedNextRunAt : latest, nextRunAt: next };
}
