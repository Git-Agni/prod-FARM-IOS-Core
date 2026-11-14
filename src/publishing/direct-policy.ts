/** Explicit item allowlist while native flows are being qualified. Empty means no phone actions. */
export function directReleaseIds(value = process.env.PHONE_FARM_DIRECT_RELEASE_IDS): string[] {
    if (!value?.trim()) return [];
    const ids = value.split(',').map(v => v.trim());
    if (ids.length > 100 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
        throw new Error('Direct publishing requires an explicit list of calendar item IDs');
    return [...new Set(ids)];
}
/** `armed` admits every armed calendar release, so arming in the calendar is the only per-item approval. */
export function directReleaseAllArmed(value = process.env.PHONE_FARM_DIRECT_RELEASE_IDS) { return value?.trim() === 'armed'; }
export function directPublicationStatus(value = process.env.PHONE_FARM_DIRECT_RELEASE_IDS) {
    if (directReleaseAllArmed(value)) return { enabled: true, itemIds: [] as string[], scope: 'all_armed', pausedCommentPlatforms:directPausedCommentPlatforms(),
        reason: 'Every armed calendar item may run at its time. Each still needs native preflight.' };
    const itemIds = directReleaseIds(value);
    return { enabled: itemIds.length > 0, itemIds, scope: 'selected_items', pausedCommentPlatforms:directPausedCommentPlatforms(),
        reason: itemIds.length ? 'Only selected calendar items may run. Each still needs native preflight.' : 'Direct posting is paused. No calendar items are selected.' };
}

/** Stop a known broken comment layout without stopping video releases or clearing claims. */
export function directPausedCommentPlatforms(value=process.env.PHONE_FARM_DIRECT_PAUSED_COMMENTS): string[] {
    if(!value?.trim())return [];
    const platforms=value.split(',').map(v=>v.trim());
    if(platforms.some(v=>!['instagram','facebook','tiktok'].includes(v)))throw Error('Unknown paused comment platform');
    return [...new Set(platforms)];
}
