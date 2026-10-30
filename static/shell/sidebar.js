// Side menu behavior: mobile drawer, phone status dot, and publishing counts.
// Counts come from the publishing calendar (it fires "pf:counts" after each render),
// so the menu shows the same numbers as the calendar tiles. Other pages show the
// last numbers for up to 10 minutes, then hide them rather than show stale data.
(function () {
    const COUNT_KEY = 'pf-nav-counts';
    const MAX_AGE = 10 * 60 * 1000;
    const sidebar = document.getElementById('pf-sidebar');
    if (!sidebar) return;
    const toggle = document.querySelector('.pf-menu-toggle');
    const scrim = document.querySelector('.pf-scrim');
    const slot = (name) => sidebar.querySelector(`[data-slot="${name}"]`);

    const main = document.querySelector('main');
    const skip = document.querySelector('.pf-skip');
    if (main && skip) { if (!main.id) main.id = 'main-content'; skip.href = `#${main.id}`; }

    function setOpen(open) {
        sidebar.classList.toggle('is-open', open);
        toggle?.setAttribute('aria-expanded', String(open));
        toggle?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (scrim) scrim.hidden = !open;
        if (open) sidebar.querySelector('.pf-nav-item')?.focus();
    }
    toggle?.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
    scrim?.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) { setOpen(false); toggle?.focus(); }
    });

    function chip(cls, text, title) {
        const el = document.createElement('span');
        el.className = `pf-count ${cls}`;
        el.textContent = text;
        if (title) el.title = title;
        return el;
    }
    function showCounts(counts) {
        const el = slot('publishing');
        if (!el) return;
        if (!counts) { el.replaceChildren(); return; }
        const parts = [chip('today', `${counts.today} today`, `${counts.today} post groups today`)];
        if (counts.review > 0) parts.push(chip('review', `${counts.review} review`, `${counts.review} post groups need review, on any day`));
        if (counts.held > 0) parts.push(chip('held', `${counts.held} held`, `${counts.held} upcoming post groups held, not armed yet`));
        el.replaceChildren(...parts);
    }
    window.addEventListener('pf:counts', (event) => {
        const counts = event.detail;
        showCounts(counts);
        try { localStorage.setItem(COUNT_KEY, JSON.stringify({ ...counts, at: Date.now() })); } catch { /* storage blocked */ }
    });
    try {
        const saved = JSON.parse(localStorage.getItem(COUNT_KEY) || 'null');
        if (saved && Date.now() - saved.at < MAX_AGE) showCounts(saved);
    } catch { /* storage blocked or bad JSON */ }

    async function refreshPhones() {
        const phone = slot('phone');
        const devicesSlot = slot('devices');
        try {
            const response = await fetch('/api/devices', { headers: { accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) throw new Error(String(response.status));
            const devices = (await response.json()).filter((d) => !d.disabled);
            const online = devices.filter((d) => d.connected).length;
            const text = !devices.length ? 'No phone registered'
                : devices.length === 1 ? (online ? 'iPhone online' : 'iPhone offline')
                    : `${online} of ${devices.length} phones online`;
            const dot = () => { const d = document.createElement('span'); d.className = `pf-dot${online ? ' on' : ''}`; return d; };
            const label = document.createElement('span');
            label.textContent = text;
            phone?.replaceChildren(dot(), label);
            if (devicesSlot) { const d = dot(); d.title = text; devicesSlot.replaceChildren(d); }
        } catch {
            const label = document.createElement('span');
            label.textContent = 'Phone status unavailable';
            const d = document.createElement('span');
            d.className = 'pf-dot';
            phone?.replaceChildren(d, label);
            devicesSlot?.replaceChildren();
        }
    }
    refreshPhones();
    setInterval(refreshPhones, 30_000);
})();
