import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDS, hasConflicts, normalizeBinds, rebind } from './keybinds';

describe('key bindings', () => {
  it('defaults match the briefing and have no conflicts', () => {
    expect(DEFAULT_BINDS).toMatchObject({ moveUp: 'KeyW', run: 'ShiftLeft', fire: 'Mouse0', dash: 'Mouse2', jump: 'Space', taunt: 'KeyT', refill: 'KeyE', pushToTalk: 'KeyV', pause: 'Escape' });
    expect(hasConflicts(DEFAULT_BINDS)).toBe(false);
    expect(Object.keys(DEFAULT_BINDS).sort()).toEqual([...ACTIONS].sort());
  });

  it('rebinding to a used key swaps, never duplicates', () => {
    const { binds, swapped } = rebind(DEFAULT_BINDS, 'taunt', 'KeyE');
    expect(binds.taunt).toBe('KeyE');
    expect(binds.refill).toBe('KeyT');
    expect(swapped).toBe('refill');
    expect(hasConflicts(binds)).toBe(false);
  });

  it('rebinding to a free key changes only that action', () => {
    const { binds, swapped } = rebind(DEFAULT_BINDS, 'taunt', 'KeyG');
    expect(binds.taunt).toBe('KeyG');
    expect(swapped).toBeNull();
  });

  it('normalizes broken stored data', () => {
    expect(normalizeBinds({ moveUp: 'KeyS' })).toMatchObject({ moveUp: 'KeyS', moveDown: 'KeyW' });
    expect(normalizeBinds('garbage')).toEqual(DEFAULT_BINDS);
    expect(hasConflicts(normalizeBinds({ fire: 'KeyW', dash: 'KeyW' }))).toBe(false);
  });

  it('drops actions that no longer exist (old saved sneeze on Space)', () => {
    const binds = normalizeBinds({ sneeze: 'Space', taunt: 'KeyG' });
    expect(binds).toMatchObject({ jump: 'Space', taunt: 'KeyG' });
    expect('sneeze' in binds).toBe(false);
  });
});
