import * as THREE from 'three';
import { MAX_RINGS, ringAt, type MatchSettings } from '@psst/shared';
import { SONAR, SONAR_RIM, starShape, toon } from './toon';

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Filled disc + dark rim + bright edge. Normal blending: additive washes out on light floors.
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uAlpha;
uniform float uEdge;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  if (d > 1.0) discard;
  float aa = 0.012;
  float edge = smoothstep(1.0 - uEdge - aa, 1.0 - uEdge, d) * (1.0 - smoothstep(1.0 - aa, 1.0, d));
  float rim = smoothstep(1.0 - uEdge * 1.8 - aa, 1.0 - uEdge * 1.8, d) * (1.0 - smoothstep(1.0 - uEdge - aa, 1.0 - uEdge, d));
  vec3 col = uColor;
  float a = uAlpha * 0.18;
  col = mix(col, uRim, rim);
  a = mix(a, uAlpha * 0.8, rim);
  a = mix(a, min(1.0, uAlpha * 1.6), edge);
  col = mix(col, uColor, edge);
  gl_FragColor = vec4(col, a);
}`;

const BAND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float k = 1.0 - vUv.y;
  gl_FragColor = vec4(uColor, uAlpha * k * k * 0.9);
}`;

interface Ring {
  x: number;
  y: number;
  intensity: number;
  born: number;
  disc: THREE.Mesh;
  band: THREE.Mesh;
}

export type ParticleKind = 'dust' | 'shard' | 'star' | 'cloud' | 'splash' | 'crumb' | 'ecto' | 'flash';

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.Material & { opacity: number };
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  gravity: number;
  age: number;
  life: number;
  s0: number;
  s1: number;
  base: number;
}

const discGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);

const KINDS: Record<ParticleKind, { geo: () => THREE.BufferGeometry; color: number; opacity: number; gravity: number; emissive?: number }> = {
  dust: { geo: () => new THREE.SphereGeometry(0.13, 7, 5), color: 0xe8dcc0, opacity: 0.85, gravity: 0 },
  shard: { geo: () => new THREE.TetrahedronGeometry(0.07), color: 0x7be495, opacity: 1, gravity: -9, emissive: 0x1d5a2c },
  star: { geo: () => new THREE.ExtrudeGeometry(starShape(0.12, 0.05), { depth: 0.03, bevelEnabled: false }), color: 0xffe14d, opacity: 1, gravity: -4, emissive: 0x6b5200 },
  cloud: { geo: () => new THREE.SphereGeometry(0.3, 10, 8), color: 0xffffff, opacity: 0.9, gravity: 0 },
  splash: { geo: () => new THREE.SphereGeometry(0.05, 6, 4), color: 0x7cc8ff, opacity: 0.95, gravity: -10 },
  crumb: { geo: () => new THREE.DodecahedronGeometry(0.045), color: 0xb7793d, opacity: 1, gravity: -10 },
  ecto: { geo: () => new THREE.SphereGeometry(0.12, 8, 6), color: 0x8dffb0, opacity: 0.65, gravity: -3, emissive: 0x1f7f3f },
  flash: { geo: () => new THREE.SphereGeometry(0.3, 12, 8), color: 0xffd23f, opacity: 0.7, gravity: 0, emissive: 0x7a5a00 },
};
const geoCache = new Map<ParticleKind, THREE.BufferGeometry>();

/** Sonar rings (on the floor, piercing walls) and simple pooled particle bursts. */
export class Effects {
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private free: Ring[] = [];
  private parts: Particle[] = [];
  /**
   * Overhead views draw the floor disc through solids; mouse-look views depth-test the disc (it would
   * smear across walls) and let the vertical band pierce walls instead, so sounds behind cover still show.
   */
  private lookView = false;

  setLookView(look: boolean) {
    if (look === this.lookView) return;
    this.lookView = look;
    for (const r of [...this.rings, ...this.free]) this.applyDepth(r);
  }

  private applyDepth(r: Ring) {
    (r.disc.material as THREE.Material).depthTest = this.lookView;
    (r.band.material as THREE.Material).depthTest = !this.lookView;
  }

  private makeRing(): Ring {
    const disc = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(SONAR) }, uRim: { value: new THREE.Color(SONAR_RIM) }, uAlpha: { value: 0 }, uEdge: { value: 0.1 } },
    }));
    disc.renderOrder = 5;
    const band = new THREE.Mesh(bandGeo, new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(SONAR) }, uAlpha: { value: 0 } },
    }));
    band.renderOrder = 6;
    const r = { x: 0, y: 0, intensity: 0, born: 0, disc, band };
    this.applyDepth(r);
    return r;
  }

  ring(x: number, y: number, intensity: number, now: number) {
    const r = this.free.pop() ?? this.makeRing();
    Object.assign(r, { x, y, intensity, born: now });
    r.disc.position.set(x, 0.03, y);
    r.band.position.set(x, 0, y);
    this.group.add(r.disc, r.band);
    this.rings.push(r);
    if (this.rings.length > MAX_RINGS) this.release(this.rings.shift()!);
  }

  private release(r: Ring) {
    r.disc.removeFromParent();
    r.band.removeFromParent();
    this.free.push(r);
  }

  clear() {
    for (const r of this.rings) this.release(r);
    this.rings = [];
    for (const p of this.parts) this.killParticle(p);
    this.parts = [];
  }

  update(now: number, dt: number, s: MatchSettings) {
    this.rings = this.rings.filter((r) => {
      const st = ringAt(s, r.intensity, now - r.born);
      if (!st || st.radius <= 0.01) {
        if (!st) {
          this.release(r);
          return false;
        }
        r.disc.visible = r.band.visible = false;
        return true;
      }
      r.disc.visible = r.band.visible = true;
      r.disc.scale.setScalar(st.radius);
      const du = (r.disc.material as THREE.ShaderMaterial).uniforms;
      du.uAlpha.value = st.alpha;
      du.uEdge.value = Math.min(0.5, st.width / st.radius);
      r.band.scale.set(st.radius, 0.35 + 0.45 * r.intensity, st.radius);
      (r.band.material as THREE.ShaderMaterial).uniforms.uAlpha.value = st.alpha * (this.lookView ? 0.4 : 1);
      return true;
    });

    this.parts = this.parts.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) {
        this.killParticle(p);
        return false;
      }
      const k = p.age / p.life;
      p.vel.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.02 && p.gravity < 0) {
        p.mesh.position.y = 0.02;
        p.vel.multiplyScalar(0.4);
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      p.mesh.scale.setScalar(p.s0 + (p.s1 - p.s0) * k);
      p.mat.opacity = p.base * (1 - k * k);
      return true;
    });
  }

  private spawn(kind: ParticleKind, x: number, h: number, y: number, vel: THREE.Vector3, life: number, s0: number, s1: number, spin: boolean) {
    const def = KINDS[kind];
    let geo = geoCache.get(kind);
    if (!geo) {
      geo = def.geo();
      geoCache.set(kind, geo);
    }
    const mat = toon(def.color, { transparent: true, opacity: def.opacity, emissive: def.emissive });
    mat.depthWrite = false;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h, y);
    this.group.add(mesh);
    const sp = spin ? new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14) : new THREE.Vector3();
    this.parts.push({ mesh, mat, vel, spin: sp, gravity: def.gravity, age: 0, life, s0, s1, base: def.opacity });
  }

  private killParticle(p: Particle) {
    p.mesh.removeFromParent();
    p.mat.dispose();
  }

  /** `n` particles flying outward from (x, y) meters on the floor. */
  burst(kind: ParticleKind, x: number, y: number, n: number, opts: { speed?: number; life?: number; scale?: number; up?: number; height?: number; spin?: boolean } = {}) {
    const speed = opts.speed ?? 1.5;
    const life = (opts.life ?? 450) / 1000;
    const sc = opts.scale ?? 1;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const v = speed * (0.5 + Math.random() * 0.7);
      const vel = new THREE.Vector3(Math.cos(ang) * v, (opts.up ?? 0) * (0.6 + Math.random() * 0.6), Math.sin(ang) * v);
      this.spawn(kind, x, opts.height ?? 0.25, y, vel, life, sc, sc * 0.6, !!opts.spin);
    }
  }

  /** A single puff that grows and fades (ecto splat, impact flash). */
  pop(kind: ParticleKind, x: number, y: number, opts: { scale?: number; life?: number; rise?: number; height?: number } = {}) {
    const sc = opts.scale ?? 1;
    const life = (opts.life ?? 700) / 1000;
    this.spawn(kind, x, opts.height ?? 0.5, y, new THREE.Vector3(0, (opts.rise ?? 0) / life, 0), life, sc * 0.5, sc, false);
  }
}
