import {contentGroups} from './groups.mjs';
// Publishing calendar for the local Phone Farm.
// Reads the publishing API (items, timed releases, engagements, capabilities) and refreshes every 30 seconds.
// Writes: Add video (held), Arm scheduled post, Instagram preview, and Cancel.
(() => {
    'use strict';

    const TZ = 'America/Los_Angeles';
    const REFRESH_MS = 30_000;
    const FB_PAGE_ID = '61584693917444';
    const API = '/api/publishing';
    const $ = (id) => document.getElementById(id);

    // ---------- small DOM helpers ----------
    function h(tag, attrs, ...children) {
        const el = document.createElement(tag);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (value === null || value === undefined || value === false) continue;
                if (key === 'class') el.className = value;
                else if (key === 'text') el.textContent = value;
                else if (key === 'dataset') Object.assign(el.dataset, value);
                else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
                else el.setAttribute(key, value === true ? '' : String(value));
            }
        }
        for (const child of children.flat(Infinity)) {
            if (child === null || child === undefined || child === false) continue;
            el.append(child instanceof Node ? child : String(child));
        }
        return el;
    }
    const ICONS = {
        ok: '<svg class="ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.1 2.1 4.3-4.5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        warn: '<svg class="ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.3l7.2 12.8H.8z" fill="currentColor"/><path d="M8 6v3.7M8 11.7v.1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
        fail: '<svg class="ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>',
        wait: '<svg class="ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        na: '<svg class="ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.3 8h5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        alert: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.2M12 17.2v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
        pin: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
        play: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
        ext: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };
    function fill(el, ...children) {
        el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
        return el;
    }
    function icon(name) {
        const holder = document.createElement('span');
        holder.innerHTML = ICONS[name]; // static markup only
        return holder.firstElementChild;
    }
    function pref(name, fallback) {
        try { return localStorage.getItem('publishing.' + name) ?? fallback; } catch { return fallback; }
    }
    function savePref(name, value) {
        try { localStorage.setItem('publishing.' + name, value); } catch { /* storage unavailable */ }
    }

    // ---------- time helpers (always America/Los_Angeles) ----------
    const partsFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const whenFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const stampFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    function dayKey(date) {
        const parts = Object.fromEntries(partsFormat.formatToParts(date).map((p) => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }
    const todayKey = () => dayKey(new Date());
    function keyDate(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d, 12));
    }
    function addDays(key, days) {
        const date = keyDate(key);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    }
    const fmtKey = (key, options) => keyDate(key).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
    function tzAbbr() {
        return new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date())
            .find((p) => p.type === 'timeZoneName')?.value || 'PT';
    }
    function relative(ms, precise) {
        const past = ms < 0;
        const s = Math.round(Math.abs(ms) / 1000);
        let out;
        if (s < 60) out = `${s}s`;
        else if (s < 3600) out = precise ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 60)}m`;
        else if (s < 86400) { const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); out = `${hh}h ${String(mm).padStart(2, '0')}m`; }
        else { const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); out = hh ? `${d}d ${hh}h` : `${d}d`; }
        return past ? `${out} ago` : `in ${out}`;
    }
    function stamp(value) {
        const t = Date.parse(value);
        return Number.isFinite(t) ? `${stampFormat.format(t)} (${relative(t - Date.now())})` : '—';
    }
    function dayHeading(key) {
        const today = todayKey();
        const date = fmtKey(key, { month: 'short', day: 'numeric' });
        const weekday = fmtKey(key, { weekday: 'long' });
        if (key === today) return ['Today', date, weekday];
        if (key === addDays(today, 1)) return ['Tomorrow', date, weekday];
        if (key === addDays(today, -1)) return ['Yesterday', date, weekday];
        return [weekday, date, ''];
    }
    const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
    const PLATFORM = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
    const PLATFORM_CLASS = { instagram: 'ig', facebook: 'fb', tiktok: 'tt', youtube: 'yt' };
    function mb(bytes) { return Number.isFinite(bytes) ? `${(bytes / 1048576).toFixed(1)} MB` : '—'; }

    // ---------- state ----------
    const state = {
        items: [], models: [], byId: new Map(), releases: new Map(), engagements: [], caps: null, cadence: null, automation: null,
        sources: { releases: '', engagements: '', caps: '' },
        loaded: false, loading: false, error: '', loadedAt: 0, today: todayKey(),
        view: pref('view', 'list') === 'week' ? 'week' : 'list',
        start: todayKey(), filter: 'all', showCancelled: pref('cancelled', '0') === '1',
        drawer: null, // { mode: 'item', id, message, bad } | { mode: 'add' }
    };

    // ---------- data ----------
    async function getJson(url) {
        const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
        let body = null;
        try { body = await response.json(); } catch { /* not JSON */ }
        if (!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
        return body;
    }
    async function postJson(url, payload) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        let body = null;
        try { body = await response.json(); } catch { /* not JSON */ }
        if (!response.ok) throw new Error(body?.error || `Request failed (HTTP ${response.status})`);
        return body;
    }
    async function fetchAllItems() {
        const byId = new Map();
        let offset = 0;
        for (let page = 0; page < 200 && offset !== null && offset !== undefined; page += 1) {
            const data = await getJson(`${API}/items?limit=100&offset=${offset}`);
            for (const item of data.items || []) if (item && item.id) byId.set(item.id, item);
            offset = data.nextOffset ?? null;
        }
        return [...byId.values()];
    }
    async function optional(url) {
        try { return { ok: true, data: await getJson(url) }; } catch (error) { return { ok: false, error: error.message }; }
    }
    async function refresh() {
        if (state.loading) { state.again = true; return; }
        state.loading = true;
        updateClock();
        try {
            const [items, releases, engagements, caps, cadence, automation, health] = await Promise.all([
                fetchAllItems(), optional(`${API}/releases`), optional(`${API}/engagements`), optional(`${API}/capabilities`), optional(`${API}/cadence`), optional(`${API}/automation`), optional(`${API}/health`),
            ]);
            state.health = health.ok ? health.data : null;
            state.items = items;
            if (releases.ok) state.releases = new Map((releases.data.releases || []).map((r) => [r.item_id, r]));
            if (engagements.ok) state.engagements = engagements.data.engagements || [];
            if (caps.ok) state.caps = caps.data;
            state.automation = automation.ok ? automation.data : null;
            state.cadence = cadence.ok ? cadence.data : null;
            state.sources = { releases: releases.ok ? '' : releases.error, engagements: engagements.ok ? '' : engagements.error, caps: caps.ok ? '' : caps.error };
            state.loaded = true;
            state.error = '';
            state.loadedAt = Date.now();
        } catch (error) {
            state.error = error.message || String(error);
        } finally {
            state.loading = false;
        }
        render();
        if (state.again) { state.again = false; await refresh(); }
    }

    // ---------- derived post model ----------
    function keyword(caption) {
        const text = String(caption || '');
        const upper = /\b(?:comment|Comment|COMMENT)\s+["“'‘]?([A-Z0-9][A-Z0-9_-]*)(?![a-z])/.exec(text);
        if (upper) return upper[1].toUpperCase();
        const any = /\bcomment\s+["“'‘]?([A-Za-z0-9][\w-]*)/i.exec(text);
        return any ? any[1].toUpperCase() : '';
    }
    function firstLine(caption) {
        const line = String(caption || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
        return line.length > 180 ? line.slice(0, 177) + '…' : line;
    }
    function igKey(url) {
        const text = String(url || '');
        const match = /instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i.exec(text);
        return match ? match[1] : text.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    }
    function safeUrl(url, host) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' && (parsed.hostname === host || parsed.hostname.endsWith('.' + host)) ? parsed.href : '';
        } catch { return ''; }
    }
    function receipt(item, rel, platform) {
        const host = platform === 'facebook' ? 'facebook.com' : platform === 'tiktok' ? 'tiktok.com' : 'instagram.com';
        for (const source of [item.results?.release, rel?.result]) {
            if (!source || typeof source !== 'object') continue;
            const candidates = [source[platform], source.receipts?.[platform], source.urls?.[platform], source[platform + 'Url'], source.posts?.[platform]];
            for (const c of candidates) {
                const url = safeUrl(typeof c === 'string' ? c : c?.url, host);
                if (url) return { url, verifiedAt: (c && typeof c === 'object' && (c.verifiedAt || (c.verified ? 'verified' : ''))) || '' };
            }
        }
        return null;
    }
    const isPin = (e) => e?.action === 'pin' || String(e?.claim_key || '').startsWith('pin:');
    const isStory = (e) => e?.action === 'story' || String(e?.claim_key || '').startsWith('story:');
    function engagementUrl(e) { return e.post_url || String(e.claim_key || '').replace(/^pin:/, ''); }
    function storyDay(e) {
        const key = String(e.claim_key || '');
        if (/^story:\d{4}-\d{2}-\d{2}$/.test(key)) return key.slice(6);
        const t = Date.parse(e.created_at || e.updated_at);
        return Number.isFinite(t) ? dayKey(new Date(t)) : '';
    }
    function engagementInfo(e) {
        switch (e?.status) {
            case 'done': return { level: 'ok', text: e.result?.status && e.result.status !== 'done' ? cap(String(e.result.status).replace(/_/g, ' ')) : 'Done' };
            case 'claimed': return { level: 'wait', text: 'In progress' };
            case 'failed_before_action': return { level: 'fail', text: 'Failed before tapping' };
            case 'uncertain_review': return { level: 'fail', text: 'Check the phone' };
            default: return { level: 'na', text: cap(e?.status || 'Unknown') };
        }
    }

    function postingPaused() {
        return state.caps?.publicationEnabled !== true || state.cadence?.runtime?.videoPostingRunning !== true;
    }
    function postState(item, rel, runAt) {
        const relState = rel?.state;
        const release = item.results?.release || {};
        if (item.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', title: 'Cancelled. It will not post.' };
        if (item.status === 'published' || relState === 'published') return { key: 'posted', label: 'Posted', title: 'Posted and verified by the release job.' };
        if (item.status === 'needs_review' || relState === 'needs_review') {
            const external = item.results?.externalYouTubeDelivery;
            if (external?.doNotReupload === true && external.verifiedSourceHash === item.media?.sha256 && safeUrl(external.publicUrl, 'youtube.com')) {
                return { key: 'review', label: 'Live on YouTube; review details', title: 'Already delivered through the previous schedule. Do not upload again.', error: 'The source file matches a published YouTube Short. Check its caption, cover, related video and comment on the existing post.', note: 'Do not re-upload', noteBad: true };
            }
            const error = item.results?.reviewNote || rel?.result?.error || release.error || 'The release stopped. Check the phone before doing anything else.';
            const shared = rel?.share_claimed_at || release.shareAttempted;
            return { key: 'review', label: 'Needs review', error, title: 'Stopped. Needs a person to check.', note: shared ? 'Share was attempted' : '', noteBad: true };
        }
        if (relState === 'running') return { key: 'posting', label: 'Posting', title: 'The phone is posting this now.' };
        if (item.status === 'held' && item.results?.hourlyRecoveryExclusion) return {key:'review',label:'Duplicate check needed',title:'Inspect the existing native post before another upload.',error:'This destination is held for a duplicate check. No automatic retry.'};
        if (relState === 'armed' && state.caps?.controlMode === 'wda' && state.caps?.direct?.scope !== 'all_armed' && !state.caps?.direct?.itemIds?.includes(item.id)) return {key:'held',label:'Held',title:'Saved release exists, but this item is not enabled for the worker.',note:'Not enabled for posting'};
        if (relState === 'armed') {
            const mismatch = rel.item_version !== item.version;
            const timeDiff = Number.isFinite(runAt) && Math.abs(Date.parse(rel.run_at) - runAt) > 60_000;
            return {
                key: 'scheduled', label: postingPaused() ? 'Armed, paused' : 'Scheduled', title: postingPaused() ? 'Armed, but automatic posting is paused.' : 'Armed: the phone posts this at its time.',
                note: mismatch ? `Armed for v${rel.item_version}, item is v${item.version}` : timeDiff ? `Release runs at ${timeFormat.format(Date.parse(rel.run_at))}` : '',
                noteBad: mismatch || timeDiff,
            };
        }
        if (item.status === 'held') {
            const passed = Number.isFinite(runAt) && runAt < Date.now();
            return {
                key: 'held', label: 'Held', title: 'Saved on hold (draft). It will not post until a timed release is armed.',
                note: relState === 'cancelled' ? 'Release cancelled' : passed ? 'Time passed, not armed' : 'Not armed yet', noteBad: passed || relState === 'cancelled',
            };
        }
        return { key: 'other', label: cap(String(item.status || 'unknown').replace(/_/g, ' ')), title: `Item status: ${item.status}` };
    }

    function buildChecks(m) {
        const { item, input, targets, st, rel } = m;
        const out = [];
        const add = (key, label, level, short, detail) => out.push({ key, label, level, short, detail: detail || short });
        const cancelled = st.key === 'cancelled';
        const instagram = targets.find((t) => t.platform === 'instagram');
        const facebook = targets.find((t) => t.platform === 'facebook');
        if (input.youtube) {
            const checked = item.results?.youtubePreparation;
            add('youtube', 'YouTube upload', st.key === 'posted' ? 'ok' : 'warn', st.key === 'posted' ? 'Posted' : 'Held for review', st.key === 'posted' ? 'This item has a saved publication receipt.' : 'Unattended YouTube uploads are not enabled.');
            add('media', 'Shorts video', checked?.eligible ? 'ok' : 'warn', checked?.eligible ? 'File checked' : 'Needs check', checked?.eligible ? `${checked.width} × ${checked.height}, ${checked.durationSeconds.toFixed(1)} seconds. The file hash is saved.` : 'The actual video file must pass inspection.');
            add('channel', 'Channel', st.key === 'posted' ? 'ok' : 'warn', st.key === 'posted' ? 'Checked at posting' : 'Phone check pending', `${input.youtube.channelId}. Verify this channel in the YouTube app before upload.`);
            return out;
        }
        const preview = item.results?.instagramPreview || null;
        const evidence = item.results?.release?.evidence || rel?.result?.evidence || null;

        // Timed release
        if (cancelled) add('release', 'Armed to post', 'na', 'Cancelled', 'This post was cancelled.');
        else if (st.key === 'posted') add('release', 'Armed to post', 'ok', 'Posted', 'The release job finished and saved post receipts.');
        else if (st.key === 'review') add('release', 'Armed to post', 'fail', 'Stopped', st.error);
        else if (st.key === 'posting') add('release', 'Armed to post', 'wait', 'Posting now', 'The release job is running on the phone.');
        else if (st.key === 'scheduled') {
            if (st.noteBad) add('release', 'Armed to post', 'fail', st.note, `${st.note}. The release job will stop instead of posting. Re-arm it for the current version and time.`);
            else add('release', 'Armed to post', 'ok', 'Armed', `Runs at ${whenFormat.format(Date.parse(rel.run_at))} for version ${rel.item_version}.`);
        } else if (st.key === 'held') {
            const passed = Number.isFinite(m.runAt) && m.runAt < Date.now();
            add('release', 'Armed to post', passed ? 'fail' : 'warn', passed ? 'Time passed' : 'Not armed',
                passed ? 'The target time passed and no release was armed. Nothing posted.' : 'Saved on hold. It will not post until a timed release is armed for this version.');
        } else add('release', 'Armed to post', 'na', st.label, st.title);

        // Video fingerprint
        const sha = item.media?.sha256 || '';
        if (!/^[0-9a-f]{64}$/i.test(sha)) add('video', 'Video', 'fail', 'No fingerprint', 'The item has no valid SHA-256 for its video.');
        else if (preview?.videoSha256 && preview.videoSha256 !== sha) add('video', 'Video', 'fail', 'Phone copy differs', `Item SHA-256 ${sha}, phone preview SHA-256 ${preview.videoSha256}.`);
        else if (evidence?.exactMedia === true) add('video', 'Video', 'ok', 'Verified on phone', `Exact video verified in the composer. SHA-256 ${sha}.`);
        else add('video', 'Video', 'ok', sha.slice(0, 8), `SHA-256 ${sha} · ${mb(item.media?.size)} · ${item.media?.name || 'video'}${preview?.videoSha256 === sha ? ' · matches the phone preview copy' : ''}`);

        // Caption
        const caption = String(input.caption || '');
        if (!caption.trim()) add('caption', 'Caption', 'fail', 'Empty', 'The caption is empty.');
        else if (/https?:\/\/|www\./i.test(caption)) add('caption', 'Caption', 'fail', 'Has a link', 'Public captions must be URL-free. The release job rejects links.');
        else if (caption.length > 2200) add('caption', 'Caption', 'fail', 'Too long', `${caption.length} characters. The limit is 2,200.`);
        else if (!m.kw) add('caption', 'Caption', 'warn', 'No keyword', `${caption.length} characters. No "Comment KEYWORD" call to action found.`);
        else add('caption', 'Caption', 'ok', `${caption.length} chars`, `Keyword ${m.kw}. No links. Limit 2,200 characters.${preview?.captionVerified ? ' Matched in the phone preview.' : ''}`);

        // Trial + automatic promotion
        if (!instagram) add('trial', 'Trial + auto promo', 'na', 'No Instagram', 'This item has no Instagram target.');
        else if (input.instagramTrial && input.automaticPromotion) {
            const verified = evidence?.automaticPromotion === true || preview?.automaticPromotionVerified === true;
            add('trial', 'Trial + auto promo', 'ok', verified ? 'On, verified' : 'On', `Trial Reel with automatic promotion on.${verified ? ' Verified on the phone.' : ' The release job checks the native setting before Share.'}`);
        } else if (input.instagramTrial) add('trial', 'Trial + auto promo', 'fail', 'Promotion off', 'Trial Reels need automatic promotion on. Recreate this item under the current policy.');
        else add('trial', 'Trial + auto promo', 'warn', 'Trial off', 'This posts as a regular Reel, not a Trial Reel.');

        // Facebook linked (Antonio Revenue)
        if (m.fb) add('facebook', 'Facebook', 'ok', 'Posted', `Facebook post: ${m.fb.url}`);
        else if (!facebook) add('facebook', 'Facebook', cancelled ? 'na' : 'warn', 'Not selected', 'Facebook (Antonio Revenue) is not a target on this item, so nothing is shared to Facebook.');
        else if (!String(facebook.account).includes(FB_PAGE_ID)) add('facebook', 'Facebook', 'warn', 'Other Page', `Facebook target is ${facebook.account}, not Antonio Revenue.`);
        else if (input.facebookMode !== 'linked_from_instagram') add('facebook', 'Facebook', 'fail', 'Separate post', 'The item asks for a separate Facebook upload instead of linked sharing from Instagram.');
        else if (!instagram) add('facebook', 'Facebook', 'fail', 'No Instagram', 'Linked sharing needs Instagram on the same item.');
        else if (item.results?.release?.receipts?.facebook?.verified && item.results.release.receipts.facebook.evidence) add('facebook', 'Facebook', 'ok', 'Verified on phone', item.results.release.receipts.facebook.evidence + '. No Facebook URL saved.');
        else if (st.key === 'posted') add('facebook', 'Facebook', 'warn', 'No receipt', 'The post is live but no Facebook receipt URL was saved.');
        else add('facebook', 'Facebook', 'wait', 'Linked; receipt pending', 'Configured to share to Antonio Revenue. Native Facebook delivery has not been verified.');

        // Pinned comment
        const comment = String(input.firstComment || '').trim();
        if (instagram) {
        if (cancelled) add('pin', 'Pinned comment', 'na', comment ? 'Cancelled' : 'None', comment || 'No first comment.');
        else if (m.pin) { const info = engagementInfo(m.pin); add('pin', 'Pinned comment', info.level, info.text, `${comment || '(text not on item)'}${m.pin.result?.error ? `\nError: ${m.pin.result.error}` : ''}`); }
        else if (!comment) add('pin', 'Pinned comment', 'warn', 'None set', 'No first comment on this item, so there is nothing to pin.');
        else if (st.key === 'posted') add('pin', 'Pinned comment', 'wait', 'Not pinned yet', comment);
        else add('pin', 'Pinned comment', 'wait', 'After posting', comment);

        }
        for (const platform of ['facebook','tiktok']) {
            if (!input.targets.some(t => t.platform === platform)) continue;
            const record = state.engagements.find(e => e.claim_key === `comment:${platform}:item:${item.id}`);
            const result = item.results?.[platform+'Comment'];
            const label = cap(platform)+' comment';
            if (result?.commentVerified) add(platform+'Comment',label,result.pinned?'ok':'warn',result.pinned?'Posted and pinned':'Posted, pin unavailable',result.evidence);
            else if (record) { const info=engagementInfo(record);add(platform+'Comment',label,info.level,info.text,record.result?.error||comment); }
            else add(platform+'Comment',label,cancelled?'na':comment?'wait':'warn',cancelled?'Cancelled':comment?'After posting':'None set',comment||'Add a first comment to this item.');
        }

        // Story (only when a Story action points at this post)
        if (m.stories.length) {
            const latest = m.stories[0];
            const info = engagementInfo(latest);
            const day = storyDay(latest);
            add('story', 'Story', info.level, `${info.text}${day ? ', ' + fmtKey(day, { month: 'short', day: 'numeric' }) : ''}`,
                `Reel shared to the daily Story${day ? ' for ' + fmtKey(day, { weekday: 'long', month: 'short', day: 'numeric' }) : ''}.${latest.result?.error ? ' Error: ' + latest.result.error : ''}`);
        }
        return out;
    }

    function buildModel(item) {
        const input = item.input && typeof item.input === 'object' ? item.input : {};
        const targets = Array.isArray(input.targets) ? input.targets : [];
        const rel = state.releases.get(item.id) || null;
        const runAt = Date.parse(input.runAt);
        const m = {
            item, input, targets, rel, runAt,
            day: Number.isFinite(runAt) ? dayKey(new Date(runAt)) : null,
            st: postState(item, rel, runAt),
            kw: keyword(input.caption), first: firstLine(input.caption),
            ig: receipt(item, rel, 'instagram'), fb: receipt(item, rel, 'facebook'), tt: receipt(item, rel, 'tiktok'),
        };
        const key = m.ig ? igKey(m.ig.url) : '';
        // Phone-posted reels record their pin under the item ID (iOS blocks reading the post link).
        m.pin = state.engagements.find((e) => isPin(e) && e.claim_key === 'pin:item:' + item.id)
            || (key ? state.engagements.find((e) => isPin(e) && igKey(engagementUrl(e)) === key) : null) || null;
        m.stories = key ? state.engagements.filter((e) => isStory(e) && igKey(e.post_url) === key)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) : [];
        m.checks = buildChecks(m);
        return m;
    }
    const sortModels = (a, b) => (a.runAt - b.runAt) || ((a.st.key === 'cancelled') - (b.st.key === 'cancelled')) || String(a.item.createdAt).localeCompare(String(b.item.createdAt));
    function rangeKeys() { return Array.from({ length: 7 }, (_, i) => addDays(state.start, i)); }
    const inRange = (m) => m.day && m.day >= state.start && m.day <= addDays(state.start, 6);
    function matchesFilter(m) {
        if (m.st.key === 'cancelled') return state.showCancelled && state.filter === 'all';
        if (state.filter === 'all') return true;
        if (state.filter === 'scheduled') return m.st.key === 'scheduled' || m.st.key === 'posting';
        return m.st.key === state.filter;
    }

    // ---------- thumbnails (cached so refreshes never reload video) ----------
    const thumbCache = new Map();
    const videoUrl = (item) => `${API}/items/${encodeURIComponent(item.id)}/media/video`;
    const lazy = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const video = entry.target;
            if (!video.getAttribute('src') && video.dataset.src) { video.preload = 'metadata'; video.src = video.dataset.src; }
            lazy.unobserve(video);
        }
    }, { rootMargin: '600px 0px' }) : null;
    // Draw the opening frame into a canvas, then drop the video so thumbnails hold no media connections.
    function freezeFrame(video) {
        let done = false;
        const draw = () => {
            if (done || !video.videoWidth) return;
            done = true;
            const canvas = document.createElement('canvas');
            canvas.width = 216;
            canvas.height = Math.round(216 * video.videoHeight / video.videoWidth);
            try { canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); } catch { return; }
            video.replaceWith(canvas);
            video.removeAttribute('src');
            video.load();
        };
        video.addEventListener('loadeddata', () => {
            if (video.currentTime >= 0 || !(video.duration > 0.6)) draw();
            else { video.addEventListener('seeked', draw, { once: true }); video.currentTime = 0.5; }
        }, { once: true });
    }
    function thumb(item, kind) {
        const key = `${kind}:${item.id}:${item.media?.sha256 || ''}`;
        let el = thumbCache.get(key);
        if (el) return el;
        el = h('span', { class: kind === 'big' ? 'thumb' : 'mini-thumb', 'aria-hidden': 'true' });
        if (!item.media) el.append(h('span', { class: 'thumb-missing', text: 'No video' }));
        else {
            const video = h('video', { muted: true, playsinline: true, preload: 'none', tabindex: '-1', disablepictureinpicture: true });
            video.muted = true;
            video.dataset.src = videoUrl(item) + '#t=0';
            if (item.cover) video.poster = `${API}/items/${encodeURIComponent(item.id)}/media/cover`;
            video.addEventListener('error', () => el.replaceChildren(h('span', { class: 'thumb-missing', text: 'Preview unavailable' })), { once: true });
            freezeFrame(video);
            el.append(video);
            if (kind === 'big') el.append(h('span', { class: 'thumb-play' }, icon('play')));
            if (lazy) lazy.observe(video); else { video.preload = 'metadata'; video.src = video.dataset.src; }
        }
        thumbCache.set(key, el);
        return el;
    }

    // ---------- shared pieces ----------
    function badge(st, small) {
        return h('span', { class: `badge st-${st.key}${small ? ' sm' : ''}`, title: st.title || '' }, st.label);
    }
    function platformChips(m) {
        return m.targets.map((t) => {
            let sub = '';
            if (t.platform === 'instagram' && m.input.instagramTrial) sub = 'Trial';
            if (t.platform === 'facebook') sub = m.input.facebookMode === 'linked_from_instagram' ? 'linked' : 'separate';
            return h('span', { class: `chip ${PLATFORM_CLASS[t.platform] || ''}`, title: `${PLATFORM[t.platform] || t.platform}: ${t.account}` },
                h('i'), PLATFORM[t.platform] || t.platform, sub ? h('span', { class: 'chip-sub', text: sub }) : null);
        });
    }
    function checkPill(c) {
        return h('li', { class: `check ${c.level}`, title: `${c.label}: ${c.detail}` }, icon(c.level), h('b', { text: c.label }), h('small', { text: c.short }));
    }
    function linkButton(url, label) {
        return h('a', { class: 'btn btn-small btn-link', href: url, target: '_blank', rel: 'noopener' }, label, icon('ext'));
    }
    function countdown(runAt, precise) {
        return h('span', { dataset: { countdown: String(runAt), precise: precise ? '1' : '' } }, relative(runAt - Date.now(), precise));
    }

    // ---------- page sections ----------
    function renderCaps() {
        const cadence = $('cadence');
        if (state.cadence) fill(cadence,
            h('div', {class:'banner-main'}, h('strong', {text:'Video plan: set in the Autopilot panel above, one lane per platform.'}), h('span', {text:'Stories at 9 a.m. and 5 p.m. Pacific.'})),
            h('div', {class:'banner-note',text:state.cadence.runtime?.controlMode === 'mirroring'
                ? `${state.cadence.runtime?.videoPostingRunning ? 'Verified video posting is running.' : state.cadence.runtime?.automaticPostingRequested ? 'Automatic schedule checks are on. Publishing is blocked.' : 'Automatic posting is paused.'} Keep the physical phone locked and the Mac awake and unlocked. ${state.cadence.runtime?.releaseWorker?.blockers?.join(' ') || state.cadence.mirroring?.reason || 'Checking the Mac controller.'} ${state.cadence.audio?.reason || 'Phone audio mute is not verified. Keep playback stopped.'}`
                : state.cadence.runtime?.videoPostingRunning ? 'The video worker and native driver are running. Only armed content can publish. A Story posts only after you approve its five native previews.' : 'Video posting is paused. The release worker and native driver must be restored. A Story posts only after you approve its five native previews.'}));
        else fill(cadence,h('strong',{text:'Could not confirm the configured cadence.'}));
        const audio=state.cadence?.audio;
        if(state.cadence?.mirroring?.controlReady&&audio?.muteArmed===true&&audio?.ready!==true&&audio?.serviceGeneration) {
            const report=h('input',{type:'checkbox','aria-label':'I played a video in iPhone Mirroring and heard no phone audio from my Mac.'});
            const save=h('button',{type:'button',disabled:true,text:'Save silence check',onclick:async()=>{
                if(!report.checked)return;
                save.disabled=true;
                try {
                    await postJson(`${API}/audio/confirm-silence`,{
                        confirmation:'owner_confirmed_silent_playback',serviceGeneration:audio.serviceGeneration,
                        tapId:audio.tapId,aggregateId:audio.aggregateId,targetProcessIds:audio.targetProcessIds,
                    });
                    await refresh();
                } catch(error){message.textContent=error.message;}
            }});
            report.addEventListener('change',()=>{save.disabled=!report.checked;});
            const message=h('div',{class:'banner-note',role:'status',text:'Play a short clip in iPhone Mirroring. Pause it, then confirm only if you heard no phone audio from your Mac. This saves the sound check. It does not enable posting.'});
            cadence.append(message,h('label',{},report,' I played a video in iPhone Mirroring and heard no phone audio from my Mac.'),save);
        }
        const el = $('capabilities');
        const c = state.caps;
        if (!c) {
            el.className = 'banner banner-warn';
            el.replaceChildren(h('div', { class: 'banner-main' }, icon('alert'),
                h('strong', { text: state.sources.caps ? 'Posting mode unknown.' : 'Checking posting mode…' }),
                state.sources.caps ? h('span', { text: `Capabilities check failed: ${state.sources.caps}` }) : null));
            return;
        }
        const enabled = c.publicationEnabled === true;
        el.className = `banner ${enabled ? 'banner-ok' : 'banner-warn'}`;
        const platforms = Object.entries(c.platforms || {});
        const reasons = platforms.filter(([, p]) => p && p.reason).map(([name, p]) => h('li', {}, h('b', { text: `${PLATFORM[name] || name}: ` }), p.reason));
        if (c.facebookPolicy) reasons.push(h('li', {}, h('b', { text: 'Facebook policy: ' }), c.facebookPolicy));
        if (c.youtube) reasons.push(h('li', {}, h('b', { text: 'YouTube: ' }), c.youtube));
        const notes = [];
        if (state.sources.releases) notes.push(`Timed releases could not be read (${state.sources.releases}). Scheduled states may be missing.`);
        if (state.sources.engagements) notes.push(`Pin and Story results could not be read (${state.sources.engagements}).`);
        fill(el,
            h('div', { class: 'banner-main' }, enabled ? null : icon('alert'),
                h('strong', { text: enabled ? 'Selected native posting flows are enabled.' : c.automation?.foregroundAllowed === false ? 'Phone control is paused.' : 'Native posting tests are pending.' }),
                h('span', { class: 'page-sub', text: `Mode: ${c.mode || 'unknown'}` })),
            h('div', { class: 'banner-chips' },
                platforms.map(([name, p]) => h('span', { class: `ready-chip${p?.ready ? ' is-ready' : ''}`, title: p?.reason || '' }, `${PLATFORM[name] || name} ${p?.ready ? 'ready' : 'not ready'}`)),
                c.instagramPreviewAvailable ? h('span', { class: 'ready-chip is-ready', title: 'The phone can open the Instagram composer and stop before Share.' }, 'Instagram preview available') : null),
            reasons.length ? h('details', {}, h('summary', { text: 'Readiness details' }), h('ul', {}, reasons)) : null,
            notes.length ? h('div', { class: 'banner-note', text: notes.join(' ') }) : null,
            renderAutomationControls(),
            renderNativeStoryApprovals(),
        );
    }

    function renderAutomationControls() {
        if(state.caps?.controlMode !== 'mirroring') return h('p',{class:'banner-note',text:'Direct iPhone control. Keep the phone unlocked and media volume at zero. Only approved, enabled items can run.'});
        const a=state.automation;if(!a)return null;
        if(a.foregroundAllowed)return h('div', {class:'banner-note'},
            h('span',{text:'Phone Farm may bring Mirroring forward. Phone audio stays muted.'}),
            h('button',{type:'button',class:'btn btn-small',onclick:async()=>{await postJson(`${API}/automation/pause`,{});await refresh();}},'Pause phone control'));
        const checkbox=h('input',{type:'checkbox'});
        const button=h('button',{type:'button',class:'btn btn-small',disabled:true,onclick:async()=>{
            button.disabled=true;
            try{await postJson(`${API}/automation/allow-foreground`,{confirmed:checkbox.checked});await refresh();}
            catch(error){button.disabled=false;window.alert(error.message);}
        }},'Allow phone control');
        checkbox.addEventListener('change',()=>{button.disabled=!checkbox.checked;});
        return h('div',{class:'banner-note'},h('label',{},checkbox,' I’m ready for Phone Farm to use Mirroring.'),button,
            h('p',{text:'Mirroring takes focus during native tests and posts. This switch does not run a test. Each platform still needs a worker pilot.'}));
    }
    function renderNativeStoryApprovals() {
        const jobs=state.automation?.nativeStories||[];
        if(!jobs.length)return null;
        return h('details',{},h('summary',{text:'Native Story previews and approvals'}),jobs.map(job=>{
            if(job.state!=='waiting_native_approval') {
                const canPilot=job.state==='armed'&&!job.pilot&&Date.parse(job.run_at)>Date.now();
                return h('div',{},h('p',{text:`${job.title}: ${job.state.replace(/_/g,' ')}.`}),canPilot?h('button',{type:'button',class:'btn btn-small',disabled:state.cadence?.runtime?.controlMode==='mirroring'&&!state.automation.foregroundAllowed,onclick:async()=>{
                    if(!window.confirm('Publish these five approved frames once through the worker? Each frame needs both Instagram and Facebook receipts.'))return;
                    try{await postJson(`${API}/stories/native/${job.id}/pilot`,{});await refresh();}catch(error){window.alert(error.message);}
                }},'Post one Story worker pilot'):null);
            }
            const selected=new Set();
            const approve=h('button',{type:'button',class:'btn btn-small',disabled:true,onclick:async()=>{
                approve.disabled=true;
                try{await postJson(`${API}/stories/native/${job.id}/approve`,{revision:job.revision,reviewedFrames:[...selected],confirmed:true});await refresh();}
                catch(error){approve.disabled=false;window.alert(error.message);}
            }},'Approve these five native frames');
            return h('details',{},h('summary',{text:job.title}),[1,2,3,4,5].map(n=>{
                const box=h('input',{type:'checkbox',onchange:()=>{if(box.checked)selected.add(n);else selected.delete(n);approve.disabled=selected.size!==5;}});
                return h('figure',{},h('img',{src:`${API}/stories/native/${job.id}/frames/${n}`,alt:`Native Story frame ${n}`,style:'max-width:240px;width:100%;height:auto;'}),h('figcaption',{},h('label',{},box,` Reviewed frame ${n}`)));
            }),approve,h('p',{text:'Approval applies to this exact sequence and slot. It does not approve future assets.'}));
        }));
    }

    function renderError() {
        const el = $('load-error');
        if (!state.error) { el.hidden = true; return; }
        el.hidden = false;
        el.replaceChildren(h('div', { class: 'banner-main' }, icon('alert'), h('strong', { text: 'Could not load posts.' }),
            h('span', { text: `${state.error}. ${state.loaded ? `Showing data from ${stampFormat.format(state.loadedAt)}. ` : ''}Retrying every 30 seconds.` })));
    }

    // Oct 26 health strip: live captions, next-24 h supply per lane, comment pins, Mac services.
    function renderHealth() {
        const el = $('health'); if (!el) return;
        const hl = state.health;
        if (!hl) { el.replaceChildren(); return; }
        const tile = (label, value, sub, bad) => h('div', { class: `stat${bad ? ' is-alert' : ''}` },
            h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: String(value) }), h('div', { class: 'stat-sub', text: sub }));
        const c = hl.captions;
        const capBad = c && !c.lifted && c.emptySinceBlock > 0;
        const capTile = tile('Instagram captions', !c ? 'Unknown' : capBad ? 'Blocked' : 'OK',
            !c ? 'Caption check has not run yet' : capBad ? `${c.emptySinceBlock} Reels posted empty; newest ${whenFormat.format(new Date(c.newestEmpty))}. Checked ${whenFormat.format(new Date(c.checkedAt))}` : `Checked ${whenFormat.format(new Date(c.checkedAt))}`, capBad);
        const names = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'Shorts' };
        const short = hl.supply.filter(s => s.armed24h < s.target);
        const supplyTile = tile('Armed next 24 h', hl.supply.map(s => `${names[s.lane]} ${s.armed24h}/${s.target}`).join(' · '),
            short.length ? `Short: ${short.map(s => names[s.lane]).join(', ')}. Add or arm videos.` : 'Every lane is full', short.some(s => s.armed24h === 0));
        const n = (st) => (hl.pins.find(p => p.status === st) || {}).n || 0;
        const pinBad = n('failed_before_action') + n('uncertain_review');
        const pinTile = tile('Comment pins (72 h)', `${n('done')} done`, pinBad ? `${pinBad} failed or need review` : 'No failures', pinBad > n('done'));
        const down = hl.services.filter(s => !s.running && ['worker', 'web', 'wda', 'appium', 'tunnel', 'awake'].includes(s.name));
        const svcTile = tile('Mac services', down.length ? `${down.length} down` : 'All running', down.length ? down.map(s => s.name).join(', ') : `${hl.services.filter(s => s.running).length} running`, down.length > 0);
        const rearmTile = tile('Can be re-armed', hl.rearmable, hl.rearmable ? 'Stopped before Share. Use Re-arm on the post.' : 'Nothing stopped before Share', false);
        el.replaceChildren(capTile, supplyTile, pinTile, svcTile, rearmTile);
    }
    function renderSummary() {
        const el = $('summary');
        const today = todayKey();
        const live = state.cards.filter((m) => m.st.key !== 'cancelled');
        const todays = live.filter((m) => m.day === today);
        const deliveredToday = state.models.filter(m=>m.st.key==='posted' && m.day===today).flatMap(m=>m.targets).length;
        const posted = todays.filter((m) => m.st.key === 'posted').length;
        const scheduled = todays.filter((m) => m.st.key === 'scheduled' || m.st.key === 'posting').length;
        const held = todays.filter((m) => m.st.key === 'held' && m.runAt > Date.now()).length;
        const reviewAll = live.filter((m) => m.st.key === 'review');
        const reviewToday = reviewAll.filter((m) => m.day === today).length;
        const now = Date.now();
        const next = live.filter((m) => (m.st.key === 'scheduled' || m.st.key === 'held') && m.runAt > now).sort(sortModels)[0];
        const posting = live.find((m) => m.st.key === 'posting');

        const stat = (label, value, sub, extra) => h('div', { class: `stat${extra?.alert ? ' is-alert' : ''}` },
            h('div', { class: 'stat-label', text: label }), h('div', { class: 'stat-value', text: String(value) }),
            h('div', { class: `stat-sub${extra?.warn ? ' warn' : ''}`, text: sub }));

        let nextTile;
        const focus = posting || next;
        if (focus) {
            const isHeld = focus.st.key === 'held';
            nextTile = h('button', { type: 'button', class: 'stat stat-next', onclick: () => openItem(focus.item.id), title: 'Open this post' },
                thumb(focus.item, 'next'),
                h('div', { class: 'stat-next-body' },
                    h('div', { class: 'stat-label' }, posting ? 'Posting now' : 'Next post', ' · ', badge(focus.st, true)),
                    h('div', { class: 'stat-value' }, `${fmtKey(focus.day, { weekday: 'short' })} ${timeFormat.format(focus.runAt)} `,
                        posting ? null : h('span', { class: 'page-sub' }, countdown(focus.runAt, true))),
                    h('div', { class: `stat-sub${isHeld ? ' warn' : ''}`, text: `${focus.kw || focus.first || focus.item.media?.name || 'Post'}${isHeld ? ' · held, not armed yet' : ''}` })));
        } else {
            nextTile = h('div', { class: 'stat stat-next' }, h('div', { class: 'stat-next-body' },
                h('div', { class: 'stat-label', text: 'Next post' }), h('div', { class: 'stat-value', text: 'None upcoming' }),
                h('div', { class: 'stat-sub', text: 'No held or scheduled posts ahead.' })));
        }
        el.replaceChildren(
            stat('Posts today', todays.length, fmtKey(today, { weekday: 'short', month: 'short', day: 'numeric' })),
            stat('Platform posts confirmed', deliveredToday, `${posted} video groups complete across their saved destinations`),
            stat('Scheduled', scheduled, postingPaused() ? 'Automatic posting paused' : held ? `${held} groups held` : todays.length ? 'All armed or done' : 'Nothing today', { warn: held > 0 || postingPaused() }),
            stat('Needs review', reviewToday, reviewAll.length > reviewToday ? `+${reviewAll.length - reviewToday} on other days` : reviewToday ? 'Check the phone first' : 'Nothing to check', { alert: reviewAll.length > 0 }),
            nextTile,
        );
        // The side menu (static/shell/sidebar.js) shows these same numbers on every page.
        window.dispatchEvent(new CustomEvent('pf:counts', { detail: { today: todays.length, review: reviewAll.length, held: live.filter((m) => m.st.key === 'held' && m.runAt > now).length } }));
    }

    function renderTabs() {
        const ranged = state.cards.filter(inRange);
        const live = ranged.filter((m) => m.st.key !== 'cancelled');
        const counts = {
            all: live.length + (state.showCancelled ? ranged.length - live.length : 0),
            scheduled: live.filter((m) => m.st.key === 'scheduled' || m.st.key === 'posting').length,
            held: live.filter((m) => m.st.key === 'held').length,
            posted: live.filter((m) => m.st.key === 'posted').length,
            review: live.filter((m) => m.st.key === 'review').length,
        };
        const tabs = [['all', 'All'], ['scheduled', 'Scheduled'], ['held', 'Held'], ['posted', 'Posted'], ['review', 'Needs review']];
        $('tabs').replaceChildren(...tabs.map(([key, label]) => h('button', {
            type: 'button', role: 'tab', class: `tab${key === 'review' && counts.review ? ' is-alert' : ''}`,
            'aria-selected': String(state.filter === key), onclick: () => { state.filter = key; render(); },
        }, label, h('span', { class: 'count', text: String(counts[key]) }))));
        $('cancelled-count').textContent = String(ranged.length - live.length);
        $('show-cancelled').checked = state.showCancelled;
    }

    function renderRange() {
        const end = addDays(state.start, 6);
        const sameYear = state.start.slice(0, 4) === end.slice(0, 4);
        $('range-label').textContent = `${fmtKey(state.start, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} to ${fmtKey(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        $('today').disabled = state.start === todayKey();
        const live = state.cards.filter((m) => m.st.key !== 'cancelled' && m.day);
        const earlier = live.filter((m) => m.day < state.start).sort(sortModels);
        const later = live.filter((m) => m.day > end).sort(sortModels);
        const parts = [];
        if (earlier.length) parts.push(h('button', { type: 'button', onclick: () => jumpTo(earlier[earlier.length - 1].day) }, `${earlier.length} earlier`));
        if (later.length) parts.push(h('button', { type: 'button', onclick: () => jumpTo(later[0].day) }, `${later.length} later, next ${fmtKey(later[0].day, { month: 'short', day: 'numeric' })}`));
        const outside = $('range-outside');
        outside.replaceChildren(...(parts.length ? ['Outside this range: ', ...parts.flatMap((p, i) => i ? [' · ', p] : [p])] : []));
    }
    function jumpTo(key) { state.start = key; render(); window.scrollTo({ top: $('tabs').offsetTop - 70, behavior: 'smooth' }); }

    // Daily Story
    function storyFor(key) {
        return state.engagements.filter((e) => isStory(e) && storyDay(e) === key)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;
    }
    function storyCell(key, compact) {
        const today = todayKey();
        const e = storyFor(key);
        const day = compact ? null : h('div', { class: 'story-day', text: `${fmtKey(key, { weekday: 'short' })} ${Number(key.slice(8))}` });
        const cls = `story-cell${key === today && !compact ? ' is-today' : ''}`;
        if (!e) {
            let text = state.sources.engagements ? 'Story data unavailable' : key < today ? 'No Story' : key === today ? 'Not shared yet' : 'Not yet';
            if (compact && !state.sources.engagements) text = key < today ? 'No Story' : key === today ? 'Story not shared yet' : '';
            if (compact && !text) return null;
            return h('div', { class: cls }, h('div', { class: 'story-body' }, day, h('div', { class: 'story-state', text })));
        }
        const info = engagementInfo(e);
        const key2 = igKey(e.post_url);
        const post = state.models.find((m) => m.ig && igKey(m.ig.url) === key2);
        const stateText = h('div', { class: `story-state ${info.level === 'ok' ? 'ok' : info.level === 'fail' ? 'bad' : info.level === 'wait' ? 'run' : ''}`, text: compact ? `Story: ${info.text}` : info.text });
        if (post) {
            return h('button', { type: 'button', class: cls, title: `Story on ${key}: ${post.kw || post.first}. ${info.text}.`, onclick: () => openItem(post.item.id) },
                compact ? null : thumb(post.item, 'story'), h('div', { class: 'story-body' }, day, h('div', { class: 'story-kw', text: post.kw || post.first || 'Reel' }), stateText));
        }
        const url = safeUrl(e.post_url, 'instagram.com');
        return h('div', { class: cls, title: e.post_url || '' }, h('div', { class: 'story-body' }, day,
            url ? h('a', { class: 'story-kw', href: url, target: '_blank', rel: 'noopener', text: 'Reel' }) : h('div', { class: 'story-kw', text: 'Reel' }), stateText));
    }
    function renderStories() {
        const el = $('stories');
        el.hidden = state.view !== 'list';
        if (el.hidden) return;
        el.replaceChildren(h('div', { class: 'stories-label' }, 'Daily Story', h('span', { text: 'Reel shared to Story' })),
            ...rangeKeys().map((key) => storyCell(key, false)));
    }

    // List view (Buffer Publish list)
    function postCard(m) {
        const { item, st } = m;
        const handle = (m.targets.find((t) => t.platform === 'instagram') || m.targets[0] || {}).account || 'unknown';
        const primary = PLATFORM_CLASS[(m.targets.find((t) => t.platform === 'instagram') || m.targets[0] || {}).platform] || 'ig';
        const card = h('article', { class: `post${st.key === 'cancelled' ? ' is-cancelled' : ''}${st.key === 'review' ? ' is-review' : ''}`, dataset: { id: item.id } });
        if (st.key === 'review') card.append(h('div', { class: 'post-banner' }, icon('alert'), h('span', { text: st.error })));
        const main = h('div', { class: 'post-main' },
            h('div', { class: 'post-head' },
                h('span', { class: 'avatar', 'aria-hidden': 'true' }, String(handle).replace(/^@/, '').slice(0, 1).toUpperCase(), h('span', { class: 'avatar-badge', style: `background: var(--${primary})` })),
                h('span', { class: 'handle', text: String(handle).startsWith('http') ? 'Facebook Page' : String(handle).replace(/^@/, '') }),
                h('span', { class: 'chips' }, platformChips(m))),
            m.kw ? h('div', { class: 'keyword', text: m.kw }) : h('div', { class: 'keyword none', text: 'No comment keyword' }),
            m.first ? h('p', { class: 'firstline', text: m.first }) : h('p', { class: 'firstline', text: 'No caption' }),
            m.input.firstComment ? h('div', { class: 'pin-line', title: 'First comment to pin' }, icon('pin'), h('span', { text: m.input.firstComment })) : null);
        card.append(h('div', { class: 'post-body' }, main, thumb(item, 'big')));
        card.append(destinationRows(m.members || [m]));
        const created = Date.parse(item.createdAt);
        card.append(h('footer', { class: 'post-foot' },
            h('span', { class: 'post-meta' }, `Saved ${Number.isFinite(created) ? relative(created - Date.now()) : ''} · version ${item.version} · `, h('code', { text: item.media?.name || item.id.slice(0, 8) })),
            h('span', { class: 'post-actions' },
                m.ig ? linkButton(m.ig.url, 'Instagram') : null,
                m.fb ? linkButton(m.fb.url, 'Facebook') : null,
                h('button', { type: 'button', class: 'btn btn-small', onclick: () => openItem(item.id) }, 'Details'))));
        card.addEventListener('click', (event) => { if (!event.target.closest('a, button')) openItem(item.id); });
        return card;
    }
    function slot(m) {
        const future = Number.isFinite(m.runAt) && m.runAt > Date.now();
        const showRel = future && m.st.key !== 'cancelled';
        return h('div', { class: 'slot' },
            h('div', { class: 'gutter' },
                h('div', { class: 'gutter-time', text: Number.isFinite(m.runAt) ? timeFormat.format(m.runAt) : 'No time' }),
                badge(m.st),
                showRel ? h('div', { class: 'gutter-rel' }, countdown(m.runAt)) : null,
                m.st.note && m.st.key !== 'cancelled' ? h('div', { class: `gutter-note${m.st.noteBad ? ' bad' : ''}`, text: m.st.note }) : null),
            postCard(m));
    }
    function destinationRows(members) {
        return h('div',{class:'destination-rows'},['instagram','facebook','youtube','tiktok'].map(platform=>{
            const matches=members.filter(m=>m.targets.some(t=>t.platform===platform));
            return h('div',{class:'destination-row'},h('strong',{text:PLATFORM[platform]}),matches.length ? matches.map(m=>h('div',{},
                h('button',{type:'button',class:'btn btn-small',onclick:()=>openItem(m.item.id)},m.st.label,' · ',Number.isFinite(m.runAt)?whenFormat.format(m.runAt):'No time'),
                m.st.note?h('small',{class:'destination-note',text:m.st.note}):null,
                m.st.error?h('small',{class:'destination-note bad',text:m.st.error}):null,
                m.st.key==='review'&&m.st.note!=='Share was attempted'?h('button',{type:'button',class:'btn btn-small',onclick:async(e)=>{
                    e.stopPropagation();const b=e.currentTarget;b.disabled=true;b.textContent='Re-arming…';
                    try{const r=await postJson(`${API}/items/${encodeURIComponent(m.item.id)}/rearm`,{});b.textContent=`Re-armed for ${whenFormat.format(new Date(r.runAt))}`;await refresh();}
                    catch(err){b.disabled=false;b.textContent='Re-arm failed: '+(err.message||err);}
                }},'Re-arm'):null,
                h('details',{},h('summary',{text:'Checks and next steps'}),h('ul',{class:'checks'},m.checks.filter(c=>!['facebook','facebookComment'].includes(c.key)||platform==='facebook').map(checkPill)))
            )) : h('span',{text:'No destination prepared'}));
        }));
    }
    function slotGroups(models) { return models.map(m=>[m]); }
    function groupedSlot(group) { return slot(group[0]); }
    function emptyState(visibleInRange) {
        const live = state.cards.filter((m) => m.st.key !== 'cancelled' && m.day);
        const end = addDays(state.start, 6);
        const later = live.filter((m) => m.day > end).sort(sortModels)[0];
        const earlier = live.filter((m) => m.day < state.start).sort(sortModels).pop();
        if (!state.items.length) {
            return h('div', { class: 'empty-card' }, h('strong', { text: 'No videos in the calendar yet.' }),
                h('span', {}, 'Use Add video, or run ', h('code', { text: 'python3 scripts/publishing.py prepare' }), '.'));
        }
        const filterName = { scheduled: 'scheduled', held: 'held', posted: 'posted', review: 'needing review' }[state.filter];
        const title = visibleInRange && filterName ? `No ${filterName} posts in this range.` : `No posts from ${fmtKey(state.start, { month: 'short', day: 'numeric' })} to ${fmtKey(end, { month: 'short', day: 'numeric' })}.`;
        return h('div', { class: 'empty-card' }, h('strong', { text: title }),
            h('div', { class: 'post-actions' },
                later ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => jumpTo(later.day) }, `Jump to next post, ${fmtKey(later.day, { month: 'short', day: 'numeric' })}`) : null,
                earlier ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => jumpTo(earlier.day) }, `Go to last post, ${fmtKey(earlier.day, { month: 'short', day: 'numeric' })}`) : null,
                state.start !== todayKey() ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => jumpTo(todayKey()) }, 'Back to today') : null,
                !later && !earlier && !state.showCancelled ? h('span', { text: 'Only cancelled posts exist. Turn on Show cancelled to see them.' }) : null));
    }
    function renderList(visible) {
        const root = $('calendar');
        const anyInRange = state.cards.some((m) => inRange(m) && (m.st.key !== 'cancelled' || state.showCancelled));
        if (!visible.length) { root.replaceChildren(emptyState(anyInRange)); return; }
        const byDay = new Map();
        for (const m of visible) { if (!byDay.has(m.day)) byDay.set(m.day, []); byDay.get(m.day).push(m); }
        root.replaceChildren(...rangeKeys().map((key) => {
            const posts = (byDay.get(key) || []).sort(sortModels);
            const [label, date, weekday] = dayHeading(key);
            const live = slotGroups(posts.filter((m) => m.st.key !== 'cancelled')).length;
            const cancelled = posts.filter(m=>m.st.key === 'cancelled').length;
            const count = posts.length ? `${live} video slot${live === 1 ? '' : 's'}${cancelled ? `, ${cancelled} cancelled` : ''}` : '';
            return h('section', { class: 'day', 'aria-label': `${label}, ${date}` },
                h('h2', { class: 'day-head' }, h('span', {}, h('strong', { text: `${label}, ` }), date),
                    h('span', { class: 'day-count', text: [weekday, count].filter(Boolean).join(' · ') })),
                posts.length ? slotGroups(posts).map(groupedSlot) : h('div', { class: 'slot' }, h('div'), h('div', { class: 'empty-slot', text: 'No posts' })));
        }));
    }

    // Week view (Buffer calendar week)
    function weekCard(m) {
        return h('button', { type: 'button', class: `wcard st-border-${m.st.key}`, onclick: () => openItem(m.item.id), title: `${timeFormat.format(m.runAt)} · ${m.st.label}${m.st.note ? ' · ' + m.st.note : ''}` },
            h('div', { class: 'wcard-main' },
                h('div', { class: 'wcard-time' }, h('i', { style: `background: var(--${PLATFORM_CLASS[(m.targets.find((t) => t.platform === 'instagram') || m.targets[0] || {}).platform] || 'ig'})` }), timeFormat.format(m.runAt)),
                h('div', { class: 'wcard-kw', text: m.kw || 'No keyword' }),
                h('div', { class: 'wcard-cap', text: m.first }),
                badge(m.st, true),
                h('div', { class: 'wcard-flags' }, m.checks.map((c) => h('span', { class: `flag ${c.level}`, title: `${c.label}: ${c.short}` })))),
            thumb(m.item, 'mini'));
    }
    function renderWeek(visible) {
        const root = $('calendar');
        const today = todayKey();
        const grid = h('div', { class: 'week' }, rangeKeys().map((key) => {
            const posts = visible.filter((m) => m.day === key).sort(sortModels);
            return h('div', { class: `week-col${key === today ? ' is-today' : ''}${key < today ? ' is-past' : ''}` },
                h('div', { class: 'week-head' }, h('strong', { text: fmtKey(key, { weekday: 'short' }) }), ' ', fmtKey(key, { month: 'short', day: 'numeric' }),
                    storyCell(key, true)),
                h('div', { class: 'week-body' }, posts.length ? posts.map(m=>h('article',{class:'wcard'},h('strong',{text:timeFormat.format(m.runAt)+' · '+(m.kw||m.first)}),destinationRows(m.members||[m]))) : h('div', { class: 'week-empty', text: 'No posts' })));
        }));
        const nodes = [grid];
        if (!visible.length) nodes.unshift(emptyState(state.cards.some((m) => inRange(m) && (m.st.key !== 'cancelled' || state.showCancelled))));
        root.replaceChildren(...nodes);
    }

    function render() {
        const today = todayKey();
        if (today !== state.today) { if (state.start === state.today) state.start = today; state.today = today; }
        state.models = state.items.map(buildModel);
        state.cards = contentGroups(state.models);
        state.byId = new Map(state.models.map((m) => [m.item.id, m]));
        const handles = state.cards.filter((m) => m.st.key !== 'cancelled').flatMap((m) => m.targets.filter((t) => t.platform === 'instagram').map((t) => t.account));
        if (handles.length) $('account-line').textContent = '@' + String(handles[0]).replace(/^@/, '');
        $('tz-abbr').textContent = tzAbbr();
        $('view-list').setAttribute('aria-pressed', String(state.view === 'list'));
        $('view-week').setAttribute('aria-pressed', String(state.view === 'week'));
        renderCaps();
        renderError();
        renderSummary();
        renderHealth();
        renderTabs();
        renderRange();
        renderStories();
        if (!state.loaded) {
            $('calendar').replaceChildren(h('div', { class: 'empty-card' }, state.error ? h('strong', { text: 'The calendar could not load.' }) : h('span', { class: 'spinner', 'aria-hidden': 'true' }),
                state.error ? h('span', { text: state.error }) : 'Loading the calendar…'));
        } else {
            const visible = state.cards.filter((m) => inRange(m) && matchesFilter(m)).sort(sortModels);
            if (state.view === 'week') renderWeek(visible); else renderList(visible);
        }
        if (state.drawer?.mode === 'item') renderDrawerItem(false);
        updateClock();
    }

    // ---------- drawer ----------
    let lastFocus = null;
    let drawerMediaKey = '';
    function showDrawer() {
        if ($('drawer').hidden) lastFocus = document.activeElement;
        $('drawer').hidden = false;
        $('scrim').hidden = false;
        document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
        const video = $('drawer-media').querySelector('video');
        if (video) video.pause();
        state.drawer = null;
        drawerMediaKey = '';
        $('drawer').hidden = true;
        $('scrim').hidden = true;
        document.body.style.overflow = '';
        $('drawer-media').replaceChildren();
        $('drawer-info').replaceChildren();
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }
    function openItem(id) {
        const wasOpen = state.drawer?.mode === 'item' && state.drawer.id === id;
        state.drawer = { mode: 'item', id, message: wasOpen ? state.drawer.message : '', bad: wasOpen ? state.drawer.bad : false };
        history.replaceState(null, '', `#post=${encodeURIComponent(id)}`);
        showDrawer();
        renderDrawerItem(true);
        $('drawer-close').focus();
    }
    function section(title, ...children) { return h('section', { class: 'd-section' }, title ? h('h3', { text: title }) : null, ...children); }
    function kv(rows) {
        return h('dl', { class: 'kv' }, rows.filter(Boolean).flatMap(([k, v, mono]) => [h('dt', { text: k }), h('dd', { class: mono ? 'mono' : '' }, v === '' || v === null || v === undefined ? '—' : v)]));
    }
    function jsonBlock(key, title, value) {
        return h('details', { class: 'json', dataset: { key } }, h('summary', { text: title }), h('pre', { text: JSON.stringify(value, null, 2) }));
    }
    function renderDrawerItem(fresh) {
        const drawer = state.drawer;
        if (!drawer || drawer.mode !== 'item') return;
        const m = state.byId.get(drawer.id);
        const info = $('drawer-info');
        const scroller = $('drawer-scroll');
        if (!m) {
            $('drawer-title').replaceChildren(h('span', { class: 't', text: 'Post not found' }));
            $('drawer-media').replaceChildren();
            drawerMediaKey = '';
            info.replaceChildren(section('', h('p', { text: state.loaded ? 'This post is no longer in the calendar.' : 'Loading…' })));
            return;
        }
        const { item, input, st, rel } = m;
        const openKeys = new Set([...info.querySelectorAll('details[data-key]')].filter((d) => d.open).map((d) => d.dataset.key));
        const scrollTop = scroller.scrollTop;

        $('drawer-title').replaceChildren(badge(st), h('span', { class: 't', text: Number.isFinite(m.runAt) ? whenFormat.format(m.runAt) : 'No target time' }));
        const mediaKey = `${item.id}:${item.media?.sha256 || ''}`;
        if (fresh || mediaKey !== drawerMediaKey) {
            drawerMediaKey = mediaKey;
            if (item.media) {
                const player = h('video', { muted: true, controls: true, playsinline: true, preload: 'metadata', src: videoUrl(item) });
                player.muted = true;
                if (item.cover) player.poster = `${API}/items/${encodeURIComponent(item.id)}/media/cover`;
                const cropPanel = h('section', {class:'cover-crop-preview'});
                const frameLabel = h('p', {text:'Opening frame at 0.00 seconds'});
                const slider = h('input', {type:'range',min:'0',max:'5',step:'0.05',value:'0','aria-label':'Opening frame time'});
                const portrait = h('canvas', {width:'270',height:'480',style:'width:45%;height:auto;border-radius:8px'});
                const grid = h('canvas', {width:'270',height:'360',style:'width:45%;height:auto;border-radius:8px'});
                const draw = () => {
                    if (!player.videoWidth) return;
                    const w=player.videoWidth, ht=player.videoHeight;
                    portrait.getContext('2d').drawImage(player,0,0,w,ht,0,0,270,480);
                    const ch=Math.min(ht,w*4/3),cw=Math.min(w,ht*3/4);
                    grid.getContext('2d').drawImage(player,(w-cw)/2,(ht-ch)/2,cw,ch,0,0,270,360);
                    frameLabel.textContent=`Video frame at ${player.currentTime.toFixed(2)} seconds`;
                };
                player.addEventListener('loadedmetadata',()=>{slider.max=String(Math.min(5,player.duration));player.currentTime=0;draw();});
                player.addEventListener('seeked',draw);
                slider.addEventListener('input',()=>{player.pause();player.currentTime=Number(slider.value);});
                cropPanel.append(h('h3',{text:'Cover crop preview'}),h('p',{text:item.results?.release?.cover?.profileCropVerified ? 'Cover set and crop checked on the phone: ' + item.results.release.cover.title + '. The slider below is a preview and does not change the posted cover.' : 'Full Reel (9:16) and centered profile crop (3:4). Preview only: this selection is not yet saved or applied on the phone.'}),frameLabel,slider,h('div',{style:'display:flex;align-items:center;gap:12px'},portrait,grid));
                $('drawer-media').replaceChildren(player,cropPanel);
            } else $('drawer-media').replaceChildren(h('div', { class: 'thumb-missing', text: 'No video on this item.' }));
        }

        const sections = [section('This video across all platforms', destinationRows(state.cards.find(g=>g.members.some(x=>x.item.id===item.id))?.members || [m]))];
        const future = Number.isFinite(m.runAt) && m.runAt > Date.now();
        sections.push(section('',
            h('div', { class: 'd-hero' },
                h('div', {}, h('div', { class: 'd-kw', text: m.kw || 'No comment keyword' }),
                    h('div', { class: 'd-when' }, Number.isFinite(m.runAt) ? `${whenFormat.format(m.runAt)} ${tzAbbr()} · ` : '', Number.isFinite(m.runAt) ? countdown(m.runAt, future) : '')),
                badge(st)),
            h('div', { class: 'chips', style: 'margin: 10px 0 0' }, platformChips(m)),
            m.ig || m.fb ? h('div', { class: 'd-links' }, m.ig ? linkButton(m.ig.url, 'Open on Instagram') : null, m.fb ? linkButton(m.fb.url, 'Open on Facebook') : null) : null,
            st.key === 'review' ? h('div', { class: 'd-error', text: st.error }) : null,
            st.note && st.key !== 'review' && st.key !== 'cancelled' ? h('div', { class: 'd-note', text: st.note + (st.key === 'held' ? '. Saved items do not post by themselves.' : '') }) : null,
            input.timezone && input.timezone !== TZ ? h('div', { class: 'd-note', text: `This item was saved with timezone ${input.timezone}. Times here are shown in Los Angeles.` }) : null));

        sections.push(section('Checklist', h('ul', { class: 'd-checks' }, m.checks.map((c) => h('li', { class: c.level }, icon(c.level), h('span', { class: 'k', text: c.label }), h('span', { class: 'v' }, h('b', { text: c.short }), c.detail && c.detail !== c.short ? ` · ${c.detail}` : ''))))));

        const caption = String(input.caption || '');
        if (input.youtube) sections.push(section('YouTube Shorts', kv([
            ['Title', input.youtube.title], ['Channel ID', input.youtube.channelId],
            ['Visibility', input.youtube.visibility], ['Audience', input.youtube.madeForKids ? 'Made for kids' : 'Not made for kids'],
            ['Upload', 'Preparation only. Native upload testing is pending.'],
            ['Related video', input.youtube.publishing?.relatedVideoId || 'Needs selection or review'],
            ['Category', input.youtube.publishing?.category || 'Not set'],
            ['Tags', input.youtube.publishing?.tags?.join(', ') || 'Not set'],
            ['Comment keyword', input.youtube.publishing?.commentKeyword || 'Not set'],
            ['Hashtags', input.youtube.publishing?.hashtags?.join(' ') || 'Not set'],
            ['AI use', input.youtube.publishing?.aiUse || 'Review required'],
            ['Cover', item.results?.youtubeCover ? 'First frame replaced. Original preserved. YouTube thumbnail selection is unverified.' : 'Existing video frame'],
        ])));
        sections.push(section('Caption', h('div', { class: 'd-text', text: caption || 'No caption.' }), h('div', { class: 'd-count', text: `${caption.length} of ${input.youtube ? '5,000' : '2,200'} characters` })));
        const pinInfo = m.pin ? engagementInfo(m.pin) : null;
        sections.push(section('First comment', h('div', { class: 'd-text', text: input.firstComment || 'None set.' }),
            input.firstComment ? h('div', { class: 'd-count', text: pinInfo ? `Pin status: ${pinInfo.text} (${stamp(m.pin.updated_at)})` : 'See each platform comment result in the checks above.' }) : null));

        sections.push(section('Targets',
            h('table', { class: 'targets' }, h('thead', {}, h('tr', {}, h('th', { text: 'Platform' }), h('th', { text: 'Account' }), h('th', { text: 'Delivery' }), h('th', { text: 'Post' }))),
                h('tbody', {}, m.targets.length ? m.targets.map((t) => {
                    const r = t.platform === 'instagram' ? m.ig : t.platform === 'facebook' ? m.fb : t.platform === 'tiktok' ? m.tt : null;
                    const delivery = t.platform === 'instagram' ? (input.instagramTrial ? 'Trial Reel' : 'Reel')
                        : t.platform === 'facebook' ? (input.facebookMode === 'linked_from_instagram' ? 'Linked from Instagram' : 'Separate post') : 'Native post';
                    const label = t.platform === 'facebook' && String(t.account).includes(FB_PAGE_ID) ? `Antonio Revenue (${t.account})` : t.account;
                    return h('tr', {}, h('td', { text: PLATFORM[t.platform] || t.platform }), h('td', { text: label }), h('td', { text: delivery }),
                        h('td', {}, r ? h('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'Open' }) : '—'));
                }) : h('tr', {}, h('td', { colspan: '4', text: 'No targets.' })))),
            h('div', { style: 'height: 10px' }),
            kv([
                ['Trial Reel', input.instagramTrial ? 'On' : 'Off'],
                ['Automatic promotion', input.automaticPromotion ? 'On' : 'Off'],
                ['Facebook mode', input.facebookMode === 'linked_from_instagram' ? 'Linked from Instagram' : input.facebookMode === 'direct' ? 'Separate post' : input.facebookMode],
                ['Target time (UTC)', input.runAt, true],
                ['Saved timezone', input.timezone],
                ['Phone', input.deviceUdid, true],
            ])));

        const releaseRows = rel ? kv([
            ['State', cap(rel.state)],
            ['Runs at', Number.isFinite(Date.parse(rel.run_at)) ? `${whenFormat.format(Date.parse(rel.run_at))} ${tzAbbr()}` : rel.run_at],
            ['Armed version', `v${rel.item_version}${rel.state === 'armed' && rel.item_version !== item.version ? ` (item is v${item.version}, so this release will stop)` : ''}`],
            ['Share claimed', rel.share_claimed_at ? stamp(rel.share_claimed_at) : 'No'],
            ['Updated', stamp(rel.updated_at)],
        ]) : h('p', { class: 'd-count', text: state.sources.releases ? `Release data unavailable: ${state.sources.releases}` : 'No timed release is armed for this post.' });
        sections.push(section('Timed release', releaseRows,
            rel ? jsonBlock('release-result', 'Release job result (JSON)', rel.result ?? {}) : null,
            item.results?.release ? jsonBlock('item-release', 'Item release receipt (JSON)', item.results.release) : null));

        const externalYouTube = item.results?.externalYouTubeDelivery;
        const externalYouTubeUrl = safeUrl(externalYouTube?.publicUrl, 'youtube.com');
        if (externalYouTube?.doNotReupload === true && externalYouTube.verifiedSourceHash === item.media?.sha256 && externalYouTubeUrl) {
            sections.push(section('Existing YouTube delivery',
                h('p', { text: 'This source already posted through the previous schedule. Review the existing video instead of uploading it again.' }),
                h('a', { href: externalYouTubeUrl, target: '_blank', rel: 'noopener', text: 'Open published Short' }),
                kv([['Details review', 'Caption, cover, related video and comment still need review'], ['Checked', stamp(externalYouTube.checkedAt)]])));
        }
        const preview = item.results?.instagramPreview;
        if (preview) {
            sections.push(section('Phone preview',
                kv([
                    ['Status', String(preview.status || '').replace(/_/g, ' ')],
                    ['Checked', stamp(preview.checkedAt)],
                    ['Caption matched', preview.captionVerified ? 'Yes' : 'No'],
                    ['Auto promotion verified', preview.automaticPromotionVerified ? 'Yes' : 'No'],
                    ['Exact media verified', preview.exactMediaSelectionVerified ? 'Yes' : 'No'],
                    ['Facebook verified', preview.facebookDeliveryVerified ? 'Yes' : 'No'],
                    preview.executionId ? ['Execution', h('a', { href: `/api/executions/${encodeURIComponent(preview.executionId)}`, target: '_blank', rel: 'noopener', text: preview.executionId }), true] : null,
                ]),
                preview.nextAction || preview.error ? h('p', { class: 'd-count', text: preview.error || preview.nextAction }) : null,
                jsonBlock('preview', 'Preview result (JSON)', preview)));
        }

        const engagements = [m.pin, ...m.stories].filter(Boolean);
        if (engagements.length) {
            sections.push(section('After-post actions', ...engagements.map((e) => {
                const i = engagementInfo(e);
                return h('div', { style: 'margin-bottom: 8px' },
                    h('div', { class: `check ${i.level}` }, icon(i.level), h('b', { text: isPin(e) ? 'Pin comment' : `Story ${storyDay(e)}` }), h('small', { text: `${i.text} · ${stamp(e.updated_at)}` })),
                    jsonBlock(`eng-${e.claim_key}`, 'Result (JSON)', e));
            })));
        }

        sections.push(section('Identifiers', kv([
            ['Item ID', item.id, true],
            ['Version', String(item.version)],
            ['Item status', item.status],
            ['Request ID', input.requestId, true],
            ['Video', `${item.media?.name || '—'} · ${mb(item.media?.size)}`],
            ['Video SHA-256', item.media?.sha256, true],
            ['Cover', item.cover?.name || 'Video frame'],
            ['Created', stamp(item.createdAt)],
            ['Updated', stamp(item.updatedAt)],
        ]), jsonBlock('raw', 'Full item (JSON)', item)));

        const actions = [];
        if (item.status === 'held') {
            const allReady = m.targets.every(t => state.caps?.platforms?.[t.platform]?.ready);
            const layoutAvailable = m.targets.every(t => state.caps?.platforms?.[t.platform]?.layoutAvailable);
            const foregroundAllowed = state.automation?.foregroundAllowed === true;
            const separateTikTok = !m.targets.some(t => t.platform === 'tiktok') || m.targets.length === 1;
            if (!rel && m.runAt > Date.now() && (allReady || layoutAvailable) && separateTikTok)
                actions.push(h('button', {type:'button',class:'btn btn-small',onclick:e=>armItem(m,e.currentTarget)}, allReady ? 'Arm scheduled post' : 'Arm for worker test'));
            const busy = [...state.releases.values()].some((r) => r.state === 'running' || (r.state === 'armed' && Math.abs(Date.parse(r.run_at) - Date.now()) < 20 * 60_000));
            if (state.caps?.controlMode === 'mirroring' && layoutAvailable) {
                actions.push(h('button',{type:'button',class:'btn btn-small',disabled:!foregroundAllowed,onclick:e=>nativeTest(m,e.currentTarget,'dry-run')},'Dry run without Share'));
                if(rel?.state==='armed' && m.runAt>Date.now() && m.runAt<Date.now()+10*60_000)actions.push(h('button',{type:'button',class:'btn btn-small',disabled:!foregroundAllowed,onclick:e=>nativeTest(m,e.currentTarget,'pilot')},'Post one worker pilot'));
            }
            if (state.caps?.controlMode !== 'mirroring' && m.targets.some((t) => t.platform === 'instagram')) {
                if (item.results?.previewScheduleId) actions.push(h('a', { class: 'btn btn-small', href: '/tasks' }, 'View preview task'));
                else actions.push(h('button', { type: 'button', class: 'btn btn-small', disabled: busy || null, title: busy ? 'A post is running or due within 20 minutes. Keep the phone free.' : '', onclick: (e) => previewItem(m, e.currentTarget) }, 'Prepare Instagram preview'));
            }
            actions.push(h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: (e) => cancelItem(m, e.currentTarget) }, 'Cancel this post'));
        }
        if (actions.length || drawer.message) {
            sections.push(section('Actions', h('div', { class: 'd-actions' }, actions),
                actions.length ? h('div', { class: 'd-actions-note', text: 'Arm schedules automatic posting at the saved time. Preview opens the Instagram composer on the phone and stops before Share. Cancel keeps the item as cancelled so it never posts.' }) : null,
                drawer.message ? h('div', { class: `d-message${drawer.bad ? ' bad' : ''}`, text: drawer.message }) : null));
        }

        info.replaceChildren(...sections);
        for (const d of info.querySelectorAll('details[data-key]')) if (openKeys.has(d.dataset.key)) d.open = true;
        if (!fresh) scroller.scrollTop = scrollTop; else scroller.scrollTop = 0;
    }
    async function nativeTest(m,button,kind){
        if(kind==='pilot'&&!window.confirm('Post this exact video once through the app worker? It will publish to the saved accounts.'))return;
        button.disabled=true;
        try{await postJson(`${API}/automation/${kind}`,{itemId:m.item.id,version:m.item.version});if(state.drawer?.id===m.item.id)Object.assign(state.drawer,{message:kind==='pilot'?'One worker pilot is queued. Check its platform receipts.':'Dry run passed. Nothing was shared. A worker pilot is still required.',bad:false});}
        catch(error){if(state.drawer?.id===m.item.id)Object.assign(state.drawer,{message:error.message,bad:true});}
        await refresh();
    }
    async function armItem(m, button) {
        button.disabled = true;
        try {
            await postJson(`${API}/items/${encodeURIComponent(m.item.id)}/arm`, {version:m.item.version});
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, {message:postingPaused() ? 'Armed. Automatic posting is paused.' : 'Armed. This video will post on the phone at its scheduled time.',bad:false});
        } catch(error) {
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, {message:error.message,bad:true});
        }
        await refresh();
    }
    async function cancelItem(m, button) {
        const label = `${m.kw || m.item.media?.name || 'this post'} at ${Number.isFinite(m.runAt) ? whenFormat.format(m.runAt) : 'no time'}`;
        if (!window.confirm(`Cancel ${label}?\n\nIt stays in the calendar as cancelled and will not post.`)) return;
        button.disabled = true;
        try {
            await postJson(`${API}/items/${encodeURIComponent(m.item.id)}/cancel`, { version: m.item.version });
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, { message: 'Cancelled. Nothing was posted.', bad: false });
        } catch (error) {
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, { message: error.message, bad: true });
        }
        await refresh();
    }
    async function previewItem(m, button) {
        if (!window.confirm('Open the Instagram composer on the phone for this post?\n\nThe phone imports the video, checks the settings and stops before Share. Do not run this while a post is about to go out.')) return;
        button.disabled = true;
        try {
            await postJson(`${API}/items/${encodeURIComponent(m.item.id)}/preview`, { version: m.item.version });
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, { message: 'Preview queued. The phone stops before Share. Follow it on the Tasks page.', bad: false });
        } catch (error) {
            if (state.drawer?.id === m.item.id) Object.assign(state.drawer, { message: error.message, bad: true });
        }
        await refresh();
    }

    // Add video (the existing save-on-hold form, moved into the drawer)
    function newRequestId() {
        return window.crypto?.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    async function openAdd() {
        state.drawer = { mode: 'add' };
        drawerMediaKey = '';
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        showDrawer();
        $('drawer-title').replaceChildren(h('span', { class: 't', text: 'Add a video' }));
        $('drawer-media').replaceChildren();
        const form = $('add-form-template').content.firstElementChild.cloneNode(true);
        $('drawer-info').replaceChildren(form);
        $('drawer-scroll').scrollTop = 0;
        let requestId = newRequestId();
        const message = form.querySelector('#form-message');
        const save = form.querySelector('#save');
        form.querySelector('#timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const occupied = new Set(state.items.filter(i=>i.status!=='cancelled' && Date.parse(i.input.runAt)>Date.now()).map(i=>Date.parse(i.input.runAt)));
        const freeSlot = state.cadence?.upcomingVideoSlots?.find(t=>Date.parse(t)>Date.now()+15*60000 && !occupied.has(Date.parse(t)));
        const soon = new Date(freeSlot || Date.now() + 3600000);
        form.querySelector('#runAt').value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        form.addEventListener('input', () => { requestId = newRequestId(); });
        form.querySelector('#youtube').addEventListener('change', () => {
            const youtube = form.querySelector('#youtube').checked;
            form.querySelector('#youtube-details').hidden = !youtube;
            form.querySelector('#caption').maxLength = youtube ? 5000 : 2200;
            for (const id of ['yt-account','yt-channel','yt-title','yt-audience','yt-tags','yt-keyword','yt-hashtags']) form.querySelector('#'+id).required = youtube;
            if (youtube) for (const id of ['instagram','facebook','tiktok','trial']) form.querySelector('#'+id).checked = false;
        });
        form.querySelector('#device').focus();
        try {
            const devices = await getJson('/api/devices');
            for (const d of (Array.isArray(devices) ? devices : []).filter((x) => !x.disabled)) {
                form.querySelector('#device').append(h('option', { value: d.udid, text: `${d.name}${d.connected ? ' (connected)' : ' (offline)'}` }));
            }
            if (!form.querySelector('#device').options.length) { save.disabled = true; message.textContent = 'Register a phone first.'; }
        } catch (error) { message.textContent = `Could not load phones: ${error.message}`; }
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            save.disabled = true;
            message.textContent = 'Saving video…';
            try {
                const q = (id) => form.querySelector('#' + id);
                const targets = [];
                for (const [platform, id] of [['instagram', 'ig-account'], ['facebook', 'fb-account'], ['tiktok', 'tt-account'], ['youtube', 'yt-account']]) {
                    if (q(platform).checked) targets.push({ platform, account: q(id).value.trim() });
                }
                const trial = q('instagram').checked && q('trial').checked;
                const input = {
                    requestId, deviceUdid: q('device').value, caption: q('caption').value,
                    runAt: new Date(q('runAt').value).toISOString(), timezone: q('timezone').value, targets,
                    instagramTrial: trial, automaticPromotion: trial, facebookMode: q('facebookMode').value,
                };
                if (q('youtube').checked) {
                    if (!q('yt-audience').value) throw new Error('Choose a YouTube audience');
                    input.youtube = { title: q('yt-title').value, channelId: q('yt-channel').value.trim(), visibility: q('yt-visibility').value, madeForKids: q('yt-audience').value === 'yes', publishing: {
                        category: q('yt-category').value, tags: q('yt-tags').value.split(',').map(s => s.trim()).filter(Boolean),
                        hashtags: q('yt-hashtags').value.trim().split(/\s+/).filter(Boolean), commentKeyword: q('yt-keyword').value.trim(),
                        aiUse: q('yt-ai-use').value, coverMode: q('yt-cover-mode').value,
                        ...(q('yt-related').value.trim() ? { relatedVideoId: q('yt-related').value.trim() } : {})
                    } };
                }
                const firstComment = q('firstComment').value.trim();
                if (firstComment) input.firstComment = firstComment;
                const body = new FormData();
                body.set('input', JSON.stringify(input));
                if (!q('video').files[0]) throw new Error('Choose a video');
                body.set('video', q('video').files[0]);
                if (q('cover').files[0]) body.set('cover', q('cover').files[0]);
                const response = await fetch(`${API}/items`, { method: 'POST', body });
                const saved = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(saved.error || `Save failed (HTTP ${response.status})`);
                message.textContent = 'Saved on hold. Nothing has been posted.';
                await refresh();
                if (saved.id && state.drawer?.mode === 'add') {
                    const m = state.byId.get(saved.id);
                    if (m?.day) state.start = m.day < state.start || m.day > addDays(state.start, 6) ? m.day : state.start;
                    render();
                    openItem(saved.id);
                    if (state.drawer) Object.assign(state.drawer, { message: 'Saved on hold. Nothing has been posted.', bad: false });
                    renderDrawerItem(false);
                }
            } catch (error) {
                message.textContent = error.message;
            } finally {
                save.disabled = false;
            }
        });
    }

    // ---------- clock ----------
    function updateClock() {
        const now = Date.now();
        for (const el of document.querySelectorAll('[data-countdown]')) {
            const t = Number(el.dataset.countdown);
            if (Number.isFinite(t)) el.textContent = relative(t - now, el.dataset.precise === '1');
        }
        const updated = $('updated');
        if (state.loading) updated.textContent = state.loaded ? 'Refreshing…' : 'Loading…';
        else if (state.loadedAt) updated.textContent = now - state.loadedAt < 5000 ? 'Updated just now' : `Updated ${relative(state.loadedAt - now)}`;
        else if (state.error) updated.textContent = 'Not loaded';
        if (todayKey() !== state.today) render();
    }

    // ---------- wiring ----------
    $('refresh').addEventListener('click', () => refresh());
    $('view-list').addEventListener('click', () => { state.view = 'list'; savePref('view', 'list'); render(); });
    $('view-week').addEventListener('click', () => { state.view = 'week'; savePref('view', 'week'); render(); });
    $('prev').addEventListener('click', () => { state.start = addDays(state.start, -7); render(); });
    $('next').addEventListener('click', () => { state.start = addDays(state.start, 7); render(); });
    $('today').addEventListener('click', () => { state.start = todayKey(); render(); });
    $('show-cancelled').addEventListener('change', (event) => { state.showCancelled = event.target.checked; savePref('cancelled', state.showCancelled ? '1' : '0'); render(); });
    $('add-video').addEventListener('click', () => openAdd());
    $('drawer-close').addEventListener('click', closeDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.drawer) closeDrawer(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.loadedAt > REFRESH_MS) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    setInterval(updateClock, 1000);

    function openFromHash() {
        const match = /^#post=([0-9a-f-]{36})$/i.exec(location.hash);
        if (match && state.byId.has(match[1])) openItem(match[1]);
    }
    window.addEventListener('hashchange', openFromHash);
    render();
    refresh().then(openFromHash);
})();
