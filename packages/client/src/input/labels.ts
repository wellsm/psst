import { t } from '../i18n/i18n';
import { prefs } from '../prefs';
import { PAD_BINDS, PAD_LABELS } from './gamepad';
import { codeLabel, type Action } from './keybinds';

/** The device the player used last: on-screen hints name its button, not a keyboard key. */
export type InputDevice = 'keyboard' | 'pad' | 'touch';

const TOUCH_LABEL: Partial<Record<Action, string>> = {
  fire: 'touch.fire', dash: 'touch.dash', jump: 'touch.jump', run: 'touch.run', taunt: 'touch.taunt',
  refill: 'touch.refill', usePower: 'touch.power', pushToTalk: 'touch.talk', pause: 'touch.pause',
};

let device: InputDevice = 'keyboard';

export function inputDevice(): InputDevice {
  return device;
}

export function setInputDevice(d: InputDevice) {
  device = d;
}

/** What to press for `a` on the current device ("Space", "B", "JUMP"). */
export function actionLabel(a: Action): string {
  const pad = PAD_BINDS[a]?.[0];
  if (device === 'pad' && pad !== undefined) return t(`pad.${PAD_LABELS[pad]}`);
  const touch = TOUCH_LABEL[a];
  if (device === 'touch' && touch) return t(touch);
  return codeLabel(prefs.binds[a], t);
}
