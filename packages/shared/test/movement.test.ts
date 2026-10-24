import { describe, expect, it } from 'vitest';
import { buildLayout } from '../src/maps';
import { INPUT_DT, JUMP, isAirborne, jumpHeight, newMoveState, stepMove, type MoveContext, type MoveInput, type MoveState } from '../src/movement';
import { defaultSettings } from '../src/settings';

const DT = INPUT_DT;
const LANE_Y = 16.5;
const settings = defaultSettings();
const layout = buildLayout('arena', 1, 3);
const ctx = (role: MoveContext['role'] = 'hider'): MoveContext => ({ role, life: 'alive', settings, layout, canMove: true });
const inp = (o: Partial<MoveInput> = {}): MoveInput => ({ seq: 1, mx: 0, my: 0, run: false, ax: 40, ay: LANE_Y, dash: false, jump: false, ...o });
const ticks = (seconds: number) => Math.round(seconds / DT);

function steps(s: MoveState, seconds: number, o: Partial<MoveInput> = {}, c = ctx()) {
  const out = [];
  for (let i = 0; i < ticks(seconds); i++) out.push(stepMove(s, inp(o), DT, c));
  return out;
}

describe('jump', () => {
  it('rises and comes back down in JUMP.duration, peaking at JUMP.height', () => {
    const s = newMoveState(10, LANE_Y, settings);
    expect(stepMove(s, inp({ jump: true }), DT, ctx()).jumpStarted).toBe(true);
    expect(jumpHeight(s)).toBe(0); // takeoff tick: feet still on the ground
    let peak = 0;
    const evs = steps(s, JUMP.duration, {}, ctx());
    for (let i = 0; i < evs.length; i++) if (!evs[i].landed) peak = Math.max(peak, jumpHeight(s));
    expect(evs.filter((e) => e.landed).length).toBe(1);
    expect(jumpHeight(s)).toBe(0);
    expect(s.airLeft).toBe(0);
    const s2 = newMoveState(10, LANE_Y, settings);
    stepMove(s2, inp({ jump: true }), DT, ctx());
    steps(s2, JUMP.duration / 2);
    expect(jumpHeight(s2)).toBeCloseTo(JUMP.height, 1);
    expect(isAirborne(s2)).toBe(true);
    expect(peak).toBeLessThanOrEqual(JUMP.height + 1e-9);
  });

  it('no double jump, cooldown after landing, no jump while stunned', () => {
    const s = newMoveState(10, LANE_Y, settings);
    stepMove(s, inp({ jump: true }), DT, ctx());
    steps(s, 0.2);
    expect(stepMove(s, inp({ jump: true }), DT, ctx()).jumpStarted).toBe(false);
    steps(s, JUMP.duration);
    expect(s.jumpCdLeft).toBeGreaterThan(0);
    expect(stepMove(s, inp({ jump: true }), DT, ctx()).jumpStarted).toBe(false);
    steps(s, JUMP.cooldown + DT);
    expect(stepMove(s, inp({ jump: true }), DT, ctx()).jumpStarted).toBe(true);
    const stunned = newMoveState(10, LANE_Y, settings);
    stunned.stunLeft = 1;
    expect(stepMove(stunned, inp({ jump: true }), DT, ctx()).jumpStarted).toBe(false);
  });

  it('a normal jump does not pass low solids; a super jump does and perches on top', () => {
    // Arena mug at x 6..8, y 6..8.
    const walk = (power: boolean) => {
      const s = newMoveState(4.5, 6.5, settings);
      if (power) s.jumpLeft = 10;
      steps(s, 2, { mx: 1, jump: true, ax: 40, ay: 6.5 });
      return s;
    };
    expect(walk(false).x).toBeLessThan(6);
    expect(walk(true).x).toBeGreaterThan(8.5);
    // Super jump that comes down on the mug: stays on top, then walking off lands.
    const s = newMoveState(4.5, 6.5, settings);
    s.jumpLeft = 10;
    stepMove(s, inp({ mx: 1, jump: true, ax: 40, ay: 6.5 }), DT, ctx());
    steps(s, JUMP.superDuration, { mx: 0.9, ax: 40, ay: 6.5 });
    expect(s.perched).toBe(true);
    expect(s.airLeft).toBe(0);
    s.jumpLeft = 0;
    const evs = steps(s, 1.5, { mx: 1, ax: 40, ay: 6.5 });
    expect(s.perched).toBe(false);
    expect(s.x).toBeGreaterThan(8.4);
    expect(evs.some((e) => e.landed)).toBe(true);
  });

  it('a pounce (dash started in the air) passes over a low solid; a ground dash does not', () => {
    const dashAt = (jumpFirst: boolean) => {
      const s = newMoveState(4.2, 6.5, settings);
      if (jumpFirst) { stepMove(s, inp({ jump: true }), DT, ctx('seeker')); steps(s, 0.05, {}, ctx('seeker')); }
      stepMove(s, inp({ dash: true, ax: 40, ay: 6.5 }), DT, ctx('seeker'));
      steps(s, settings.dashDuration, {}, ctx('seeker'));
      return s.x;
    };
    expect(dashAt(false)).toBeLessThan(6);
    expect(dashAt(true)).toBeGreaterThan(6);
  });
});
