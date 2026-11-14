/** Render a branded Story sequence from a JSON spec (Antonio, Oct 21: "a branded sample that we could be running every single
 * day", modelled on Devin Jatho's live Story, docs/stories/reference/devinjatho, and built on the Full Visual kit rules:
 * real material only, interfaces redrawn in code, one object that changes state, a boxed key word, a CTA that names what
 * arrives). One brand system for every way of telling the story: dark #0A0A0A, blue #2780FF, red #E8231F, Inter.
 * Frame types: hook, photo, orbit, states, list, proof, timeline, image, render (full-bleed 3D render), scene (3D built in code from JSON), cta. Icons: built-in or logo:<path>. Text marks: **bold**, [[red box]], {{red}}, ((blue)).
 * Photos are Story-pool photos named by SHA-256 prefix; images are paths relative to docs/stories/teaching/.
 * Usage: render-teaching-story.ts docs/stories/teaching/<slug>.json  ->  .scheduler-data/story-assets/teaching/<slug>/
 * Renders files only: no phone, no upload, no Story plan. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';
import sharp from 'sharp';
import { loadPhotoPool, photoBuffer } from '../src/publishing/story-lifestyle.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const specPath = path.resolve(process.argv[2]!), base = path.dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const out = path.resolve('.scheduler-data/story-assets/teaching', spec.slug); mkdirSync(out, { recursive: true });
const pool = loadPhotoPool();

const md = (s = '') => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<span class="box">$1</span>')
    .replace(/\{\{(.+?)\}\}/g, '<span class="red">$1</span>').replace(/\(\((.+?)\)\)/g, '<span class="blue">$1</span>').replace(/__(.+?)__/g, '<span class="ul">$1</span>').replace(/\n/g, '<br>');
async function photo(prefix: string, name: string, dim = 1) {
    const p = pool.find(x => x.sha256.startsWith(prefix)); if (!p) throw Error('No pool photo ' + prefix);
    const file = path.join(out, name + '.jpg');
    await sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate().resize(1080, 1920, { fit: 'cover', position: 'attention' }).modulate({ brightness: dim }).jpeg({ quality: 90 }).toFile(file);
    return name + '.jpg';
}
/** Code-built 3D (scripts/story-scene3d.ts), bundled once per run and inlined into each scene frame. */
let scene3d = '';
const dataUri = (rel: string) => `data:image/${rel.endsWith('.svg') ? 'svg+xml' : rel.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(path.join(base, rel)).toString('base64')}`;
const inlineImages = (o: any): any => Array.isArray(o) ? o.map(inlineImages) : o && typeof o === 'object'
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ['img', 'screen'].includes(k) && typeof v === 'string' ? dataUri(v) : inlineImages(v)])) : o;
function asset(rel: string) { const name = path.basename(rel); copyFileSync(path.join(base, rel), path.join(out, name)); return name; }

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=block');
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff}
.stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#0A0A0A}
.grid{position:absolute;inset:0;background:radial-gradient(ellipse 800px 600px at 50% 900px,rgba(39,128,255,.18),rgba(39,128,255,0) 70%),linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px) 0 0/54px 54px,linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px) 0 0/54px 54px}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,10,.92) 0%,rgba(10,10,10,.55) 38%,rgba(10,10,10,.1) 60%,rgba(10,10,10,.7) 100%)}
.shade.full{background:linear-gradient(180deg,rgba(10,10,10,.9) 0%,rgba(10,10,10,.7) 45%,rgba(10,10,10,.82) 100%)}
.title{position:absolute;top:200px;left:80px;right:80px;font:600 64px/1.18 Inter;letter-spacing:-1.2px}
.title b{font-weight:800}.center{text-align:center}
.body{position:absolute;left:80px;right:300px;font:500 46px/1.3 Inter;color:#e9e9e9}.body b{color:#fff;font-weight:800}
.pull{position:absolute;right:80px;bottom:330px;font:700 48px Inter;padding:10px 4px;border-bottom:4px solid rgba(255,255,255,.85);text-shadow:0 2px 14px rgba(0,0,0,.9)}
.box{background:#E8231F;color:#fff;padding:0 14px;border-radius:6px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.red{color:#FF4D4D}.blue{color:#2780FF}.ul{text-decoration:underline;text-decoration-color:#2780FF;text-decoration-thickness:6px;text-underline-offset:10px}
.hook{position:absolute;top:180px;left:60px;right:60px;text-align:center;font:900 104px/1.02 Inter;letter-spacing:-3px;text-transform:uppercase}
.bottom{position:absolute;bottom:300px;left:60px;right:60px;text-align:center;font:600 52px/1.25 Inter}
.shot{position:absolute;left:50%;transform:translateX(-50%);background:#fff;border-radius:26px;padding:14px;box-shadow:0 0 0 4px #2780FF,0 0 60px rgba(39,128,255,.45),0 30px 80px rgba(0,0,0,.75)}
.shot img{display:block;border-radius:14px;max-width:100%}
.ring{position:absolute;border:9px solid #FF2D2D;border-radius:50%;transform:rotate(-4deg)}
/* redrawn interfaces */
.phone{position:absolute;left:50%;transform:translateX(-50%) rotate(-3deg);width:600px;border-radius:72px;background:#000;border:14px solid #2a2a2e;box-shadow:0 0 0 2px #444,0 40px 90px rgba(0,0,0,.8),0 0 120px rgba(39,128,255,.25);padding:74px 26px 40px;overflow:hidden}
.notch{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:170px;height:36px;border-radius:20px;background:#111}
.thread-h{text-align:center;font:700 26px Inter;color:#fff;margin-bottom:18px}.thread-h small{display:block;font:500 20px Inter;color:#8e8e93}
.bub{font:500 30px/1.32 -apple-system,Inter;padding:16px 24px;border-radius:30px;max-width:440px;margin:10px 0;width:fit-content}
.bub.in{background:#26262a;color:#fff;border-bottom-left-radius:8px}.bub.out{background:#2780FF;color:#fff;margin-left:auto;border-bottom-right-radius:8px}
.sys{text-align:center;font:600 22px Inter;color:#8e8e93;margin:16px 0 6px}
.callrow{display:flex;align-items:center;gap:16px;background:#1c1c1e;border-radius:22px;padding:16px 20px;margin:12px 0;font:600 28px Inter}
.callrow .ico{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center}
.callrow .miss{color:#FF453A}.callrow small{display:block;font:500 20px Inter;color:#8e8e93}
.mini{position:relative;flex:1;border-radius:26px;background:rgba(20,20,24,.94);border:3px solid #34343a;padding:22px 18px;display:flex;flex-direction:column;gap:12px;min-height:560px}
.mini .nm{font:800 32px Inter;text-align:center}.mini .act{font:600 26px/1.25 Inter;color:#cfcfcf;text-align:center}
.mini.on{border-color:#2780FF;box-shadow:0 0 50px rgba(39,128,255,.35)}.mini.off{border-color:#E8231F}
.mini .ui{background:#000;border-radius:18px;padding:14px;min-height:190px}
.mini .ui .bub{font-size:21px;padding:10px 14px;border-radius:18px;max-width:none}
.mini .ui .callrow{font-size:20px;padding:10px 12px;margin:0}.mini .ui .callrow .ico{width:38px;height:38px;border-radius:10px}
.cal{border-radius:12px;overflow:hidden;font:600 20px Inter}.cal .hd{background:#E8231F;color:#fff;padding:6px 10px;font-weight:800}
.cal .slot{background:#1c1c1e;padding:10px;border-left:6px solid #2780FF;margin-top:8px;border-radius:8px}
.stamp{position:absolute;top:210px;left:50%;transform:translateX(-50%) rotate(-12deg);font:900 30px Inter;color:#fff;background:#E8231F;padding:10px 16px;border-radius:8px;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.center-node{position:absolute;left:50%;transform:translateX(-50%);width:200px;border-radius:36px;background:#16161a;border:3px solid #3a3a40;padding:18px;text-align:center;font:800 32px Inter}
.center-node .av{width:96px;height:96px;border-radius:50%;margin:0 auto 10px;background:#2780FF;display:flex;align-items:center;justify-content:center;font:900 44px Inter}
.ask{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font:700 28px Inter;background:#fff;color:#111;padding:12px 20px;border-radius:18px}
svg.lines{position:absolute;left:0;top:0;width:1080px}
.orbit{position:absolute;right:-120px;top:560px;width:760px;height:760px;border-radius:50%;border:3px solid rgba(39,128,255,.7);box-shadow:0 0 40px rgba(39,128,255,.35)}
.chip{position:absolute;display:flex;align-items:center;gap:12px;font:700 32px Inter;background:rgba(20,20,24,.92);border:2px solid #2780FF;border-radius:999px;padding:12px 24px 12px 12px;white-space:nowrap}
.chip .ico{width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center}
.items{position:absolute;top:1060px;left:80px;right:80px;display:flex;flex-direction:column;gap:26px}
.item{display:flex;align-items:center;gap:26px;background:rgba(16,16,20,.9);border:2px solid rgba(39,128,255,.55);border-radius:24px;padding:26px 30px;font:700 44px/1.25 Inter}.item b{color:#2780FF}
.num{width:76px;height:76px;flex:none;border-radius:20px;background:#2780FF;display:flex;align-items:center;justify-content:center;font:900 44px Inter}
.tag{position:absolute;font:800 32px Inter;color:#fff;background:#E8231F;padding:12px 20px;border-radius:10px;transform:rotate(-4deg);box-shadow:0 8px 24px rgba(0,0,0,.6)}
.time{position:absolute;top:190px;left:80px;font:900 150px/1 Inter;letter-spacing:-5px}
.time small{display:block;font:700 34px Inter;letter-spacing:2px;color:#2780FF;margin-top:14px;text-transform:uppercase}
.yt{position:absolute;top:520px;left:90px;right:90px;background:#fff;border-radius:28px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,.7)}
.yt img{width:100%;border-radius:14px;display:block}.yt .bar{height:8px;background:#ddd;border-radius:4px;margin:16px 4px 0;position:relative}
.yt .bar:after{content:'';position:absolute;left:0;top:0;bottom:0;width:22%;background:#E8231F;border-radius:4px}
.yt .vt{font:700 30px Inter;color:#111;margin:16px 6px 4px}
.reel{position:absolute;top:430px;left:50%;transform:translateX(-50%) rotate(-2deg);width:430px;border-radius:30px;overflow:hidden;box-shadow:0 0 0 4px #2780FF,0 30px 80px rgba(0,0,0,.75)}
.reel img{display:block;width:100%}.plays{position:absolute;left:22px;bottom:20px;font:800 34px Inter;text-shadow:0 2px 12px rgba(0,0,0,.9)}
.reply{position:absolute;top:1250px;left:0;right:0;text-align:center;font:900 112px/1 Inter;letter-spacing:-2px}
.reply .k{color:#2780FF}.send{position:absolute;top:1390px;left:0;right:0;text-align:center;font:500 46px Inter;color:#d0d0d0}
.arrow{position:absolute;left:0;top:0;width:1080px;height:1920px;pointer-events:none}`;

const ICON: Record<string, string> = {
    sms: '<div class="ico" style="background:#34C759"><svg width="30" height="30" viewBox="0 0 24 24"><path fill="#fff" d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.4 4.6 3.6 6.1L5 21l4.2-2.3c.9.2 1.8.3 2.8.3 5.5 0 10-3.6 10-8s-4.5-8-10-8z"/></svg></div>',
    call: '<div class="ico" style="background:#34C759"><svg width="28" height="28" viewBox="0 0 24 24"><path fill="#fff" d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg></div>',
    calendar: '<div class="ico" style="background:#fff;color:#E8231F;font:900 18px Inter;flex-direction:column;line-height:1"><span style="font-size:11px">WED</span>21</div>',
};
const logoTile = (rel: string, size = 48, wide = 1) => `<div class="ico" style="background:#fff;width:${Math.round(size * wide)}px;height:${size}px;padding:${Math.round(size * .14)}px;border-radius:${Math.round(size * .26)}px"><img src="${asset(rel)}" style="width:100%;height:100%;object-fit:contain"></div>`;
const icon = (k: string, size = 48, wide = 1) => k?.startsWith('logo:') ? logoTile(k.slice(5), size, wide)
    : ICON[k]?.replace('class="ico" style="', `class="ico" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * .26)}px;`).replace(/width="(28|30)" height="(28|30)"/, `width="${Math.round(size * .6)}" height="${Math.round(size * .6)}"`) ?? '';
function ui(kind: string, text = '') {
    if (kind === 'sms') return `<div class="ui"><div class="bub in">${text}</div><div class="bub out" style="font-size:19px">Yes! Our program fits any schedule</div></div>`;
    if (kind === 'call') return `<div class="ui"><div class="callrow">${ICON.call}<div>Outgoing call<small>${text}</small></div></div></div>`;
    return `<div class="ui"><div class="cal"><div class="hd">Booked call</div><div class="slot">${text}</div></div></div>`;
}

async function frameHtml(f: any, i: number) {
    let inner = '';
    const bgPhoto = async (dim = 1, cls = '') => `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i, dim)})"></div><div class="shade ${cls}"></div>`;
    if (f.type === 'hook') {
        let visual = '';
        if (f.visual?.kind === 'thread') visual = `<div class="phone" style="top:640px"><div class="notch"></div><div class="thread-h">${f.visual.contact}<small>Text message</small></div>
          ${f.visual.items.map((m: any) => m.kind === 'call' ? `<div class="callrow">${ICON.call}<div class="${m.missed ? 'miss' : ''}">${m.text}<small>${m.sub ?? ''}</small></div></div>` : m.kind === 'sys' ? `<div class="sys">${m.text}</div>` : `<div class="bub ${m.kind}">${m.text}</div>`).join('')}</div>`;
        if (f.visual?.kind === 'image') visual = `<div class="shot" style="top:${f.visual.top ?? 640}px;width:${f.visual.width ?? 880}px"><img src="${asset(f.visual.src)}" style="width:100%"></div>`;
        inner = `${f.photo ? await bgPhoto(.55, 'full') : '<div class="grid"></div>'}<div class="hook">${md(f.title)}</div>${visual}<div class="bottom">${md(f.bottom)}</div>`;
    }
    if (f.type === 'photo') inner = `${await bgPhoto()}<div class="title">${md(f.title)}</div><div class="body" style="top:${f.bodyTop ?? 420}px">${md(f.body)}</div>${f.pull ? `<div class="pull">${md(f.pull)}</div>` : ''}`;
    if (f.type === 'orbit') inner = `${await bgPhoto(.6)}<div class="orbit"></div>
      ${f.chips.map((c: any) => `<div class="chip" style="right:${c.right}px;top:${c.top}px">${icon(c.icon)}${c.label}</div>`).join('')}
      <div class="title">${md(f.title)}</div><div class="body" style="top:470px;right:360px">${md(f.body)}</div><div class="pull">${md(f.pull)}</div>`;
    if (f.type === 'states') {
        const color = f.state === 3 ? '#E8231F' : 'rgba(255,255,255,.55)', top = 560;
        const lines = [215, 540, 865].map(x => `<path d="M540 ${top + 200} C 540 ${top + 260}, ${x} ${top + 260}, ${x} ${top + 330}" stroke="${color}" stroke-width="4" stroke-dasharray="14 12" fill="none"/>`).join('');
        const cards = f.cards.map((c: any) => `<div class="mini ${f.state === 2 ? 'on' : f.state === 3 ? 'off' : ''}"><div style="display:flex;justify-content:center;margin:6px 0 4px">${icon(c.icon, 120)}</div><div class="nm">${c.name}</div>${f.state >= 2 ? `${ui(c.ui, c.text)}<div class="act">${c.act}</div>` : `<div class="act">${c.waiting ?? 'Waiting'}</div>`}${f.state === 3 ? `<div class="stamp">${f.stamp}</div>` : ''}</div>`).join('');
        inner = `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i, .12)});filter:blur(8px) saturate(.4)"></div><div class="grid"></div>
          <div class="title center" style="top:220px">${md(f.title)}</div>
          <svg class="lines" height="1000" viewBox="0 0 1080 1000">${lines}</svg>
          ${f.state === 1 ? `<div class="ask" style="top:${top - 70}px">${f.ask}</div>` : ''}
          <div class="center-node" style="top:${top}px;width:300px">${f.centerLogo ? `<div style="display:flex;justify-content:center;margin-bottom:10px">${icon(f.centerLogo, 64, 3.6)}</div>` : ''}<div style="font:700 22px Inter;color:#9a9a9a">${f.centerSub ?? ''}</div>${f.center}</div>
          <div style="position:absolute;top:${top + 330}px;left:60px;right:60px;display:flex;gap:24px">${cards}</div>`;
    }
    if (f.type === 'list') inner = `${await bgPhoto()}<div class="title center" style="top:230px;font-size:76px">${md(f.title)}</div>
      <div class="items" style="top:${f.pull ? 900 : 1060}px">${f.items.map((t: string, n: number) => `<div class="item"><div class="num">${n + 1}</div><span>${md(t)}</span></div>`).join('')}</div>`;
    if (f.type === 'proof') {
        const img = asset(f.image), m = await sharp(path.join(base, f.image)).metadata(), w = Math.min(920, f.width ?? 920), h = Math.round(w * m.height! / m.width!);
        const top = f.top ?? 640, ring = f.ring ? `<div class="ring" style="left:${80 + f.ring[0] * w - 20}px;top:${top + 14 + f.ring[1] * h - 16}px;width:${f.ring[2] * w + 40}px;height:${f.ring[3] * h + 32}px"></div>` : '';
        inner = `${f.photo ? await bgPhoto(.45, 'full') : '<div class="grid"></div>'}<div class="title center" style="top:${f.titleTop ?? 260}px;font:900 70px/1.1 Inter;text-transform:uppercase;letter-spacing:-1.5px">${md(f.title)}</div>
          <div class="shot" style="top:${top}px;width:${w + 28}px"><img src="${img}" style="width:${w}px"></div>${ring}
          ${f.tag ? `<div class="tag" style="left:110px;top:${top + h + 70}px">${f.tag}</div>` : ''}
          ${f.note ? `<div class="bottom" style="bottom:${f.noteBottom ?? 380}px">${md(f.note)}</div>` : ''}`;
    }
    if (f.type === 'timeline') inner = `${await bgPhoto(.75)}<div class="time">${f.time}<small>${f.label}</small></div>
      <div class="title" style="top:440px">${md(f.title)}</div>
      ${f.image ? `<div class="shot" style="top:${f.imageTop ?? 900}px;width:${(f.imageWidth ?? 820) + 28}px"><img src="${asset(f.image)}" style="width:${f.imageWidth ?? 820}px"></div>` : ''}`;
    if (f.type === 'image') {
        const w = f.width ?? 880, top = f.top ?? 620, m = await sharp(path.join(base, f.image)).metadata(), h = Math.round(w * m.height! / m.width!);
        const ring = f.ring ? `<div class="ring" style="left:${540 - (w + 28) / 2 + 14 + f.ring[0] * w - 20}px;top:${top + 14 + f.ring[1] * h - 16}px;width:${f.ring[2] * w + 40}px;height:${f.ring[3] * h + 32}px;border-radius:40px"></div>` : '';
        inner = `${f.photo ? await bgPhoto(.5, 'full') : '<div class="grid"></div>'}<div class="title center" style="top:${f.titleTop ?? 230}px">${md(f.title)}</div>
      <div class="shot" style="top:${top}px;width:${w + 28}px"><img src="${asset(f.image)}" style="width:${w}px"></div>${ring}
      ${f.body ? `<div class="bottom" style="bottom:${f.bodyBottom ?? 330}px">${md(f.body)}</div>` : ''}`;
    }
    if (f.type === 'render') {
        const name = 'render' + i + '.jpg';
        await sharp(path.join(base, f.image)).resize(1080, 1920, { fit: 'cover' }).jpeg({ quality: 92 }).toFile(path.join(out, name));
        inner = `<div class="bg" style="background-image:url(${name})"></div>
          <div class="${f.hook ? 'hook' : 'title center'}" style="top:${f.titleTop ?? 200}px">${md(f.title)}</div>
          ${(f.labels ?? []).map((l: any) => `<div class="chip" style="top:${l.top}px;${l.left != null ? `left:${l.left}px` : `right:${l.right ?? 40}px`}">${l.icon ? icon(l.icon) : ''}${md(l.text)}</div>`).join('')}
          ${f.bottom ? `<div class="bottom" style="${f.subTop ? `top:${f.subTop}px;bottom:auto` : `bottom:${f.bottomAt ?? 300}px`};text-shadow:0 2px 16px rgba(0,0,0,.95)">${md(f.bottom)}</div>` : ''}`;
    }
    if (f.type === 'scene') {
        scene3d ||= buildSync({ entryPoints: [path.resolve('scripts/story-scene3d.ts')], bundle: true, format: 'esm', write: false, target: 'es2022' }).outputFiles[0]!.text;
        inner = `${f.photo ? `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i, f.dim ?? .35)});filter:blur(${f.blur ?? 0}px)"></div>` : '<div class="grid"></div>'}
          <div id="scene" style="position:absolute;inset:0"></div><div class="shade" style="background:linear-gradient(180deg,rgba(10,10,10,.75) 0%,rgba(10,10,10,0) 30%,rgba(10,10,10,0) 72%,rgba(10,10,10,.75) 100%)"></div>
          <div class="${f.hook ? 'hook' : 'title center'}" style="top:${f.titleTop ?? 200}px">${md(f.title)}</div>
          ${f.bottom ? `<div class="bottom" style="${f.subTop ? `top:${f.subTop}px;bottom:auto` : `bottom:${f.bottomAt ?? 300}px`};text-shadow:0 2px 16px rgba(0,0,0,.95)">${md(f.bottom)}</div>` : ''}
          <script>window.SCENE=${JSON.stringify(inlineImages(f.scene))}</script><script type="module">${scene3d.replace(/<\/script/g, '<\\/script')}</script>`;
    }
    if (f.type === 'cta') {
        const card = f.card.kind === 'yt' ? `<div class="yt"><img src="${f.card.thumb}"><div class="bar"></div><div class="vt">${f.card.title}</div></div>`
            : f.card.kind === 'image' ? `<div class="shot" style="top:470px;width:${(f.card.width ?? 860) + 28}px"><img src="${asset(f.card.image)}" style="width:${f.card.width ?? 860}px"></div>`
            : `<div class="reel"><img src="${asset(f.card.image)}">${f.card.views ? `<div class="plays">▶ ${f.card.views}</div>` : ''}</div>`;
        const rsize = Math.min(112, Math.floor(1700 / (`Reply "${spec.keyword}"`.length + 1)));
        inner = `<div class="grid"></div><div class="title center" style="top:200px;font-size:54px">${md(f.title)}</div>${card}
          <div class="reply" style="font-size:${rsize}px;white-space:nowrap">Reply <span class="k">"${spec.keyword}"</span></div><div class="send">${f.send ?? "and I'll send it to you"}</div>`;
    }
    if (!inner) throw Error('Unknown frame type ' + f.type);
    // Devin's open loop: every frame before the payoff ends on a pull line that earns the next tap.
    if (f.pull && !['photo', 'orbit'].includes(f.type)) inner += `<div class="pull">${md(f.pull)}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="stage">${inner}</div></body></html>`;
}

for (const f of ['assets/logo-github.svg']) try { asset(f); } catch { /* optional */ }
const pngs: string[] = [];
for (const [i, f] of spec.frames.entries()) {
    const html = path.join(out, `frame-${i + 1}.html`), png = path.join(out, `frame-${i + 1}.png`);
    writeFileSync(html, await frameHtml(f, i + 1));
    const gl = f.type === 'scene' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu'];
    execFileSync(CHROME, ['--headless=new', ...gl, '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', '--virtual-time-budget=8000', `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
    pngs.push(png);
}
const th = await Promise.all(pngs.map(p => sharp(p).resize(360, 640).toBuffer()));
await sharp({ create: { width: th.length * 370, height: 640, channels: 3, background: '#222' } }).composite(th.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 88 }).toFile(path.join(out, 'sheet.jpg'));
console.log(JSON.stringify({ out, frames: pngs.length }));
