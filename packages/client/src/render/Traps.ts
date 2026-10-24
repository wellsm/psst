import * as THREE from 'three';
import type { SnapTrap, TrapKind } from '@psst/shared';
import { addOutline, disposeTree, inked, toon } from './toon';

const DUCK = 0xffd23f;
const BEAK = 0xff8f3c;

/** Rubber duck facing +X, sitting on y = 0. `s` scales the whole toy. */
export function buildDuck(s = 1): THREE.Group {
  const g = new THREE.Group();
  const body = inked(new THREE.SphereGeometry(0.22 * s, 16, 12), toon(DUCK), 0.03);
  body.scale.set(1.2, 0.8, 1);
  body.position.y = 0.17 * s;
  const head = inked(new THREE.SphereGeometry(0.13 * s, 14, 10), toon(DUCK), 0.03);
  head.position.set(0.14 * s, 0.38 * s, 0);
  const beak = inked(new THREE.ConeGeometry(0.06 * s, 0.14 * s, 10), toon(BEAK), 0.02);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.3 * s, 0.36 * s, 0);
  const tail = inked(new THREE.ConeGeometry(0.07 * s, 0.14 * s, 8), toon(DUCK), 0.02);
  tail.rotation.z = Math.PI / 2.6;
  tail.position.set(-0.27 * s, 0.26 * s, 0);
  g.add(body, head, beak, tail);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 8, 6), toon(0x1a1a2e));
    eye.position.set(0.22 * s, 0.43 * s, side * 0.08 * s);
    g.add(eye);
  }
  return g;
}

function buildBanana(): THREE.Group {
  const g = new THREE.Group();
  const peel = toon(0xffe14d);
  // Three splayed peel flaps around a little stem.
  for (let i = 0; i < 3; i++) {
    const flap = inked(new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), peel, 0.025);
    flap.scale.set(1, 1, 0.45);
    const a = (i / 3) * Math.PI * 2;
    flap.position.set(Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17);
    flap.rotation.set(0, -a, Math.PI / 2 - 0.25);
    g.add(flap);
  }
  const stem = inked(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 8), toon(0x7a5a1e), 0.02);
  stem.position.y = 0.1;
  g.add(stem);
  return g;
}

function buildMousetrap(): THREE.Group {
  const g = new THREE.Group();
  const base = inked(new THREE.BoxGeometry(0.62, 0.06, 0.34), toon(0xc08a4a), 0.025);
  base.position.y = 0.03;
  const cheese = inked(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 3), toon(0xffd23f), 0.02);
  cheese.position.set(0.14, 0.095, 0);
  const bar = new THREE.Group();
  const wire = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 6, 16, Math.PI), toon(0xc8ccd6));
  wire.rotation.y = Math.PI / 2;
  wire.position.x = 0;
  bar.add(wire);
  bar.position.set(-0.05, 0.07, 0);
  bar.name = 'bar';
  g.add(base, cheese, bar);
  return g;
}

function buildAlarm(): THREE.Group {
  const g = new THREE.Group();
  const red = toon(0xff4d5e);
  const metal = toon(0xc8ccd6);
  const body = inked(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), red, 0.03);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.3;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), toon(0xffffff));
  face.position.set(0, 0.3, 0.065);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.01), toon(0x1a1a2e));
  hand.position.set(0, 0.34, 0.07);
  g.add(body, face, hand);
  for (const side of [-1, 1]) {
    const bell = inked(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0.02);
    bell.position.set(side * 0.13, 0.46, 0);
    bell.rotation.z = -side * 0.5;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), metal);
    leg.position.set(side * 0.13, 0.12, 0);
    leg.rotation.z = side * 0.4;
    g.add(bell, leg);
  }
  return g;
}

function build(k: TrapKind): THREE.Group {
  switch (k) {
    case 'duck': return buildDuck();
    case 'banana': return buildBanana();
    case 'mousetrap': return buildMousetrap();
    case 'alarm': return buildAlarm();
  }
}

/** Duck hat for the "hot duck" event: a rubber duck on a little brim. */
export function buildDuckHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 18), toon(0xff8f3c));
  addOutline(brim, 0.02);
  const duck = buildDuck(0.8);
  duck.position.y = 0.015;
  g.add(brim, duck);
  return g;
}

/** World traps from the snapshot (empty while "invisible traps" runs). */
export class TrapsView {
  readonly group = new THREE.Group();
  private items = new Map<number, { o: THREE.Group; k: TrapKind; armed: boolean; t: number; seed: number }>();

  update(traps: readonly SnapTrap[], dt: number) {
    const seen = new Set<number>();
    for (const tr of traps) {
      seen.add(tr.id);
      let it = this.items.get(tr.id);
      if (!it) {
        const o = build(tr.k);
        o.traverse((m) => { if ((m as THREE.Mesh).isMesh && !m.userData.outline) m.castShadow = true; });
        o.rotation.y = (tr.id * 2.39996) % (Math.PI * 2);
        o.position.set(tr.x, 0, tr.y);
        this.group.add(o);
        it = { o, k: tr.k, armed: tr.armed, t: 0, seed: tr.id };
        this.items.set(tr.id, it);
      }
      // Fired traps react: duck squashes, peel spins along its slide, mousetrap snaps shut, alarm rattles.
      if (it.armed && !tr.armed) it.t = 0;
      it.armed = tr.armed;
      it.t += dt;
      const o = it.o;
      // Bananas slide to their new spot.
      const k = Math.exp(-dt * 10);
      o.position.x = o.position.x * k + tr.x * (1 - k);
      o.position.z = o.position.z * k + tr.y * (1 - k);
      o.position.y = 0;
      o.scale.set(1, 1, 1);
      if (it.k === 'duck' && !tr.armed) {
        const q = Math.max(0, 1 - it.t * 4);
        o.scale.set(1 + q * 0.3, 1 - q * 0.4, 1 + q * 0.3);
      }
      if (it.k === 'banana' && !tr.armed && it.t < 0.6) o.rotation.y += dt * 18;
      if (it.k === 'mousetrap') {
        const bar = o.getObjectByName('bar');
        if (bar) bar.rotation.z = tr.armed ? 0 : -Math.PI * 0.9;
      }
      if (it.k === 'alarm') {
        const ringing = !tr.armed && it.t < 3.5;
        o.rotation.z = ringing ? Math.sin(it.t * 60) * 0.12 : 0;
        o.position.y = ringing ? Math.abs(Math.sin(it.t * 30)) * 0.04 : 0;
      }
    }
    for (const [id, it] of this.items) {
      if (seen.has(id)) continue;
      it.o.removeFromParent();
      disposeTree(it.o);
      this.items.delete(id);
    }
  }

  clear() {
    this.update([], 0);
  }
}
