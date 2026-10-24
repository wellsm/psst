import * as THREE from 'three';

/** Dark ink used for every outline. */
export const OUTLINE = 0x1a1a2e;
export const SONAR = 0x59ff99;
export const SONAR_RIM = 0x0b5e3a;

let gradient: THREE.DataTexture | null = null;

/** 3-step ramp: cartoon shading with hard light bands. */
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = [110, 185, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: number, opts: { map?: THREE.Texture; transparent?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    map: opts.map ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
  });
}

const sharedOutline = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });

export function outlineMaterial(): THREE.MeshBasicMaterial {
  return sharedOutline;
}

/**
 * Inverted-hull outline: a back-face copy of the mesh, grown by `thickness` meters on each axis
 * (computed from the geometry bounds, so it works for convex centered primitives).
 */
export function addOutline(mesh: THREE.Mesh, thickness = 0.035, material: THREE.Material = sharedOutline): THREE.Mesh {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  const center = new THREE.Vector3();
  g.boundingBox!.getCenter(center);
  const hull = new THREE.Mesh(g, material);
  const k = (s: number) => (s > 1e-4 ? 1 + (2 * thickness) / s : 1);
  hull.scale.set(k(size.x), k(size.y), k(size.z));
  // Keep the hull centered on the geometry when it is not centered at the origin.
  hull.position.copy(center).sub(center.clone().multiply(hull.scale));
  hull.userData.outline = true;
  hull.castShadow = false;
  hull.receiveShadow = false;
  mesh.add(hull);
  return hull;
}

/** Mesh + outline in one call. */
export function inked(geometry: THREE.BufferGeometry, material: THREE.Material, thickness = 0.035): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  addOutline(m, thickness);
  return m;
}

/** Shapes reused by several views. */
export function starShape(outer = 0.5, inner = 0.22, points = 5): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** Soft radial gradient for glows. */
let glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Frees GPU resources of a subtree, except geometries in `keep` (shared ones). */
export function disposeTree(root: THREE.Object3D, keep: ReadonlySet<THREE.BufferGeometry> = new Set()) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    if (m.material) for (const mat of ([] as THREE.Material[]).concat(m.material)) mat.dispose();
  });
}
