/** Browser entry for the Story renderer's code-built 3D frames (Antonio, Oct 21: "aren't we able to generate them with
 * claude through like json codes?"). A frame's `scene` JSON lists objects, a camera and a light preset; this file turns it
 * into a Three.js render on a transparent canvas laid over the frame's photo. Real logos, screenshots and thumbnails go on
 * the objects as textures (inlined as data URIs by render-teaching-story.ts), so every image is our own material, lit in 3D.
 * Bundled with esbuild into the frame folder; sets document.title = 'ready' once drawn. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type V3 = [number, number, number];
const S: any = (window as any).SCENE;
const rad = (r: V3 = [0, 0, 0]) => new THREE.Euler(...r.map(d => d * Math.PI / 180) as V3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(1080, 1920); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = S.exposure ?? 1;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('scene')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = S.envIntensity ?? .6;
const cam = new THREE.PerspectiveCamera(S.camera?.fov ?? 32, 1080 / 1920, .1, 100);
cam.position.set(...(S.camera?.pos ?? [0, 1.4, 9]) as V3); cam.lookAt(...(S.camera?.look ?? [0, 1, 0]) as V3);

const key = new THREE.DirectionalLight('#ffffff', S.key ?? 2.2); key.position.set(-3, 7, 5); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); key.shadow.radius = 6;
scene.add(key);
const rim = new THREE.DirectionalLight(S.accent ?? '#2780FF', S.rim ?? 3); rim.position.set(4, 3, -5); scene.add(rim);
if (S.floor === true) { // contact shadows only for objects resting on a surface; floating objects cast odd strips
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: S.shadow ?? .55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = S.floorY ?? -1; floor.receiveShadow = true; scene.add(floor);
}

const loader = new THREE.TextureLoader();
const tex = (src: string) => new Promise<THREE.Texture>(ok => loader.load(src, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ok(t); }));
/** Text drawn on a canvas so headlines, numbers and labels can sit on or float near objects. */
function textTex(t: string, o: any) {
    const c = document.createElement('canvas'), g = c.getContext('2d')!, px = o.px ?? 160;
    g.font = `${o.weight ?? 900} ${px}px Inter`; const lines = t.split('\n');
    c.width = Math.ceil(Math.max(...lines.map(l => g.measureText(l).width)) + px * .4); c.height = Math.ceil(px * 1.2 * lines.length + px * .2);
    g.font = `${o.weight ?? 900} ${px}px Inter`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (o.bg) { g.fillStyle = o.bg; g.beginPath(); g.roundRect(0, 0, c.width, c.height, px * .18); g.fill(); }
    g.fillStyle = o.color ?? '#fff'; lines.forEach((l, i) => g.fillText(l, c.width / 2, px * .7 + i * px * 1.2));
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    return { tx, aspect: c.width / c.height };
}
/** A flat decal (image or text) on an object's front face. `at` is the centre in object units, `w` its width. */
async function decal(parent: THREE.Object3D, d: any, z: number) {
    let map: THREE.Texture, aspect: number;
    if (d.text != null) ({ tx: map, aspect } = textTex(d.text, d));
    else { map = await tex(d.img); aspect = (map.image as HTMLImageElement).width / (map.image as HTMLImageElement).height; }
    // Screens and screenshots are shown as-is (unlit, no tone mapping) so real UI colours stay true; logos and prints take the light.
    const w = d.w ?? 1, m = d.glow ? new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 })
        : new THREE.MeshStandardMaterial({ map, transparent: true, roughness: d.rough ?? .5, metalness: 0, color: d.tint ?? '#ffffff', polygonOffset: true, polygonOffsetFactor: -2 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / aspect), m); p.position.set(d.at?.[0] ?? 0, d.at?.[1] ?? 0, z + .002); parent.add(p);
}
const mat = (o: any) => new THREE.MeshPhysicalMaterial({ color: o.color ?? '#1b1b20', roughness: o.rough ?? .35, metalness: o.metal ?? 0, clearcoat: o.coat ?? .4, clearcoatRoughness: .25,
    emissive: o.emissive ?? '#000000', emissiveIntensity: o.emissiveIntensity ?? 1, transmission: o.glass ? 1 : 0, thickness: o.glass ? .4 : 0, ior: 1.4, transparent: !!o.opacity, opacity: o.opacity ?? 1 });

/** Objects with an `id` are remembered so links can attach to their edges instead of a hand-placed point. */
const placed = new Map<string, { pos: THREE.Vector3; half: THREE.Vector3 }>();
const SIZES: Record<string, V3> = { tile: [1, 1, .22], card: [2.4, 1.5, .06], phone: [1.6, 3.3, .16], slab: [2, 3, .5] };
function anchor(ref: any, toward: THREE.Vector3) {
    if (Array.isArray(ref)) return new THREE.Vector3(...ref as V3);
    const p = placed.get(ref); if (!p) throw Error('Unknown link target ' + ref);
    const d = toward.clone().sub(p.pos), t = Math.min(p.half.x / Math.abs(d.x || 1e-6), p.half.y / Math.abs(d.y || 1e-6));
    const edge = p.pos.clone().add(d.clone().multiplyScalar(Math.min(t, 1)));
    return edge.add(d.normalize().multiplyScalar(.12)); // a small gap so the dot sits just off the edge
}
/** A connector in Devin's diagram style: a soft curve with round dots at both ends.
 * state: done (solid accent with a glow), pending (grey dashes), broken (red dashes with a gap and an X badge). */
function link(o: any) {
    const ca = Array.isArray(o.from) ? new THREE.Vector3(...o.from as V3) : placed.get(o.from)!.pos, cb = Array.isArray(o.to) ? new THREE.Vector3(...o.to as V3) : placed.get(o.to)!.pos;
    const a = anchor(o.from, cb), b = anchor(o.to, ca), dir = b.clone().sub(a);
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    const ctrl = a.clone().lerp(b, .5).add(perp.multiplyScalar((o.bend ?? .25) * dir.length())).add(new THREE.Vector3(0, 0, .35));
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b), state = o.state ?? (o.broken ? 'broken' : 'done');
    const color = o.color ?? (state === 'broken' ? '#E8231F' : state === 'pending' ? '#7a7a86' : S.accent ?? '#2780FF'), r = o.r ?? .026;
    const piece = (t0: number, t1: number, rad: number, m: THREE.Material) => {
        const pts = Array.from({ length: 12 }, (_, i) => curve.getPoint(t0 + (t1 - t0) * i / 11));
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rad, 10), m));
    };
    const core = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const glow = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false });
    const gap = state === 'broken' ? [.42, .58] : null, dashed = state !== 'done';
    const len = curve.getLength(), n = dashed ? Math.max(6, Math.round(len / .14)) : 1;
    for (let i = 0; i < n; i++) {
        if (dashed && i % 2) continue;
        const t0 = i / n, t1 = dashed ? (i + 1) / n : 1;
        if (gap && t1 > gap[0] && t0 < gap[1]) continue;
        piece(t0, t1, r, core); if (state === 'done') piece(t0, t1, r * 3.2, glow);
    }
    for (const p of [a, b]) { const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 2.6, 16, 12), core); dot.position.copy(p); scene.add(dot); }
    if (gap) { // a red badge with a white X where the conversation breaks
        const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
        g.fillStyle = '#E8231F'; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 30; g.lineCap = 'round'; g.beginPath(); g.moveTo(84, 84); g.lineTo(172, 172); g.moveTo(172, 84); g.lineTo(84, 172); g.stroke();
        const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
        const x = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), new THREE.MeshBasicMaterial({ map: tx, transparent: true, toneMapped: false }));
        x.position.copy(curve.getPoint(.5)); x.lookAt(cam.position); scene.add(x);
    }
}

async function build(o: any): Promise<THREE.Object3D> {
    const g = new THREE.Group();
    if (['slab', 'tile', 'card', 'phone'].includes(o.kind)) {
        const preset: Record<string, any> = { tile: { size: [1, 1, .22], radius: .2, color: '#ffffff', rough: .25 }, card: { size: [2.4, 1.5, .06], radius: .06, color: '#ffffff', rough: .4 },
            phone: { size: [1.6, 3.3, .16], radius: .2, color: '#0c0c0f', rough: .2, metal: .6 }, slab: { size: [2, 3, .5], radius: .1 } };
        const p = { ...preset[o.kind], ...o }, [w, h, d] = p.size as V3;
        const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 6, Math.min(p.radius, d / 2 - .001)), mat(p)); body.castShadow = body.receiveShadow = true; g.add(body);
        if (o.kind === 'phone' && o.screen) await decal(g, { img: o.screen, w: w * .9, glow: .9, rough: .15 }, d / 2);
        if (o.kind === 'tile' && o.img) await decal(g, { img: o.img, w: w * (o.fill ?? .62) }, d / 2);
        if (o.kind === 'card' && o.img) await decal(g, { img: o.img, w: w - .1, glow: o.glow ?? .15 }, d / 2);
        for (const f of o.face ?? []) await decal(g, f, d / 2);
    }
    if (o.kind === 'text') { const { tx, aspect } = textTex(o.text, o); const h = o.h ?? .6;
        g.add(new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), new THREE.MeshBasicMaterial({ map: tx, transparent: true, toneMapped: false }))); }
    if (o.kind === 'ring') { const t = new THREE.Mesh(new THREE.TorusGeometry(o.r ?? 2, o.tube ?? .012, 12, 200), new THREE.MeshBasicMaterial({ color: o.color ?? '#2780FF', toneMapped: false, transparent: true, opacity: o.opacity ?? .8 })); g.add(t); }
    if (o.lit) { // the step that is happening now: accent glow on the body plus its own light
        g.traverse((m: any) => { if (m.isMesh && m.material.emissive && !m.material.map) { m.material.emissive = new THREE.Color(S.accent ?? '#2780FF'); m.material.emissiveIntensity = o.lit === true ? .35 : o.lit; } });
        const l = new THREE.PointLight(S.accent ?? '#2780FF', 12, 4); l.position.set(0, 0, 1.2); g.add(l);
    }
    if (o.dim) g.traverse((m: any) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = o.dim === true ? .22 : o.dim; m.castShadow = false; } });
    if (o.kind === 'light') { const l = new THREE.PointLight(o.color ?? '#2780FF', o.power ?? 30, o.distance ?? 8); g.add(l); }
    g.position.set(...(o.pos ?? [0, 0, 0]) as V3); g.rotation.copy(rad(o.rot)); g.scale.setScalar(o.scale ?? 1);
    if (o.id) { const sz = (o.size ?? SIZES[o.kind] ?? [.6, .3, 0]) as V3; placed.set(o.id, { pos: g.position.clone(), half: new THREE.Vector3(sz[0] / 2 * (o.scale ?? 1), sz[1] / 2 * (o.scale ?? 1), 0) }); }
    if (o.billboard) g.lookAt(cam.position);
    return g;
}

await document.fonts.ready;
for (const o of S.objects) if (o.kind !== 'link') scene.add(await build(o));
for (const o of S.objects) if (o.kind === 'link') link(o);
renderer.render(scene, cam);
document.title = 'ready';
