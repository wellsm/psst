import { COUGH_VARIANTS, NAME_MAX, VOLUME_GROUPS, type VolumeGroup } from '@psst/shared';
import { detectLang, type Lang } from './i18n/i18n';
import { normalizeBinds, type Binds } from './input/keybinds';

// Per-viewer conveniences stored in localStorage (may be unavailable: always fall back to defaults).
export interface Prefs {
  name: string;
  lang: Lang;
  volumes: Record<VolumeGroup, number>;
  binds: Binds;
  voiceMode: 'open' | 'ptt';
  micId: string;
  outputId: string;
  sensitivity: number;
  coughVariant: number;
  /** "I want to be the seeker" — re-sent on every join so a reload never flips it back on. */
  seekerOptIn: boolean;
}

const KEY = 'psst.prefs.v1';

function defaults(): Prefs {
  const volumes = {} as Record<VolumeGroup, number>;
  for (const g of VOLUME_GROUPS) volumes[g] = g === 'music' ? 0.5 : 0.8;
  return {
    name: '',
    lang: detectLang(),
    volumes,
    binds: normalizeBinds(null),
    voiceMode: 'open',
    micId: '',
    outputId: '',
    sensitivity: 1,
    coughVariant: Math.floor(Math.random() * COUGH_VARIANTS),
    seekerOptIn: true,
  };
}

function load(): Prefs {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return d;
    const vol = { ...d.volumes };
    for (const g of VOLUME_GROUPS) {
      const v = raw.volumes?.[g];
      if (typeof v === 'number' && v >= 0 && v <= 1) vol[g] = v;
    }
    const int = (v: unknown, max: number, fb: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : fb);
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) : d.name,
      lang: raw.lang === 'pt' || raw.lang === 'en' ? raw.lang : d.lang,
      volumes: vol,
      binds: normalizeBinds(raw.binds),
      voiceMode: raw.voiceMode === 'ptt' ? 'ptt' : 'open',
      micId: typeof raw.micId === 'string' ? raw.micId : '',
      outputId: typeof raw.outputId === 'string' ? raw.outputId : '',
      sensitivity: typeof raw.sensitivity === 'number' && raw.sensitivity >= 0.2 && raw.sensitivity <= 3 ? raw.sensitivity : 1,
      coughVariant: int(raw.coughVariant, COUGH_VARIANTS, d.coughVariant),
      seekerOptIn: raw.seekerOptIn !== false,
    };
  } catch {
    return d;
  }
}

export const prefs: Prefs = load();

const listeners = new Set<() => void>();
export function onPrefsChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function savePrefs(patch: Partial<Prefs> = {}) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private mode): keep in memory only.
  }
  for (const l of listeners) l();
}
