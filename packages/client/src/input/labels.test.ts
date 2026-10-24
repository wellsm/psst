import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../i18n/i18n';
import { prefs } from '../prefs';
import { codeLabel } from './keybinds';
import { actionLabel, setInputDevice } from './labels';

describe('device-aware hints', () => {
  afterEach(() => setInputDevice('keyboard'));

  it('names the key, the pad button or the touch button of the device in use', () => {
    setLang('en');
    expect(actionLabel('taunt')).toBe(codeLabel(prefs.binds.taunt, t));
    setInputDevice('pad');
    expect(actionLabel('taunt')).toBe('RB');
    expect(actionLabel('usePower')).toBe('Y');
    setInputDevice('touch');
    expect(actionLabel('taunt')).toBe(t('touch.taunt'));
    expect(actionLabel('usePower')).toBe(t('touch.power'));
  });
});
