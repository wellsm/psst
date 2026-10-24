import * as THREE from 'three';
import {
  Anim,
  CameraMode,
  INPUT_DT,
  SOUND_DEFS,
  dist,
  forwardYaw,
  isLookMode,
  isVisibleTo,
  jumpHeight,
  rotateMove,
  stepDisplayAlpha,
  type ClientInput,
  type GameEvent,
  type Layout,
  type PlayerTarget,
  type SnapPlayer,
  type Viewer,
  type Visibility,
} from '@psst/shared';
import type { AudioEngine } from '../audio/AudioEngine';
import type { InputState } from '../input/InputState';
import { isTouchDevice } from '../input/TouchControls';
import type { Net } from '../net/Net';
import { buildBottle } from '../render/Chameleon';
import { CharacterView, CorpseView, type CharState } from '../render/CharacterView';
import { Effects } from '../render/Effects';
import { MapView } from '../render/MapView';
import { TrapsView, buildDuckHat } from '../render/Traps';
import { addOutline, disposeTree, toon } from '../render/toon';
import { h } from '../ui/dom';
import type { World } from './World';

const FOV = 38;
const CAM_DISTANCE = 20;
const CAM_PITCH = (58 * Math.PI) / 180;
const AIM_LOOKAHEAD = 0.18;
/** Isometric: true-iso elevation, half the visible floor height in meters. */
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const ISO_HALF_HEIGHT = 10;
/** Mouse-look views. */
const LOOK_FOV = 65;
const LOOK_RATE = 0.0025;
const THIRD_DISTANCE = 4.5;
const THIRD_SHOULDER = 0.6;
const THIRD_PITCH = { min: -0.25, max: 1.3, start: 0.4 };
const FIRST_PITCH = { min: -1.3, max: 1.3, start: 0.12 };
const EYE_HEIGHT = 0.75;
const GHOST_EYE_HEIGHT = 1.1;
/** Aim distance when the view ray hits nothing (looking at the sky). */
const SKY_AIM = 30;
const MAX_STEPS_PER_FRAME = 6;
/** Projectiles fly at chest height. */
const PROJ_HEIGHT = 0.7;
/** Super-jump: standing heights on low solids (mugs/pebbles, crates and covers). */
const MUG_TOP = { kitchen: 1.5, terrarium: 0.65, playroom: 1.5, snowglobe: 0.65 } as const;
const BOX_TOP = 0.85;
const HAT_HEIGHT = 1.02;

export interface FrameInfo {
  now: number;
  fireHeld: boolean;
  nearCrate: boolean;
  listener: { x: number; y: number };
}

export interface GameDeps {
  world: World;
  input: InputState;
  net: Net;
  audio: AudioEngine;
  nameOf(id: string): string;
  onFrame(info: FrameInfo): void;
}

/** Three.js game view: input/prediction loop and the 3D rendering of the world. */
export class GameView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  private camera: THREE.Camera = this.persp;
  private mode: number = CameraMode.TOP_DOWN;
  private lookMode = -1;
  private lookYaw = -Math.PI / 2;
  private lookPitch = 0;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private mapV = new MapView();
  private fx = new Effects();
  private trapsV = new TrapsView();
  private duckHat = buildDuckHat();
  private hop = new Map<string, number>();
  private trail = new Map<string, number>();
  private views = new Map<string, CharacterView>();
  private bodies = new Map<string, CorpseView>();
  private projs = new Map<number, THREE.Object3D>();
  private held: THREE.Object3D[] = [];
  private lastStates = new Map<string, SnapPlayer>();
  private tagLayer: HTMLElement;
  private reticle: HTMLElement;
  private range: THREE.Mesh;
  private rangeR = -1;
  private rangeLine: THREE.Mesh;
  private builtLayout: Layout | null = null;
  private acc = 0;
  private pendingDash = false;
  private pendingJump = false;
  private fireHeld = false;
  private claimed = new Set<string>();
  private wasDashing = false;
  private unlisten: () => void;
  private camX = 0;
  private camY = 0;
  private shake = 0;
  private raf = 0;
  private lastMs = 0;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private ndc = new THREE.Vector2();

  constructor(private deps: GameDeps, private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Phones: fewer pixels keep the frame rate (and battery) up.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isTouchDevice() ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.tagLayer = h('div.tag-layer');
    this.reticle = h('div.reticle');
    host.append(this.tagLayer, this.reticle);

    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a7a, 1.5));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -22;
    sc.right = sc.top = 22;
    sc.near = 1;
    sc.far = 70;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.mapV.group, this.fx.group, this.trapsV.group, this.duckHat);
    this.duckHat.visible = false;

    this.range = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
    this.range.renderOrder = 8;
    this.rangeLine = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 0.07).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthTest: false }));
    this.rangeLine.renderOrder = 8;
    this.scene.add(this.range, this.rangeLine);

    this.unlisten = deps.world.listen({ onEvents: (e) => this.onEvents(e) });
    addEventListener('resize', this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    this.unlisten();
    for (const v of this.views.values()) v.destroy();
    for (const b of this.bodies.values()) b.destroy();
    this.mapV.dispose();
    this.fx.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.tagLayer.remove();
    this.reticle.remove();
  }

  private resize = () => {
    const aspect = innerWidth / Math.max(1, innerHeight);
    this.renderer.setSize(innerWidth, innerHeight);
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.ortho.top = ISO_HALF_HEIGHT;
    this.ortho.bottom = -ISO_HALF_HEIGHT;
    this.ortho.left = -ISO_HALF_HEIGHT * aspect;
    this.ortho.right = ISO_HALF_HEIGHT * aspect;
    this.ortho.updateProjectionMatrix();
  };

  /** Picks the camera for the host's camera rule; (re)starts mouse-look from the player's facing. */
  private applyMode(mode: number, facing: number | undefined) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.camera = mode === CameraMode.ISOMETRIC ? this.ortho : this.persp;
      this.mapV.setBackdrop(isLookMode(mode));
      this.fx.setLookView(isLookMode(mode));
      this.persp.fov = isLookMode(mode) ? LOOK_FOV : FOV;
      this.persp.updateProjectionMatrix();
    }
    if (isLookMode(mode) && this.lookMode !== mode && facing !== undefined) {
      this.lookMode = mode;
      this.lookYaw = facing;
      this.lookPitch = mode === CameraMode.THIRD_PERSON ? THIRD_PITCH.start : FIRST_PITCH.start;
    }
    if (!isLookMode(mode)) this.lookMode = -1;
  }

  private turn(dx: number, dy: number) {
    if (!isLookMode(this.mode)) return;
    const lim = this.mode === CameraMode.THIRD_PERSON ? THIRD_PITCH : FIRST_PITCH;
    this.lookYaw += dx * LOOK_RATE;
    this.lookPitch = Math.min(lim.max, Math.max(lim.min, this.lookPitch + dy * LOOK_RATE));
  }

  /** World direction of the mouse-look view (three axes). */
  private lookDir(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.lookPitch);
    return out.set(c * Math.cos(this.lookYaw), -Math.sin(this.lookPitch), c * Math.sin(this.lookYaw));
  }

  private aimWorld(): { x: number; y: number } {
    const { input, world } = this.deps;
    if (isLookMode(this.mode)) {
      // Screen-center ray: first solid or floor hit; looking at the sky aims far ahead.
      this.ndc.set(0, 0);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      let best = Infinity;
      const floor = this.raycaster.ray.intersectPlane(this.ground, this.tmp);
      if (floor) best = this.raycaster.ray.origin.distanceTo(floor);
      const solid = this.raycaster.intersectObjects(this.mapV.occluders, false)[0];
      if (solid && solid.distance < best) return { x: solid.point.x, y: solid.point.z };
      if (floor) return { x: floor.x, y: floor.z };
      const p = world.predictor;
      return { x: p.renderX + Math.cos(this.lookYaw) * SKY_AIM, y: p.renderY + Math.sin(this.lookYaw) * SKY_AIM };
    }
    this.ndc.set((input.cursorX / innerWidth) * 2 - 1, -(input.cursorY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.tmp);
    return hit ? { x: hit.x, y: hit.z } : { x: this.camX, y: this.camY };
  }

  private placeCamera(dt: number, selfX: number, selfY: number, ghost: boolean) {
    this.shake = Math.max(0, this.shake - dt);
    const s = this.shake > 0 ? this.shake * 1.4 : 0;
    const jx = s ? (Math.random() - 0.5) * s : 0, jz = s ? (Math.random() - 0.5) * s : 0;
    const cam = this.camera;
    let cx = this.camX, cy = this.camY;
    if (this.mode === CameraMode.ISOMETRIC) {
      const d = 40, k = Math.cos(ISO_ELEVATION) * Math.SQRT1_2 * d;
      cam.position.set(this.camX + k + jx, Math.sin(ISO_ELEVATION) * d, this.camY + k + jz);
      cam.lookAt(this.camX + jx, 0, this.camY + jz);
    } else if (this.mode === CameraMode.THIRD_PERSON) {
      const dir = this.lookDir(new THREE.Vector3());
      const right = new THREE.Vector3(-Math.sin(this.lookYaw), 0, Math.cos(this.lookYaw));
      const target = new THREE.Vector3(selfX, ghost ? 1.3 : 0.9, selfY).addScaledVector(right, THIRD_SHOULDER);
      // Pull the camera in front of any solid between it and the player.
      let distance = THIRD_DISTANCE;
      this.raycaster.set(target, dir.clone().negate());
      this.raycaster.far = THIRD_DISTANCE;
      const hit = this.raycaster.intersectObjects(this.mapV.occluders, false)[0];
      this.raycaster.far = Infinity;
      if (hit && !ghost) distance = Math.max(0.6, hit.distance - 0.25);
      cam.position.copy(target).addScaledVector(dir, -distance);
      cam.position.y = Math.max(0.25, cam.position.y);
      cam.position.x += jx;
      cam.position.z += jz;
      cam.lookAt(cam.position.clone().add(dir));
      cx = selfX + Math.cos(this.lookYaw) * 8;
      cy = selfY + Math.sin(this.lookYaw) * 8;
    } else if (this.mode === CameraMode.FIRST_PERSON) {
      const dir = this.lookDir(new THREE.Vector3());
      cam.position.set(selfX + Math.cos(this.lookYaw) * 0.25 + jx * 0.3, ghost ? GHOST_EYE_HEIGHT : EYE_HEIGHT, selfY + Math.sin(this.lookYaw) * 0.25 + jz * 0.3);
      cam.lookAt(cam.position.clone().add(dir));
      cx = selfX + Math.cos(this.lookYaw) * 10;
      cy = selfY + Math.sin(this.lookYaw) * 10;
    } else {
      const oy = CAM_DISTANCE * Math.sin(CAM_PITCH), oz = CAM_DISTANCE * Math.cos(CAM_PITCH);
      cam.position.set(this.camX + jx, oy, this.camY + oz + jz);
      cam.lookAt(this.camX + jx, 0, this.camY + jz);
    }
    // Keep the shadow frustum over what the camera looks at.
    this.sun.position.set(cx + 9, 24, cy + 6);
    this.sun.target.position.set(cx, 0, cy);
  }

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastMs ? Math.min((ms - this.lastMs) / 1000, 0.1) : 1 / 60;
    this.lastMs = ms;
    const now = performance.now() / 1000;
    const { world, input, net } = this.deps;
    const snap = world.latest;
    if (!snap || !world.layout) {
      input.endFrame();
      return;
    }
    if (world.layout !== this.builtLayout) {
      this.builtLayout = world.layout;
      this.mapV.build(world.layout);
      this.mapV.setBackdrop(isLookMode(this.mode));
      this.scene.background = this.mapV.background;
      for (const v of this.views.values()) v.destroy();
      this.views.clear();
      this.bodies.forEach((b) => b.destroy());
      this.bodies.clear();
      this.fx.clear();
      this.trapsV.clear();
      this.lookMode = -1;
    }

    const me = snap.me;
    const pred = world.predictor;
    const ctx = world.moveContext();
    const s = world.settings;
    this.applyMode(s.cameraMode, pred.state?.angle);
    const look = input.consumeLook();
    this.turn(look.dx, look.dy);
    const aim = this.aimWorld();
    const viewYaw = forwardYaw(this.mode, this.lookYaw);

    // ---------- actions (edge-triggered, per frame)
    if (me && snap.phase === 'hunt' && me.life === 'alive' && me.power && input.consumePressed('usePower')) net.send('usePower', {});
    if (me && snap.phase === 'hunt') {
      const canFire = me.stunLeft <= 0 && me.dashLeft <= 0;
      if (me.role === 'seeker') {
        if (input.consumePressed('fire') && canFire) {
          net.send('fire', { ax: aim.x, ay: aim.y });
          this.deps.audio.play('slingshot', 'seeker', { volume: 0.7 });
        }
        if (input.consumePressed('dash')) this.pendingDash = true;
      } else {
        if (input.consumePressed('fire')) this.fireHeld = true;
        if (input.consumeReleased('fire') && this.fireHeld) {
          this.fireHeld = false;
          if (canFire) net.send('fire', { ax: aim.x, ay: aim.y });
        }
        if (me.life === 'alive') {
          if (input.consumePressed('taunt')) net.send('taunt', {});
          if (input.consumePressed('refill')) net.send('refill', {});
        }
      }
    } else {
      this.fireHeld = false;
    }
    if (!input.isDown('fire')) this.fireHeld = false;
    if (input.consumePressed('jump') && me?.life === 'alive') this.pendingJump = true;

    // ---------- fixed-step input + prediction
    this.acc = Math.min(this.acc + dt, INPUT_DT * MAX_STEPS_PER_FRAME);
    const batch: ClientInput[] = [];
    while (this.acc >= INPUT_DT) {
      this.acc -= INPUT_DT;
      // WASD / sticks are relative to the view: rotated into world axes before prediction and sending.
      const mv = input.moveVector();
      const { mx, my } = rotateMove(mv.x, mv.y, viewYaw);
      const inp: ClientInput = { seq: ++pred.seq, mx, my, run: input.isDown('run'), ax: aim.x, ay: aim.y, dash: this.pendingDash, jump: this.pendingJump, hold: this.fireHeld };
      this.pendingDash = false;
      this.pendingJump = false;
      if (ctx) {
        const ev = pred.step(inp, ctx);
        if (ev?.dashStarted) {
          this.claimed.clear();
          this.fx.burst('dust', pred.renderX, pred.renderY, 7, { speed: 1.4, height: 0.15 });
        }
        if (ev?.landed) this.fx.burst('dust', pred.renderX, pred.renderY, 5, { speed: 1, height: 0.1 });
      }
      batch.push(inp);
    }
    if (batch.length && snap.phase !== 'end') net.send('input', batch);
    pred.decay(dt);

    const selfX = pred.state ? pred.renderX : 0;
    const selfY = pred.state ? pred.renderY : 0;

    // ---------- entities
    const sample = world.sample(now);
    const viewer: Viewer | null = me ? { id: world.myId, role: me.role, life: me.life } : null;
    const seen = new Set<string>();

    // Dash claims against visible hiders (server re-validates with tolerance).
    const dashing = !!pred.state && pred.state.dashLeft > 0;
    if (me?.role === 'seeker' && (dashing || this.wasDashing)) {
      for (const p of sample.players.values()) {
        if (p.role !== 'hider' || p.life !== 'alive' || this.claimed.has(p.id)) continue;
        if (dist(p.x, p.y, selfX, selfY) <= s.dashHitRadius + 0.3) {
          this.claimed.add(p.id);
          net.send('dashClaim', { targetId: p.id });
        }
      }
    }
    this.wasDashing = dashing;

    const render = (id: string, st: CharState, rev: number, self: boolean, z: number) => {
      seen.add(id);
      let v = this.views.get(id);
      if (!v) {
        v = new CharacterView(this.deps.nameOf(id));
        this.views.set(id, v);
        this.scene.add(v.root);
        this.tagLayer.append(v.tag);
      }
      v.setName(this.deps.nameOf(id));
      const target: PlayerTarget = { kind: 'player', id, role: st.role, life: st.life, reveal: rev, stunned: (st.anim & Anim.STUNNED) !== 0 };
      const vis: Visibility = viewer ? isVisibleTo(viewer, target, snap.phase) : 'full';
      const targetAlpha = vis === 'silhouette' ? rev : vis === 'hidden' ? 0 : 1;
      v.displayAlpha = vis === 'silhouette' ? stepDisplayAlpha(v.displayAlpha, targetAlpha, dt, s.revealAlphaRate) : targetAlpha;
      v.update(st, vis, v.displayAlpha, dt, self, self && me ? { ballReady: me.ballCd <= 0 } : {});
      // Camo: a disguised seeker carries no name tag.
      if ((st as Partial<SnapPlayer>).anon) { v.tagVisible = false; v.tag.style.display = 'none'; }
      // Jump arc; super jumps and pounces come down on top of the low solid underneath.
      const jumping = (st.anim & Anim.JUMPING) !== 0;
      const ground = jumping && world.layout ? lowTop(world.layout, st.x, st.y, s.playerRadius) : 0;
      const top = (this.hop.get(id) ?? 0) + (ground - (this.hop.get(id) ?? 0)) * (1 - Math.exp(-dt * 14));
      this.hop.set(id, top);
      const y = Math.max(top, z);
      v.root.position.y = y;
      v.tagAnchor.y += y;
      if ((st.anim & Anim.SPEEDING) && (st.anim & Anim.MOVING) && v.root.visible) {
        const left = (this.trail.get(id) ?? 0) - dt;
        this.trail.set(id, left <= 0 ? 0.07 : left);
        if (left <= 0) this.fx.burst('dust', st.x, st.y, 1, { speed: 0.4, height: 0.1 + y });
      }
    };

    if (me && pred.state) {
      render(world.myId, {
        x: selfX, y: selfY, a: pred.state.angle,
        anim: (me.anim & ~(Anim.MOVING | Anim.RUNNING | Anim.DASHING)) | (Math.hypot(pred.state.vx, pred.state.vy) > 0.3 ? Anim.MOVING : 0) | (pred.state.running ? Anim.RUNNING : 0) | (pred.state.dashLeft > 0 ? Anim.DASHING : 0) | (pred.state.stunLeft > 0 ? Anim.STUNNED : 0) | (this.fireHeld && (me.bottles > 0 || me.life === 'ghost') ? Anim.HOLDING : 0),
        role: me.role, life: me.life, color: snap.players.find((p) => p.id === world.myId)?.color ?? 0,
      }, 1, true, jumpHeight(pred.state));
      const own = this.views.get(world.myId);
      if (own && this.mode === CameraMode.FIRST_PERSON) {
        own.root.visible = false;
        own.tagVisible = false;
        own.tag.style.display = 'none';
      }
    }
    for (const p of sample.players.values()) {
      if (p.id === world.myId) continue;
      render(p.id, p, p.rev, false, p.z ?? 0);
    }
    // Players that dropped out of the snapshot fade out where they were last seen.
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.displayAlpha = stepDisplayAlpha(v.displayAlpha, 0, dt, s.revealAlphaRate);
      const lastState = this.lastStates.get(id);
      if (v.displayAlpha <= 0.02 || !lastState) {
        v.destroy();
        this.views.delete(id);
        this.lastStates.delete(id);
        continue;
      }
      v.update(lastState, 'silhouette', v.displayAlpha, dt, false);
    }
    for (const p of sample.players.values()) this.lastStates.set(p.id, p);

    // Bodies.
    const bodyIds = new Set(snap.bodies.map((b) => b.id));
    for (const b of snap.bodies) {
      if (this.bodies.has(b.id)) continue;
      const c = new CorpseView(b.x, b.y, b.a, b.color);
      this.scene.add(c.root);
      this.bodies.set(b.id, c);
    }
    for (const [id, c] of this.bodies) if (!bodyIds.has(id)) { c.destroy(); this.bodies.delete(id); }

    // Projectiles.
    const projIds = new Set<number>();
    for (const pr of sample.proj) {
      projIds.add(pr.id);
      let o = this.projs.get(pr.id);
      if (!o) {
        o = makeProjectile(pr.k);
        this.scene.add(o);
        this.projs.set(pr.id, o);
      }
      o.position.set(pr.x, PROJ_HEIGHT, pr.y);
      if (pr.k === 'ball') o.rotation.z -= dt * 12;
      else o.rotation.x += dt * 14;
    }
    for (const [id, o] of this.projs) if (!projIds.has(id)) { o.removeFromParent(); disposeTree(o); this.projs.delete(id); }

    // Bottles held by hiders the viewer cannot see (they give the owner away).
    while (this.held.length < snap.held.length) {
      const b = buildBottle(toon(0x4fc36b, { emissive: 0x0c3318 }));
      this.scene.add(b);
      this.held.push(b);
    }
    this.held.forEach((o, i) => {
      const hb = snap.held[i];
      o.visible = !!hb;
      if (hb) {
        o.position.set(hb.x + Math.cos(hb.a) * 0.38, 0.32 + Math.sin(now * 6) * 0.02, hb.y + Math.sin(hb.a) * 0.38);
        o.rotation.set(0, -hb.a, -0.5);
      }
    });

    // Traps and the hot-duck hat (only on a carrier this viewer can see).
    this.trapsV.update(snap.traps, dt);
    const carrier = snap.event?.k === 'hotDuck' && snap.event.carrier ? this.views.get(snap.event.carrier) : undefined;
    this.duckHat.visible = !!carrier && carrier.root.visible;
    if (carrier && this.duckHat.visible) {
      this.duckHat.position.set(carrier.root.position.x, carrier.root.position.y + HAT_HEIGHT + Math.abs(Math.sin(now * 9)) * 0.04, carrier.root.position.z);
      this.duckHat.rotation.y = carrier.root.rotation.y;
    }

    this.fx.update(now, dt, s);
    this.mapV.update(dt);

    // ---------- camera, occlusion, reticle, range
    if (pred.state) {
      const tx = selfX + (aim.x - selfX) * AIM_LOOKAHEAD, ty = selfY + (aim.y - selfY) * AIM_LOOKAHEAD;
      const k = 1 - Math.exp(-dt * 8);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      if (Math.hypot(tx - this.camX, ty - this.camY) > 15) { this.camX = tx; this.camY = ty; }
    }
    this.placeCamera(dt, selfX, selfY, me?.life === 'ghost');
    if (pred.state && this.mode !== CameraMode.FIRST_PERSON) this.updateOcclusion(selfX, selfY);

    const aimNow = this.aimWorld();
    const liveAim = (snap.phase === 'hunt' || snap.phase === 'countdown') && me && me.life !== 'caught' && !(me.role === 'seeker' && snap.phase === 'countdown');
    this.reticle.style.display = liveAim ? '' : 'none';
    const look3d = isLookMode(this.mode);
    this.reticle.style.transform = look3d ? `translate(${innerWidth / 2}px, ${innerHeight / 2}px)` : `translate(${input.cursorX}px, ${input.cursorY}px)`;
    this.reticle.classList.toggle('seeker', me?.role === 'seeker');
    const canHold = me && snap.phase === 'hunt' && ((me.life === 'alive' && me.role === 'hider' && me.bottles > 0) || (me.life === 'ghost' && me.ghostCd <= 0));
    const showRange = !!(this.fireHeld && canHold);
    this.range.visible = this.rangeLine.visible = showRange;
    if (showRange) {
      if (this.rangeR !== s.bottleRange) {
        this.rangeR = s.bottleRange;
        this.range.geometry.dispose();
        this.range.geometry = new THREE.RingGeometry(s.bottleRange - 0.05, s.bottleRange + 0.05, 96).rotateX(-Math.PI / 2);
      }
      this.range.position.set(selfX, 0.05, selfY);
      const d = Math.min(s.bottleRange, dist(selfX, selfY, aimNow.x, aimNow.y));
      const ang = Math.atan2(aimNow.y - selfY, aimNow.x - selfX);
      this.rangeLine.position.set(selfX, 0.06, selfY);
      this.rangeLine.rotation.y = -ang;
      this.rangeLine.scale.set(Math.max(0.01, d), 1, 1);
    }

    this.renderer.render(this.scene, this.camera);
    this.placeTags();

    const nearCrate = !!world.layout && world.layout.crates.some((c) => dist(selfX, selfY, c.x + 0.5, c.y + 0.5) <= s.refillRange);
    this.deps.onFrame({ now, fireHeld: this.fireHeld, nearCrate, listener: { x: selfX, y: selfY } });
    input.endFrame();
  };

  /** Fades solids that hide the local player from the camera. */
  private updateOcclusion(x: number, y: number) {
    const hit = new Set<THREE.Object3D>();
    const cam = this.camera.position;
    for (const hgt of [0.2, 0.6]) {
      const target = this.tmp.set(x, hgt, y);
      const dir = target.clone().sub(cam);
      const len = dir.length();
      this.raycaster.set(cam, dir.normalize());
      this.raycaster.far = len - 0.4;
      for (const i of this.raycaster.intersectObjects(this.mapV.occluders, false)) hit.add(i.object);
    }
    this.raycaster.far = Infinity;
    this.mapV.setOccluding(hit);
  }

  private placeTags() {
    const w = innerWidth, hgt = innerHeight;
    for (const v of this.views.values()) {
      if (!v.tagVisible) continue;
      const p = this.tmp.copy(v.tagAnchor).project(this.camera);
      if (p.z > 1) { v.tag.style.display = 'none'; continue; }
      v.tag.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * hgt}px)`;
    }
  }

  private onEvents(events: GameEvent[]) {
    const { world, audio } = this.deps;
    const now = performance.now() / 1000;
    const pred = world.predictor;
    const listener = pred.state ? { x: pred.renderX, y: pred.renderY } : { x: this.camX, y: this.camY };
    audio.playEvents(events, { ...listener, yaw: forwardYaw(this.mode, this.lookYaw) }, world.settings);
    for (const e of events) {
      if (e.e === 'snd') {
        if (SOUND_DEFS[e.t].reveals) this.fx.ring(e.x, e.y, e.i, now);
        switch (e.t) {
          case 'water':
            this.fx.burst(e.s === 'crumbs' ? 'crumb' : 'splash', e.x, e.y, 6, { speed: 0.9, up: 2.2, life: 500, height: 0.05 });
            break;
          case 'cough':
            this.fx.pop('cloud', e.x, e.y, { scale: 1, life: 500, height: 0.6 });
            break;
          case 'dashMiss':
            this.fx.burst('dust', e.x, e.y, 12, { speed: 2.2, height: 0.15 });
            if (dist(e.x, e.y, listener.x, listener.y) < 12) this.shake = 0.25;
            break;
          case 'beacon':
            this.mapV.pulseBeacon();
            break;
          case 'capture':
            this.fx.burst('star', e.x, e.y, 10, { speed: 2.5, up: 3, spin: true, life: 800, height: 0.6 });
            break;
        }
      } else if (e.e === 'break' || e.e === 'hit') {
        if (e.k === 'bottle') this.fx.burst('shard', e.x, e.y, 9, { speed: 2, up: 2.5, spin: true, height: PROJ_HEIGHT });
        else if (e.k === 'ghostBottle') {
          this.fx.pop('ecto', e.x, e.y, { scale: 2.5, height: PROJ_HEIGHT });
          this.fx.burst('ecto', e.x, e.y, 6, { speed: 1.5, up: 1.5, height: PROJ_HEIGHT });
        } else this.fx.pop('flash', e.x, e.y, { scale: 2.5, life: 400, height: PROJ_HEIGHT });
        if (e.e === 'hit') audio.play('stun', 'body', { volume: 0.5 * Math.max(0, 1 - dist(e.x, e.y, listener.x, listener.y) / 25) });
      } else if (e.e === 'refilled') {
        audio.play('refill', 'world', { volume: 0.8 });
      }
    }
  }
}

/** Height of the low solid a jumper stands on (0 = floor). */
function lowTop(layout: Layout, x: number, y: number, r: number): number {
  const { map } = layout;
  let top = 0;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
      const i = ty * map.width + tx;
      if (layout.low[i] !== 1) continue;
      const nx = Math.max(tx, Math.min(x, tx + 1)), ny = Math.max(ty, Math.min(y, ty + 1));
      if ((x - nx) ** 2 + (y - ny) ** 2 >= r * r) continue;
      top = Math.max(top, map.tiles[i] === 'O' ? MUG_TOP[map.def.theme] : BOX_TOP);
    }
  }
  return top;
}

function makeProjectile(kind: 'ball' | 'bottle' | 'ghostBottle'): THREE.Object3D {
  if (kind === 'ball') {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), toon(0xff8f3c, { emissive: 0x4a1a00 }));
    ball.castShadow = true;
    addOutline(ball, 0.03);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 20), toon(0xffffff));
    g.add(ball, stripe);
    return g;
  }
  const mat = kind === 'bottle'
    ? toon(0x4fc36b, { emissive: 0x0c3318 })
    : toon(0x8dffb0, { transparent: true, opacity: 0.6, emissive: 0x1f7f3f });
  const pivot = new THREE.Group();
  const b = buildBottle(mat);
  b.position.y = -0.15;
  pivot.add(b);
  return pivot;
}
