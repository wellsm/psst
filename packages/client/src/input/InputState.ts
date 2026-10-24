import { prefs } from '../prefs';
import type { Action } from './keybinds';

/** Non-keyboard devices that feed held actions and an analog move vector. */
export type VirtualSource = 'pad' | 'touch';

/** Keyboard + mouse state mapped through the user's bindings, plus gamepad/touch as virtual sources. */
export class InputState {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Cursor in CSS pixels relative to the game element. */
  cursorX = 0;
  cursorY = 0;
  locked = false;
  enabled = false;
  /** Raw mouse motion since the last `consumeLook` (mouse-look cameras), scaled by sensitivity. */
  private lookX = 0;
  private lookY = 0;
  private captureFn: ((code: string) => void) | null = null;
  private virtual = new Map<VirtualSource, { actions: ReadonlySet<Action>; mx: number; my: number }>();
  private vDown = new Set<Action>();
  private vPressed = new Set<Action>();
  private vReleased = new Set<Action>();
  private el: HTMLElement;
  onPauseKey: (() => void) | null = null;
  onLockLost: (() => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.cursorX = innerWidth / 2;
    this.cursorY = innerHeight / 2;
    addEventListener('keydown', (e) => this.onDown(e.code, e));
    addEventListener('keyup', (e) => this.onUp(e.code));
    addEventListener('mousedown', (e) => {
      if (this.captureFn) {
        e.preventDefault();
        this.onDown(`Mouse${e.button}`, e);
        return;
      }
      // While locked, events target the locked element (#game), not the canvas.
      const onGame = this.locked || (e.target instanceof Node && this.el.contains(e.target));
      if (!this.enabled || !onGame) return;
      if (!this.locked) {
        // Lock the pointer so sensitivity applies; the click itself still counts.
        try {
          void Promise.resolve(this.el.requestPointerLock?.()).catch(() => undefined);
        } catch {
          // Pointer lock unavailable: keep playing with the absolute cursor.
        }
      }
      this.onDown(`Mouse${e.button}`, e);
    });
    addEventListener('mouseup', (e) => this.onUp(`Mouse${e.button}`));
    addEventListener('mousemove', (e) => {
      if (this.enabled) {
        this.lookX += e.movementX * prefs.sensitivity;
        this.lookY += e.movementY * prefs.sensitivity;
      }
      if (this.locked) {
        this.cursorX = Math.max(0, Math.min(innerWidth, this.cursorX + e.movementX * prefs.sensitivity));
        this.cursorY = Math.max(0, Math.min(innerHeight, this.cursorY + e.movementY * prefs.sensitivity));
      } else {
        this.cursorX = e.clientX;
        this.cursorY = e.clientY;
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (wasLocked && !this.locked) {
        this.releaseAll();
        this.onLockLost?.();
      }
    });
    addEventListener('blur', () => this.releaseAll());
  }

  private typing(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  private onDown(code: string, e: Event) {
    if (this.captureFn) {
      e.preventDefault();
      const fn = this.captureFn;
      this.captureFn = null;
      fn(code);
      return;
    }
    if (code === prefs.binds.pause && !(e as KeyboardEvent).repeat) {
      this.onPauseKey?.();
      return;
    }
    if (!this.enabled || this.typing(e)) return;
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    if (code === 'Space' || code === 'Tab') e.preventDefault();
  }

  private onUp(code: string) {
    if (this.down.delete(code)) this.released.add(code);
  }

  releaseAll() {
    for (const c of this.down) this.released.add(c);
    this.down.clear();
    for (const a of this.vDown) this.vReleased.add(a);
    this.vDown.clear();
    this.virtual.clear();
  }

  /** Held actions and analog move (-1..1, y down = backward) of one virtual source; ignored while disabled. */
  setVirtual(source: VirtualSource, actions: ReadonlySet<Action>, mx = 0, my = 0) {
    if (!this.enabled) actions = new Set();
    this.virtual.set(source, { actions, mx: this.enabled ? mx : 0, my: this.enabled ? my : 0 });
    const next = new Set<Action>();
    for (const v of this.virtual.values()) for (const a of v.actions) next.add(a);
    for (const a of next) if (!this.vDown.has(a)) this.vPressed.add(a);
    for (const a of this.vDown) if (!next.has(a)) this.vReleased.add(a);
    this.vDown = next;
  }

  /** Camera/aim motion from a virtual source, in mouse pixels (sensitivity applied here). */
  addLook(dx: number, dy: number) {
    if (!this.enabled) return;
    this.lookX += dx * prefs.sensitivity;
    this.lookY += dy * prefs.sensitivity;
    this.cursorX = Math.max(0, Math.min(innerWidth, this.cursorX + dx * prefs.sensitivity));
    this.cursorY = Math.max(0, Math.min(innerHeight, this.cursorY + dy * prefs.sensitivity));
  }

  /** View-relative move: the strongest analog source when tilted (magnitude kept), else WASD. */
  moveVector(): { x: number; y: number } {
    let best = { x: 0, y: 0 }, len = 0;
    for (const v of this.virtual.values()) {
      const l = Math.hypot(v.mx, v.my);
      if (l > len) { len = l; best = { x: v.mx, y: v.my }; }
    }
    if (len > 0) return best;
    return {
      x: (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0),
      y: (this.isDown('moveDown') ? 1 : 0) - (this.isDown('moveUp') ? 1 : 0),
    };
  }

  /** Next key or mouse button is delivered to `fn` instead of the game (rebinding). */
  capture(fn: ((code: string) => void) | null) {
    this.captureFn = fn;
  }

  isDown(a: Action) {
    return this.down.has(prefs.binds[a]) || this.vDown.has(a);
  }

  consumePressed(a: Action) {
    const k = this.pressed.delete(prefs.binds[a]);
    return this.vPressed.delete(a) || k;
  }

  consumeReleased(a: Action) {
    const k = this.released.delete(prefs.binds[a]);
    return this.vReleased.delete(a) || k;
  }

  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Clear edge events at the end of a frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.vPressed.clear();
    this.vReleased.clear();
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
