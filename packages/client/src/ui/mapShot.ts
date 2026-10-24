import * as THREE from 'three';
import { TRAP_KINDS, areaScale, buildLayout, layoutTraps, trapCount, type Layout, type MatchSettings, type SnapTrap, type TrapKind } from '@psst/shared';
import { MapView } from '../render/MapView';
import { TrapsView } from '../render/Traps';
import { h } from './dom';

/** Lobby map preview: a still 3D render of the real match scene (seed-0 layout and traps, at the match's map side). */
export const SHOT_W = 640;
export const SHOT_H = 400;
const SHOT_AZIMUTH = Math.PI / 4;
const SHOT_ELEVATION = (36 * Math.PI) / 180;
const SHOT_PADDING = 1.0;
const CACHE_MAX = 12;
/** Renders wait for the settings to settle (a slider drag changes trap counts every frame). */
const RENDER_DELAY_MS = 120;

export interface MapFacts {
  width: number;
  height: number;
  crates: number;
  /** Noisy floor (puddles, crumbs) in m². */
  noisy: number;
  traps: number;
}

const cache = new Map<string, HTMLCanvasElement>();
const lastByMap = new Map<string, HTMLCanvasElement>();
let pending: ReturnType<typeof setTimeout> | null = null;

/** Same counts the match places at start (scaled with the map area). */
function counts(s: MatchSettings, side: number): Partial<Record<TrapKind, number>> {
  const c: Partial<Record<TrapKind, number>> = {};
  for (const k of TRAP_KINDS) c[k] = Math.round(trapCount(k, s) * areaScale(side));
  return c;
}

function scene(mapId: string, s: MatchSettings, side: number): { layout: Layout; traps: SnapTrap[] } {
  const layout = buildLayout(mapId, 0, s.bottleRefillStations, side);
  const traps = layoutTraps(layout, 0, s, counts(s, side)).map((t, id) => ({ id, k: t.k, x: t.x, y: t.y, armed: true }));
  return { layout, traps };
}

function key(mapId: string, s: MatchSettings, side: number): string {
  return [mapId, side, s.bottleRefillStations, s.trapGridSize, s.trapMinSpacing, ...TRAP_KINDS.map((k) => trapCount(k, s))].join(':');
}

export function mapFacts(mapId: string, s: MatchSettings, side: number): MapFacts {
  const { layout, traps } = scene(mapId, s, side);
  const { width, height, tiles } = layout.map;
  let noisy = 0;
  for (const c of tiles) if (c === '~' || c === ':') noisy++;
  return { width, height, crates: layout.crates.length, noisy, traps: traps.length };
}

function render(mapId: string, s: MatchSettings, side: number): HTMLCanvasElement {
  const out = h('canvas', { width: SHOT_W, height: SHOT_H });
  const { layout, traps } = scene(mapId, s, side);
  const mapV = new MapView();
  const trapsV = new TrapsView();
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SHOT_W, SHOT_H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mapV.build(layout);
    mapV.setBackdrop(false);
    trapsV.update(traps, 0);
    const sc = new THREE.Scene();
    sc.background = mapV.background;
    const { width: w, height: d } = layout.map;
    const center = new THREE.Vector3(w / 2, 0, d / 2);
    sc.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a7a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(center.x - 12, 30, center.z + 8);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = Math.max(w, d) * 0.75;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 90 });
    sun.shadow.bias = -0.0008;
    sc.add(sun, sun.target, mapV.group, trapsV.group);

    // Fixed diorama view; the frustum hugs the map box seen from that angle.
    const dir = new THREE.Vector3(Math.cos(SHOT_ELEVATION) * Math.sin(SHOT_AZIMUTH), Math.sin(SHOT_ELEVATION), Math.cos(SHOT_ELEVATION) * Math.cos(SHOT_AZIMUTH));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    cam.position.copy(center).addScaledVector(dir, 150);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const cx of [0, w]) for (const cy of [0, 2]) for (const cz of [0, d]) {
      v.set(cx, cy, cz).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let hw = ((x1 - x0) / 2) * SHOT_PADDING, hh = ((y1 - y0) / 2) * SHOT_PADDING;
    if (hw / hh > SHOT_W / SHOT_H) hh = hw / (SHOT_W / SHOT_H); else hw = hh * (SHOT_W / SHOT_H);
    Object.assign(cam, { left: mx - hw, right: mx + hw, top: my + hh, bottom: my - hh });
    cam.updateProjectionMatrix();

    renderer.render(sc, cam);
    out.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
  } catch {
    // No WebGL: the slot keeps the empty (dark) canvas.
  } finally {
    trapsV.clear();
    mapV.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return out;
}

/** Slot showing the preview; renders in the background on a cache miss (the map's previous shot stays meanwhile). */
export function mapShot(mapId: string, s: MatchSettings, side: number): HTMLElement {
  const slot = h('div.map-shot');
  const k = key(mapId, s, side);
  const hit = cache.get(k) ?? lastByMap.get(mapId);
  if (hit) slot.append(hit);
  if (cache.has(k)) return slot;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const c = render(mapId, s, side);
    cache.set(k, c);
    lastByMap.set(mapId, c);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    slot.replaceChildren(c);
  }, RENDER_DELAY_MS);
  return slot;
}
