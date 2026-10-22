/** Story versions 3 and 4 from Devin Jatho's Highlights, in C2C blue.
 * Version 3, lifestyle identity (sheet-ARISTOCRAT.jpg): real candid photos full bleed, one short lowercase italic serif
 *   line, an optional location sticker, and an Ask Me Anything question box to close.
 * Version 4, offer card (sheet-JOIN_NEXUS.jpg): one frame. Portrait in the top two thirds fading to black, verified
 *   handle, a huge "JOIN X." title, a one-line promise, a white REPLY WITH pill and a row of fading down arrows.
 * Frame types: life, ama, offer. Photos: pool SHA prefix or asset:<path>.
 * Usage: render-identity-story.ts docs/stories/devin/<slug>.json -> .scheduler-data/story-assets/devin/<slug>/ */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadPhotoPool, photoBuffer } from '../src/publishing/story-lifestyle.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const specPath = path.resolve(process.argv[2]!), base = path.dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const out = path.resolve('.scheduler-data/story-assets/devin', spec.slug); mkdirSync(out, { recursive: true });
const pool = loadPhotoPool();
const BLUE = '#2780FF', F = 'system-ui,-apple-system,sans-serif', SERIF = "'Times New Roman',Didot,Georgia,serif";
const banned = new Set(['video:ff', 'b8ad871c']);

async function photo(key: string, name: string, o: { pos?: string; dim?: number } = {}) {
    if (banned.has(key)) throw Error('Banned photo ' + key);
    let img: sharp.Sharp;
    if (key.startsWith('asset:')) img = sharp(path.join(base, key.slice(6)));
    else { const p = pool.find(x => x.sha256.startsWith(key)); if (!p) throw Error('No pool photo ' + key); img = sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate(); }
    await img.resize(1080, 1920, { fit: 'cover', position: (o.pos as any) ?? 'attention' }).modulate({ brightness: o.dim ?? 1 }).jpeg({ quality: 90 }).toFile(path.join(out, name + '.jpg'));
    return name + '.jpg';
}
const check = `<svg width="38" height="38" viewBox="0 0 24 24"><path d="M12 1l2.6 2.2 3.4-.4 1 3.3 3 1.7-1 3.2 1 3.2-3 1.7-1 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-1-3.3-3-1.7 1-3.2-1-3.2 3-1.7 1-3.3 3.4.4z" fill="${BLUE}"/><path d="M7.5 12.3l3 3 6-6.2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function frameHtml(f: any, i: number) {
    let inner = '';
    if (f.type === 'life') {
        // His lifestyle frames: the photo is the content; the words are one quiet line, lowercase italic serif.
        const bg = await photo(f.photo, 'bg' + i, { pos: f.pos, dim: f.dim });
        inner = `<div style="position:absolute;inset:0;background:url(${bg}) center/cover"></div>
          <div style="position:absolute;left:0;right:0;top:${f.y ?? 1180}px;text-align:center;font:italic 400 ${f.size ?? 58}px/1.2 ${SERIF};color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.65),0 0 2px rgba(0,0,0,.5)">${f.line}</div>
          ${f.location ? `<div style="position:absolute;left:44px;top:230px;display:flex;align-items:center;gap:8px;padding:10px 20px 10px 14px;border-radius:14px;background:rgba(255,255,255,.88);color:${BLUE};font:700 32px ${F}"><svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6a2.5 2.5 0 010 5.5z" fill="${BLUE}"/></svg>${f.location}</div>` : ''}`;
    }
    if (f.type === 'ama') {
        const bg = await photo(f.photo, 'bg' + i, { pos: f.pos, dim: f.dim ?? .9 });
        const av = await photo(f.avatar, 'av' + i);
        inner = `<div style="position:absolute;inset:0;background:url(${bg}) center/cover"></div>
          <div style="position:absolute;left:150px;right:150px;top:${f.y ?? 520}px;border-radius:40px;background:#fff;padding:96px 40px 40px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)">
            <div style="position:absolute;left:50%;top:-56px;transform:translateX(-50%);width:112px;height:112px;border-radius:50%;border:6px solid #fff;background:url(${av}) center/cover"></div>
            <div style="font:500 44px/1.3 ${F};color:#111">${f.question.replace(/\n/g, "<br>")}</div>
            <div style="margin-top:34px;border-radius:22px;background:#EEF4FF;color:#8A97AD;font:500 34px/1 ${F};padding:30px 0">Type something...</div></div>`;
    }
    if (f.type === 'offer') {
        // His JOIN NEXUS card, measured from the Highlight: portrait top, fade to black, centred type stack.
        const bg = await photo(f.photo, 'bg' + i, { pos: 'north', dim: f.dim ?? .95 });
        const arrows = [1, .85, .7, .5, .32, .18].map(o => `<svg width="34" height="54" viewBox="0 0 24 38" style="opacity:${o}"><path d="M12 2v30M3 24l9 10 9-10" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`).join('');
        inner = `<div style="position:absolute;inset:0;background:url(${bg}) center top/cover"></div>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 38%,rgba(0,0,0,.55) 55%,#000 70%,#000 100%)"></div>
          <div style="position:absolute;left:0;right:0;top:1150px;display:flex;justify-content:center;align-items:center;gap:10px;font:700 40px ${F};color:#fff">${spec.handle}${check}</div>
          <div style="position:absolute;left:0;right:0;top:1218px;text-align:center;font:900 168px/1 ${F};letter-spacing:-5px;text-transform:uppercase;color:#fff">${f.title}<span style="color:${BLUE}">.</span></div>
          <div style="position:absolute;left:90px;right:90px;top:1420px;text-align:center;font:500 44px/1.3 ${F};color:#E8EEF8">${f.promise.replace(/\n/g, "<br>")}</div>
          <div style="position:absolute;left:0;right:0;top:1600px;display:flex;justify-content:center;align-items:center;gap:26px">
            <div style="background:#fff;color:#000;border-radius:16px;padding:14px 26px;font:italic 900 42px/1 ${F};letter-spacing:.5px;white-space:nowrap">REPLY WITH <span style="color:${BLUE}">“${spec.keyword}”</span></div>
            <div style="display:flex;gap:6px">${arrows}</div></div>`;
    }
    if (!inner) throw Error('Unknown frame type ' + f.type);
    return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#000;color:#fff;-webkit-font-smoothing:antialiased}</style></head><body><div style="position:relative;width:1080px;height:1920px;overflow:hidden">${inner}</div></body></html>`;
}

const pngs: string[] = [];
for (const [i, f] of spec.frames.entries()) {
    const html = path.join(out, `frame-${i + 1}.html`), png = path.join(out, `frame-${i + 1}.png`);
    writeFileSync(html, await frameHtml(f, i + 1));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', '--virtual-time-budget=5000', `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
    pngs.push(png);
}
const th = await Promise.all(pngs.map(p => sharp(p).resize(360, 640).toBuffer()));
await sharp({ create: { width: th.length * 370, height: 640, channels: 3, background: '#222' } }).composite(th.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 88 }).toFile(path.join(out, 'sheet.jpg'));
console.log(JSON.stringify({ out, frames: pngs.length }));
