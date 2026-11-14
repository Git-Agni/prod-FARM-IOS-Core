# Native publishing review

This change adds the Phone Farm publishing dashboard and app-owned scheduler. It includes native Instagram, linked Facebook, TikTok and YouTube drivers, per-phone locks, one-shot submission claims, separate delivery receipts, and guarded comment actions. Routine execution uses no AI model calls.

The scheduler uses the app calendar. A claim prevents duplicate submission; it does not prove delivery. Uncertain uploads, imports and comments require review. The code rejects screen-lock commands. Direct iPhone operation must keep media volume at zero.

## Validation

Both TypeScript checks and 222 tests pass in the working checkout. The web build passes. These are offline checks and do not prove unattended delivery.

## Open release blockers

- The native volume check cannot reliably dismiss Control Center on the current iPhone. The worker was stopped after this failed live check.
- Facebook delivery and Instagram's pinned comment were verified for the original Hermes post. Its Facebook comment still needs recovery.
- TikTok and YouTube pins are not qualified. YouTube first comments remain unsupported.
- Direct Story publication still requires supported assets, reviewed native drafts and receipts.
- Several native mappings remain account-specific. This is a draft implementation, not a portable production release.

## Local files excluded from the public PR

Private native screenshots, delivery receipts, Story media, saved Story approval manifests and one-off live recovery scripts remain local. Legacy Story preview routes and the reviewed Instagram cover matcher depend on those local assets. A fresh checkout cannot use those flows until the operator supplies its own reviewed assets. Missing assets must not be treated as approval or replaced with guessed content.

Do not restart publishing as part of merging this PR. Resolve the native blockers, review claims and run a bounded pilot first. The deleted Codex recovery cron must stay deleted.
