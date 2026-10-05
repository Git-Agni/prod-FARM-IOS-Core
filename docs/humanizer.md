# Humanizer

The humanizer makes automated phone-farm interactions look human by introducing natural randomness to delays, taps, swipes, and typing.

## What's randomized

- **Tap coordinates**: 6px Gaussian offset from target, clamped to the device's logical screen size (from its coordinate profile; unclamped if unknown)
- **Press duration**: 60–160ms random hold instead of fixed 100ms
- **Tap travel**: 50ms movement instead of instant
- **Jittered delays**: Log-normal spread around base values (70–130% of original, never below 70% floor for UI-transition waits)
- **Swipe trajectories**: Quadratic Bezier curves with random control-point deviation, 8-step eased timing, 4–6px start/end jitter
- **Typing patterns**: Random 1–6 character chunks (spaces sent separately) with 40–120ms delays between chunks and occasional longer pauses (300–800ms)

## Configuration

By default, the humanizer is **enabled**. All functions are pure and deterministic when seeded for reproducible tests.

### Disable

Set `HUMANIZER=off` to restore exact original behavior:

```bash
HUMANIZER=off npm run post manifest.json
```

### Defaults

```typescript
delays: { jitterStdDev: 0.15, minFloorMultiplier: 0.7, maxMultiplier: 1.3 }
tap: { maxOffsetPx: 6, durationMinMs: 60, durationMaxMs: 160 }
swipe: { startJitterMaxPx: 4, endJitterMaxPx: 6, controlPointMaxDeviationPx: 8, durationMinMs: 400, durationMaxMs: 550, steps: 8 }
typing: { keyDelayMinMs: 40, keyDelayMaxMs: 120, pauseChance: 0.08, pauseMinMs: 300, pauseMaxMs: 800 }
```

## Safety guarantees

- **Step order preserved**: All original execution sequences remain unchanged
- **Retry logic intact**: Safety checks (checkbox state, account switch retries) keep their original logic
- **60s post-upload wait**: Never below 60 seconds — uses `Math.max(60_000, humanDelay(60_000))` when enabled
- **No duplicate-post risk**: Non-retried steps (caption typing, final Post/Drafts tap) keep their single-execution semantics

## Files modified

- `src/tiktok/humanizer.ts` — core humanizer functions
- `src/tiktok/actions.ts` — humanized tapCoordinate and account switch delays
- `src/tiktok/post.ts` — humanized posting flow delays and caption typing
- `src/tiktok/doomscroll.ts` — humanized swipe trajectories

## Testing

Run `npm test` to verify humanizer determinism and bounds. Tests include:

- Seeded random produces deterministic output
- All values respect min/max clamps
- Disabled mode returns exact original values
- Bezier paths start/end near targets
