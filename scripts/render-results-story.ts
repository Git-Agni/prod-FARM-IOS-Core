/** Story version 2: Devin Jatho's RESULTS proof stack (Highlight sheet docs/stories/reference/devinjatho/sheet-RESULTS.jpg).
 * One win per frame on a deep navy-purple grid with floating crystals: a heavy uppercase headline with the result in a red
 * box, the real proof screenshot on a tilted dark card, a red ring on the number, red tags and a red curved arrow, and a
 * REPLY WITH "KEYWORD" block with a dashed arrow every 3 to 4 frames. Only real screenshots go on the cards.
 * Usage: render-results-story.ts docs/stories/devin/<slug>.json -> .scheduler-data/story-assets/devin/<slug>/ */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const specPath = path.resolve(process.argv[2]!), base = path.dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const out = path.resolve('.scheduler-data/story-assets/devin', spec.slug); mkdirSync(out, { recursive: true });
const RED = '#FF2A2A', BOX = '#E8232A';
const F = 'system-ui,-apple-system,sans-serif';
const md = (s = '') => s.replace(/\[\[(.+?)\]\]/g, `<span style="background:${BOX};padding:0 14px;margin:0 2px">$1</span>`)
    .replace(/\{\{(.+?)\}\}/g, '<span style="background:linear-gradient(90deg,#8B5CF6,#C084FC);-webkit-background-clip:text;color:transparent">$1</span>').replace(/\n/g, '<br>');
const asset = (rel: string) => { const n = path.basename(rel); copyFileSync(path.join(base, rel), path.join(out, n)); return n; };
const size = async (rel: string) => { const m = await sharp(path.join(base, rel)).metadata(); return [m.width!, m.height!]; };

// Background: deep navy-purple, faint grid, a blurred collage of other wins, and glowing purple crystals.
async function background(f: any) {
    const collage = await Promise.all((spec.collage ?? []).map(async (rel: string, n: number) =>
        `<img src="${asset(rel)}" style="position:absolute;left:${(n % 3) * 380 - 60}px;top:${Math.floor(n / 3) * 520 + 120}px;width:420px;border-radius:18px;transform:rotate(${(n % 2 ? 4 : -5)}deg);opacity:${f.type === 'titlecard' ? .28 : .10};filter:blur(${f.type === 'titlecard' ? 1 : 3}px)">`));
    const crystal = (x: number, y: number, s: number, r: number) => `<svg style="position:absolute;left:${x}px;top:${y}px;transform:rotate(${r}deg);filter:drop-shadow(0 0 24px rgba(139,92,246,.7))" width="${s}" height="${s * 1.3}" viewBox="0 0 100 130">
      <defs><linearGradient id="g${x}${y}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C4B5FD"/><stop offset=".45" stop-color="#7C3AED"/><stop offset="1" stop-color="#2E1065"/></linearGradient></defs>
      <polygon points="50,0 100,40 78,130 22,130 0,40" fill="url(#g${x}${y})" opacity=".55"/><polygon points="50,0 78,130 50,95" fill="#fff" opacity=".12"/><polygon points="0,40 50,95 22,130" fill="#000" opacity=".25"/></svg>`;
    const crystals = (f.crystals ?? spec.crystals ?? []).map((c: number[]) => crystal(c[0]!, c[1]!, c[2]!, c[3]!)).join('');
    return `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 900px 1200px at 50% 45%,#16123A 0%,#0C0A22 55%,#050410 100%)"></div>
      <div style="position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px) 0 0/54px 54px,linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px) 0 0/54px 54px"></div>
      ${collage.join('')}${crystals}`;
}

async function frameHtml(f: any) {
    let inner = await background(f);
    if (f.type === 'win') {
        const cards = await Promise.all(f.cards.map(async (c: any, n: number) => {
            const [w0, h0] = await size(c.img), w = c.w, h = Math.round(w * h0 / w0);
            const ring = c.ring ? `<div style="position:absolute;left:${16 + c.ring[0] * w - c.ring[2] * w / 2}px;top:${16 + c.ring[1] * h - c.ring[3] * h / 2}px;width:${c.ring[2] * w}px;height:${c.ring[3] * h}px;border:6px solid ${RED};border-radius:50%;transform:rotate(-6deg);box-shadow:0 0 14px rgba(255,42,42,.5)"></div>` : '';
            return `<div style="position:absolute;left:${c.x}px;top:${c.y}px;padding:16px;border-radius:26px;background:#14122E;border:2px solid rgba(255,255,255,.09);box-shadow:0 30px 80px rgba(0,0,0,.65);transform:rotate(${c.rot ?? 0}deg)">
              <img src="${asset(c.img)}" style="display:block;width:${w}px;height:${h}px;border-radius:14px">${ring}</div>`;
        }));
        const arrows = (f.arrows ?? []).map((a: any) => `<path d="M${a.from[0]} ${a.from[1]} Q ${a.ctrl[0]} ${a.ctrl[1]} ${a.to[0]} ${a.to[1]}" fill="none" stroke="${RED}" stroke-width="6" stroke-linecap="round" marker-end="url(#ah)"/>`).join('');
        const tags = (f.tags ?? []).map((t: any) => `<div style="position:absolute;left:${t.x}px;top:${t.y}px;transform:rotate(${t.rot ?? -6}deg);background:${RED};color:#fff;font:800 32px/1 ${F};padding:12px 18px;letter-spacing:.5px;box-shadow:0 8px 20px rgba(0,0,0,.5)">${t.text}</div>`).join('');
        inner += `<div style="position:absolute;left:60px;right:60px;top:${f.titleTop ?? 250}px;text-align:center;font:900 60px/1.16 ${F};letter-spacing:-.5px;text-transform:uppercase;text-shadow:0 4px 20px rgba(0,0,0,.6)">${md(f.title)}</div>
          ${cards.join('')}
          <svg width="1080" height="1920" style="position:absolute;inset:0"><defs><marker id="ah" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 z" fill="${RED}"/></marker></defs>${arrows}</svg>${tags}`;
    }
    if (f.type === 'titlecard') {
        inner += `<div style="position:absolute;left:0;right:0;top:${f.top ?? 640}px;text-align:center;font:900 132px/1 ${F};letter-spacing:-2px;text-transform:uppercase;text-shadow:0 6px 30px rgba(0,0,0,.6)">${md(f.title)}</div>
          <div style="position:absolute;left:0;right:0;top:${(f.top ?? 640) + 300}px;text-align:center;font:600 40px/1 ${F};letter-spacing:4px;text-transform:uppercase;color:#E9E5FF">${f.sub ?? ''}</div>`;
    }
    if (f.cta) inner += `<div style="position:absolute;left:0;right:0;top:${f.ctaTop ?? 1470}px;text-align:center;white-space:nowrap">
        <span style="font:600 50px/1 ${F};letter-spacing:.5px">REPLY WITH </span><span style="font:900 italic 64px/1 ${F};background:linear-gradient(90deg,${f.ctaFrom ?? '#FF4FD8'},${f.ctaTo ?? '#A855F7'});-webkit-background-clip:text;color:transparent">“${spec.keyword}”</span></div>
      <svg width="1080" height="1920" style="position:absolute;inset:0"><path d="M${f.ctaArrowX ?? 800} ${(f.ctaTop ?? 1470) + 80} C ${(f.ctaArrowX ?? 800) + 90} ${(f.ctaTop ?? 1470) + 150}, ${(f.ctaArrowX ?? 800) + 60} ${(f.ctaTop ?? 1470) + 230}, ${(f.ctaArrowX ?? 800) + 10} ${(f.ctaTop ?? 1470) + 260}" fill="none" stroke="${f.ctaTo ?? '#A855F7'}" stroke-width="5" stroke-dasharray="12 10" stroke-linecap="round"/>
      <path d="M${(f.ctaArrowX ?? 800) - 8} ${(f.ctaTop ?? 1470) + 238} l 18 26 l 14 -30" fill="none" stroke="${f.ctaTo ?? '#A855F7'}" stroke-width="5" stroke-linecap="round"/></svg>
      ${f.send ? `<div style="position:absolute;left:0;right:0;top:${(f.ctaTop ?? 1470) + 90}px;text-align:center;font:400 40px/1 ${F};color:#D9D4FF">${f.send}</div>` : ''}`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#08061A;color:#fff;font-family:${F};-webkit-font-smoothing:antialiased}</style></head><body><div style="position:relative;width:1080px;height:1920px;overflow:hidden">${inner}</div></body></html>`;
}

const pngs: string[] = [];
for (const [i, f] of spec.frames.entries()) {
    const html = path.join(out, `frame-${i + 1}.html`), png = path.join(out, `frame-${i + 1}.png`);
    writeFileSync(html, await frameHtml(f));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', '--virtual-time-budget=5000', `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
    pngs.push(png);
}
const th = await Promise.all(pngs.map(p => sharp(p).resize(360, 640).toBuffer()));
await sharp({ create: { width: th.length * 370, height: 640, channels: 3, background: '#222' } }).composite(th.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 88 }).toFile(path.join(out, 'sheet.jpg'));
console.log(JSON.stringify({ out, frames: pngs.length }));
