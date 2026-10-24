import { moveCircle } from './collision';
import { clamp } from './math';
import { onLowSolid, type Layout } from './maps';
import type { MatchSettings } from './settings';
import type { LifeState, Role } from './visibility';

/** Fixed input step. Clients sample input at this rate; the server consumes one input per step. */
export const INPUT_DT = 1 / 30;

/** Jump tuning. Fixed in code on purpose: not a lobby rule. */
export const JUMP = {
  duration: 0.5,
  height: 0.6,
  /** Starts on landing. */
  cooldown: 0.4,
  /** Super jump (power active at takeoff, or taking off from a low solid): no cooldown, passes over low solids. */
  superDuration: 0.8,
  superHeight: 1.5,
  /** Above this height a dash goes under the jumper. */
  dodgeHeight: 0.25,
  landIntensity: 0.7,
} as const;

export interface MoveInput {
  seq: number;
  /** Desired move direction, components in [-1, 1]. */
  mx: number;
  my: number;
  run: boolean;
  /** Aim point in world meters. */
  ax: number;
  ay: number;
  /** Start a dash this step (seeker only). */
  dash: boolean;
  /** Start a jump this step. */
  jump: boolean;
}

/** Everything the shared step needs; server and client prediction hold identical copies. */
export interface MoveState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  stamina: number;
  exhausted: boolean;
  stunLeft: number;
  dashLeft: number;
  dashDx: number;
  dashDy: number;
  dashCdLeft: number;
  running: boolean;
  /** Movement power-ups, seconds left (predicted like everything else here). */
  speedLeft: number;
  turboLeft: number;
  jumpLeft: number;
  /** Seconds left in the air (0 = on the ground). */
  airLeft: number;
  /** The current jump is a super jump (see `JUMP`). */
  airSuper: boolean;
  /** Standing on top of a low solid (after a super jump or a pounce) until walking off it. */
  perched: boolean;
  jumpCdLeft: number;
  /** The current dash started in the air (a pounce): it passes over low solids. */
  dashAir: boolean;
}

export interface MoveContext {
  role: Role;
  life: LifeState;
  settings: MatchSettings;
  layout: Layout;
  /** Movement allowed this phase (seekers are frozen during the countdown). */
  canMove: boolean;
}

export interface MoveEvents {
  dashStarted: boolean;
  dashEnded: boolean;
  jumpStarted: boolean;
  /** Touched down (end of a jump, or stepped off a low solid). */
  landed: boolean;
}

export function newMoveState(x: number, y: number, settings: MatchSettings): MoveState {
  return {
    x, y, vx: 0, vy: 0, angle: 0,
    stamina: settings.seekerStamina, exhausted: false,
    stunLeft: 0, dashLeft: 0, dashDx: 0, dashDy: 0, dashCdLeft: 0, running: false,
    speedLeft: 0, turboLeft: 0, jumpLeft: 0,
    airLeft: 0, airSuper: false, perched: false, jumpCdLeft: 0, dashAir: false,
  };
}

export function cloneMove(s: MoveState): MoveState {
  return { ...s };
}

/** Height above the ground, or above the low solid a perched player stands on. */
export function jumpHeight(s: Pick<MoveState, 'airLeft' | 'airSuper'>): number {
  if (s.airLeft <= 0) return 0;
  const d = s.airSuper ? JUMP.superDuration : JUMP.duration;
  const u = clamp(1 - s.airLeft / d, 0, 1);
  return 4 * (s.airSuper ? JUMP.superHeight : JUMP.height) * u * (1 - u);
}

/** High enough for a dash to pass under. */
export const isAirborne = (s: Pick<MoveState, 'airLeft' | 'airSuper'>) => jumpHeight(s) > JUMP.dodgeHeight;

/** Low solids do not block: super jumps, pounces, and standing on top of one. */
function passesLow(s: MoveState): boolean {
  return s.perched || (s.airLeft > 0 && (s.airSuper || s.dashAir)) || (s.dashLeft > 0 && s.dashAir);
}

function resetAir(s: MoveState) {
  s.airLeft = 0; s.airSuper = false; s.perched = false; s.dashAir = false;
}

function land(s: MoveState, ctx: MoveContext, r: number, ev: MoveEvents) {
  // Only a jump allowed over low solids can come down overlapping one: it lands on top.
  s.perched = onLowSolid(ctx.layout, s.x, s.y, r);
  s.jumpCdLeft = s.airSuper ? 0 : JUMP.cooldown;
  s.airSuper = false;
  // A pounce still dashing keeps passing over low solids until the dash ends.
  s.dashAir = s.dashAir && s.dashLeft > 0;
  ev.landed = true;
}

/** Advance one fixed step. Pure aside from mutating `s`. */
export function stepMove(s: MoveState, input: MoveInput, dt: number, ctx: MoveContext): MoveEvents {
  const st = ctx.settings;
  const ev: MoveEvents = { dashStarted: false, dashEnded: false, jumpStarted: false, landed: false };
  const r = st.playerRadius;

  const aimDx = input.ax - s.x, aimDy = input.ay - s.y;
  if (Math.abs(aimDx) + Math.abs(aimDy) > 1e-4 && ctx.life !== 'caught') s.angle = Math.atan2(aimDy, aimDx);

  s.dashCdLeft = Math.max(0, s.dashCdLeft - dt);
  s.speedLeft = Math.max(0, s.speedLeft - dt);
  s.turboLeft = Math.max(0, s.turboLeft - dt);
  s.jumpLeft = Math.max(0, s.jumpLeft - dt);
  s.jumpCdLeft = Math.max(0, s.jumpCdLeft - dt);

  if (ctx.life === 'caught') {
    s.vx = 0; s.vy = 0; s.running = false;
    resetAir(s);
    return ev;
  }

  if (ctx.life === 'ghost') {
    resetAir(s);
    const len = Math.hypot(input.mx, input.my);
    const nx = len > 1 ? input.mx / len : input.mx, ny = len > 1 ? input.my / len : input.my;
    const speed = st.ghostSpeed * (input.run ? st.ghostBoostMultiplier : 1);
    s.vx = nx * speed; s.vy = ny * speed;
    const b = ctx.layout.map.ghostBounds;
    s.x = clamp(s.x + s.vx * dt, b.x0, b.x1);
    s.y = clamp(s.y + s.vy * dt, b.y0, b.y1);
    s.running = input.run && len > 0.01;
    s.stunLeft = Math.max(0, s.stunLeft - dt);
    return ev;
  }

  // Air time runs whatever else happens (stun, dash).
  if (s.airLeft > 0) {
    s.airLeft -= dt;
    if (s.airLeft <= 1e-9) {
      s.airLeft = 0;
      land(s, ctx, r, ev);
    }
  } else if (s.perched && !onLowSolid(ctx.layout, s.x, s.y, r)) {
    s.perched = false;
    ev.landed = true;
  }

  // Stun: no control, glide to a stop.
  if (s.stunLeft > 0) {
    s.stunLeft = Math.max(0, s.stunLeft - dt);
    s.dashLeft = 0;
    s.vx = 0; s.vy = 0; s.running = false;
    regenStamina(s, dt, st, ctx.role);
    return ev;
  }

  if (!ctx.canMove) {
    s.vx = 0; s.vy = 0; s.running = false;
    return ev;
  }

  // Jump start. Taking off from a low solid is a super jump, so it can come back down on top.
  if (input.jump && s.airLeft <= 0 && s.jumpCdLeft <= 0 && s.dashLeft <= 0) {
    s.airSuper = s.jumpLeft > 0 || s.perched;
    s.airLeft = s.airSuper ? JUMP.superDuration : JUMP.duration;
    s.perched = false;
    s.dashAir = false;
    ev.jumpStarted = true;
  }

  // Dash start (seeker only).
  if (input.dash && ctx.role === 'seeker' && s.dashLeft <= 0 && s.dashCdLeft <= 0) {
    const len = Math.hypot(aimDx, aimDy);
    s.dashDx = len > 1e-4 ? aimDx / len : Math.cos(s.angle);
    s.dashDy = len > 1e-4 ? aimDy / len : Math.sin(s.angle);
    s.dashLeft = st.dashDuration;
    s.dashCdLeft = st.dashCooldown;
    s.dashAir = s.airLeft > 0;
    ev.dashStarted = true;
  }

  if (s.dashLeft > 0) {
    const step = Math.min(dt, s.dashLeft);
    const turbo = s.turboLeft > 0;
    const speed = (st.dashDistance * (turbo ? st.powerTurboDashMultiplier : 1)) / st.dashDuration;
    const p = moveCircle(ctx.layout, s.x, s.y, s.dashDx * speed * step, s.dashDy * speed * step, r, passesLow(s));
    s.x = p.x; s.y = p.y;
    s.vx = s.dashDx * speed; s.vy = s.dashDy * speed;
    s.dashLeft -= step;
    s.running = false;
    if (s.dashLeft <= 1e-9) {
      s.dashLeft = 0;
      s.vx = 0; s.vy = 0;
      // A dash that ends without the server cancelling it (capture) is a miss. Turbo dashes never stun.
      s.stunLeft = turbo ? 0 : st.dashMissStun;
      ev.dashEnded = true;
      // A pounce that ends on the ground over a low solid stands on top of it.
      if (s.dashAir && s.airLeft <= 0) {
        s.perched = onLowSolid(ctx.layout, s.x, s.y, r);
        s.dashAir = false;
      }
    }
    return ev;
  }

  const len = Math.hypot(input.mx, input.my);
  const nx = len > 1 ? input.mx / len : input.mx, ny = len > 1 ? input.my / len : input.my;
  const moving = len > 0.01;
  const infinite = st.seekerStamina <= 0;
  const wantsRun = input.run && moving;
  let running = wantsRun;
  if (ctx.role === 'seeker' && !infinite) {
    if (s.exhausted || s.stamina <= 0) running = false;
  }
  const speed = (running ? st.runSpeed : st.walkSpeed) * (s.speedLeft > 0 ? st.powerSpeedMultiplier : 1);
  const tvx = nx * speed, tvy = ny * speed;
  const k = 1 - Math.exp(-dt / Math.max(1e-3, st.accelTime));
  s.vx += (tvx - s.vx) * k;
  s.vy += (tvy - s.vy) * k;
  const p = moveCircle(ctx.layout, s.x, s.y, s.vx * dt, s.vy * dt, r, passesLow(s));
  // Kill velocity into walls so we do not keep pushing.
  if (dt > 0) { s.vx = (p.x - s.x) / dt; s.vy = (p.y - s.y) / dt; }
  s.x = p.x; s.y = p.y;
  s.running = running;

  if (ctx.role === 'seeker' && !infinite) {
    if (running) {
      s.stamina = Math.max(0, s.stamina - dt);
      if (s.stamina <= 0) s.exhausted = true;
    } else {
      regenStamina(s, dt, st, ctx.role);
    }
  }
  return ev;
}

function regenStamina(s: MoveState, dt: number, st: MatchSettings, role: Role) {
  if (role !== 'seeker' || st.seekerStamina <= 0) return;
  s.stamina = Math.min(st.seekerStamina, s.stamina + dt);
  if (s.exhausted && s.stamina >= st.seekerStamina * st.staminaRecoverThreshold) s.exhausted = false;
}
