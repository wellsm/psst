// Briefing rule: every MatchSettings field must change the game, with a test each.
// Each scenario runs once with defaults and once with the field changed; outputs must differ.
import { describe, expect, it } from 'vitest';
import {
  SETTING_DEFS,
  SOUND_DEFS,
  audioGain,
  buildLayout,
  defaultSettings,
  newMoveState,
  ringAt,
  stepDisplayAlpha,
  stepMove,
  voiceVolume,
  type MatchSettings,
  type PowerKind,
  type SettingKey,
  type TrapKind,
} from '@psst/shared';
import { Match } from '../src/sim/Match';
import { DT, LANE_Y, audioOnly, effects, hold, input, p, place, run, setup, sounds, trapAt, usePower } from './helpers';

type Patch = Partial<MatchSettings>;
type Scenario = { value: number; base?: number; run: (patch: Patch) => unknown };

const S = (patch: Patch): MatchSettings => ({ ...defaultSettings(), ...patch }) as MatchSettings;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Position of h1 after walking right for `t` seconds in the open lane. */
const walkDistance = (patch: Patch, t: number, runFlag = false) => {
  const m = setup({ settings: patch });
  place(m, 'h1', 3, LANE_Y);
  hold(m, 'h1', { mx: 1, run: runFlag, ax: 40, ay: LANE_Y }, t);
  return r2(p(m, 'h1').move.x - 3);
};

const ghostDistance = (patch: Patch, runFlag: boolean) => {
  const m = setup({ humans: 3, settings: patch });
  p(m, 'h1').life = 'ghost';
  place(m, 'h1', 3, LANE_Y);
  hold(m, 'h1', { mx: 1, run: runFlag }, 1);
  return r2(p(m, 'h1').move.x - 3);
};

const seekerRun = (patch: Patch) => {
  const m = setup({ settings: patch });
  place(m, 'h0', 3, LANE_Y);
  hold(m, 'h0', { mx: 1, run: true, ax: 40, ay: LANE_Y }, 4);
  return r2(p(m, 'h0').move.x);
};

/** Intensity of the first sound of `type` emitted while doing `act`, as heard by the emitter. */
const firstIntensity = (patch: Patch, type: string, act: (m: Match) => void, viewer = 'h1', seconds = 1) => {
  const m = setup({ humans: 3, settings: patch });
  place(m, 'h0', 30, 4);
  place(m, 'h1', 5, LANE_Y);
  place(m, 'h2', 20, 30);
  act(m);
  const evs = [...m.buildEvents(viewer), ...run(m, seconds, viewer)];
  return sounds(evs, type)[0]?.i ?? null;
};

const countSounds = (patch: Patch, type: string, act: (m: Match) => void, seconds: number, viewer = 'h1') => {
  const m = setup({ settings: patch });
  place(m, 'h0', 30, 4);
  place(m, 'h1', 3, LANE_Y);
  const evs = run(m, seconds, viewer, () => act(m));
  return sounds(evs, type).length;
};

const dashFrom = (m: Match, x: number, toX: number) => {
  place(m, 'h0', x, LANE_Y);
  input(m, 'h0', { dash: true, ax: toX, ay: LANE_Y });
};

/** Score of h1 after `t` seconds standing at distance `d` from the seeker. */
const scoreAt = (patch: Patch, d: number, t = 5) => {
  const m = setup({ settings: patch });
  place(m, 'h0', 5, LANE_Y);
  place(m, 'h1', 5 + d, LANE_Y);
  run(m, t);
  return r2(p(m, 'h1').score);
};

/** Is power `k` still running on `id` `after` seconds after using it? */
const powerActiveAfter = (patch: Patch, id: string, k: PowerKind, after = 2) => {
  const m = setup({ settings: patch });
  place(m, 'h0', 30, 4);
  place(m, 'h1', 10, LANE_Y);
  usePower(m, id, k);
  run(m, after);
  return effects(m, id).includes(k);
};

/** h1 stands on a fresh trap of kind `k` at (12, LANE_Y); events seen by h1. */
const onTrap = (patch: Patch, k: TrapKind, seconds: number) => {
  const m = setup({ settings: patch });
  place(m, 'h0', 30, 4);
  place(m, 'h1', 12, LANE_Y);
  const t = trapAt(m, k, 12, LANE_Y);
  return { m, t, evs: run(m, seconds, 'h1') };
};

/** Hot duck on h1 (h2 far unless `prep` moves it). */
const hotDuck = (patch: Patch, seconds: number, prep?: (m: Match) => void) => {
  const m = setup({ humans: 3, settings: patch });
  place(m, 'h0', 30, 4);
  place(m, 'h1', 10, LANE_Y);
  place(m, 'h2', 20, 30);
  prep?.(m);
  m.startEvent('hotDuck');
  m.event!.carrier = 'h1';
  return { m, evs: run(m, seconds, 'h1') };
};

const capturePower = (patch: Patch) => {
  const m = setup({ humans: 3, settings: patch });
  place(m, 'h2', 30, 4);
  place(m, 'h1', 12, LANE_Y);
  dashFrom(m, 10, 20);
  run(m, 0.5);
  return p(m, 'h0').power !== null;
};

const SCENARIOS: Record<SettingKey, Scenario> = {
  // ---------------- match
  countdownDuration: { value: 5, run: (pt) => { const m = setup({ settings: pt, hunt: false }); run(m, 6); return m.phase; } },
  huntDuration: { value: 30, run: (pt) => { const m = setup({ settings: pt }); run(m, 31); return m.phase; } },
  matchEndDuration: { value: 5, run: (pt) => { const m = setup({ settings: { ...pt, huntDuration: 30 } }); run(m, 37); return m.phase; } },
  minPlayers: { value: 3, run: (pt) => { const m = new Match(); m.addPlayer('a', 'A'); m.addPlayer('b', 'B'); m.setSettings('a', pt as Record<string, number>); m.setReady('b', true); return m.canStart(); } },
  seekerCount: { value: 2, run: (pt) => { const m = setup({ humans: 4, volunteers: 4, settings: pt }); return [...m.players.values()].filter((x) => x.role === 'seeker').length; } },
  caughtGhostDelay: { value: 1, run: (pt) => {
    const m = setup({ humans: 3, settings: pt });
    place(m, 'h2', 30, 4);
    place(m, 'h1', 12, LANE_Y);
    dashFrom(m, 10, 20);
    run(m, 2.5);
    return p(m, 'h1').life;
  } },

  // ---------------- movement
  walkSpeed: { value: 5, run: (pt) => walkDistance(pt, 1) },
  runSpeed: { value: 9, run: (pt) => walkDistance(pt, 1, true) },
  accelTime: { value: 0.4, run: (pt) => walkDistance(pt, 0.2) },
  playerRadius: { value: 0.55, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 3, LANE_Y);
    hold(m, 'h1', { mx: -1 }, 1.5);
    return r2(p(m, 'h1').move.x); // stops at wall x=1 + radius
  } },
  seekerStamina: { value: 2, run: seekerRun },
  staminaRecoverThreshold: { value: 0.1, run: (pt) => {
    const s = S(pt);
    const st = newMoveState(3, LANE_Y, s);
    st.stamina = 0; st.exhausted = true;
    const layout = buildLayout('arena', 1, 3);
    for (let i = 0; i < 30; i++) stepMove(st, { seq: i, mx: 0, my: 0, run: false, ax: 4, ay: LANE_Y, dash: false, jump: false }, DT, { role: 'seeker', life: 'alive', settings: s, layout, canMove: true });
    return st.exhausted;
  } },
  ghostSpeed: { value: 4, run: (pt) => ghostDistance(pt, false) },
  ghostBoostMultiplier: { value: 1, run: (pt) => ghostDistance(pt, true) },

  // ---------------- sonar
  revealRadius: { value: 6, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 10, LANE_Y); m.emitSound(18, LANE_Y, 1, 'run', null); return p(m, 'h1').reveal > 0; } },
  revealDecay: { value: 1.5, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 10, LANE_Y); m.emitSound(10, LANE_Y, 1, 'run', null); run(m, 0.5); return r2(p(m, 'h1').reveal); } },
  revealAlphaRate: { value: 1, run: (pt) => r2(stepDisplayAlpha(0, 1, 0.1, S(pt).revealAlphaRate)) },
  ringOpacity: { value: 0.8, run: (pt) => r2(ringAt(S(pt), 1, 0.1)!.alpha) },
  ringDuration: { value: 0.8, run: (pt) => ringAt(S(pt), 1, 1.0) === null },
  ringScale: { value: 1.6, run: (pt) => r2(ringAt(S(pt), 1, 1.1)!.radius) },

  // ---------------- sounds
  footstepInterval: { value: 0.25, run: (pt) => countSounds(pt, 'footstep', (m) => input(m, 'h1', { mx: 1 }), 2) },
  footstepIntensity: { value: 0.2, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 3, LANE_Y); return sounds(hold(m, 'h1', { mx: 1 }, 1, 'h1'), 'footstep')[0]?.i; } },
  runStepInterval: { value: 0.7, run: (pt) => countSounds(pt, 'run', (m) => input(m, 'h1', { mx: 1, run: true }), 2) },
  runIntensity: { value: 0.5, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 3, LANE_Y); return sounds(hold(m, 'h1', { mx: 1, run: true }, 1, 'h1'), 'run')[0]?.i; } },
  noisyZoneMultiplier: { value: 1.5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 9.5, 2.5); // arena puddle at x 9..12, y 2..3
    return sounds(hold(m, 'h1', { mx: 0.3 }, 1, 'h1'), 'water')[0]?.i;
  } },
  voiceInterval: { value: 0.3, run: (pt) => { const m = setup({ settings: pt }); m.setSpeaking('h1', true); return sounds(run(m, 2, 'h1'), 'voice').length; } },
  voiceIntensity: { value: 0.7, run: (pt) => { const m = setup({ settings: pt }); m.setSpeaking('h1', true); return sounds(run(m, 1, 'h1'), 'voice')[0]?.i; } },
  throwIntensity: { value: 0.2, run: (pt) => firstIntensity(pt, 'throw', (m) => m.fire('h1', 10, LANE_Y)) },
  bottleImpactIntensity: { value: 0.5, run: (pt) => firstIntensity(pt, 'bottleImpact', (m) => m.fire('h1', 10, LANE_Y)) },
  bottleHitIntensity: { value: 0.5, run: (pt) => firstIntensity(pt, 'bottleHit', (m) => { place(m, 'h2', 9, LANE_Y); m.fire('h1', 12, LANE_Y); }) },
  dashLaunchIntensity: { value: 0.3, run: (pt) => firstIntensity(pt, 'dashLaunch', (m) => dashFrom(m, 10, 20), 'h0') },
  dashMissIntensity: { value: 0.5, run: (pt) => firstIntensity(pt, 'dashMiss', (m) => dashFrom(m, 10, 20), 'h0') },
  whistleIntensity: { value: 0.5, run: (pt) => firstIntensity(pt, 'whistle', (m) => { place(m, 'h0', 25, 4); m.fire('h0', 30, 4); place(m, 'h1', 5, 30); place(m, 'h2', 5, 33); }, 'h0') },
  whistleDetectRadius: { value: 3, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 5, LANE_Y);
    place(m, 'h1', 15, LANE_Y + 5);
    m.fire('h0', 10, LANE_Y);
    return sounds(run(m, 0.5), 'whistleHit').length;
  } },
  tauntIntensity: { value: 0.3, run: (pt) => firstIntensity(pt, 'cough', (m) => m.taunt('h1')) },
  ghostImpactIntensity: { value: 0.3, run: (pt) => {
    const m = setup({ humans: 3, settings: pt });
    p(m, 'h1').life = 'ghost';
    place(m, 'h1', 5, LANE_Y);
    m.fire('h1', 10, LANE_Y);
    return sounds(run(m, 1, 'h1'), 'ghostImpact')[0]?.i;
  } },

  // ---------------- seeker
  ballSpeed: { value: 15, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h0', 5, LANE_Y); m.fire('h0', 25, LANE_Y); run(m, 0.2); return r2(m.projectiles[0]?.x ?? -1); } },
  ballRange: { value: 8, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 3, LANE_Y);
    place(m, 'h1', 30, 4);
    m.fire('h0', 35, LANE_Y);
    run(m, 0.25);
    return m.projectiles.length;
  } },
  ballCooldown: { value: 0.5, run: (pt) => { const m = setup({ settings: pt }); m.fire('h0', 20, LANE_Y); run(m, 1); return m.fire('h0', 20, LANE_Y); } },
  dashDistance: { value: 8, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 30, 4); dashFrom(m, 3, 30); run(m, 1); return r2(p(m, 'h0').move.x); } },
  dashDuration: { value: 0.9, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 30, 4); dashFrom(m, 3, 30); run(m, 0.6); return p(m, 'h0').move.dashLeft > 0; } },
  dashCooldown: { value: 1, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 30, 4); dashFrom(m, 3, 30); run(m, DT); return r2(p(m, 'h0').move.dashCdLeft); } },
  dashHitRadius: { value: 1.5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 12, LANE_Y + 1.2);
    dashFrom(m, 10, 20);
    run(m, 0.6);
    return p(m, 'h1').life;
  } },
  captureTolerance: { value: 0.3, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 14, LANE_Y + 2);
    p(m, 'h1').lastVisibleAt = m.time;
    dashFrom(m, 10, 20);
    run(m, 0.35);
    return m.dashClaim('h0', 'h1');
  } },
  dashMissStun: { value: 4, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 30, 4); dashFrom(m, 3, 30); run(m, 1); return r2(p(m, 'h0').move.stunLeft); } },

  // ---------------- hider
  bottlesPerHider: { value: 4, run: (pt) => p(setup({ settings: pt }), 'h1').bottles },
  bottleSpeed: { value: 10, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 3, LANE_Y); m.fire('h1', 15, LANE_Y); run(m, 0.2); return r2(m.projectiles[0]?.x ?? -1); } },
  bottleRange: { value: 5, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 3, LANE_Y); m.fire('h1', 30, LANE_Y); run(m, 0.4); return m.projectiles.length; } },
  bottleStunDuration: { value: 4, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h0', 9, LANE_Y); place(m, 'h1', 5, LANE_Y); m.fire('h1', 12, LANE_Y); run(m, 0.5); return r2(p(m, 'h0').move.stunLeft); } },
  bottleRefillCooldown: { value: 60, run: (pt) => {
    const m = setup({ settings: pt });
    const c = m.layout.crates[0];
    place(m, 'h1', c.x + 0.5, c.y + 1.5);
    p(m, 'h1').bottles = 0;
    m.refill('h1');
    return p(m, 'h1').refillCd;
  } },
  refillRange: { value: 1.5, run: (pt) => {
    const m = setup({ settings: pt });
    const c = m.layout.crates[0];
    const dy = c.y > 18 ? -2.5 : 2.5;
    place(m, 'h1', c.x + 0.5, c.y + 0.5 + dy);
    p(m, 'h1').bottles = 0;
    return m.refill('h1');
  } },
  tauntCooldown: { value: 8, run: (pt) => { const m = setup({ settings: pt }); m.taunt('h1'); return p(m, 'h1').tauntCd; } },

  // ---------------- ghost
  ghostBottleCooldown: { value: 30, run: (pt) => { const m = setup({ humans: 3, settings: pt }); p(m, 'h1').life = 'ghost'; m.fire('h1', 10, 10); return p(m, 'h1').ghostCd; } },
  ghostStunSeeker: { value: 4, run: (pt) => {
    const m = setup({ humans: 3, settings: pt });
    p(m, 'h1').life = 'ghost';
    place(m, 'h1', 5, LANE_Y);
    place(m, 'h0', 9, LANE_Y);
    m.fire('h1', 12, LANE_Y);
    run(m, 0.5);
    return r2(p(m, 'h0').move.stunLeft);
  } },
  ghostStunHider: { value: 3, run: (pt) => {
    const m = setup({ humans: 3, settings: pt });
    p(m, 'h1').life = 'ghost';
    place(m, 'h1', 5, LANE_Y);
    place(m, 'h2', 9, LANE_Y);
    m.fire('h1', 12, LANE_Y);
    run(m, 0.5);
    return r2(p(m, 'h2').move.stunLeft);
  } },

  // ---------------- scoring
  surviveBasePoints: { value: 3, run: (pt) => scoreAt(pt, 20) },
  nearDistance: { value: 8, run: (pt) => scoreAt(pt, 7) },
  nearMultiplier: { value: 8, run: (pt) => scoreAt(pt, 3) },
  midDistance: { value: 15, run: (pt) => scoreAt(pt, 12) },
  midMultiplier: { value: 5, run: (pt) => scoreAt(pt, 7) },
  farMultiplier: { value: 1, run: (pt) => scoreAt(pt, 20) },
  campingGrace: { value: 5, run: (pt) => scoreAt(pt, 20, 12) },
  campingPenalty: { value: 10, run: (pt) => scoreAt(pt, 3, 20) },
  campingMoveThreshold: { value: 0.5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 5, LANE_Y);
    place(m, 'h1', 8, LANE_Y);
    // Jitter 0.2 m back and forth: above the default threshold, below 0.5 m.
    for (let i = 0; i < 20; i++) { p(m, 'h1').move.x = i % 2 ? 8.2 : 8; run(m, 1); }
    return r2(p(m, 'h1').score);
  } },
  boldnessFactor: { value: 20, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h0', 5, LANE_Y); place(m, 'h1', 8, LANE_Y); m.taunt('h1'); return r2(p(m, 'h1').score); } },
  boldnessCooldown: { value: 0.5, run: (pt) => {
    const m = setup({ settings: { ...pt, tauntCooldown: 0.5 } });
    place(m, 'h0', 5, LANE_Y);
    place(m, 'h1', 25, LANE_Y);
    m.taunt('h1');
    p(m, 'h1').move.x = 25; // stand still, no survival noise
    run(m, 0.6);
    m.taunt('h1');
    return r2(p(m, 'h1').score);
  } },
  revealReward: { value: 50, run: (pt) => { const m = setup({ settings: pt }); place(m, 'h1', 10, LANE_Y); m.emitSound(10, LANE_Y, 1, 'run', null); return r2(p(m, 'h0').score); } },
  revealRewardCooldown: { value: 0.5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 10, LANE_Y);
    m.emitSound(10, LANE_Y, 1, 'run', null);
    run(m, 1);
    m.emitSound(10, LANE_Y, 1, 'run', null);
    return r2(p(m, 'h0').score);
  } },
  captureReward: { value: 300, run: (pt) => { const m = setup({ humans: 3, settings: pt }); place(m, 'h2', 30, 4); place(m, 'h1', 12, LANE_Y); dashFrom(m, 10, 20); run(m, 0.5); return r2(p(m, 'h0').score); } },
  ghostHitReward: { value: 60, run: (pt) => {
    const m = setup({ humans: 3, settings: pt });
    p(m, 'h1').life = 'ghost';
    place(m, 'h1', 5, LANE_Y);
    place(m, 'h0', 9, LANE_Y);
    m.fire('h1', 12, LANE_Y);
    run(m, 0.5);
    return r2(p(m, 'h1').score);
  } },

  // ---------------- map
  beaconInterval: { value: 10, run: (pt) => { const m = setup({ settings: pt }); return sounds(run(m, 21), 'beacon').length; } },
  beaconIntensity: { value: 0.4, run: (pt) => { const m = setup({ settings: pt }); return sounds(run(m, 26), 'beacon')[0]?.i; } },
  bottleRefillStations: { value: 7, run: (pt) => setup({ settings: pt }).layout.crates.length },

  // ---------------- bots
  botRetargetInterval: { value: 25, run: (pt) => { const m = setup({ bots: 1, settings: pt }); run(m, DT); const b = [...m.players.values()].find((x) => x.isBot)!; return b.bot!.retargetIn > 15; } },
  botRunChance: { value: 1, base: 0, run: (pt) => {
    const m = setup({ bots: 4, settings: pt });
    run(m, DT);
    return [...m.players.values()].filter((x) => x.isBot && x.bot!.running).length;
  } },

  // ---------------- audio
  audioMaxRange: { value: 20, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 33, LANE_Y);
    place(m, 'h1', 3, LANE_Y);
    m.fire('h1', 3, 30);
    return audioOnly(m.buildEvents('h0'), 'throw').length;
  } },
  footstepAudioRange: { value: 5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 20, LANE_Y);
    place(m, 'h1', 10, LANE_Y);
    return audioOnly(hold(m, 'h1', { mx: -1 }, 1.2), 'footstep').length;
  } },
  runAudioRange: { value: 10, run: (pt) => r2(audioGain(12, SOUND_DEFS.run.range(S(pt)))) },
  voiceRange: { value: 10, run: (pt) => r2(voiceVolume(12, S(pt))) },
  // A hidden hider's footsteps straight behind a seeker facing +x: centered in the mouse-look view (default),
  // off-center on the fixed isometric screen.
  cameraMode: { value: 1, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 20, LANE_Y);
    place(m, 'h1', 10, LANE_Y);
    return r2(audioOnly(hold(m, 'h1', { mx: 1 }, 1.2), 'footstep')[0].pan);
  } },

  // ---------------- power-ups
  powerUpPointThreshold: { value: 500, run: capturePower },
  powerInvisibleDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h0', 'invisible') },
  powerSpeedDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h1', 'speed') },
  powerSpeedMultiplier: { value: 3, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 3, LANE_Y);
    usePower(m, 'h1', 'speed');
    hold(m, 'h1', { mx: 1, ax: 40, ay: LANE_Y }, 1);
    return r2(p(m, 'h1').move.x);
  } },
  powerMuteDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h1', 'mute') },
  powerTurboDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h0', 'turbo') },
  powerTurboDashMultiplier: { value: 2.5, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h1', 30, 4);
    place(m, 'h0', 3, LANE_Y);
    usePower(m, 'h0', 'turbo');
    dashFrom(m, 3, 30);
    run(m, 1);
    return r2(p(m, 'h0').move.x);
  } },
  powerCamoDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h0', 'camo') },
  powerMegaphoneDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h1', 'megaphone') },
  powerMegaphoneIntensity: { value: 0.5, run: (pt) => firstIntensity(pt, 'cough', (m) => { usePower(m, 'h1', 'megaphone'); m.taunt('h1'); }) },
  powerJamDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h1', 'jam') },
  powerJumpDuration: { value: 1, run: (pt) => powerActiveAfter(pt, 'h1', 'jump') },

  // ---------------- traps
  duckCount: { value: 3, base: 12, run: (pt) => setup({ settings: pt }).traps.filter((t) => t.k === 'duck').length },
  bananaCount: { value: 2, base: 8, run: (pt) => setup({ settings: pt }).traps.filter((t) => t.k === 'banana').length },
  mousetrapCount: { value: 2, base: 6, run: (pt) => setup({ settings: pt }).traps.filter((t) => t.k === 'mousetrap').length },
  alarmCount: { value: 1, base: 4, run: (pt) => setup({ settings: pt }).traps.filter((t) => t.k === 'alarm').length },
  trapGridSize: { value: 4, run: (pt) => JSON.stringify(setup({ settings: { duckCount: 6, ...pt } }).traps.map((t) => [t.x, t.y])) },
  trapMinSpacing: { value: 10, run: (pt) => setup({ settings: { duckCount: 30, ...pt } }).traps.length },
  trapRadius: { value: 1.2, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 30, 4);
    place(m, 'h1', 12.9, LANE_Y);
    const t = trapAt(m, 'duck', 12, LANE_Y);
    run(m, DT * 2);
    return t.armed;
  } },
  duckIntensity: { value: 0.3, run: (pt) => sounds(onTrap(pt, 'duck', 0.2).evs, 'quack')[0]?.i },
  duckCooldown: { value: 5, run: (pt) => sounds(onTrap(pt, 'duck', 3.2).evs, 'quack').length },
  bananaStun: { value: 3, run: (pt) => r2(p(onTrap(pt, 'banana', 0.1).m, 'h1').move.stunLeft) },
  slipIntensity: { value: 0.5, run: (pt) => sounds(onTrap(pt, 'banana', 0.2).evs, 'slip')[0]?.i },
  bananaSlideDistance: { value: 1, run: (pt) => {
    const m = setup({ settings: pt });
    place(m, 'h0', 30, 4);
    place(m, 'h1', 10, LANE_Y);
    const t = trapAt(m, 'banana', 12, LANE_Y);
    hold(m, 'h1', { mx: 1, ax: 40, ay: LANE_Y }, 1.5);
    return r2(t.x);
  } },
  mousetrapStun: { value: 2, run: (pt) => r2(p(onTrap(pt, 'mousetrap', 0.1).m, 'h1').move.stunLeft) },
  mousetrapIntensity: { value: 0.5, run: (pt) => sounds(onTrap(pt, 'mousetrap', 0.2).evs, 'snap')[0]?.i },
  mousetrapRearm: { value: 1, run: (pt) => sounds(onTrap(pt, 'mousetrap', 3).evs, 'snap').length },
  alarmRings: { value: 5, run: (pt) => sounds(onTrap(pt, 'alarm', 8).evs, 'alarm').length },
  alarmIntensity: { value: 0.3, run: (pt) => sounds(onTrap(pt, 'alarm', 0.3).evs, 'alarm')[0]?.i },
  alarmRingInterval: { value: 0.5, run: (pt) => sounds(onTrap(pt, 'alarm', 1.5).evs, 'alarm').length },
  alarmRearm: { value: 2, run: (pt) => sounds(onTrap(pt, 'alarm', 6).evs, 'alarm').length },

  // ---------------- map events
  mapEventCount: { value: 0, base: 2, run: (pt) => { const m = setup({ settings: { mapEventFirstAt: 5, ...pt } }); run(m, 6); return m.event !== null; } },
  mapEventFirstAt: { value: 30, run: (pt) => { const m = setup({ settings: { mapEventCount: 1, ...pt } }); run(m, 31); return m.event?.k ?? null; } },
  mapEventGap: { value: 10, run: (pt) => {
    const m = setup({ settings: { mapEventCount: 2, mapEventFirstAt: 5, hotDuckDuration: 5, invisibleTrapsDuration: 5, tripleTrapsDuration: 5, ...pt } });
    run(m, 17);
    return m.event !== null;
  } },
  hotDuckDuration: { value: 10, run: (pt) => hotDuck(pt, 15).m.event?.k ?? null },
  hotDuckQuackInterval: { value: 1, run: (pt) => sounds(hotDuck(pt, 5).evs, 'quack').length },
  hotDuckIntensity: { value: 0.3, run: (pt) => sounds(hotDuck(pt, 0.2).evs, 'quack')[0]?.i },
  hotDuckTouchRadius: { value: 3, run: (pt) => hotDuck(pt, 0.1, (m) => place(m, 'h2', 12, LANE_Y)).m.event?.carrier },
  hotDuckImmunity: { value: 0, run: (pt) => sounds(hotDuck(pt, 1, (m) => place(m, 'h2', 11, LANE_Y)).evs, 'quack').length },
  invisibleTrapsDuration: { value: 5, run: (pt) => {
    const m = setup({ settings: pt });
    for (let i = 0; i < 3; i++) trapAt(m, 'duck', 20 + i * 4, 30);
    m.startEvent('invisibleTraps');
    run(m, 8);
    return m.buildSnapshot('h0')!.traps.length;
  } },
  tripleTrapsDuration: { value: 5, run: (pt) => {
    const m = setup({ settings: { duckCount: 2, bananaCount: 2, ...pt } });
    m.startEvent('tripleTraps');
    run(m, 6);
    return m.traps.length;
  } },
};

describe('MatchSettings: every field changes the game', () => {
  it('every setting has a scenario', () => {
    const missing = SETTING_DEFS.map((d) => d.key).filter((k) => !(k in SCENARIOS));
    expect(missing).toEqual([]);
  });

  for (const def of SETTING_DEFS) {
    const sc = SCENARIOS[def.key];
    it(`${def.key}`, () => {
      expect(sc.value).toBeGreaterThanOrEqual(def.min);
      expect(sc.value).toBeLessThanOrEqual(def.max);
      const basePatch: Patch = sc.base !== undefined ? { [def.key]: sc.base } : {};
      const a = sc.run(basePatch);
      const b = sc.run({ [def.key]: sc.value });
      expect(a).not.toBeUndefined();
      expect(b).not.toBeUndefined();
      expect(b).not.toEqual(a);
    });
  }
});
