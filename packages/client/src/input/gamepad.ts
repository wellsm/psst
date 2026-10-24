import type { Action } from './keybinds';
import type { InputState } from './InputState';

// Gamepads use the browser "standard" layout (Xbox names): fixed mapping, no rebinding.
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/** Buttons per action (any of them holds the action). Movement and camera are the sticks. */
export const PAD_BINDS: Partial<Record<Action, readonly number[]>> = {
  fire: [PAD.RT],
  dash: [PAD.LT],
  jump: [PAD.B],
  run: [PAD.LB, PAD.L3],
  taunt: [PAD.RB],
  refill: [PAD.X],
  usePower: [PAD.Y],
  pushToTalk: [PAD.BACK],
  pause: [PAD.START],
};

/** Short label of a pad button for the controls screen (Xbox names are the de facto standard). */
export const PAD_LABELS: Record<number, string> = {
  [PAD.A]: 'A', [PAD.B]: 'B', [PAD.X]: 'X', [PAD.Y]: 'Y', [PAD.LB]: 'LB', [PAD.RB]: 'RB', [PAD.LT]: 'LT', [PAD.RT]: 'RT',
  [PAD.BACK]: 'Back', [PAD.START]: 'Start', [PAD.L3]: 'L3', [PAD.R3]: 'R3',
};

export const STICK_DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.4;
/** Mouse pixels per second of camera turn at full right-stick tilt. */
export const PAD_LOOK_SPEED = 1100;

/** The subset of the Gamepad API we read (lets tests pass plain objects). */
export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadFrame {
  move: { x: number; y: number };
  look: { x: number; y: number };
  actions: Set<Action>;
  /** Raw held buttons, for menu navigation edges. */
  held: Set<number>;
}

/** Radial deadzone, rescaled so movement starts at 0 just past the deadzone; magnitude capped at 1. */
export function stick(x: number, y: number, dz = STICK_DEADZONE): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len <= dz) return { x: 0, y: 0 };
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  return { x: x * k, y: y * k };
}

export function isHeld(pad: PadLike, i: number): boolean {
  const b = pad.buttons[i];
  if (!b) return false;
  return i === PAD.LT || i === PAD.RT ? b.value > TRIGGER_THRESHOLD || b.pressed : b.pressed;
}

export function actionsOf(held: ReadonlySet<number>): Set<Action> {
  const actions = new Set<Action>();
  for (const [a, btns] of Object.entries(PAD_BINDS) as [Action, readonly number[]][]) if (btns.some((b) => held.has(b))) actions.add(a);
  return actions;
}

export function readPad(pad: PadLike): PadFrame {
  const held = new Set<number>();
  for (let i = 0; i < pad.buttons.length; i++) if (isHeld(pad, i)) held.add(i);
  const actions = actionsOf(held);
  const move = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
  const r = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  // Squared response: fine aim near the center, full speed at the edge.
  const rl = Math.hypot(r.x, r.y);
  const look = { x: r.x * rl, y: r.y * rl };
  return { move, look, actions, held };
}

/** Menu direction from the D-pad or the left stick (pushed past half). */
export function menuDir(f: PadFrame): 'up' | 'down' | 'left' | 'right' | null {
  if (f.held.has(PAD.UP) || f.move.y < -0.5) return 'up';
  if (f.held.has(PAD.DOWN) || f.move.y > 0.5) return 'down';
  if (f.held.has(PAD.LEFT) || f.move.x < -0.5) return 'left';
  if (f.held.has(PAD.RIGHT) || f.move.x > 0.5) return 'right';
  return null;
}

const REPEAT_DELAY = 0.4;
const REPEAT_RATE = 0.12;

/**
 * Polls every connected pad once per frame. In game it feeds InputState; in menus (input disabled)
 * it moves focus between buttons/inputs, A clicks, B goes back, Start toggles pause.
 */
export class GamepadInput {
  private prevHeld = new Set<number>();
  /** Buttons still held from a menu (e.g. B that closed the pause): ignored in game until released. */
  private blocked = new Set<number>();
  private wasEnabled = false;
  private dir: ReturnType<typeof menuDir> = null;
  private repeatIn = 0;
  onBack: (() => void) | null = null;
  /** Any button or stick in use (the pad becomes the device named in hints). */
  onActivity: (() => void) | null = null;

  constructor(private input: InputState, private root: HTMLElement) {}

  poll(dt: number) {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let f: PadFrame | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const r = readPad(p);
      if (!f) { f = r; continue; }
      // Several pads: merge buttons, keep the strongest stick.
      for (const a of r.actions) f.actions.add(a);
      for (const b of r.held) f.held.add(b);
      if (Math.hypot(r.move.x, r.move.y) > Math.hypot(f.move.x, f.move.y)) f.move = r.move;
      if (Math.hypot(r.look.x, r.look.y) > Math.hypot(f.look.x, f.look.y)) f.look = r.look;
    }
    if (!f) {
      this.input.setVirtual('pad', new Set());
      this.prevHeld.clear();
      return;
    }
    const pressed = (b: number) => f.held.has(b) && !this.prevHeld.has(b);
    if (f.held.size || f.move.x || f.move.y || f.look.x || f.look.y) this.onActivity?.();
    // Start is the pause key everywhere (open, resume, leave settings).
    if (pressed(PAD.START)) this.input.onPauseKey?.();
    if (this.input.enabled && !this.wasEnabled) this.blocked = new Set(f.held);
    for (const b of this.blocked) if (!f.held.has(b)) this.blocked.delete(b);
    this.wasEnabled = this.input.enabled;
    if (this.input.enabled) {
      const actions = this.blocked.size ? actionsOf(new Set([...f.held].filter((b) => !this.blocked.has(b)))) : f.actions;
      actions.delete('pause');
      this.input.setVirtual('pad', actions, f.move.x, f.move.y);
      this.input.addLook(f.look.x * PAD_LOOK_SPEED * dt, f.look.y * PAD_LOOK_SPEED * dt);
    } else {
      this.input.setVirtual('pad', new Set());
      this.menu(f, pressed, dt);
    }
    this.prevHeld = f.held;
  }

  private menu(f: PadFrame, pressed: (b: number) => boolean, dt: number) {
    const d = menuDir(f);
    let step = false;
    if (d !== this.dir) {
      this.dir = d;
      this.repeatIn = REPEAT_DELAY;
      step = d !== null;
    } else if (d) {
      this.repeatIn -= dt;
      if (this.repeatIn <= 0) { this.repeatIn = REPEAT_RATE; step = true; }
    }
    if (step && d) this.moveFocus(d);
    const el = document.activeElement;
    if (pressed(PAD.A) && el instanceof HTMLElement && this.root.contains(el)) el.click();
    if (pressed(PAD.B)) this.onBack?.();
  }

  private focusables(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('button, input, select, a[href]')]
      .filter((e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null);
  }

  private moveFocus(d: 'up' | 'down' | 'left' | 'right') {
    const el = document.activeElement;
    document.body.classList.add('pad-nav');
    // Sliders and dropdowns take left/right.
    if (el instanceof HTMLInputElement && el.type === 'range' && (d === 'left' || d === 'right')) {
      if (d === 'left') el.stepDown(); else el.stepUp();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el instanceof HTMLSelectElement && (d === 'left' || d === 'right')) {
      el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + (d === 'left' ? -1 : 1)));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const all = this.focusables();
    if (!all.length) return;
    const cur = el instanceof HTMLElement ? all.indexOf(el) : -1;
    const next = cur < 0 ? 0 : (cur + (d === 'up' || d === 'left' ? -1 : 1) + all.length) % all.length;
    all[next].focus();
    all[next].scrollIntoView({ block: 'nearest' });
  }
}
