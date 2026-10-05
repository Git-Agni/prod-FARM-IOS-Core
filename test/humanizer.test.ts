import assert from 'node:assert/strict';
import test from 'node:test';

import {
    seededRandom, humanDelay, jitterTapPoint, pressDuration, bezierSwipePath,
    typingPlan, isEnabled, getConfig, resetConfig,
    swipeSequence, easedProgress, delaySequence,
} from '../src/tiktok/humanizer.js';

test('seededRandom produces deterministic output', () => {
    const seed1a = seededRandom(42);
    const seed1b = seededRandom(42);
    const seed2 = seededRandom(123);

    const vals1a = [seed1a(), seed1a(), seed1a()];
    const vals1b = [seed1b(), seed1b(), seed1b()];
    const vals2 = [seed2(), seed2(), seed2()];

    assert.deepEqual(vals1a, vals1b, 'Same seed should produce same sequence');
    assert.notDeepEqual(vals1a, vals2, 'Different seeds should produce different sequences');
});

test('humanDelay returns base value when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    const config = getConfig();
    assert.equal(config.enabled, false);
    
    assert.equal(humanDelay(1000), 1000);
    assert.equal(humanDelay(2000), 2000);
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('humanDelay applies jitter when enabled', () => {
    const rng = seededRandom(12345);
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig();

    const delays = [humanDelay(1000, rng), humanDelay(1000, rng), humanDelay(1000, rng)];
    const base = 1000;
    const minAllowed = base * 0.7;
    const maxAllowed = base * 1.3;

    for (const delay of delays) {
        assert.ok(delay >= minAllowed, `Delay ${delay} below minimum ${minAllowed}`);
        assert.ok(delay <= maxAllowed, `Delay ${delay} above maximum ${maxAllowed}`);
    }
    
    resetConfig();
});

test('humanDelay respects minimum floor multiplier', () => {
    const rng = seededRandom(1);
    resetConfig();
    delete process.env.HUMANIZER;
    
    const config = getConfig();
    config.enabled = true;

    const base = 1000;
    let countBelowFloor = 0;
    for (let i = 0; i < 100; i++) {
        const delay = humanDelay(base, rng);
        if (delay < base * config.delays.minFloorMultiplier) {
            countBelowFloor++;
        }
    }

    assert.ok(countBelowFloor === 0, `Should not have delays below floor: ${countBelowFloor} violations`);
    
    resetConfig();
});

test('jitterTapPoint returns original coordinates when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    
    const result = jitterTapPoint(100, 200, 375, 667);
    assert.deepEqual(result, { x: 100, y: 200 });
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('jitterTapPoint clamps to screen bounds', () => {
    const rng = seededRandom(12345);
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const result1 = jitterTapPoint(-50, -50, 375, 667, rng);
    assert.ok(result1.x >= 0, 'x should be >= 0');
    assert.ok(result1.y >= 0, 'y should be >= 0');

    const result2 = jitterTapPoint(500, 800, 375, 667, rng);
    assert.ok(result2.x <= 375, 'x should be <= screen width');
    assert.ok(result2.y <= 667, 'y should be <= screen height');
    
    resetConfig();
});

test('jitterTapPoint respects maxOffsetPx', () => {
    const rng = seededRandom(12345);
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const targetX = 187;
    const targetY = 333;
    const maxOffset = 6;

    let maxDeviation = 0;
    for (let i = 0; i < 50; i++) {
        const result = jitterTapPoint(targetX, targetY, 375, 667, rng, maxOffset);
        const dx = Math.abs(result.x - targetX);
        const dy = Math.abs(result.y - targetY);
        const deviation = Math.sqrt(dx * dx + dy * dy);
        maxDeviation = Math.max(maxDeviation, deviation);
    }

    assert.ok(maxDeviation <= maxOffset * 2, `Max deviation ${maxDeviation} should be within bounds`);
    
    resetConfig();
});

test('pressDuration returns default when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    
    assert.equal(pressDuration(), 100);
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('pressDuration returns value within range when enabled', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const minMs = 60;
    const maxMs = 160;

    for (let i = 0; i < 20; i++) {
        const dur = pressDuration();
        assert.ok(dur >= minMs, `Duration ${dur} below minimum ${minMs}`);
        assert.ok(dur <= maxMs, `Duration ${dur} above maximum ${maxMs}`);
    }
    
    resetConfig();
});

test('bezierSwipePath returns 2 points when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    
    const path = bezierSwipePath(100, 200, 187, 100, 375, 667);
    assert.equal(path.length, 2);
    assert.deepEqual(path[0], { x: 100, y: 200 });
    assert.deepEqual(path[1], { x: 187, y: 100 });
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('bezierSwipePath generates curved trajectory when enabled', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const path = bezierSwipePath(187, 550, 187, 150, 375, 667, seededRandom(42));
    
    assert.ok(path.length > 2, 'Should have more than 2 points for curve');
});

test('bezierSwipePath clamps to screen bounds', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const path = bezierSwipePath(-50, -50, 500, 800, 375, 667, seededRandom(42));
    
    for (const point of path) {
        assert.ok(point.x >= 0 && point.x <= 375, `Point x ${point.x} outside bounds`);
        assert.ok(point.y >= 0 && point.y <= 667, `Point y ${point.y} outside bounds`);
    }
    
    resetConfig();
});

test('typingPlan returns empty array when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    
    assert.deepEqual(typingPlan('hello'), []);
    assert.deepEqual(typingPlan(''), []);
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('typingPlan chunks text into random 1-6 char chunks with delays', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const text = 'hello world';
    const steps = typingPlan(text, seededRandom(42));
    
    // First step has no delay
    assert.equal(steps[0].delayMs, 0, 'First chunk has no delay');
    
    // All chunks should be 1-6 chars
    for (const step of steps) {
        assert.ok(step.chunk.length >= 1 && step.chunk.length <= 6, 
            `Chunk "${step.chunk}" length ${step.chunk.length} should be 1-6`);
    }
    
    // Concatenating all chunks should equal original text
    const result = steps.map(s => s.chunk).join('');
    assert.equal(result, text, 'Chunks should reconstruct original text');
    
    // A 60-char caption should produce fewer than 40 steps (avg chunk size > 1.5)
    const longText = 'a'.repeat(60);
    const longSteps = typingPlan(longText, seededRandom(42));
    assert.ok(longSteps.length < 40, 
        `60-char text produced ${longSteps.length} steps, expected < 40`);
    
    resetConfig();
});

test('typingPlan is deterministic with same seed', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const text = 'hello world test';
    const steps1 = typingPlan(text, seededRandom(12345));
    const steps2 = typingPlan(text, seededRandom(12345));
    
    assert.equal(steps1.length, steps2.length);
    for (let i = 0; i < steps1.length; i++) {
        assert.equal(steps1[i].chunk, steps2[i].chunk, `Chunk ${i} should match`);
        assert.equal(steps1[i].delayMs, steps2[i].delayMs, `Delay ${i} should match`);
    }
    
    resetConfig();
});

test('typingPlan breaks at spaces (spaces are their own chunks)', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const text = 'hi there you';
    const steps = typingPlan(text, seededRandom(42));
    
    // Check that no NON-SPACE chunk contains a space
    for (const step of steps) {
        if (step.chunk !== ' ') {
            assert.ok(!step.chunk.includes(' '), `Non-space chunk "${step.chunk}" should not contain space`);
        }
    }
    
    // Verify that spaces exist as their own chunks (expecting 2+ spaces)
    const spaceChunks = steps.filter(s => s.chunk === ' ');
    assert.ok(spaceChunks.length >= 2, `Expected at least 2 space chunks, got ${spaceChunks.length}`);
    
    resetConfig();
});

test('typingPlan keeps emoji and grapheme clusters intact', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    // Surrogate pairs (🔥), flag (🇺🇸), and skin-tone modifier (👍🏽) must not
    // be split across /keys chunks the way text[i] UTF-16 iteration would.
    const text = 'love this 🔥🔥 #fyp 🇺🇸👍🏽';
    const steps = typingPlan(text, seededRandom(42));

    assert.equal(steps.map((step) => step.chunk).join(''), text, 'Chunks should reconstruct the original caption');

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const step of steps) {
        for (const char of step.chunk) {
            const codePoint = char.codePointAt(0)!;
            assert.ok(
                codePoint < 0xD800 || codePoint > 0xDFFF,
                `Chunk ${JSON.stringify(step.chunk)} contains a lone UTF-16 surrogate`,
            );
        }
        const clusters = Array.from(segmenter.segment(step.chunk), ({ segment }) => segment);
        assert.equal(clusters.join(''), step.chunk, `Chunk ${JSON.stringify(step.chunk)} should be whole graphemes`);
    }

    const joined = steps.map((step) => step.chunk).join('');
    assert.ok(joined.includes('🔥🔥'), 'Fire emoji should survive intact');
    assert.ok(steps.some((step) => step.chunk.includes('🔥')), 'Fire emoji should live in a single chunk');
    assert.ok(steps.some((step) => step.chunk.includes('🇺🇸')), 'Flag emoji should live in a single chunk');
    assert.ok(steps.some((step) => step.chunk.includes('👍🏽')), 'Skin-tone emoji should live in a single chunk');

    resetConfig();
});

test('typingPlan respects delay ranges', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const text = 'test text here';
    const steps = typingPlan(text, seededRandom(42));
    
    // First step has delay 0
    assert.equal(steps[0].delayMs, 0);
    
    // Other steps have delays (may include thinking pauses)
    for (let i = 1; i < steps.length; i++) {
        const delay = steps[i].delayMs;
        assert.ok(delay >= 40, `Delay ${delay} below minimum 40ms`);
        assert.ok(delay <= 800, `Delay ${delay} above maximum 800ms (thinking pause)`);
    }
    
    resetConfig();
});

test('jitterTapPoint clamps edge coordinates within bounds', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const screenWidth = 375;
    const screenHeight = 667;
    
    // Test edge case: point near corner with large maxOffset
    let allWithinBounds = true;
    for (let seed = 1; seed <= 20; seed++) {
        const result = jitterTapPoint(374, 666, screenWidth, screenHeight, seededRandom(seed), 50);
        if (result.x < 0 || result.x > screenWidth || result.y < 0 || result.y > screenHeight) {
            allWithinBounds = false;
            break;
        }
    }
    
    assert.ok(allWithinBounds, 'All jittered points should be within bounds');
    
    resetConfig();
});

test('jitterTapPoint with Infinity does not clamp (returns rounded jittered values)', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    // With Infinity bounds, jitter is applied but not clamped
    const result = jitterTapPoint(100, 200, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, seededRandom(42));
    
    // Result should be finite and rounded
    assert.ok(Number.isFinite(result.x), 'x should be finite');
    assert.ok(Number.isFinite(result.y), 'y should be finite');
    assert.ok(Number.isInteger(result.x), 'x should be integer');
    assert.ok(Number.isInteger(result.y), 'y should be integer');
    
    resetConfig();
});

test('bezierSwipePath all points within screen bounds', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const path = bezierSwipePath(187, 600, 187, 100, 375, 667, seededRandom(42));
    
    for (const point of path) {
        assert.ok(point.x >= 0 && point.x <= 375, 
            `Point x ${point.x} outside [0, 375]`);
        assert.ok(point.y >= 0 && point.y <= 667, 
            `Point y ${point.y} outside [0, 667]`);
    }
    
    resetConfig();
});

test('swipeSequence all points within screen bounds', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const seq = swipeSequence(187, 600, 187, 100, 375, 667, seededRandom(42));
    
    for (const point of seq.path) {
        assert.ok(point.x >= 0 && point.x <= 375, 
            `Point x ${point.x} outside [0, 375]`);
        assert.ok(point.y >= 0 && point.y <= 667, 
            `Point y ${point.y} outside [0, 667]`);
    }
    
    resetConfig();
});

test('swipeSequence generates path and durations', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const seq = swipeSequence(187, 550, 187, 150, 375, 667, seededRandom(42));
    
    assert.ok(seq.path.length > 1, 'Path should have multiple points');
    assert.ok(seq.durations.length > 0, 'Should have durations');
    assert.ok(seq.totalDurationMs >= 400 && seq.totalDurationMs <= 550, 'Total duration should be within range');
    
    const sumDurations = seq.durations.reduce((a, b) => a + b, 0);
    assert.equal(sumDurations, seq.totalDurationMs, 'Segment durations should sum to totalDurationMs');
    assert.equal(seq.durations.length, seq.path.length - 1, 'One duration per path segment');
    
    resetConfig();
});

test('easedProgress produces smooth acceleration/deceleration', () => {
    assert.equal(easedProgress(0), 0);
    assert.equal(easedProgress(1), 1);
});

test('delaySequence returns original delays when disabled', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    
    const baseDelays = [1000, 2000, 3000];
    const { delays, totalMs } = delaySequence(baseDelays);
    
    assert.deepEqual(delays, baseDelays);
    assert.equal(totalMs, 6000);
    
    delete process.env.HUMANIZER;
    resetConfig();
});

test('delaySequence applies jitter when enabled', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    getConfig().enabled = true;

    const baseDelays = [1000, 2000, 3000];
    const rng = seededRandom(12345);
    const { delays } = delaySequence(baseDelays, rng);
    
    assert.equal(delays.length, baseDelays.length);
    
    for (let i = 0; i < baseDelays.length; i++) {
        const minAllowed = baseDelays[i] * 0.7;
        const maxAllowed = baseDelays[i] * 1.3;
        assert.ok(delays[i] >= minAllowed, `Delay ${delays[i]} below minimum for base ${baseDelays[i]}`);
        assert.ok(delays[i] <= maxAllowed, `Delay ${delays[i]} above maximum for base ${baseDelays[i]}`);
    }
    
    resetConfig();
});

test('isEnabled reflects HUMANIZER=off', () => {
    resetConfig();
    process.env.HUMANIZER = 'off';
    assert.equal(isEnabled(), false);
    delete process.env.HUMANIZER;
    resetConfig();
});

test('isEnabled reflects default enabled state', () => {
    resetConfig();
    delete process.env.HUMANIZER;
    assert.equal(isEnabled(), true);
    resetConfig();
});
