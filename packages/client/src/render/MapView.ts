import * as THREE from 'three';
import { GHOST_BORDER, hashPos, type Layout, type MapDef } from '@psst/shared';
import { addOutline, glowTexture, toon } from './toon';

/** Floor texture resolution (pixels per meter). */
const FLOOR_PX = 32;
const FADE_OPACITY = 0.28;

interface Theme {
  /** Prop set: kitchen (cereal boxes, mugs, egg timer) or terrarium (stumps, pebbles, crystal, glass walls). */
  style: 'kitchen' | 'terrarium';
  bg: number;
  sky: number;
  outOfBounds: number;
  floorA: string;
  floorB: string;
  grout: string;
  wall: number;
  wallTop: number;
  wallHeight: number;
  glassWalls: boolean;
  boxes: number[];
  round: number[];
  leg: number;
  cube: number;
  puddle: string;
  puddleHi: string;
  puddleEdge: string;
  crumbs: number[];
  rugA: string;
  rugB: string;
  /** Terrarium backdrop blades. */
  grass: [number, number];
}

const THEMES: Record<MapDef['theme'], Theme> = {
  kitchen: {
    style: 'kitchen',
    bg: 0x2a1d2e, sky: 0x4a3a44, outOfBounds: 0x6b4a33, floorA: '#f6ead2', floorB: '#e6d3ad', grout: '#cdb98f',
    wall: 0x8a5a3b, wallTop: 0xb07a52, wallHeight: 1.8, glassWalls: false,
    boxes: [0xff5a5f, 0xffc93c, 0x3fa7ff, 0x7ed957, 0xff8f3c, 0xb06bff],
    round: [0xff6fb5, 0x55c8ff, 0xffd23f, 0x2fd4c4, 0xf2f2f2],
    leg: 0xa0693f, cube: 0xfdfdfd,
    puddle: '#9fd8ff', puddleHi: '#ffffff', puddleEdge: '#4f9fe0',
    crumbs: [0xb7793d, 0x8c5a2b, 0xd9a35e],
    rugA: '#e84a5f', rugB: '#fff3e0', grass: [0x4caf50, 0x7ed957],
  },
  terrarium: {
    style: 'terrarium',
    bg: 0x16302a, sky: 0xaee3f2, outOfBounds: 0x2b5d3c, floorA: '#ead59b', floorB: '#dcc383', grout: '#c9ae6c',
    wall: 0x5fb8d0, wallTop: 0xd6f6ff, wallHeight: 1.3, glassWalls: true,
    boxes: [0x9b6a3c, 0x7d5230, 0xb88350],
    round: [0x9ea3ad, 0x8a8f99, 0xb4b8c0],
    leg: 0x8a8f99, cube: 0xd8d8d8,
    puddle: '#5fb8ff', puddleHi: '#bfe6ff', puddleEdge: '#2f74c0',
    crumbs: [0xd9822b, 0xb85c1e, 0xe8b04a],
    rugA: '#4caf50', rugB: '#7ed957', grass: [0x4caf50, 0x7ed957],
  },
  playroom: {
    style: 'kitchen',
    bg: 0x1d2440, sky: 0x9fc4ff, outOfBounds: 0x3a4f8a, floorA: '#e9c79a', floorB: '#d9b17c', grout: '#b98d5a',
    wall: 0x4d8dff, wallTop: 0xffd23f, wallHeight: 1.8, glassWalls: false,
    boxes: [0xff4d5e, 0xffd23f, 0x4d8dff, 0x59ff99, 0xff6fb5, 0xff8f3c],
    round: [0xffd23f, 0xff6fb5, 0x55c8ff, 0x7ed957],
    leg: 0xffffff, cube: 0xff4d5e,
    puddle: '#ffb347', puddleHi: '#fff1c9', puddleEdge: '#e07b1a',
    crumbs: [0xff4d5e, 0x4d8dff, 0xffd23f, 0x59ff99],
    rugA: '#4d8dff', rugB: '#bfe0ff', grass: [0x4caf50, 0x7ed957],
  },
  snowglobe: {
    style: 'terrarium',
    bg: 0x101a33, sky: 0xd8ecff, outOfBounds: 0x2a3d66, floorA: '#f4f8ff', floorB: '#e1ebf7', grout: '#c6d4e8',
    wall: 0xbfe6ff, wallTop: 0xffffff, wallHeight: 1.3, glassWalls: true,
    boxes: [0x7a4b2a, 0x8f5d35, 0x6a3f22],
    round: [0xffffff, 0xeef6ff, 0xdbe9ff],
    leg: 0xbfe6ff, cube: 0xd6f0ff,
    puddle: '#a8dcff', puddleHi: '#ffffff', puddleEdge: '#5aa7e0',
    crumbs: [0x2f7d4f, 0x3f9a5f, 0x6b4a2b],
    rugA: '#7ed957', rugB: '#a9e58c', grass: [0x1f6b45, 0x2f8f5a],
  },
};

interface Rect { x: number; y: number; w: number; h: number }

/** Greedy merge of same-char tiles into rectangles. */
function rects(layout: Layout, ch: string): Rect[] {
  const { width, height, tiles } = layout.map;
  const used = new Uint8Array(width * height);
  const out: Rect[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (used[i] || tiles[i] !== ch) continue;
      let w = 1;
      while (x + w < width && tiles[i + w] === ch && !used[i + w]) w++;
      let h = 1;
      outer: while (y + h < height) {
        for (let k = 0; k < w; k++) {
          const j = (y + h) * width + x + k;
          if (tiles[j] !== ch || used[j]) break outer;
        }
        h++;
      }
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[(y + dy) * width + x + dx] = 1;
      out.push({ x, y, w, h });
    }
  }
  return out;
}

/** Splits long rectangles into ≤ `max` m pieces so rows of boxes read as separate objects. */
function split(r: Rect, max: number): Rect[] {
  const out: Rect[] = [];
  if (r.w >= r.h) {
    const n = Math.ceil(r.w / max);
    let x = r.x;
    for (let i = 0; i < n; i++) {
      const w = Math.round((r.w - (x - r.x)) / (n - i));
      out.push({ x, y: r.y, w, h: r.h });
      x += w;
    }
  } else {
    const n = Math.ceil(r.h / max);
    let y = r.y;
    for (let i = 0; i < n; i++) {
      const h = Math.round((r.h - (y - r.y)) / (n - i));
      out.push({ x: r.x, y, w: r.w, h });
      y += h;
    }
  }
  return out;
}

interface Fade {
  mats: THREE.Material[];
  outlines: THREE.Object3D[];
  opacity: number;
  hit: boolean;
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const labelCache = new Map<number, THREE.CanvasTexture>();

/** Cereal-box front: color, white badge, star and a stripe. */
function cerealTexture(color: number): THREE.CanvasTexture {
  const hit = labelCache.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = css(color);
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 96, 128, 14);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 54, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(color);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 10 : 24;
    g.lineTo(64 + Math.cos(a) * r, 54 + Math.sin(a) * r);
  }
  g.fill();
  g.strokeStyle = '#1a1a2e';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(color, t);
  return t;
}

/** Wooden kitchen cabinets: two doors with knobs per 6 m tile, plinth and countertop band. */
function cabinetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b07a52';
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 470, 256, 42);
  g.fillStyle = '#e9e1d4';
  g.fillRect(0, 0, 256, 34);
  g.strokeStyle = '#1a1a2e';
  g.lineWidth = 6;
  for (const x of [10, 133]) {
    g.fillStyle = '#c98a5b';
    g.fillRect(x, 60, 113, 390);
    g.strokeRect(x, 60, 113, 390);
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.arc(x === 10 ? 108 : 148, 255, 9, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9a86a';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#8c5a2b';
  g.lineWidth = 4;
  for (let r = 12; r < 64; r += 13) {
    g.beginPath();
    g.arc(64, 64, r, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function slatsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c98a4b';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#9a6233';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 3);
  g.fillRect(0, 0, 5, 64);
  g.fillRect(59, 0, 5, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MapView {
  readonly group = new THREE.Group();
  /** Meshes that may stand between the camera and the local player (raycast targets). */
  readonly occluders: THREE.Object3D[] = [];
  background = new THREE.Color(0x000000);
  /** Giant surroundings, only shown in the mouse-look views (they would block the overhead cameras). */
  private backdrop = new THREE.Group();
  private skyColor = new THREE.Color(0x000000);
  private overheadColor = new THREE.Color(0x000000);
  private fades = new Map<THREE.Object3D, Fade>();
  private beacon: THREE.Group | null = null;
  private beaconGlow: THREE.Sprite | null = null;
  private beaconPulse = 0;
  private sparkles: THREE.InstancedMesh | null = null;
  private disposables: { dispose(): void }[] = [];
  private t = 0;

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.group.clear();
    this.backdrop = new THREE.Group();
    this.occluders.length = 0;
    this.fades.clear();
    this.beacon = null;
    this.beaconGlow = null;
    this.sparkles = null;
  }

  build(layout: Layout) {
    this.dispose();
    const map = layout.map;
    const th = THEMES[map.def.theme];
    const kitchen = th.style === 'kitchen';
    this.overheadColor.setHex(th.bg);
    this.skyColor.setHex(th.sky);
    this.background.setHex(th.bg);
    this.buildBackdrop(layout, th);

    this.buildFloor(layout, th);

    // Perimeter.
    for (const r of rects(layout, '#')) {
      for (const p of split(r, 8)) {
        if (th.glassWalls) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, th.wallHeight, p.h), toon(th.wall, { transparent: true, opacity: 0.22 }));
          (m.material as THREE.Material).depthWrite = false;
          m.position.set(p.x + p.w / 2, th.wallHeight / 2, p.y + p.h / 2);
          const rim = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.12, p.h), toon(th.wallTop));
          rim.position.y = th.wallHeight / 2;
          m.add(rim);
          this.track(m);
          this.group.add(m);
        } else {
          this.solidBox(p, th.wallHeight, th.wall, { top: th.wallTop });
        }
      }
    }

    // Boxes (kitchen cereal boxes) / wooden blocks and stumps (terrarium).
    for (const r of rects(layout, 'X')) {
      for (const p of split(r, 3)) {
        const hsh = hashPos(p.x, p.y);
        const col = th.boxes[hsh % th.boxes.length];
        if (kitchen) {
          const h = 1.9 + (hsh % 5) * 0.22;
          this.solidBox(p, h, col, { map: cerealTexture(col) });
        } else if (p.w === p.h) {
          const h = 1.1 + (hsh % 3) * 0.2;
          const geo = new THREE.CylinderGeometry(p.w * 0.48, p.w * 0.5, h, 18);
          const top = toon(0xffffff, { map: ringsTexture() });
          this.solid(geo, [toon(col), top, toon(col)], p.x + p.w / 2, h / 2, p.y + p.h / 2);
        } else {
          this.solidBox(p, 1.2, col);
        }
      }
    }

    // Mugs (kitchen) / pebbles (terrarium).
    for (const r of rects(layout, 'O')) {
      const col = th.round[hashPos(r.x, r.y) % th.round.length];
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = (Math.min(r.w, r.h) / 2) * 0.95;
      if (kitchen) {
        const h = 1.5;
        const geo = new THREE.CylinderGeometry(rad, rad * 0.92, h, 24);
        const root = this.solid(geo, [toon(col), toon(0x6b3a1e), toon(col)], cx, h / 2, cy);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 8, 16, Math.PI), toon(col));
        const side = hashPos(r.y, r.x) % 2 ? 1 : -1;
        handle.rotation.z = -Math.PI / 2 * side;
        handle.position.set(rad * side, 0.05, 0);
        addOutline(handle, 0.03);
        root.add(handle);
        this.fades.get(root)!.mats.push(handle.material as THREE.Material);
      } else {
        const geo = new THREE.IcosahedronGeometry(rad, 1);
        geo.scale(1, 0.62, 1);
        // Non-indexed polyhedron: recomputed normals are per face (faceted pebble).
        geo.computeVertexNormals();
        this.solid(geo, toon(col), cx, rad * 0.5, cy);
      }
    }

    // Table legs (2×2) and sugar cubes (1×1).
    for (const r of rects(layout, 'L')) {
      if (r.w > 1 || r.h > 1) {
        const h = 3.2;
        const rad = Math.min(r.w, r.h) / 2;
        this.solid(new THREE.CylinderGeometry(rad * 0.85, rad, h, 16), toon(th.leg), r.x + r.w / 2, h / 2, r.y + r.h / 2);
      } else {
        this.solidBox({ x: r.x + 0.08, y: r.y + 0.08, w: 0.84, h: 0.84 }, 0.84, th.cube);
      }
    }

    this.buildBeacon(layout, kitchen);

    // Seeded crates.
    const slats = slatsTexture();
    for (const c of layout.crates) {
      const root = this.solidBox({ x: c.x + 0.05, y: c.y + 0.05, w: 0.9, h: 0.9 }, 0.8, 0xffffff, { map: slats });
      const fade = this.fades.get(root)!;
      for (let i = 0; i < 3; i++) {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.32, 8), toon(0x4fc36b, { emissive: 0x0c3318 }));
        neck.position.set(-0.22 + i * 0.22, 0.48, (i % 2 ? 0.12 : -0.1));
        neck.rotation.z = (i - 1) * 0.25;
        addOutline(neck, 0.02);
        root.add(neck);
        fade.mats.push(neck.material as THREE.Material);
      }
    }

    // Seeded variable covers.
    for (const c of layout.covers) this.buildCover(c.x + 0.5, c.y + 0.5, c.kind, kitchen, th);

    // Ghost border: faint markers at the invisible wall.
    const W = map.width, H = map.height;
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W - 2 + 2 * GHOST_BORDER, 0.02, H - 2 + 2 * GHOST_BORDER)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }),
    );
    border.position.set(W / 2, 0.01, H / 2);
    this.track(border);
    this.group.add(border);
  }

  private track(o: THREE.Object3D) {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.geometry) this.disposables.push(m.geometry);
      if (m.material) for (const mat of ([] as THREE.Material[]).concat(m.material)) this.disposables.push(mat);
    });
  }

  /** Adds a solid object: shadowed, outlined, fadeable and an occluder. */
  private solid(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, h: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, h, z);
    m.castShadow = true;
    m.receiveShadow = true;
    const hull = addOutline(m, 0.05);
    this.group.add(m);
    this.occluders.push(m);
    this.fades.set(m, { mats: ([] as THREE.Material[]).concat(mat), outlines: [hull], opacity: 1, hit: false });
    this.track(m);
    return m;
  }

  private solidBox(r: Rect, h: number, color: number, opts: { map?: THREE.Texture; top?: number } = {}): THREE.Mesh {
    const side = toon(opts.map ? 0xffffff : color, { map: opts.map });
    const top = opts.top !== undefined ? toon(opts.top) : opts.map ? toon(color) : side;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    const mats = [side, side, top, side, side, side];
    return this.solid(new THREE.BoxGeometry(r.w, h, r.h), mats, r.x + r.w / 2, h / 2, r.y + r.h / 2);
  }

  private buildFloor(layout: Layout, th: Theme) {
    const map = layout.map;
    const W = map.width, H = map.height;
    const c = document.createElement('canvas');
    c.width = W * FLOOR_PX;
    c.height = H * FLOOR_PX;
    const g = c.getContext('2d')!;
    const P = FLOOR_PX;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      g.fillStyle = ((x >> 1) + (y >> 1)) % 2 ? th.floorA : th.floorB;
      g.fillRect(x * P, y * P, P, P);
    }
    g.strokeStyle = th.grout;
    g.globalAlpha = 0.6;
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 2) { g.beginPath(); g.moveTo(x * P, 0); g.lineTo(x * P, H * P); g.stroke(); }
    for (let y = 0; y <= H; y += 2) { g.beginPath(); g.moveTo(0, y * P); g.lineTo(W * P, y * P); g.stroke(); }
    g.globalAlpha = 1;
    const sparkleSpots: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = map.tiles[y * W + x];
      if (ch === '~') {
        g.fillStyle = th.puddleEdge;
        g.beginPath();
        g.arc((x + 0.5) * P, (y + 0.5) * P, P * 0.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = map.tiles[y * W + x];
      if (ch === '~') {
        g.fillStyle = th.puddle;
        g.beginPath();
        g.arc((x + 0.5) * P, (y + 0.5) * P, P * 0.72, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x * P + 3, y * P + 3, P - 6, P - 6);
        if (hashPos(x, y) % 3 === 0) sparkleSpots.push({ x: x + 0.35, y: y + 0.35 });
      } else if (ch === '=') {
        g.fillStyle = th.rugB;
        g.fillRect(x * P, y * P, P, P);
        g.fillStyle = th.rugA;
        g.fillRect(x * P, y * P + P * 0.15, P, P * 0.25);
        g.fillRect(x * P, y * P + P * 0.6, P, P * 0.25);
      } else if (ch === ':') {
        g.fillStyle = 'rgba(120,70,30,0.18)';
        g.fillRect(x * P, y * P, P, P);
      }
    }
    // Ink line along the inside of the perimeter.
    g.strokeStyle = '#1a1a2e';
    g.lineWidth = 3;
    g.strokeRect(P, P, (W - 2) * P, (H - 2) * P);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), toon(0xffffff, { map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    this.track(floor);
    this.disposables.push(tex);
    this.group.add(floor);

    const outer = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * GHOST_BORDER + 60, H + 2 * GHOST_BORDER + 60), toon(th.outOfBounds));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(W / 2, -0.02, H / 2);
    outer.receiveShadow = true;
    this.track(outer);
    this.group.add(outer);

    // Crumbs (kitchen) / dry leaves (terrarium): little 3D bits on noisy tiles.
    const crumbTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.tiles[y * W + x] === ':') crumbTiles.push({ x, y });
    if (crumbTiles.length) {
      const per = 6;
      const leaf = th.style === 'terrarium';
      const geo = leaf ? new THREE.CircleGeometry(0.11, 5) : new THREE.DodecahedronGeometry(0.06);
      const mat = toon(0xffffff);
      if (leaf) mat.side = THREE.DoubleSide;
      const inst = new THREE.InstancedMesh(geo, mat, crumbTiles.length * per);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), col = new THREE.Color();
      let i = 0;
      for (const t of crumbTiles) {
        const hsh = hashPos(t.x, t.y);
        for (let k = 0; k < per; k++) {
          const r1 = ((hsh >>> (k * 4)) & 15) / 15, r2 = ((hsh >>> (k * 3 + 7)) & 15) / 15;
          p.set(t.x + 0.1 + r1 * 0.8, leaf ? 0.012 : 0.04, t.y + 0.1 + r2 * 0.8);
          e.set(leaf ? -Math.PI / 2 : r1 * 3, r2 * 6, 0);
          q.setFromEuler(e);
          const sc = 0.7 + r1 * 0.7;
          s.set(sc, sc, sc);
          m4.compose(p, q, s);
          inst.setMatrixAt(i, m4);
          inst.setColorAt(i, col.setHex(th.crumbs[(k + hsh) % th.crumbs.length]));
          i++;
        }
      }
      inst.receiveShadow = true;
      this.track(inst);
      this.group.add(inst);
    }

    // Puddle glints that shimmer.
    if (sparkleSpots.length) {
      const geo = new THREE.CircleGeometry(0.16, 12);
      geo.scale(1, 0.45, 1);
      const mat = new THREE.MeshBasicMaterial({ color: th.puddleHi, transparent: true, opacity: 0.9 });
      const inst = new THREE.InstancedMesh(geo, mat, sparkleSpots.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      sparkleSpots.forEach((sp, i) => {
        m4.compose(new THREE.Vector3(sp.x, 0.01, sp.y), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(i, m4);
      });
      this.sparkles = inst;
      this.track(inst);
      this.group.add(inst);
    }
  }

  private buildBeacon(layout: Layout, kitchen: boolean) {
    const b = layout.map.beacon;
    const root = new THREE.Group();
    root.position.set(b.x, 0, b.y);
    if (kitchen) {
      // Egg timer.
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1, 0.7, 24), toon(0xf2f2f2));
      base.position.y = 0.35;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff5a5f));
      dome.position.y = 0.7;
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12), toon(0xffd23f));
      knob.position.y = 1.65;
      for (const m of [base, dome, knob]) { m.castShadow = true; addOutline(m, 0.05); root.add(m); }
      for (let i = 0; i < 12; i++) {
        const tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), toon(0x1a1a2e));
        const a = (i / 12) * Math.PI * 2;
        tick.position.set(Math.cos(a) * 0.93, 0.5, Math.sin(a) * 0.93);
        tick.rotation.y = -a;
        root.add(tick);
      }
    } else {
      // Glowing crystal on a rock.
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95), toon(0x8a8f99));
      rock.geometry.scale(1, 0.5, 1);
      rock.position.y = 0.4;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), toon(0x7af6ff, { emissive: 0x1f7f8f }));
      crystal.geometry.scale(0.8, 1.6, 0.8);
      crystal.position.y = 1.5;
      for (const m of [rock, crystal]) { m.castShadow = true; addOutline(m, 0.05); root.add(m); }
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x59ff99, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(5, 5, 1);
    glow.position.y = 1.4;
    root.add(glow);
    this.beaconGlow = glow;
    this.beacon = root;
    this.track(root);
    this.group.add(root);
  }

  private buildCover(x: number, z: number, kind: 'cube' | 'bowl' | 'spool', kitchen: boolean, th: Theme) {
    const hsh = hashPos(x, z);
    if (kind === 'cube') {
      this.solidBox({ x: x - 0.42, y: z - 0.42, w: 0.84, h: 0.84 }, kitchen ? 0.84 : 0.7, kitchen ? th.cube : th.round[hsh % th.round.length]);
    } else if (kind === 'bowl') {
      const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.3, 0.02), new THREE.Vector2(0.46, 0.2), new THREE.Vector2(0.5, 0.5), new THREE.Vector2(0.44, 0.5), new THREE.Vector2(0.4, 0.24), new THREE.Vector2(0.001, 0.12)];
      const col = kitchen ? th.round[hsh % th.round.length] : 0x9b6a3c;
      const mat = toon(col);
      mat.side = THREE.DoubleSide;
      this.solid(new THREE.LatheGeometry(pts, 20), mat, x, 0, z);
    } else if (kitchen) {
      // Thread spool.
      const thread = th.boxes[hsh % th.boxes.length];
      const root = this.solid(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 16), toon(thread), x, 0.45, z);
      const fade = this.fades.get(root)!;
      for (const y of [-0.38, 0.38]) {
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.09, 18), toon(0xd9b38c));
        fl.position.y = y;
        addOutline(fl, 0.03);
        root.add(fl);
        fade.mats.push(fl.material as THREE.Material);
      }
    } else {
      // Mushroom.
      const root = this.solid(new THREE.CylinderGeometry(0.16, 0.2, 0.6, 12), toon(0xfff3e0), x, 0.3, z);
      const fade = this.fades.get(root)!;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff5a5f));
      cap.position.y = 0.25;
      addOutline(cap, 0.03);
      root.add(cap);
      fade.mats.push(cap.material as THREE.Material);
      for (let i = 0; i < 5; i++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(0xffffff));
        const a = i * 1.3;
        dot.position.set(Math.cos(a) * 0.28, 0.25 + 0.34, Math.sin(a) * 0.28);
        root.add(dot);
        fade.mats.push(dot.material as THREE.Material);
      }
    }
  }

  /** Mouse-look views see the surroundings and a sky; overhead views keep the plain background. */
  setBackdrop(visible: boolean) {
    this.backdrop.visible = visible;
    this.background.copy(visible ? this.skyColor : this.overheadColor);
  }

  private buildBackdrop(layout: Layout, th: Theme) {
    const kitchen = th.style === 'kitchen';
    const W = layout.map.width, H = layout.map.height;
    const pad = GHOST_BORDER + 6;
    const height = kitchen ? 26 : 18;
    const tex = kitchen ? cabinetTexture() : null;
    const sides: [number, number, number, number][] = [
      [W / 2, -pad, W + 2 * pad, 0], [W / 2, H + pad, W + 2 * pad, Math.PI],
      [-pad, H / 2, H + 2 * pad, Math.PI / 2], [W + pad, H / 2, H + 2 * pad, -Math.PI / 2],
    ];
    for (const [x, z, len, rot] of sides) {
      let mat: THREE.Material;
      if (tex) {
        const t = tex.clone();
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.set(len / 6, 1);
        t.needsUpdate = true;
        this.disposables.push(t);
        mat = toon(0xffffff, { map: t });
      } else {
        mat = toon(0x8fd9e8, { transparent: true, opacity: 0.18 });
        mat.depthWrite = false;
      }
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, height), mat);
      wall.position.set(x, height / 2 - 0.05, z);
      wall.rotation.y = rot;
      this.backdrop.add(wall);
    }
    if (!kitchen) {
      // Tall grass blades leaning over the glass.
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = Math.max(W, H) / 2 + pad + 4 + (hashPos(i, 3) % 7);
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.8, 9 + (hashPos(i, 9) % 8), 4), toon(th.grass[i % 2]));
        blade.position.set(W / 2 + Math.cos(a) * r, 5, H / 2 + Math.sin(a) * r);
        blade.rotation.z = Math.sin(a * 3) * 0.2;
        this.backdrop.add(blade);
      }
    }
    this.backdrop.visible = false;
    this.track(this.backdrop);
    this.group.add(this.backdrop);
  }

  pulseBeacon() {
    this.beaconPulse = 1;
  }

  /** Objects (from `occluders`) currently between the camera and the player. */
  setOccluding(hit: Set<THREE.Object3D>) {
    for (const [obj, f] of this.fades) f.hit = hit.has(obj);
  }

  update(dt: number) {
    this.t += dt;
    if (this.beacon) {
      this.beaconPulse = Math.max(0, this.beaconPulse - dt * 1.6);
      const k = this.beaconPulse;
      this.beacon.scale.setScalar(1 + 0.22 * k * k);
      if (this.beaconGlow) (this.beaconGlow.material as THREE.SpriteMaterial).opacity = 0.15 + 0.85 * k;
    }
    if (this.sparkles) (this.sparkles.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.sin(this.t * 3);
    const k = 1 - Math.exp(-dt * 10);
    for (const f of this.fades.values()) {
      const target = f.hit ? FADE_OPACITY : 1;
      if (Math.abs(f.opacity - target) < 0.005) {
        if (f.opacity === target) continue;
        f.opacity = target;
      } else {
        f.opacity += (target - f.opacity) * k;
      }
      const solid = f.opacity > 0.985;
      for (const m of f.mats) {
        m.opacity = solid ? 1 : f.opacity;
        m.transparent = !solid;
        m.depthWrite = solid;
      }
      for (const o of f.outlines) o.visible = solid;
    }
  }
}

