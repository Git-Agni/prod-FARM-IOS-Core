import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStorySlot, storySchedule } from '../src/publishing/story-schedule.js';
test('Story slots use 8 AM and 4 PM Pacific across daylight saving changes', () => {
    assert.equal(nextStorySlot(new Date('2026-10-01T00:00:00Z')).toISOString(), '2026-10-01T15:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-11-01T00:00:00Z')).toISOString(), '2026-11-01T16:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-10-01T15:00:00Z')).toISOString(), '2026-10-01T23:00:00.000Z');
    assert.equal(nextStorySlot(new Date('2026-11-01T16:00:00Z')).toISOString(), '2026-11-02T00:00:00.000Z');
    assert.equal(storySchedule.publicationEnabled, false);
});

import { upcomingStorySlots, storyWorkerHealth } from '../src/publishing/story-schedule.js';
test('planning window has a week of unique future slots across DST', () => {
    assert.deepEqual(upcomingStorySlots(new Date('2026-10-31T17:00:00Z')).map(d=>d.toISOString()).slice(0, 6), ['2026-10-31T23:00:00.000Z','2026-11-01T16:00:00.000Z','2026-11-02T00:00:00.000Z','2026-11-02T16:00:00.000Z','2026-11-03T00:00:00.000Z','2026-11-03T16:00:00.000Z']);
});
test('a stored future slot cannot stand in for a worker heartbeat', () => {
    const now = new Date('2026-10-01T22:00:00Z');
    assert.equal(storyWorkerHealth(null, now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()-121000), now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()+1000), now).healthy, false);
    assert.equal(storyWorkerHealth(new Date(now.getTime()-30000), now).healthy, true);
});

test('a week of slots is two a day for seven days', () => {
    assert.equal(upcomingStorySlots(new Date('2026-10-31T17:00:00Z')).length, 14);
});
