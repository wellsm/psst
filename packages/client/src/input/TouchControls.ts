import type { LifeState, Role } from '@psst/shared';
import { t } from '../i18n/i18n';
import { h } from '../ui/dom';
import type { Action } from './keybinds';
import type { InputState } from './InputState';

/** Joystick radius in CSS pixels (full tilt). */
const STICK_RADIUS = 56;
/** Touch drag → mouse pixels (a finger travels less than a mouse for the same turn). */
const TOUCH_LOOK_SCALE = 1.6;

export interface TouchContext {
  role: Role;
  life: LifeState;
  hunt: boolean;
  power: boolean;
  nearCrate: boolean;
}

/** True on phones/tablets; laptops with touch screens switch on at their first touch. */
export function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Phones play in landscape only: fullscreen + orientation lock where the browser allows it (Android Chrome).
 * Must run inside a user gesture. iOS Safari has no lock API; the portrait "rotate" screen covers it.
 */
export function lockLandscape(): void {
  const root = document.documentElement;
  if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return;
  // `lock` is not in lib.dom (missing on desktop Safari/Firefox).
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };
  root.requestFullscreen({ navigationUI: 'hide' }).then(() => orientation.lock?.('landscape')).catch(() => undefined);
}

/**
 * On-screen controls: floating joystick on the left half, drag anywhere else to turn the camera / move the aim,
 * buttons on the right. Feeds InputState as the 'touch' virtual source.
 */
export class TouchControls {
  readonly el: HTMLElement;
  private held = new Set<Action>();
  private runOn = false;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private move = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private base: HTMLElement;
  private knob: HTMLElement;
  private runBtn: HTMLElement;
  onPause: (() => void) | null = null;

  constructor(private input: InputState) {
    this.knob = h('div.knob');
    this.base = h('div.stick-base', null, this.knob);
    const stickZone = h('div.touch-stick', null, this.base);
    const lookZone = h('div.touch-look');
    this.runBtn = this.toggle('run', t('touch.run'));
    const pause = h('button.tb.pause', { 'aria-label': t('touch.pause') }, 'II');
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause?.(); });
    this.el = h('div.touch', null,
      lookZone, stickZone, pause,
      h('div.touch-btns', null,
        this.hold('fire', t('touch.fire'), 'big'),
        this.hold('dash', t('touch.dash'), 'big seeker-only'),
        this.hold('jump', t('touch.jump')),
        this.hold('taunt', t('touch.taunt'), 'hider-only'),
        this.hold('refill', t('touch.refill'), 'hider-only refill'),
        this.hold('usePower', t('touch.power'), 'power'),
        this.runBtn,
        this.hold('pushToTalk', t('touch.talk'), 'talk'),
      ),
    );
    // Cancel the emulated mouse events (they would fire / lock the pointer) and page scroll/zoom.
    this.el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.base.classList.add('on');
      this.updateStick(e.clientX, e.clientY);
    });
    stickZone.addEventListener('pointermove', (e) => e.pointerId === this.stickId && this.updateStick(e.clientX, e.clientY));
    const stickUp = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.updateStick(this.stickOrigin.x, this.stickOrigin.y);
      this.restStick();
    };
    stickZone.addEventListener('pointerup', stickUp);
    addEventListener('resize', () => this.stickId === null && this.restStick());
    this.restStick();
    stickZone.addEventListener('pointercancel', stickUp);

    lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addLook((e.clientX - this.lookLast.x) * TOUCH_LOOK_SCALE, (e.clientY - this.lookLast.y) * TOUCH_LOOK_SCALE);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const lookUp = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    lookZone.addEventListener('pointerup', lookUp);
    lookZone.addEventListener('pointercancel', lookUp);
  }

  private hold(a: Action, label: string, cls = '') {
    const b = h('button.tb', { class: cls, 'data-a': a }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      this.held.add(a);
      this.sync();
    });
    const up = () => {
      b.classList.remove('down');
      this.held.delete(a);
      this.sync();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  /** Run is a toggle: the left thumb is on the stick and the right one aims. */
  private toggle(a: Action, label: string) {
    const b = h('button.tb', { 'data-a': a }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.runOn = !this.runOn;
      b.classList.toggle('down', this.runOn);
      this.sync();
    });
    return b;
  }

  /** Faded joystick at its resting spot shows where to put the thumb. */
  private restStick() {
    this.base.classList.remove('on');
    this.base.style.transform = `translate(${96}px, ${innerHeight - 110}px)`;
  }

  private updateStick(x: number, y: number) {
    let dx = (x - this.stickOrigin.x) / STICK_RADIUS, dy = (y - this.stickOrigin.y) / STICK_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.move = { x: dx, y: dy };
    this.knob.style.transform = `translate(${dx * STICK_RADIUS}px, ${dy * STICK_RADIUS}px)`;
    this.sync();
  }

  /** Push the current state to InputState (also called on every touch so sub-frame taps register). */
  sync() {
    const actions = new Set(this.held);
    if (this.runOn) actions.add('run');
    this.input.setVirtual('touch', actions, this.move.x, this.move.y);
  }

  /** Show only the buttons that make sense right now. */
  setContext(c: TouchContext) {
    const d = this.el.dataset;
    d.role = c.life === 'ghost' ? 'ghost' : c.role;
    d.life = c.life;
    d.hunt = String(c.hunt);
    d.power = String(c.power);
    d.crate = String(c.nearCrate);
  }

  /** Drop everything held (screen change, pause). */
  reset() {
    this.held.clear();
    this.runOn = false;
    this.runBtn.classList.remove('down');
    this.stickId = this.lookId = null;
    this.move = { x: 0, y: 0 };
    this.knob.style.transform = '';
    this.restStick();
    for (const b of this.el.querySelectorAll('.tb.down')) b.classList.remove('down');
    this.sync();
  }
}
