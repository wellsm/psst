import { describe, expect, it } from 'vitest';
import { ACTIONS } from './keybinds';
import { PAD, PAD_BINDS, PAD_LABELS, STICK_DEADZONE, menuDir, readPad, stick, type PadLike } from './gamepad';

function pad(axes: number[] = [0, 0, 0, 0], held: number[] = [], values: Record<number, number> = {}): PadLike {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: values[i] ?? (held.includes(i) ? 1 : 0) })),
  };
}

describe('gamepad mapping', () => {
  it('ignores stick drift inside the deadzone and rescales past it', () => {
    expect(stick(STICK_DEADZONE * 0.9, 0)).toEqual({ x: 0, y: 0 });
    expect(stick(1, 0).x).toBeCloseTo(1);
    const half = stick(0, (1 + STICK_DEADZONE) / 2);
    expect(half.y).toBeCloseTo(0.5);
  });

  it('caps diagonal magnitude at 1 and keeps partial tilt (slow walk)', () => {
    const d = stick(1, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    const f = readPad(pad([0.4, 0, 0, 0]));
    expect(f.move.x).toBeGreaterThan(0);
    expect(f.move.x).toBeLessThan(0.4);
  });

  it('maps buttons to actions; triggers count past their threshold', () => {
    expect([...readPad(pad([0, 0, 0, 0], [PAD.RB, PAD.LB])).actions].sort()).toEqual(['run', 'taunt']);
    expect(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.2 })).actions.has('fire')).toBe(false);
    expect(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.8 })).actions.has('fire')).toBe(true);
    expect(readPad(pad([0, 0, 0, 0], [PAD.B])).actions.has('jump')).toBe(true);
  });

  it('every non-movement action has a pad button with a label; no button serves two actions', () => {
    const used: number[] = [];
    for (const a of ACTIONS.filter((x) => !x.startsWith('move'))) {
      const btns = PAD_BINDS[a];
      expect(btns?.length, a).toBeGreaterThan(0);
      for (const b of btns!) { expect(PAD_LABELS[b], `${a}:${b}`).toBeTruthy(); used.push(b); }
    }
    expect(new Set(used).size).toBe(used.length);
  });

  it('right stick has a squared response for fine aim', () => {
    const slow = readPad(pad([0, 0, 0.5, 0])).look.x;
    const fast = readPad(pad([0, 0, 1, 0])).look.x;
    expect(fast).toBeCloseTo(1);
    expect(slow).toBeLessThan(stick(0.5, 0).x);
  });

  it('menu direction from the D-pad or a pushed left stick', () => {
    expect(menuDir(readPad(pad([0, 0, 0, 0], [PAD.DOWN])))).toBe('down');
    expect(menuDir(readPad(pad([0, -0.9, 0, 0])))).toBe('up');
    expect(menuDir(readPad(pad([0.3, 0, 0, 0])))).toBe(null);
  });
});
