/** Group only exact media on the same phone. Never merge claims or platform records. */
export function contentGroups(models) {
    const groups = new Map();
    for (const m of models) {
        const key = m.st.key === 'cancelled' ? m.item.id : `${m.input.deviceUdid}:${m.item.media?.sha256 || m.item.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    }
    return [...groups.values()].map(members => {
        const pending = members.filter(m => !['posted','cancelled'].includes(m.st.key));
        const future = pending.filter(m => m.runAt > Date.now());
        const anchor = [...(future.length ? future : pending.length ? pending : members)].sort((a,b)=>a.runAt-b.runAt)[0];
        const primary = members.find(m=>m.targets.some(t=>t.platform==='instagram')) || anchor;
        const key = members.every(m=>m.st.key==='posted') ? 'posted' : members.every(m=>m.st.key==='cancelled') ? 'cancelled' : members.some(m=>m.st.key==='posting') ? 'posting' : pending.some(m=>m.st.key==='review') ? 'review' : pending.every(m=>m.st.key==='scheduled') ? 'scheduled' : 'held';
        const labels = {posted:'Posted',cancelled:'Cancelled',posting:'Posting',review:'Needs review',scheduled:'Scheduled',held:'Held'};
        return {...primary, members, runAt:anchor.runAt, day:anchor.day, targets:members.flatMap(m=>m.targets), st:{key,label:labels[key],title:'See each platform status below.'}};
    });
}
