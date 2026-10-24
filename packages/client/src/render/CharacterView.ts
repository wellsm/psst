import * as THREE from 'three';
import { Anim, PLAYER_COLORS, type LifeState, type Role, type Visibility } from '@psst/shared';
import { Chameleon, type Pose } from './Chameleon';
import { addOutline, disposeTree, glowTexture, OUTLINE, SONAR, SONAR_RIM, starShape, toon } from './toon';
import { h } from '../ui/dom';

const GHOST_ALPHA = 0.3;
const GHOST_SELF_ALPHA = 0.55;
/** Models are drawn a bit larger than the 0.8 m collider so they read at game zoom. */
const MODEL_SCALE = 1.25;

export interface CharState {
  x: number;
  y: number;
  a: number;
  anim: number;
  role: Role;
  life: LifeState;
  color: number;
}

let starGeo: THREE.ExtrudeGeometry | null = null;
function starGeometry() {
  starGeo ??= new THREE.ExtrudeGeometry(starShape(0.09, 0.04), { depth: 0.03, bevelEnabled: false });
  return starGeo;
}

/** Translucent bedsheet ghost with a chameleon face, facing +X, hem at y = 0. */
function buildGhost(sheet: THREE.Material, ink: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const prof = [[0.001, 0.95], [0.18, 0.92], [0.32, 0.8], [0.4, 0.6], [0.43, 0.35], [0.47, 0.05]].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(prof, 28);
  // Wavy hem.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.1) continue;
    pos.setY(i, pos.getY(i) + Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 7) * 0.05);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, sheet);
  g.add(body);
  const casque = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 10), sheet);
  casque.position.set(-0.08, 0.98, 0);
  casque.rotation.z = 0.85;
  g.add(casque);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), ink);
    eye.scale.set(0.6, 1, 0.8);
    eye.position.set(0.37, 0.66, side * 0.13);
    g.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 6), ink);
  mouth.scale.set(0.5, 0.6, 1.4);
  mouth.position.set(0.42, 0.45, 0);
  g.add(mouth);
  return g;
}

/** One per player: chameleon, sonar silhouette, ghost, stun stars and a DOM name tag. */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly tag: HTMLElement;
  /** World point the name tag hangs from. */
  readonly tagAnchor = new THREE.Vector3();
  tagVisible = false;
  private nameEl: HTMLElement;
  private speakerEl: HTMLElement;
  private model = new Chameleon();
  private silFill = new THREE.MeshBasicMaterial({ color: SONAR, transparent: true, depthTest: false, depthWrite: false });
  private silRim = new THREE.MeshBasicMaterial({ color: SONAR_RIM, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false });
  private silhouette = new Chameleon({ fill: this.silFill, rim: this.silRim });
  private glow: THREE.Sprite;
  private ghostSheet = toon(0xffffff, { transparent: true, opacity: GHOST_ALPHA });
  private ghostInk = new THREE.MeshBasicMaterial({ color: OUTLINE, transparent: true, opacity: 0.6 });
  private ghostRim = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, transparent: true, opacity: 0.3, depthWrite: false });
  private ghost: THREE.Group;
  private stars: THREE.Mesh[];
  private t = Math.random() * 10;
  /** Smoothed alpha shown for sonar silhouettes. */
  displayAlpha = 0;

  constructor(name: string) {
    this.model.group.scale.setScalar(MODEL_SCALE);
    this.silhouette.group.scale.setScalar(MODEL_SCALE);
    this.root.add(this.model.group);
    this.silhouette.group.traverse((o) => {
      o.renderOrder = o.userData.outline ? 20 : 21;
    });
    this.root.add(this.silhouette.group);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: SONAR, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.set(2.4, 2.4, 1);
    this.glow.position.y = 0.35;
    this.glow.renderOrder = 19;
    this.root.add(this.glow);

    this.ghostSheet.depthWrite = false;
    this.ghost = buildGhost(this.ghostSheet, this.ghostInk);
    this.ghost.scale.setScalar(MODEL_SCALE);
    addOutline(this.ghost.children[0] as THREE.Mesh, 0.03, this.ghostRim);
    this.root.add(this.ghost);

    const starMat = toon(0xffe14d, { emissive: 0x6b5200 });
    this.stars = [0, 1, 2].map(() => {
      const s = new THREE.Mesh(starGeometry(), starMat);
      this.root.add(s);
      return s;
    });

    this.nameEl = h('span.nametag-name', null, name);
    this.speakerEl = h('span.nametag-speaker', null, '🔊');
    this.tag = h('div.nametag', null, this.speakerEl, this.nameEl);
  }

  destroy() {
    this.root.removeFromParent();
    disposeTree(this.root, new Set(starGeo ? [starGeo] : []));
    this.tag.remove();
  }

  setName(name: string) {
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
  }

  /** `vis` comes from isVisibleTo; `alpha` is the displayed silhouette alpha (sonar) or 1. */
  update(st: CharState, vis: Visibility, alpha: number, dt: number, self: boolean, extra: { ballReady?: boolean } = {}): boolean {
    this.t += dt;
    const t = this.t;
    this.root.position.set(st.x, 0, st.y);
    this.root.rotation.y = -st.a;
    const show = vis !== 'hidden' && alpha > 0.02;
    this.root.visible = show;
    this.tagVisible = false;
    this.tag.style.display = 'none';
    if (!show) return false;

    const anim = st.anim;
    const color = PLAYER_COLORS[st.color] ?? 0xffffff;
    const speaking = (anim & Anim.SPEAKING) !== 0;
    const stunned = (anim & Anim.STUNNED) !== 0;
    this.model.group.visible = false;
    this.silhouette.group.visible = false;
    this.glow.visible = false;
    this.ghost.visible = false;
    this.stars.forEach((s) => (s.visible = false));

    const showTag = (y: number, opacity: number) => {
      this.tagAnchor.set(st.x, y, st.y);
      this.tagVisible = true;
      this.tag.style.display = '';
      this.tag.style.opacity = String(opacity);
      this.speakerEl.style.visibility = speaking ? 'visible' : 'hidden';
    };
    const orbitStars = (y: number) => {
      this.stars.forEach((s, i) => {
        const a = t * 5 + i * 2.1;
        s.visible = true;
        s.position.set(Math.cos(a) * 0.3, y + Math.sin(a * 2) * 0.03, Math.sin(a) * 0.3);
        s.rotation.set(-Math.PI / 2, 0, t * 4);
      });
    };

    if (st.life === 'ghost') {
      this.ghost.visible = true;
      const a = self ? GHOST_SELF_ALPHA : GHOST_ALPHA;
      this.ghostSheet.opacity = a;
      this.ghostSheet.color.setHex(color).lerp(new THREE.Color(0xffffff), 0.55);
      this.ghostInk.opacity = a + 0.25;
      this.ghost.position.y = 0.25 + Math.sin(t * 3) * 0.08;
      this.ghost.rotation.z = Math.sin(t * 2) * 0.05;
      showTag(1.5, 0.7);
      return true;
    }

    if (st.life === 'caught') {
      this.model.group.visible = true;
      this.model.setLook(color, st.role === 'seeker');
      this.model.animate(corpsePose, dt);
      orbitStars(0.75);
      showTag(1.1, 1);
      return true;
    }

    if (vis === 'silhouette') {
      this.silhouette.group.visible = true;
      this.silFill.opacity = alpha;
      this.silRim.opacity = alpha;
      this.glow.visible = true;
      (this.glow.material as THREE.SpriteMaterial).opacity = alpha * 0.55;
      return true;
    }

    this.model.group.visible = true;
    this.model.setLook(color, st.role === 'seeker');
    const throwing = (anim & Anim.THROWING) !== 0;
    this.model.animate({
      moving: (anim & Anim.MOVING) !== 0,
      running: (anim & Anim.RUNNING) !== 0,
      dashing: (anim & Anim.DASHING) !== 0,
      stunned,
      throwing,
      holding: (anim & Anim.HOLDING) !== 0,
      taunting: (anim & Anim.TAUNTING) !== 0,
      corpse: false,
      seeker: st.role === 'seeker',
      ballReady: extra.ballReady ?? !throwing,
    }, dt);
    if (stunned) orbitStars(0.95);
    showTag(1.15, 1);
    return true;
  }
}

const corpsePose: Pose = {
  moving: false, running: false, dashing: false, stunned: false, throwing: false, holding: false,
  taunting: false, corpse: true, seeker: false, ballReady: false,
};

/** A static body left where a hider was caught. */
export class CorpseView {
  readonly root: THREE.Group;
  private model = new Chameleon();

  constructor(x: number, y: number, a: number, color: number) {
    this.root = this.model.group;
    this.root.scale.setScalar(MODEL_SCALE);
    this.model.setLook(PLAYER_COLORS[color] ?? 0xffffff, false);
    this.model.animate(corpsePose, 0);
    this.root.position.set(x, 0, y);
    this.root.rotation.y = -a;
  }

  destroy() {
    this.root.removeFromParent();
    disposeTree(this.root);
  }
}
