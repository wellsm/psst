// HUD checklist (briefing §10): every HUD element × every role × every phase.
// Run before each delivery: `npm test`.
import { describe, expect, it } from 'vitest';
import { defaultSettings, newMoveState, type LifeState, type MeState, type Phase, type Role } from '@psst/shared';
import { computeHud, type HudInput, type HudModel } from './hudModel';

type Who = 'seeker' | 'hider' | 'caught' | 'ghost';
const PHASES: Phase[] = ['countdown', 'hunt', 'end'];
const WHO: Who[] = ['seeker', 'hider', 'caught', 'ghost'];

const settings = defaultSettings();

function me(who: Who, extra: Partial<MeState> = {}): MeState {
  const role: Role = who === 'seeker' ? 'seeker' : 'hider';
  const life: LifeState = who === 'caught' ? 'caught' : who === 'ghost' ? 'ghost' : 'alive';
  return {
    ...newMoveState(5, 5, settings),
    ack: 0, role, life, bottles: role === 'hider' ? 2 : 0, ballCd: 0, refillCd: 0, tauntCd: 0, ghostCd: 0,
    caughtLeft: life === 'caught' ? 3 : 0, anim: 0, power: null, powerProgress: 0, effects: [], jammed: 0, ...extra,
  };
}

function hud(who: Who, phase: Phase, over: Partial<HudInput> = {}, meExtra: Partial<MeState> = {}): HudModel {
  return computeHud({
    phase, phaseLeft: 30, beaconLeft: 12, me: me(who, meExtra), settings,
    scores: [
      { id: 'me', name: 'Me', score: 10, role: who === 'seeker' ? 'seeker' : 'hider', life: 'alive', color: 0 },
      { id: 'x', name: 'X', score: 99, role: 'hider', life: 'ghost', color: 1 },
    ],
    myId: 'me', nearCrate: false, fireHeld: false, voiceProblem: false, since: 0, event: null, ...over,
  });
}

// Expected visibility: [element, who, phase] → visible. Unlisted combos must be hidden.
const live = (p: Phase) => p === 'countdown' || p === 'hunt';
const CHECKLIST: Record<string, (who: Who, phase: Phase) => boolean> = {
  timer: (_w, p) => live(p),
  scoreboard: (_w, p) => live(p),
  ownScore: (_w, p) => live(p),
  beacon: (_w, p) => live(p),
  seekerActions: (w, p) => w === 'seeker' && live(p),
  hiderActions: (w, p) => w === 'hider' && live(p),
  ghostActions: (w, p) => w === 'ghost' && p === 'hunt',
  caughtCard: (w, p) => w === 'caught' && live(p),
  countdownCover: (w, p) => w === 'seeker' && p === 'countdown',
  hiderCountdown: (w, p) => w !== 'seeker' && p === 'countdown',
  reticle: (w, p) => live(p) && w !== 'caught' && !(w === 'seeker' && p === 'countdown'),
  endScreen: (_w, p) => p === 'end',
  powerSlot: (w, p) => (w === 'seeker' || w === 'hider') && p === 'hunt',
  // Conditional elements: hidden in the default state of every role/phase.
  bottleRange: () => false,
  voiceWarning: () => false,
  effects: () => false,
  jammed: () => false,
  mapEvent: () => false,
};

describe('HUD checklist: element × role × phase', () => {
  it('covers every HUD element', () => {
    expect(Object.keys(CHECKLIST).sort()).toEqual(Object.keys(hud('hider', 'hunt')).sort());
  });
  for (const [el, expected] of Object.entries(CHECKLIST)) {
    for (const who of WHO) {
      for (const phase of PHASES) {
        it(`${el} / ${who} / ${phase}`, () => {
          const model = hud(who, phase) as unknown as Record<string, { visible: boolean }>;
          expect(model[el].visible).toBe(expected(who, phase));
        });
      }
    }
  }
});

describe('HUD conditional elements', () => {
  it('scoreboard marks caught hiders as PEGO and sorts by points', () => {
    const m = hud('seeker', 'hunt');
    expect(m.scoreboard.rows[0].id).toBe('x');
    expect(m.scoreboard.rows[0].caught).toBe(true);
    expect(m.scoreboard.rows.find((r) => r.me)?.caught).toBe(false);
  });
  it('refill shows only near a crate and when missing bottles', () => {
    expect(hud('hider', 'hunt', { nearCrate: true }).hiderActions.refill.visible).toBe(false);
    expect(hud('hider', 'hunt', { nearCrate: true }, { bottles: 1 }).hiderActions.refill.visible).toBe(true);
    expect(hud('hider', 'hunt', { nearCrate: false }, { bottles: 1 }).hiderActions.refill.visible).toBe(false);
    expect(hud('seeker', 'hunt', { nearCrate: true }).hiderActions.refill.visible).toBe(false);
  });
  it('bottle range shows while holding fire with a bottle (hider) or a ready spectral bottle (ghost)', () => {
    expect(hud('hider', 'hunt', { fireHeld: true }).bottleRange.visible).toBe(true);
    expect(hud('hider', 'hunt', { fireHeld: true }, { bottles: 0 }).bottleRange.visible).toBe(false);
    expect(hud('ghost', 'hunt', { fireHeld: true }).bottleRange.visible).toBe(true);
    expect(hud('ghost', 'hunt', { fireHeld: true }, { ghostCd: 4 }).bottleRange.visible).toBe(false);
    expect(hud('seeker', 'hunt', { fireHeld: true }).bottleRange.visible).toBe(false);
    expect(hud('hider', 'hunt', { fireHeld: true }).bottleRange.radius).toBe(settings.bottleRange);
  });
  it('voice warning shows in game when voice failed', () => {
    for (const p of PHASES) expect(hud('hider', p, { voiceProblem: true }).voiceWarning.visible).toBe(true);
  });
  it('cooldowns report readiness and advance between snapshots', () => {
    const m = hud('seeker', 'hunt', { since: 0.5 }, { ballCd: 1 });
    expect(m.seekerActions.ball.ready).toBe(false);
    expect(m.seekerActions.ball.left).toBeCloseTo(0.5);
    expect(hud('seeker', 'hunt', { since: 1.2 }, { ballCd: 1 }).seekerActions.ball.ready).toBe(true);
  });
  it('jump tile: busy in the air, cooldown after landing, for both roles', () => {
    expect(hud('hider', 'hunt', {}, { airLeft: 0.2 }).hiderActions.jump.ready).toBe(false);
    expect(hud('seeker', 'hunt', {}, { airLeft: 0.2 }).seekerActions.jump.ready).toBe(false);
    expect(hud('hider', 'hunt', { since: 0.1 }, { jumpCdLeft: 0.3 }).hiderActions.jump.left).toBeCloseTo(0.2);
    expect(hud('hider', 'hunt').hiderActions.jump.ready).toBe(true);
  });
  it('stamina bar reflects stamina and exhaustion', () => {
    const m = hud('seeker', 'hunt', {}, { stamina: 3, exhausted: true });
    expect(m.seekerActions.stamina.frac).toBeCloseTo(0.5);
    expect(m.seekerActions.stamina.exhausted).toBe(true);
  });
  it('countdown cover counts down for the seeker', () => {
    expect(hud('seeker', 'countdown', { phaseLeft: 7.2 }).countdownCover.n).toBe(8);
  });
  it('power slot fills toward the threshold and shows the earned power', () => {
    expect(hud('hider', 'hunt', {}, { powerProgress: 75 }).powerSlot.frac).toBeCloseTo(0.5);
    expect(hud('seeker', 'hunt', {}, { power: 'turbo' }).powerSlot).toMatchObject({ power: 'turbo', frac: 1 });
    expect(hud('hider', 'hunt', { settings: { ...settings, powerUpPointThreshold: 0 } }).powerSlot.visible).toBe(false);
  });
  it('active effects tick down; jam shows for seekers only', () => {
    const m = hud('hider', 'hunt', { since: 1 }, { effects: [{ k: 'jump', left: 3 }, { k: 'mute', left: 0.5 }] });
    expect(m.effects.list).toEqual([{ k: 'jump', left: 2 }]);
    expect(hud('seeker', 'hunt', {}, { jammed: 4 }).jammed.visible).toBe(true);
    expect(hud('hider', 'hunt', {}, { jammed: 4 }).jammed.visible).toBe(false);
  });
  it('map event banner shows during the hunt and flags the hot duck on me', () => {
    const m = hud('hider', 'hunt', { event: { k: 'hotDuck', left: 12, carrier: 'me' } });
    expect(m.mapEvent).toMatchObject({ visible: true, k: 'hotDuck', onMe: true });
    expect(hud('hider', 'end', { event: { k: 'tripleTraps', left: 5 } }).mapEvent.visible).toBe(false);
  });
});
