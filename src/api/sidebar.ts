// Left side menu shared by every dashboard page. The server renders it into each
// HTML response so it paints with the page; static/shell/sidebar.js only fills
// in live counts and the phone status dot.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PluginNavLink } from '../plugin.js';

const shellDir = fileURLToPath(new URL('../../static/shell/', import.meta.url));
export const shellAssets = {
    css: readFileSync(shellDir + 'sidebar.css', 'utf8'),
    js: readFileSync(shellDir + 'sidebar.js', 'utf8'),
};
const version = (body: string) => crypto.createHash('sha1').update(body).digest('base64url').slice(0, 10);
const cssVersion = version(shellAssets.css);
const jsVersion = version(shellAssets.js);

const icon = (paths: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
    devices: icon('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
    publishing: icon('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
    stories: icon('<rect x="4" y="3" width="11" height="18" rx="2.5"/><path d="M18.5 6v12M21 8v8"/>'),
    tasks: icon('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'),
    register: icon('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 9v6M9 12h6"/>'),
    link: icon('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
    logout: icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>'),
    menu: icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};

interface MenuItem { key: string; label: string; href: string; icon: string; active: (path: string) => boolean }

const CORE: MenuItem[] = [
    { key: 'devices', label: 'Devices', href: '/', icon: ICONS.devices,
        active: (p) => p === '/' || (p.startsWith('/devices/') && p !== '/devices/register') },
    { key: 'publishing', label: 'Publishing', href: '/publishing', icon: ICONS.publishing, active: (p) => p === '/publishing' },
    { key: 'stories', label: 'Story drafts', href: '/publishing/stories', icon: ICONS.stories, active: (p) => p.startsWith('/publishing/stories') },
    { key: 'tasks', label: 'Tasks', href: '/tasks', icon: ICONS.tasks, active: (p) => p === '/tasks' },
];
const SETUP: MenuItem[] = [
    { key: 'register', label: 'Register device', href: '/devices/register', icon: ICONS.register, active: (p) => p === '/devices/register' },
];

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function itemHtml(item: MenuItem, path: string): string {
    const current = item.active(path);
    // data-slot is where sidebar.js writes counts or the phone dot for this item.
    return `<li><a class="pf-nav-item${current ? ' is-current' : ''}" href="${escapeHtml(item.href)}" data-nav="${item.key}"${current ? ' aria-current="page"' : ''}>${item.icon}<span class="pf-nav-label">${escapeHtml(item.label)}</span><span class="pf-nav-meta" data-slot="${item.key}"></span></a></li>`;
}

export function sidebarHtml(path: string, pluginLinks: readonly PluginNavLink[], logoutPath?: string): string {
    const known = new Set([...CORE, ...SETUP].map((item) => item.href));
    const extra: MenuItem[] = pluginLinks.filter((link) => !known.has(link.href)).map((link) => ({
        key: 'plugin', label: link.label, href: link.href, icon: ICONS.link, active: (p) => p === link.href,
    }));
    const logout = logoutPath
        ? `<a class="pf-nav-item" href="${escapeHtml(logoutPath)}">${ICONS.logout}<span class="pf-nav-label">Log out</span></a>` : '';
    return `<a class="pf-skip" href="#main-content">Skip to content</a>
<div class="pf-mobilebar"><button type="button" class="pf-menu-toggle" aria-controls="pf-sidebar" aria-expanded="false" aria-label="Open menu">${ICONS.menu}</button><a class="pf-brand-name" href="/">iOS Farm</a></div>
<aside id="pf-sidebar" class="pf-sidebar" aria-label="Main menu">
<div class="pf-brand"><a class="pf-brand-name" href="/">iOS Farm</a><a class="pf-brand-by" href="https://gethandler.ai" target="_blank" rel="noopener">by Handler</a></div>
<nav class="pf-nav" aria-label="Main">
<p class="pf-nav-heading">Workspace</p><ul>${[...CORE, ...extra].map((item) => itemHtml(item, path)).join('')}</ul>
<p class="pf-nav-heading">Setup</p><ul>${SETUP.map((item) => itemHtml(item, path)).join('')}</ul>
</nav>
<div class="pf-sidebar-foot"><p class="pf-phone" data-slot="phone"><span class="pf-dot"></span><span>Checking phone…</span></p>${logout}</div>
</aside>
<div class="pf-scrim" hidden></div>`;
}

// Adds the shell stylesheet, script and menu to a full HTML page. Pages that
// already carry the menu, and fragments without <body>, pass through unchanged.
export function injectShell(html: string, path: string, pluginLinks: readonly PluginNavLink[], logoutPath?: string): string {
    if (html.includes('id="pf-sidebar"') || !html.includes('</head>')) return html;
    const body = /<body[^>]*>/i.exec(html);
    if (!body) return html;
    const head = `<link rel="stylesheet" href="/shell/sidebar.css?v=${cssVersion}"><script src="/shell/sidebar.js?v=${jsVersion}" defer></script>`;
    const at = body.index + body[0].length;
    return (html.slice(0, at) + sidebarHtml(path, pluginLinks, logoutPath) + html.slice(at)).replace('</head>', `${head}</head>`);
}
