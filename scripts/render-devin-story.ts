/** Render a Story in Devin Jatho's exact live-Story design (Antonio, Oct 21: "review each frame, reverse engineer the
 * exact layers ... the cover frame has to follow the same format with the shadows, compositions"). Every number below is
 * measured from his 8 originals (docs/stories/reference/devinjatho/live-2026-10-21/orig, 480x853, scaled x2.25) and
 * written up in docs/stories/devin/layer-spec.md. Font: SF Pro (system), the face his Stories use.
 * Frame types: cover, person, tree, showcase, cta. Marks: **bold**, [[red box]], {{red}}, ((green)), <<mint>>, __underline__.
 * Usage: render-devin-story.ts docs/stories/devin/<slug>.json -> .scheduler-data/story-assets/devin/<slug>/frame-N.png */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadPhotoPool, photoBuffer } from '../src/publishing/story-lifestyle.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const specPath = path.resolve(process.argv[2]!), base = path.dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const out = path.resolve('.scheduler-data/story-assets/devin', spec.slug); mkdirSync(out, { recursive: true });
const pool = loadPhotoPool();
// Measured palette (sampled from the originals).
const C = { red: '#E03842', redText: '#F2434D', green: '#4DA3FF', mint: '#7CC4FF', orange: '#F8930D', teal: '#3DE99B', cyan: '#1EF5F5', stamp: '#D6272C', orbit: '#4FB8E6' };

const md = (s = '') => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<span class="box">$1</span>')
    .replace(/\{\{(.+?)\}\}/g, `<span style="color:${C.redText}">$1</span>`).replace(/\(\((.+?)\)\)/g, `<span style="color:${C.green}">$1</span>`)
    .replace(/<<(.+?)>>/g, `<span style="color:${C.mint};font-weight:600">$1</span>`).replace(/__(.+?)__/g, '<span class="ul">$1</span>').replace(/\n/g, '<br>');
async function photo(key: string, name: string, o: { dim?: number; w?: number; h?: number; pos?: string; sat?: number; zoom?: number; fx?: number; fy?: number } = {}) {
    const file = path.join(out, name + '.jpg');
    let img: sharp.Sharp;
    if (key.startsWith('asset:')) img = sharp(path.join(base, key.slice(6)));
    else { const p = pool.find(x => x.sha256.startsWith(key)); if (!p) throw Error('No pool photo ' + key); img = sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate(); }
    const W = o.w ?? 1080, H = o.h ?? 1920;
    if (o.zoom && o.zoom !== 1) { // push in on a focal point (fx, fy as fractions of the cover-fit frame), like a closer camera
        const z = o.zoom, big = await img.resize(Math.round(W * z), Math.round(H * z), { fit: 'cover' }).toBuffer();
        const left = Math.round(Math.min(Math.max((o.fx ?? .5) * W * z - (o.fx ?? .5) * W, 0), W * z - W)), top = Math.round(Math.min(Math.max((o.fy ?? .5) * H * z - (o.fy ?? .5) * H, 0), H * z - H));
        img = sharp(big).extract({ left, top, width: W, height: H });
    } else img = img.resize(W, H, { fit: 'cover', position: (o.pos as any) ?? 'attention' });
    await img.modulate({ brightness: o.dim ?? 1, saturation: o.sat ?? 1 }).jpeg({ quality: 90 }).toFile(file);
    return name + '.jpg';
}
/** Put a person where Devin puts himself: the face (fx, fy as fractions of the photo, hf = head width / photo width)
 * lands at (x, y) with a head hp px wide, on black, optionally mirrored. Returns a 1080x1920 frame. */
async function place(key: string, name: string, o: { face: [number, number, number]; at: [number, number, number]; flip?: boolean; dim?: number; sat?: number }) {
    let src: sharp.Sharp;
    if (key.startsWith('asset:')) src = sharp(path.join(base, key.slice(6)));
    else { const p = pool.find(x => x.sha256.startsWith(key)); if (!p) throw Error('No pool photo ' + key); src = sharp(await photoBuffer(p.file, p.t), { failOn: 'none' }).rotate(); }
    if (o.flip) src = sharp(await src.flop().toBuffer());
    const m = await sharp(await src.clone().toBuffer()).metadata(), [fx0, fy, hf] = o.face, fx = o.flip ? 1 - fx0 : fx0, [x, y, hp] = o.at;
    const s = hp / (hf * m.width!), W = Math.round(m.width! * s), H = Math.round(m.height! * s);
    const left = Math.round(x - fx * W), top = Math.round(y - fy * H);
    const scaled = await src.resize(W, H).modulate({ brightness: o.dim ?? 1, saturation: o.sat ?? 1 }).toBuffer();
    // Crop the part that falls inside the frame, then drop it onto black.
    const cl = Math.max(0, -left), ct = Math.max(0, -top), cw = Math.min(W - cl, 1080 - Math.max(0, left)), ch = Math.min(H - ct, 1920 - Math.max(0, top));
    const piece = await sharp(scaled).extract({ left: cl, top: ct, width: cw, height: ch }).toBuffer();
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#000' } }).composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }]).jpeg({ quality: 90 }).toFile(path.join(out, name + '.jpg'));
    return name + '.jpg';
}
const asset = (rel: string) => { const n = path.basename(rel); copyFileSync(path.join(base, rel), path.join(out, n)); return n; };
const ICON: Record<string, string> = {
    clock: '<circle cx="50" cy="50" r="40" fill="none" stroke="#000" stroke-width="10"/><path d="M50 26v26l17 11" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round"/>',
    phone: '<path d="M30 14c5-3 10 0 12 5l6 14c2 4 0 8-3 10l-7 5c5 11 13 19 24 24l5-7c2-3 6-5 10-3l14 6c5 2 8 7 5 12l-5 9c-3 5-9 7-15 5C43 86 14 57 6 24c-2-6 0-12 5-15z" fill="#000" transform="translate(4 4) scale(.9)"/>',
    calendar: '<rect x="12" y="18" width="76" height="70" rx="10" fill="none" stroke="#000" stroke-width="10"/><path d="M12 40h76M32 8v20M68 8v20" stroke="#000" stroke-width="10" stroke-linecap="round"/><rect x="28" y="54" width="14" height="12" fill="#000"/><rect x="50" y="54" width="14" height="12" fill="#000"/>',
    nine5: '<text x="50" y="68" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="58" fill="#000">9-5</text>',
    form: '<rect x="18" y="8" width="64" height="84" rx="8" fill="#000"/><path d="M32 30h36M32 48h36M32 66h22" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
    chat: '<path d="M10 20c0-7 5-12 12-12h56c7 0 12 5 12 12v38c0 7-5 12-12 12H44L24 88V70h-2c-7 0-12-5-12-12z" fill="#000"/>',
    ring: '<path d="M30 14c5-3 10 0 12 5l6 14c2 4 0 8-3 10l-7 5c5 11 13 19 24 24l5-7c2-3 6-5 10-3l14 6c5 2 8 7 5 12l-5 9c-3 5-9 7-15 5C43 86 14 57 6 24c-2-6 0-12 5-15z" fill="#000"/>',
};
const glyph = (k: string, color: string, size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="filter:drop-shadow(0 0 10px ${color}) drop-shadow(0 0 2px ${color})"><g style="fill:${color};stroke:${color}">${ICON[k]!.replace(/#000/g, color)}</g></svg>`;

const CSS = `*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:#000}
body{font-family:system-ui,-apple-system,"SF Pro Display","Helvetica Neue",sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000}.bg{position:absolute;inset:0;background-size:cover;background-position:center}
b{font-weight:700}.box{background:${C.red};padding:0 18px;margin-left:6px}
.ul{text-decoration:underline;text-decoration-thickness:4px;text-underline-offset:16px}
.t{position:absolute;left:0;right:0;text-align:center}
.pull{position:absolute;font:500 48px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.6px;padding-bottom:22px}
.pull:after{content:'';position:absolute;left:-6px;right:-30px;bottom:0;height:4px;background:linear-gradient(90deg,rgba(255,255,255,.95),rgba(255,255,255,.75))}
.chip{position:absolute;display:flex;align-items:center;gap:14px;padding:16px 28px 16px 22px;border-radius:999px;background:rgba(40,40,44,.72);border:2px solid rgba(255,255,255,.28);font:500 36px system-ui,-apple-system,sans-serif;backdrop-filter:blur(6px)}`;

async function frameHtml(f: any, i: number) {
    let inner = '';
    const pull = f.pull ? `<div class="pull" style="right:${f.pullRight ?? 140}px;bottom:${f.pullBottom ?? 334}px">${md(f.pull)}</div>` : '';
    if (f.type === 'cover') {
        // Layers: photo plate; top vignette; carved icons on the stone face; headline with soft shadow; bottom fade; sub line.
        const plate = await photo('asset:' + f.plate, 'plate' + i, { zoom: f.zoom, fx: f.fx, fy: f.fy, dim: f.bright ?? 1.15 });
        const cells = (f.carve as string[]).map((k, n) => {
            const [cx, cy] = f.cells[n];
            return `<g transform="translate(${cx - 85} ${cy - 85}) scale(1.7)" filter="url(#carve)">${ICON[k]}</g>`;
        }).join('');
        inner = `<div class="bg" style="background-image:url(${plate})"></div>
          <div class="bg" style="background:linear-gradient(180deg,rgba(4,30,45,.55) 0%,rgba(4,30,45,.15) 22%,rgba(0,0,0,0) 34%)"></div>
          <svg width="1080" height="1920" style="position:absolute;inset:0"><defs><filter id="carve" x="-10%" y="-10%" width="120%" height="120%">
            <feFlood flood-color="#2b2a26" flood-opacity=".46"/><feComposite in2="SourceAlpha" operator="in" result="fill"/>
            <feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
            <feOffset in="inv" dx="5" dy="6" result="o1"/><feGaussianBlur in="o1" stdDeviation="3" result="b1"/><feComposite in="b1" in2="SourceAlpha" operator="in" result="s1"/>
            <feFlood flood-color="#000" flood-opacity=".85"/><feComposite in2="s1" operator="in" result="shadow"/>
            <feOffset in="inv" dx="-3" dy="-3" result="o2"/><feGaussianBlur in="o2" stdDeviation="2" result="b2"/><feComposite in="b2" in2="SourceAlpha" operator="in" result="s2"/>
            <feFlood flood-color="#fff" flood-opacity=".45"/><feComposite in2="s2" operator="in" result="hi"/>
            <feMerge><feMergeNode in="fill"/><feMergeNode in="shadow"/><feMergeNode in="hi"/></feMerge></filter></defs>${cells}</svg>
          <div class="bg" style="background:linear-gradient(180deg,rgba(0,0,0,0) 72%,rgba(0,0,0,.72) 84%,rgba(0,0,0,.92) 100%)"></div>
          <div class="t" style="top:${f.titleTop ?? 230}px;font:700 115px/139px system-ui,-apple-system,sans-serif;letter-spacing:-1.5px;text-transform:uppercase;text-shadow:0 4px 24px rgba(0,0,0,.35)">${md(f.title)}</div>
          <div class="t" style="top:${f.subTop ?? 1626}px;font:500 62px/77px system-ui,-apple-system,sans-serif;letter-spacing:-.8px;text-shadow:0 2px 14px rgba(0,0,0,.6)">${md(f.sub)}</div>`;
    }
    if (f.type === 'person') {
        // Layers: full-bleed photo graded dark, left text column, orbit rings + avatar bubbles or topic chips, pull line.
        const bg = f.place ? await place(f.photo, 'bg' + i, { ...f.place, dim: f.dim ?? .8, sat: .85 }) : await photo(f.photo, 'bg' + i, { dim: f.dim ?? .55, pos: f.pos, sat: .85 });
        // His person frames: the subject is lit and the room falls to black around them (a soft spotlight on the face).
        const spot = f.place ? `-webkit-mask-image:radial-gradient(ellipse ${f.spot?.[0] ?? 620}px ${f.spot?.[1] ?? 900}px at ${f.place.at[0]}px ${f.place.at[1] + 260}px,#000 40%,rgba(0,0,0,.55) 75%,rgba(0,0,0,${f.spotFloor ?? .3}) 100%)` : ''; // the room stays faintly visible, like his
        // Devin's orbit (frame 2, zoomed): big thin glowing arcs around the head. The far side runs BEHIND the head (a cutout of
        // the subject sits on top of it); one arc crosses IN FRONT of the face; small chevrons show motion; bubbles sit on the
        // ring inside a dark halo. Orbit: {cx,cy,rx,ry,rot,front:[t0,t1] degrees,arrows:[t...]}.
        const pt = (o: any, deg: number) => { const t = deg * Math.PI / 180, r = o.rot * Math.PI / 180, x = o.rx * Math.cos(t), y = o.ry * Math.sin(t);
            return [o.cx + x * Math.cos(r) - y * Math.sin(r), o.cy + x * Math.sin(r) + y * Math.cos(r)] as [number, number]; };
        const arc = (o: any, a: number, b: number) => { let d = ''; for (let k = 0; k <= 60; k++) { const [x, y] = pt(o, a + (b - a) * k / 60); d += (k ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); } return d; };
        const ringStyle = `fill="none" stroke="${C.orbit}" stroke-width="4.5" stroke-linecap="round" style="filter:drop-shadow(0 0 7px ${C.orbit}) drop-shadow(0 0 2px ${C.orbit})"`;
        const chevrons = (o: any) => (o.arrows ?? []).map((a: number) => { const [x, y] = pt(o, a), [x2, y2] = pt(o, a + 1), ang = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI;
            return `<path d="M-9 -8 L3 0 L-9 8" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})" ${ringStyle}/>`; }).join('');
        const orbits = f.orbit ?? [];
        const back = orbits.length ? `<svg width="1080" height="1920" style="position:absolute;inset:0">${orbits.map((o: any) => `<path d="${arc(o, 0, 360)}" ${ringStyle} opacity=".95"/>${chevrons(o)}`).join('')}</svg>` : '';
        const front = orbits.some((o: any) => o.front) ? `<svg width="1080" height="1920" style="position:absolute;inset:0">${orbits.filter((o: any) => o.front).map((o: any) => `<path d="${arc(o, o.front[0], o.front[1])}" ${ringStyle}/>`).join('')}</svg>` : '';
        // The subject cutout: same photo, same shift, alpha from the Apple Vision mask (scripts/tools/subject-mask.swift).
        let cutout = '';
        if (f.cutout) {
            const W = 1080, H = 1920, name = 'cut' + i + '.png';
            const src = f.photo.startsWith('asset:') ? path.join(base, f.photo.slice(6)) : '';
            const rgb = await sharp(src).resize(W, H, { fit: 'cover' }).modulate({ brightness: f.dim ?? 1, saturation: .85 }).removeAlpha().toBuffer();
            const alpha = await sharp(path.join(base, f.cutout)).resize(W, H, { fit: 'cover' }).greyscale().toColourspace('b-w').raw().toBuffer();
            await sharp(rgb).joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(out, name));
            cutout = `<div class="bg" style="background-image:url(${name});background-size:1080px 1920px;background-repeat:no-repeat;background-position:${f.shift?.[0] ?? 0}px ${f.shift?.[1] ?? 0}px"></div>`;
        }
        const onRing = (b: any) => b.on ? pt(orbits[b.on[0]], b.on[1]) : [b.x, b.y];
        // Bubbles sit on the orbit: a photo or logo (b.img) like his avatars, or a glowing glyph (b.icon) for tools.
        const bubbles = (f.bubbles ?? []).map((b: any) => { const [x, y] = onRing(b);
            return `<div style="position:absolute;left:${x - 50}px;top:${y - 50}px;width:100px;height:100px;border-radius:50%;border:5px solid ${b.ring};box-shadow:0 0 0 14px rgba(0,0,0,.55),0 0 34px 16px rgba(0,0,0,.65),0 0 16px ${b.ring};${b.img ? `background:url(${asset(b.img)}) center/cover` : 'background:#0d0f12;display:flex;align-items:center;justify-content:center'}">${b.icon ? glyph(b.icon, b.ring, 50) : ''}</div>`; }).join('');
        const chips = (f.chips ?? []).map((c: any) => `<div class="chip" style="left:${c.x}px;top:${c.y}px">${c.icon ?? ''}${c.text}</div>`).join('');
        // shift: move a pre-framed photo right/down so the subject sits where Devin sits; the gap stays black.
        const shift = f.shift ? `background-size:1080px 1920px;background-repeat:no-repeat;background-position:${f.shift[0]}px ${f.shift[1]}px;-webkit-mask-image:linear-gradient(90deg,transparent ${f.shift[0]}px,#000 ${f.shift[0] + 320}px),linear-gradient(180deg,transparent ${f.shift[1]}px,#000 ${f.shift[1] + 260}px);-webkit-mask-composite:source-in;` : '';
        inner = `<div class="bg" style="background-image:url(${bg});${shift}${spot}"></div>
          <div class="bg" style="background:linear-gradient(90deg,rgba(0,0,0,.65) 0%,rgba(0,0,0,.35) 45%,rgba(0,0,0,0) 70%)"></div>
          ${back}${cutout}${front}${bubbles}${chips}
          <div style="position:absolute;left:106px;top:${f.titleTop ?? 295}px;font:400 ${f.titleSize ?? 80}px/${f.titleLh ?? 94}px system-ui,-apple-system,sans-serif;letter-spacing:-1.4px">${md(f.title)}</div>
          <div style="position:absolute;left:106px;top:${f.bodyTop ?? 765}px;font:400 56px/66px system-ui,-apple-system,sans-serif;letter-spacing:-.6px">${md(f.body)}</div>${pull}`;
    }
    if (f.type === 'tree') {
        // Layers: black, dim backdrop photo at the bottom, centered title, "You" node, dashed curves, three cards.
        // His tree backdrop: himself, small at the bottom centre, under a heavy dark overlay; the top is pure black.
        const back = f.backPlace ? await place(f.backdrop, 'back' + i, { ...f.backPlace, dim: .5, sat: .7 }) : await photo(f.backdrop, 'back' + i, { dim: .17, w: 1080, h: 1000, pos: 'centre', sat: .7 });
        const st = f.state ?? 1, xs = [232, 529, 826], top = 853, cw = 270, ch = 443;
        const dashColor = (n: number) => st === 3 && f.cards[n].stamp ? C.stamp : 'rgba(255,255,255,.92)';
        const curves = xs.map((x, n) => `<path d="M${529 + (n - 1) * 22} 731 C ${529 + (n - 1) * 60} 790, ${x} 760, ${x} ${top - 22}" fill="none" stroke="${dashColor(n)}" stroke-width="4" stroke-dasharray="16 12" stroke-linecap="round"/>`).join('');
        const cards = await Promise.all(f.cards.map(async (c: any, n: number) => {
            const dim = st === 3 && !c.stamp, red = st === 3 && c.stamp; // his stamped cards drop the number; the survivor fades
            // His card photos are low-key: dark room, lit subject; darker still once a stat sits on top.
            const img = await photo(c.photo, `card${i}-${n}`, { w: 248, h: 372, pos: c.pos, dim: st >= 2 ? .38 : .6, sat: .85 });
            const mid = red ? '' : st === 1 ? `<div style="position:absolute;left:0;right:0;top:${c.iconTop ?? 150}px;display:flex;justify-content:center">${glyph(c.icon, c.color, 92)}</div>`
                : `<div style="position:absolute;left:0;right:0;top:118px;text-align:center"><div style="font:700 96px/1 system-ui,-apple-system,sans-serif;letter-spacing:-2px;color:${c.color};text-shadow:0 0 18px ${c.color}66">${c.stat}</div><div style="font:500 42px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:-.5px;margin-top:4px">${c.statLabel}</div></div>`;
            return `<div style="position:absolute;left:${xs[n] - cw / 2}px;top:${top}px;width:${cw}px;height:${ch}px;border-radius:22px;background:${red ? '#F1C9CB' : '#E7E7E7'};padding:0 9px 9px;opacity:${dim ? .32 : 1};box-shadow:${red ? `0 0 0 3px ${C.stamp}55` : 'none'}">
              <div style="height:58px;font:500 31px/58px system-ui,-apple-system,sans-serif;letter-spacing:-.6px;color:#111;text-align:center;white-space:nowrap">${c.name}</div>
              <div style="position:relative;height:${ch - 67}px;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.1) 40%,rgba(0,0,0,.45)),url(${img}) center/cover;outline:${red ? `3px solid ${C.stamp}` : 'none'}">${mid}</div>
              ${red ? `<div style="position:absolute;left:-26px;right:-26px;top:200px;transform:rotate(-8deg);background:${C.stamp};color:#fff;font:800 40px/1 system-ui,-apple-system,sans-serif;letter-spacing:.5px;text-align:center;padding:16px 0;box-shadow:0 8px 20px rgba(0,0,0,.45);clip-path:polygon(0 8%,3% 0,97% 4%,100% 0,98% 92%,100% 100%,2% 96%,0 100%)">${c.stamp}</div>` : ''}</div>`;
        }));
        inner = (f.backPlace ? `<div class="bg" style="background-image:url(${back});-webkit-mask-image:radial-gradient(ellipse 520px 420px at 540px ${f.backPlace.at[1] + 120}px,#000 30%,rgba(0,0,0,.5) 60%,transparent 100%)"></div>
          <div class="bg" style="background:rgba(0,0,0,.45)"></div>` : `<div class="bg" style="top:auto;height:1000px;background-image:url(${back});-webkit-mask-image:linear-gradient(180deg,transparent 0%,transparent 25%,#000 70%)"></div>`) + `
          <div class="t" style="top:${f.titleTop ?? 270}px;font:500 62px/74px system-ui,-apple-system,sans-serif;letter-spacing:-.9px">${md(f.title)}</div>
          <div style="position:absolute;left:380px;top:493px;width:299px;height:238px;border-radius:36px;background:linear-gradient(180deg,#1d1d1f 0%,#0b0b0c 70%,#000 100%);border:2px solid rgba(255,255,255,.10)">
            <div style="text-align:center;font:500 40px/1 system-ui,-apple-system,sans-serif;margin-top:26px">${f.node ?? 'You'}</div>
            <div style="width:146px;height:146px;border-radius:50%;margin:24px auto 0;background:#fff url(${await photo(f.avatar, 'av' + i, { w: 300, h: 300, pos: 'centre' })}) center/cover;border:5px solid #fff"></div></div>
          <svg width="1080" height="1920" style="position:absolute;inset:0">${curves}</svg>${cards.join('')}`;
    }
    if (f.type === 'showcase') {
        // Layers: black, title with green underline, line, centre screen card with two blurred dim side cards, divider, repeat.
        const row = async (r: any, y: number) => {
            // His side cards are other real posts, blurred and dimmed behind the sharp centre one.
            const main = asset(r.image), sides = await Promise.all((r.sides ?? [r.image, r.image]).map((s: string, k: number) => photo('asset:' + s, `side${i}-${y}-${k}`, { w: 288, h: 481, dim: .4 })));
            return `<div style="position:absolute;left:170px;top:${y + 40}px;width:260px;height:420px;border-radius:22px;background:url(${sides[0]}) center/cover;filter:blur(5px);opacity:.75"></div>
              <div style="position:absolute;left:650px;top:${y + 40}px;width:260px;height:420px;border-radius:22px;background:url(${sides[1]}) center/cover;filter:blur(5px);opacity:.75"></div>
              <div style="position:absolute;left:396px;top:${y}px;width:288px;height:481px;border-radius:24px;background:#111 url(${main}) center/cover;border:3px solid rgba(255,255,255,.85);box-shadow:0 20px 50px rgba(0,0,0,.8)"></div>`;
        };
        inner = `<div class="t" style="top:225px;font:500 64px/1 system-ui,-apple-system,sans-serif;letter-spacing:-1.2px">${md(f.title)}</div>
          <div style="position:absolute;left:127px;top:380px;font:400 54px/68px system-ui,-apple-system,sans-serif;letter-spacing:-.7px">${md(f.line1)}</div>
          ${await row(f.rows[0], 525)}
          <div style="position:absolute;left:117px;right:117px;top:1058px;height:2px;background:#2c2c2c"></div>
          <div class="t" style="top:1115px;font:400 54px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.7px">${md(f.line2)}</div>
          ${await row(f.rows[1], 1205)}`;
    }
    if (f.type === 'cta') {
        // Layers: black with a dim warm photo bottom, title + 👇, white YouTube card with player chrome, Reply "KEYWORD".
        const back = f.backdrop ? await photo(f.backdrop, 'back' + i, { dim: .16, w: 1080, h: 900, pos: 'centre', sat: .5 }) : '';
        inner = `${back ? `<div class="bg" style="top:auto;height:900px;background-image:url(${back});-webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 60%)"></div>` : ''}
          <div class="t" style="top:296px;font:600 58px/82px system-ui,-apple-system,sans-serif;letter-spacing:-1px">${md(f.title)}</div>
          <div style="position:absolute;left:90px;top:574px;width:900px;border-radius:36px;background:#fff;padding:27px 27px 26px">
            <div style="position:relative;border-radius:16px;overflow:hidden;height:470px;background:url(${asset(f.thumb)}) center/cover">
              <div style="position:absolute;left:0;right:0;bottom:0;height:96px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.75))"></div>
              <div style="position:absolute;left:24px;right:24px;bottom:66px;height:6px;background:rgba(255,255,255,.35);border-radius:3px"><div style="width:10%;height:100%;background:#f00;border-radius:3px"></div><div style="position:absolute;left:9%;top:-6px;width:18px;height:18px;border-radius:50%;background:#f00"></div></div>
              <div style="position:absolute;left:28px;bottom:16px;display:flex;gap:30px;align-items:center;font:500 26px system-ui,-apple-system,sans-serif;color:#fff">
                <svg width="30" height="30" viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="#fff"/></svg><svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 4l10 8-10 8zM17 4h3v16h-3z" fill="#fff"/></svg><span>${f.time ?? '1:14 / 16:42'}</span></div>
              <div style="position:absolute;right:28px;bottom:16px;display:flex;gap:28px">${['M4 6h16v12H4z', 'M3 12a9 9 0 1018 0 9 9 0 10-18 0', 'M4 4h6v2H6v4H4zM20 20h-6v-2h4v-4h2z'].map(d => `<svg width="30" height="30" viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="#fff" stroke-width="2.2"/></svg>`).join('')}</div></div>
            <div style="font:700 32px/1.25 system-ui,-apple-system,sans-serif;color:#111;margin-top:22px;letter-spacing:-.4px">${f.videoTitle}</div></div>
          <div class="t" style="top:1318px;font:700 116px/1 system-ui,-apple-system,sans-serif;letter-spacing:-3px;white-space:nowrap">Reply <span style="color:${C.green}">“${spec.keyword}”</span></div>
          <div class="t" style="top:1462px;font:400 44px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.4px">${f.send ?? "and I'll send it to you"}</div>`;
    }
    if (!inner) throw Error('Unknown frame type ' + f.type);
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="stage">${inner}</div></body></html>`;
}

const pngs: string[] = [];
for (const [i, f] of spec.frames.entries()) {
    const html = path.join(out, `frame-${i + 1}.html`), png = path.join(out, `frame-${i + 1}.png`);
    writeFileSync(html, await frameHtml(f, i + 1));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', '--virtual-time-budget=6000', `--screenshot=${png}`, 'file://' + html], { stdio: 'ignore' });
    pngs.push(png);
}
const th = await Promise.all(pngs.map(p => sharp(p).resize(360, 640).toBuffer()));
await sharp({ create: { width: th.length * 370, height: 640, channels: 3, background: '#222' } }).composite(th.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 88 }).toFile(path.join(out, 'sheet.jpg'));
console.log(JSON.stringify({ out, frames: pngs.length }));
