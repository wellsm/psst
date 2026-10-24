import * as THREE from 'three';
import { addOutline, toon } from './toon';

const SHORTS_SEEKER = 0xe63946;
const SHORTS_HIDER = 0x2f6fff;

export interface Pose {
  moving: boolean;
  running: boolean;
  dashing: boolean;
  stunned: boolean;
  throwing: boolean;
  holding: boolean;
  taunting: boolean;
  corpse: boolean;
  seeker: boolean;
  ballReady: boolean;
}

const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
const tint = (c: number, k: number) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();

/** Sphere of radius 1 scaled to an ellipsoid (geometry-level, so outlines follow the shape). */
function ellipsoid(rx: number, ry: number, rz: number, seg = 18): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, seg - 6));
  g.scale(rx, ry, rz);
  return g;
}

/**
 * Cartoon chameleon built from primitives, facing +X, feet on y = 0.
 * `silhouette` builds the same shape with a single flat material + rim (sonar reveal).
 */
export class Chameleon {
  readonly group = new THREE.Group();
  /** Animated child (bob, squash, roll). */
  private pose = new THREE.Group();
  private legs: THREE.Group[] = [];
  private tail: THREE.Mesh;
  private head = new THREE.Group();
  private pupils: THREE.Group[] = [];
  private xEyes: THREE.Object3D[] = [];
  private mouth: THREE.Mesh | null = null;
  private hand = new THREE.Group();
  private slingshot = new THREE.Group();
  private band: THREE.Mesh | null = null;
  private bandPulled: THREE.Group | null = null;
  private bottle = new THREE.Group();
  private skin: THREE.MeshToonMaterial | null = null;
  private belly: THREE.MeshToonMaterial | null = null;
  private crest: THREE.MeshToonMaterial | null = null;
  private shorts: THREE.MeshToonMaterial | null = null;
  private color = -1;
  private walk = Math.random() * 10;
  private t = 0;

  constructor(silhouette: { fill: THREE.Material; rim: THREE.Material } | null = null) {
    const sil = silhouette;
    const ink = (m: THREE.Mesh, th = 0.025) => {
      if (sil) addOutline(m, 0.045, sil.rim);
      else addOutline(m, th);
      m.castShadow = !sil;
      return m;
    };
    if (!sil) {
      this.skin = toon(0x7ed957);
      this.belly = toon(0xd8ffb0);
      this.crest = toon(0x4a9a2a);
      this.shorts = toon(SHORTS_HIDER);
    }
    const mat = (m: THREE.Material | null) => (sil ? sil.fill : m!);
    this.group.add(this.pose);

    const torso = ink(new THREE.Mesh(ellipsoid(0.34, 0.22, 0.24), mat(this.skin)), 0.03);
    torso.position.set(-0.02, 0.33, 0);
    this.pose.add(torso);
    if (!sil) {
      const belly = new THREE.Mesh(ellipsoid(0.27, 0.12, 0.19), this.belly!);
      belly.position.set(0, 0.2, 0);
      this.pose.add(belly);
      const shorts = ink(new THREE.Mesh((() => {
        const g = new THREE.CylinderGeometry(1, 1, 0.2, 22);
        g.rotateZ(Math.PI / 2);
        g.scale(1, 0.218, 0.238);
        return g;
      })(), this.shorts!), 0.022);
      shorts.position.set(-0.15, 0.31, 0);
      this.pose.add(shorts);
      // Dorsal ridge.
      for (const [x, h] of [[-0.2, 0.08], [-0.05, 0.1], [0.1, 0.09]] as const) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, h, 6), this.crest!);
        spike.position.set(x, 0.55 + h * 0.3, 0);
        this.pose.add(spike);
      }
    }

    // Head: skull, snout, casque, turret eyes.
    this.head.position.set(0.3, 0.42, 0);
    this.pose.add(this.head);
    const skull = ink(new THREE.Mesh(ellipsoid(0.2, 0.17, 0.17), mat(this.skin)));
    this.head.add(skull);
    const snout = ink(new THREE.Mesh(ellipsoid(0.11, 0.09, 0.11), mat(this.skin)));
    snout.position.set(0.17, -0.03, 0);
    this.head.add(snout);
    const casque = ink(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 10), mat(this.crest)));
    casque.position.set(-0.08, 0.17, 0);
    casque.rotation.z = 0.85;
    this.head.add(casque);
    for (const side of [-1, 1]) {
      const turret = ink(new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), mat(this.skin)));
      turret.position.set(0.07, 0.08, side * 0.14);
      this.head.add(turret);
      if (sil) continue;
      const look = new THREE.Group();
      turret.add(look);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
      pupil.position.set(0.065, 0.015, side * 0.03);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.03, 0.022, 0);
      pupil.add(glint);
      look.add(pupil);
      this.pupils.push(look);
      // X eyes on the turret bottom: they face up when the body lies belly-up.
      const x = new THREE.Group();
      for (const a of [0.8, -0.8]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
        bar.rotation.y = a;
        x.add(bar);
      }
      x.position.set(0.0, -0.09, 0);
      x.visible = false;
      turret.add(x);
      this.xEyes.push(x);
    }
    if (!sil) {
      this.mouth = new THREE.Mesh(ellipsoid(0.035, 0.05, 0.08, 10), new THREE.MeshBasicMaterial({ color: 0x7a1f2b }));
      this.mouth.position.set(0.27, -0.05, 0);
      this.mouth.visible = false;
      this.head.add(this.mouth);
    }

    // Legs: hip pivots, swing around Z.
    for (const [x, z] of [[0.15, 1], [0.15, -1], [-0.18, 1], [-0.18, -1]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.3, z * 0.17);
      const leg = ink(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 8), mat(this.skin)), 0.02);
      leg.position.set(0, -0.12, z * 0.05);
      leg.rotation.x = z * 0.35;
      pivot.add(leg);
      const foot = ink(new THREE.Mesh(ellipsoid(0.07, 0.035, 0.06, 10), mat(this.skin)), 0.02);
      foot.position.set(0.03, -0.27, z * 0.1);
      pivot.add(foot);
      this.pose.add(pivot);
      this.legs.push(pivot);
    }

    // Curled tail.
    this.tail = ink(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 8, 20, Math.PI * 1.6), mat(this.skin)), 0.02);
    this.tail.position.set(-0.44, 0.27, 0);
    this.tail.rotation.z = Math.PI * 0.55;
    this.pose.add(this.tail);

    if (!sil) this.buildHand();
  }

  private buildHand() {
    this.hand.position.set(0.24, 0.36, 0.27);
    this.pose.add(this.hand);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), this.skin!);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-0.08, 0, -0.03);
    this.hand.add(arm);
    const wood = toon(0x9b5e2c);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), wood);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.06;
    addOutline(handle, 0.015);
    this.slingshot.add(handle);
    for (const s of [-1, 1]) {
      const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 6), wood);
      prong.position.set(0.16, 0, s * 0.045);
      prong.rotation.x = s * 0.6;
      prong.rotation.z = Math.PI / 2;
      addOutline(prong, 0.015);
      this.slingshot.add(prong);
    }
    const rubber = toon(0xe63946);
    this.band = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.17), rubber);
    this.band.position.set(0.21, 0, 0);
    this.slingshot.add(this.band);
    this.bandPulled = new THREE.Group();
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.018), rubber);
      strap.position.set(0.15, 0, s * 0.045);
      strap.rotation.y = -s * 0.5;
      this.bandPulled.add(strap);
    }
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon(0xffd23f));
    pouch.position.set(0.08, 0, 0);
    addOutline(pouch, 0.012);
    this.bandPulled.add(pouch);
    this.slingshot.add(this.bandPulled);
    this.hand.add(this.slingshot);
    const b = buildBottle(toon(0x4fc36b, { emissive: 0x0c3318 }));
    b.rotation.z = -Math.PI / 2 + 0.4;
    b.position.x = 0.06;
    this.bottle.add(b);
    this.hand.add(this.bottle);
  }

  setLook(color: number, seeker: boolean) {
    if (!this.skin) return;
    if (color !== this.color) {
      this.color = color;
      this.skin.color.setHex(color);
      this.belly!.color.setHex(tint(color, 0.55));
      this.crest!.color.setHex(shade(color, 0.7));
    }
    this.shorts!.color.setHex(seeker ? SHORTS_SEEKER : SHORTS_HIDER);
  }

  /** Procedural animation; call every frame. `dt` in seconds. */
  animate(p: Pose, dt: number) {
    this.t += dt;
    const t = this.t;
    const pose = this.pose;
    pose.rotation.set(0, 0, 0);
    pose.position.set(0, 0, 0);
    pose.scale.set(1, 1, 1);

    if (p.corpse) {
      pose.rotation.x = Math.PI;
      pose.position.y = 0.58;
      this.legs.forEach((l, i) => l.rotation.set((i % 2 ? -1 : 1) * 0.5, 0, (i < 2 ? 1 : -1) * 0.3));
      this.tail.rotation.z = Math.PI * 0.55;
      this.pupils.forEach((e) => (e.visible = false));
      this.xEyes.forEach((x) => (x.visible = true));
      if (this.mouth) this.mouth.visible = true;
      this.hand.visible = false;
      this.head.rotation.set(0, 0, 0);
      return;
    }
    this.pupils.forEach((e) => (e.visible = true));
    this.xEyes.forEach((x) => (x.visible = false));

    const walking = p.moving && !p.stunned && !p.dashing;
    if (walking) this.walk += dt * (p.running ? 17 : 10);
    // Body bob + waddle.
    const bob = walking ? Math.abs(Math.sin(this.walk)) * (p.running ? 0.06 : 0.035) : Math.sin(t * 2.2) * 0.008;
    pose.position.y = bob;
    if (walking) pose.rotation.x = Math.sin(this.walk) * 0.06;
    if (p.running) pose.rotation.z = -0.08;
    if (p.dashing) {
      pose.scale.set(1.3, 0.8, 0.85);
      pose.rotation.z = -0.25;
    }
    if (p.stunned) {
      pose.rotation.x = Math.sin(t * 9) * 0.25;
      pose.rotation.y = Math.sin(t * 5) * 0.3;
    }
    if (p.taunting) pose.rotation.x = Math.sin(t * 30) * 0.08;

    this.legs.forEach((l, i) => {
      const swing = walking ? Math.sin(this.walk + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.7 : 0;
      const tuck = p.dashing ? (i < 2 ? 0.9 : -0.9) : 0;
      l.rotation.set(0, 0, swing + tuck);
    });
    this.tail.rotation.z = Math.PI * 0.55 + Math.sin(t * (walking ? 8 : 2)) * (walking ? 0.25 : 0.08);

    // Head: taunt shake.
    this.head.rotation.set(0, 0, 0);
    if (p.taunting) this.head.rotation.y = Math.sin(t * 24) * 0.25;

    // Eyes: independent chameleon wandering; dizzy spin when stunned.
    this.pupils.forEach((e, i) => {
      if (p.stunned) e.rotation.set(t * 12 * (i ? 1 : -1), 0, 0);
      else e.rotation.set(0, Math.sin(t * 0.9 + i * 2.3) * 0.6, Math.sin(t * 1.3 + i) * 0.3);
    });
    if (this.mouth) this.mouth.visible = p.taunting;

    // Hand.
    this.hand.visible = true;
    this.hand.position.x = 0.24 + (p.throwing ? 0.14 : 0);
    this.hand.rotation.y = p.throwing ? -0.6 : 0;
    this.slingshot.visible = p.seeker;
    this.bottle.visible = !p.seeker && (p.holding || p.throwing);
    if (p.seeker && this.band && this.bandPulled) {
      this.band.visible = !p.ballReady;
      this.bandPulled.visible = p.ballReady;
    }
    if (!p.seeker && !this.bottle.visible) this.hand.visible = false;
  }
}

/** Glass bottle standing on +Y, base at y = 0. */
export function buildBottle(material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 10), material);
  body.position.y = 0.1;
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material);
  shoulder.position.y = 0.2;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 8), material);
  neck.position.y = 0.3;
  for (const m of [body, shoulder, neck]) {
    addOutline(m, 0.015);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
