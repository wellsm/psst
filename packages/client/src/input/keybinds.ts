// Every action has exactly one binding and no two actions share one.
export const ACTIONS = [
  'moveUp', 'moveDown', 'moveLeft', 'moveRight', 'run', 'jump', 'fire', 'dash',
  'taunt', 'refill', 'usePower', 'pushToTalk', 'pause',
] as const;

export type Action = (typeof ACTIONS)[number];
/** KeyboardEvent.code values, or 'Mouse0' / 'Mouse1' / 'Mouse2' for mouse buttons. */
export type Binds = Record<Action, string>;

export const DEFAULT_BINDS: Binds = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
  fire: 'Mouse0',
  dash: 'Mouse2',
  taunt: 'KeyT',
  refill: 'KeyE',
  usePower: 'KeyF',
  pushToTalk: 'KeyV',
  pause: 'Escape',
};

/** Bind `code` to `action`; if another action used it, that action takes the old binding (swap). */
export function rebind(binds: Binds, action: Action, code: string): { binds: Binds; swapped: Action | null } {
  const next = { ...binds };
  const other = (Object.keys(next) as Action[]).find((a) => a !== action && next[a] === code) ?? null;
  if (other) next[other] = binds[action];
  next[action] = code;
  return { binds: next, swapped: other };
}

export function hasConflicts(binds: Binds): boolean {
  const codes = Object.values(binds);
  return new Set(codes).size !== codes.length;
}

/** Repair stored binds: unknown/missing actions fall back to defaults, duplicates are resolved. */
export function normalizeBinds(raw: unknown): Binds {
  let binds: Binds = { ...DEFAULT_BINDS };
  if (raw && typeof raw === 'object') {
    const stored = raw as Record<string, unknown>;
    for (const a of ACTIONS) {
      const v = stored[a];
      if (typeof v === 'string' && v) binds = rebind(binds, a, v).binds;
    }
  }
  return hasConflicts(binds) ? { ...DEFAULT_BINDS } : binds;
}

/** Short label for a code ("KeyW" → "W", "Digit1" → "1"); localized names come from i18n `key.<code>`. */
export function codeLabel(code: string, translate: (k: string) => string): string {
  const k = `key.${code}`;
  const tr = translate(k);
  if (tr !== k) return tr;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return code;
}
