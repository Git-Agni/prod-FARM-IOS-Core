# Plugin development and compatibility

Plugins are trusted code, not a sandbox. Installing one grants the same filesystem, network, process, database-facing host context, and device access as the Phone Farm service account. Only install reviewed, exactly pinned packages.

Each persisted task uses three compatibility keys: plugin ID, task type, and positive integer task version. Never change the meaning or validation of a released version. Add a new version, keep the prior executor installed while old schedules exist, and migrate schedules explicitly. Worker and web processes must load the same plugin versions.

A task definition must validate untrusted JSON before persistence, bound duration and retry behavior, make destructive actions explicit, honor `context.signal`, and avoid retrying non-idempotent actions. Files are accessed only through `context.assets`; subprocesses should be launched through `context.runProcess` so logs and cancellation remain observable.

Device-specific values belong in `device.pluginData[plugin.id]`. Global credentials belong in protected environment/secret storage. Neither belongs in task summaries, logs, HTML fragments, or a public repository.

Panels and namespaced routes are served inside the authenticated host. Panel HTML is trusted and therefore requires the same review as server code. Avoid remote scripts and never interpolate device/user values without escaping them.
