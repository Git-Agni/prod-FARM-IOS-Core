/** Render a teaching Story (Antonio, Oct 21: "a branded sample that we could be running every single day", modelled on
 * Devin Jatho's live 8-frame sequence, docs/stories/reference/devinjatho). A JSON spec lists the frames; each frame type is a
 * fixed C2C template (dark #0A0A0A, #2780FF, Inter), rendered at 1080x1920 in headless Chrome like the kit covers.
 * Text marks: **bold**, [[red box]], {{red}}, ((blue)). Photos are Story-pool photos named by SHA-256 prefix.
 * Usage: render-teaching-story.ts docs/stories/teaching/<slug>.json  ->  .scheduler-data/story-assets/teaching/<slug>/
 * Renders files only: no phone, no upload, no Story plan. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadPhotoPool, photoBuffer } from '../src/publishing/story-lifestyle.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const out = path.resolve('.scheduler-data/story-assets/teaching', spec.slug); mkdirSync(out, { recursive: true });
const pool = loadPhotoPool();

const md = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<span class="box">$1</span>')
    .replace(/\{\{(.+?)\}\}/g, '<span class="red">$1</span>').replace(/\(\((.+?)\)\)/g, '<span class="blue">$1</span>');
async function photo(prefix: string, name: string) {
    const p = pool.find(x => x.sha256.startsWith(prefix)); if (!p) throw Error('No pool photo ' + prefix);
    const file = path.join(out, name + '.jpg');
    await sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate().resize(1080, 1920, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90 }).toFile(file);
    return name + '.jpg';
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=block');
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#0A0A0A;font-family:Inter,sans-serif;color:#fff}
.stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#0A0A0A}
.grid{position:absolute;inset:0;background:radial-gradient(ellipse 800px 600px at 50% 900px,rgba(39,128,255,.18),rgba(39,128,255,0) 70%),linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px) 0 0/54px 54px,linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px) 0 0/54px 54px}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,10,10,.92) 0%,rgba(10,10,10,.55) 38%,rgba(10,10,10,.1) 60%,rgba(10,10,10,.7) 100%)}
.title{position:absolute;top:200px;left:80px;right:80px;font:600 64px/1.18 Inter;letter-spacing:-1.2px}
.title b{font-weight:800}.center{text-align:center}
.body{position:absolute;left:80px;right:300px;font:500 46px/1.3 Inter;color:#e9e9e9}.body b{color:#fff;font-weight:800}
.pull{position:absolute;right:80px;bottom:330px;font:700 48px Inter;padding-bottom:10px;border-bottom:4px solid rgba(255,255,255,.85)}
.box{background:#E8231F;color:#fff;padding:0 14px;border-radius:6px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.red{color:#FF4D4D}.blue{color:#2780FF}
.hook{position:absolute;top:180px;left:60px;right:60px;text-align:center;font:900 104px/1.02 Inter;letter-spacing:-3px;text-transform:uppercase}
.bottom{position:absolute;bottom:300px;left:60px;right:60px;text-align:center;font:600 52px/1.25 Inter}
.phone{position:absolute;left:50%;top:620px;transform:translateX(-50%) rotate(-3deg);width:560px;height:900px;border-radius:70px;background:#111;border:14px solid #2a2a2e;box-shadow:0 0 0 2px #444,0 40px 90px rgba(0,0,0,.8),0 0 120px rgba(39,128,255,.25);padding:70px 30px;overflow:hidden}
.notch{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:170px;height:38px;border-radius:20px;background:#000}
.who{font:700 24px Inter;color:#9a9a9a;margin:26px 8px 8px}
.msg{font:500 31px/1.3 Inter;padding:20px 26px;border-radius:28px;max-width:440px}
.in{background:#2a2a2e;color:#fff;border-bottom-left-radius:8px}
.missed{display:flex;align-items:center;gap:14px;background:#1d1d20;border:2px solid #E8231F;border-radius:22px;padding:18px 22px;font:700 29px Inter;color:#FF6B6B;margin-top:22px}
.tagx{display:inline-block;font:800 20px Inter;color:#0A0A0A;background:#FFD23F;padding:4px 10px;border-radius:6px;margin-left:8px}
.orbit{position:absolute;right:-120px;top:560px;width:760px;height:760px;border-radius:50%;border:3px solid rgba(39,128,255,.7);box-shadow:0 0 40px rgba(39,128,255,.35)}
.chip{position:absolute;font:700 32px Inter;background:rgba(20,20,24,.92);border:2px solid #2780FF;border-radius:999px;padding:14px 26px;white-space:nowrap}
.dg{position:absolute;left:0;right:0;top:560px;height:900px}
.lead{position:absolute;left:50%;top:0;transform:translateX(-50%);width:190px;height:190px;border-radius:40px;background:#16161a;border:3px solid #3a3a40;display:flex;flex-direction:column;align-items:center;justify-content:center;font:800 34px Inter}
.lead .ic{font-size:72px;line-height:1}
.ask{position:absolute;left:50%;top:-74px;transform:translateX(-50%);white-space:nowrap;font:700 26px Inter;background:#fff;color:#111;padding:10px 18px;border-radius:16px}
.cards{position:absolute;top:340px;left:70px;right:70px;display:flex;gap:28px}
.card{position:relative;flex:1;height:440px;border-radius:26px;background:#141418;border:3px solid #34343a;display:flex;flex-direction:column;align-items:center;padding-top:36px;gap:18px;text-align:center}
.card .ic{font-size:96px;line-height:1}.card .nm{font:800 34px Inter}.card .act{font:600 28px/1.25 Inter;color:#cfcfcf;padding:0 16px}
.card.on{border-color:#2780FF;box-shadow:0 0 50px rgba(39,128,255,.35)}
.card.off{border-color:#E8231F;opacity:.95}
.stamp{position:absolute;top:340px;left:50%;transform:translateX(-50%) rotate(-12deg);font:900 30px Inter;color:#fff;background:#E8231F;padding:10px 16px;border-radius:8px;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.6)}
svg.lines{position:absolute;left:0;top:0;width:1080px;height:600px}
.items{position:absolute;top:1060px;left:80px;right:80px;display:flex;flex-direction:column;gap:26px}
.item{display:flex;align-items:center;gap:26px;background:rgba(16,16,20,.88);border:2px solid rgba(39,128,255,.55);border-radius:24px;padding:26px 30px;font:700 46px Inter;backdrop-filter:blur(6px)}
.num{width:76px;height:76px;flex:none;border-radius:20px;background:#2780FF;display:flex;align-items:center;justify-content:center;font:900 44px Inter}
.yt{position:absolute;top:470px;left:90px;right:90px;background:#fff;border-radius:28px;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,.7)}
.yt img{width:100%;border-radius:14px;display:block}.yt .bar{height:8px;background:#ddd;border-radius:4px;margin:16px 4px 0;position:relative}
.yt .bar:after{content:'';position:absolute;left:0;top:0;bottom:0;width:22%;background:#E8231F;border-radius:4px}
.yt .vt{font:700 30px Inter;color:#111;margin:16px 6px 4px}
.reply{position:absolute;top:1130px;left:0;right:0;text-align:center;font:900 112px/1 Inter;letter-spacing:-2px}
.reply .k{color:#2780FF}.send{position:absolute;top:1262px;left:0;right:0;text-align:center;font:500 46px Inter;color:#d0d0d0}`;

const AGENTS = [{ ic: '🤖', nm: 'AI assistant', act: 'Replies by text' }, { ic: '📞', nm: 'Setter', act: 'Calls the lead' }, { ic: '🤝', nm: 'Closer', act: 'Gets the booking' }];
function diagram(state: number) {
    const lineColor = state === 3 ? '#E8231F' : 'rgba(255,255,255,.55)';
    const lines = [205, 540, 875].map(x => `<path d="M540 190 C 540 260, ${x} 260, ${x} 340" stroke="${lineColor}" stroke-width="4" stroke-dasharray="14 12" fill="none"/>`).join('');
    const cards = AGENTS.map(a => `<div class="card ${state === 2 ? 'on' : state === 3 ? 'off' : ''}"><div class="ic">${a.ic}</div><div class="nm">${a.nm}</div>${state >= 2 ? `<div class="act">${a.act}</div>` : ''}${state === 3 ? '<div class="stamp">NO CONTEXT</div>' : ''}</div>`).join('');
    return `<div class="dg"><svg class="lines" viewBox="0 0 1080 600">${lines}</svg><div class="lead"><div class="ic">🙋</div>Lead${state === 1 ? '<div class="ask">Fit my schedule?</div>' : ''}</div><div class="cards">${cards}</div></div>`;
}

async function frameHtml(f: any, i: number) {
    let inner = '';
    if (f.type === 'hook') inner = `<div class="grid"></div><div class="hook">${md(f.title)}</div>
      <div class="phone"><div class="notch"></div><div class="who">AI assistant <span class="tagx">auto</span></div><div class="msg in">Yes! Our program works around any schedule 🙌</div>
      <div class="missed">📵 Missed call · Sales team</div><div class="who">Setter</div><div class="msg in">Hey! Are you free this evening to talk about your schedule?</div></div>
      <div class="bottom">${md(f.bottom)}</div>`;
    if (f.type === 'photo') inner = `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i)})"></div><div class="shade"></div>
      <div class="title">${md(f.title)}</div><div class="body" style="top:420px">${md(f.body)}</div><div class="pull">${md(f.pull)}</div>`;
    if (f.type === 'orbit') inner = `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i)});filter:brightness(.6)"></div><div class="shade"></div>
      <div class="orbit"></div><div class="chip" style="right:480px;top:620px">🤖 AI</div><div class="chip" style="right:60px;top:820px">📞 Setter</div><div class="chip" style="right:330px;top:1210px">🤝 Closer</div>
      <div class="title">${md(f.title)}</div><div class="body" style="top:470px;right:360px">${md(f.body)}</div><div class="pull">${md(f.pull)}</div>`;
    if (f.type === 'diagram') inner = `<div class="bg" style="background-image:url(${await photo('37287de1', 'bgdg')});filter:brightness(.22) blur(2px)"></div><div class="grid"></div>
      <div class="title center" style="top:230px">${md(f.title)}</div>${diagram(f.state)}`;
    if (f.type === 'list') inner = `<div class="bg" style="background-image:url(${await photo(f.photo, 'bg' + i)})"></div><div class="shade"></div>
      <div class="title center" style="top:230px;font-size:76px">${md(f.title)}</div>
      <div class="items">${f.items.map((t: string, n: number) => `<div class="item"><div class="num">${n + 1}</div>${md(t)}</div>`).join('')}</div>`;
    if (f.type === 'cta') inner = `<div class="grid"></div><div class="title center" style="top:250px">${md(f.title)}</div>
      <div class="yt"><img src="${f.thumb}"><div class="bar"></div><div class="vt">${f.videoTitle}</div></div>
      <div class="reply">Reply <span class="k">"${spec.keyword}"</span></div><div class="send">and I'll send it to you</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="stage">${inner}</div></body></html>`;
}

const pngs: string[] = [];
for (const [i, f] of spec.frames.entries()) {
    const html = path.join(out, `frame-${i + 1}.html`), png = path.join(out, `frame-${i + 1}.png`);
    writeFileSync(html, await frameHtml(f, i + 1));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', '--virtual-time-budget=8000', `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
    pngs.push(png);
}
const th = await Promise.all(pngs.map(p => sharp(p).resize(360, 640).toBuffer()));
await sharp({ create: { width: th.length * 370, height: 640, channels: 3, background: '#222' } }).composite(th.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 88 }).toFile(path.join(out, 'sheet.jpg'));
console.log(JSON.stringify({ out, frames: pngs.length }));
