import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS, MAP_IDS, POWER_KINDS, SETTING_CATEGORIES, SETTING_DEFS, VOLUME_GROUPS } from '@psst/shared';
import { PAD_LABELS } from '../input/gamepad';
import { ACTIONS } from '../input/keybinds';
import { localeTables, setLang, t } from './i18n';

const SRC = join(__dirname, '..');

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.ts$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => join(SRC, f));
}

describe('localization', () => {
  it('en and pt have exactly the same keys', () => {
    expect(Object.keys(localeTables.pt).sort()).toEqual(Object.keys(localeTables.en).sort());
  });

  it('no empty translations', () => {
    for (const table of Object.values(localeTables)) for (const [k, v] of Object.entries(table)) expect(v, k).not.toBe('');
  });

  it('every literal t("…") key used in the code exists', () => {
    const missing: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in localeTables.en)) missing.push(`${m[1]} (${file})`);
    }
    expect(missing).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    const keys = [
      ...SETTING_DEFS.map((d) => `setting.${d.key}`),
      ...SETTING_CATEGORIES.map((c) => `settingCategory.${c}`),
      ...VOLUME_GROUPS.map((g) => `settings.volume.${g}`),
      ...ACTIONS.map((a) => `action.${a}`),
      ...MAP_IDS.flatMap((m) => [`map.${m}.name`, `map.${m}.desc`]),
      ...['allCaught', 'timeUp', 'seekersLeft'].map((r) => `end.reason.${r}`),
      ...['seeker', 'hider', 'ghost'].flatMap((r) => [`role.${r}`, `hud.role.${r}`]),
      ...SETTING_DEFS.filter((d) => d.key === 'cameraMode').flatMap((d) => Array.from({ length: d.max - d.min + 1 }, (_, i) => `cameraMode.${d.min + i}`)),
      ...POWER_KINDS.flatMap((k) => [`power.${k}`, `power.${k}.desc`]),
      ...MAP_EVENT_KINDS.flatMap((k) => [`mapEvent.${k}`, `mapEvent.${k}.desc`]),
      ...['LS', ...Object.values(PAD_LABELS)].map((l) => `pad.${l}`),
    ];
    expect(keys.filter((k) => !(k in localeTables.en))).toEqual([]);
  });

  it('interpolates params and switches language', () => {
    setLang('pt');
    expect(t('hud.countdown', { n: 5 })).toBe('CONTAGEM: 5');
    setLang('en');
    expect(t('hud.countdown', { n: 5 })).toBe('COUNTDOWN: 5');
  });
});
