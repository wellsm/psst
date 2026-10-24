import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/Match';
import { DT, LANE_Y, audioOnly, effects, hold, input, p, place, run, setup, skipCountdown, sounds, trapAt, usePower } from './helpers';

describe('lobby and flow', () => {
  it('only the host can start, and only with everyone ready and enough players', () => {
    const m = new Match();
    m.addPlayer('a', 'A');
    m.addPlayer('b', 'B');
    expect(m.hostId).toBe('a');
    expect(m.start('a')).toBe(false); // b not ready
    m.setReady('b', true);
    expect(m.start('b')).toBe(false); // not host
    expect(m.start('a')).toBe(true);
    expect(m.phase).toBe('countdown');
  });

  it('host-only actions are rejected from other players', () => {
    const m = new Match();
    m.addPlayer('a', 'A');
    m.addPlayer('b', 'B');
    expect(m.setSettings('b', { walkSpeed: 5 })).toBe(false);
    expect(m.setMap('b', 'arena')).toBe(false);
    expect(m.addBot('b')).toBe(false);
    expect(m.settings.walkSpeed).toBe(3);
    expect(m.setSettings('a', { walkSpeed: 5 })).toBe(true);
    expect(m.settings.walkSpeed).toBe(5);
  });

  it('room holds 12 including bots', () => {
    const m = new Match();
    m.addPlayer('a', 'A');
    for (let i = 0; i < 9; i++) expect(m.addBot('a')).toBe(true);
    expect(m.addBot('a')).toBe(false); // max 9 bots
    m.addPlayer('b', 'B');
    m.addPlayer('c', 'C');
    expect(m.addPlayer('d', 'D')).toBeNull();
  });

  it('volunteers become seekers first; bots are always hiders; hiders get bottles', () => {
    const m = setup({ humans: 3, bots: 3 });
    expect(p(m, 'h0').role).toBe('seeker');
    expect(p(m, 'h0').bottles).toBe(0);
    for (const pl of m.players.values()) if (pl.isBot) expect(pl.role).toBe('hider');
    expect(p(m, 'h1').bottles).toBe(m.settings.bottlesPerHider);
  });

  it('the match cannot start without at least one seeker volunteer', () => {
    const m = new Match();
    m.addPlayer('a', 'A');
    m.addBot('a');
    m.addBot('a');
    m.setOptIn('a', false);
    expect(m.canStart()).toBe(false);
    expect(m.start('a')).toBe(false);
    m.setOptIn('a', true);
    expect(m.start('a')).toBe(true);
  });

  it('opt-out is honored: an unticked host is never the seeker, even when more seekers are wanted', () => {
    for (const seekerCount of [0, 2, 3]) {
      for (let seed = 0; seed < 20; seed++) {
        let r = seed + 1;
        const m = new Match({ random: () => ((r = (r * 16807) % 2147483647) / 2147483647) });
        m.addPlayer('host', 'Host');
        m.addPlayer('guest', 'Guest');
        m.addBot('host');
        m.setSettings('host', { seekerCount });
        m.setOptIn('host', false);
        m.setReady('guest', true);
        expect(m.start('host')).toBe(true);
        expect(p(m, 'host').role).toBe('hider');
        expect(p(m, 'guest').role).toBe('seeker');
      }
    }
  });

  it('seekers are frozen during the countdown while hiders move', () => {
    const m = setup({ hunt: false });
    const s0 = { ...p(m, 'h0').move }, h0 = { ...p(m, 'h1').move };
    run(m, 1, 'h0', () => { input(m, 'h0', { mx: 1 }); input(m, 'h1', { mx: -1 }); });
    expect(p(m, 'h0').move.x).toBeCloseTo(s0.x, 5);
    expect(p(m, 'h1').move.x).not.toBeCloseTo(h0.x, 1);
  });

  it('late joiners enter as living hiders with full bottles', () => {
    const m = setup();
    const late = m.addPlayer('late', 'Late')!;
    expect(late.role).toBe('hider');
    expect(late.life).toBe('alive');
    expect(late.bottles).toBe(m.settings.bottlesPerHider);
  });

  it('seekers win when every hider is caught; ghosts and bodies appear', () => {
    const m = setup();
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 12, LANE_Y);
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    run(m, 0.5);
    expect(p(m, 'h1').life).toBe('caught');
    expect(m.phase).toBe('end');
    expect(m.result?.winner).toBe('seekers');
    expect(m.result?.reason).toBe('allCaught');
  });

  it('hiders win when time runs out with someone alive', () => {
    const m = setup({ settings: { huntDuration: 30 } });
    run(m, 31);
    expect(m.phase).toBe('end');
    expect(m.result?.winner).toBe('hiders');
  });

  it('back to lobby: bots removed, scores and ready reset', () => {
    const m = setup({ humans: 2, bots: 2, settings: { huntDuration: 30, matchEndDuration: 5 } });
    p(m, 'h1').score = 50;
    run(m, 37);
    expect(m.phase).toBe('lobby');
    expect([...m.players.values()].some((x) => x.isBot)).toBe(false);
    expect(p(m, 'h1').score).toBe(0);
    expect(p(m, 'h1').ready).toBe(false);
  });

  it('the match ends if all seekers disconnect', () => {
    const m = setup({ humans: 3 });
    m.removePlayer('h0');
    expect(m.result?.reason).toBe('seekersLeft');
    expect(m.hostId).toBe('h1');
  });

  it('caught hider becomes a ghost after the delay and leaves a body', () => {
    const m = setup({ humans: 3 });
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 12, LANE_Y);
    place(m, 'h2', 30, 4);
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    run(m, 0.5);
    expect(p(m, 'h1').life).toBe('caught');
    run(m, m.settings.caughtGhostDelay);
    expect(p(m, 'h1').life).toBe('ghost');
    expect(m.bodies.map((b) => b.id)).toContain('h1');
  });
});

describe('anti-cheat interest management', () => {
  it('the seeker never receives the position of an unrevealed hider', () => {
    const m = setup();
    place(m, 'h1', 5, 4);
    const snap = m.buildSnapshot('h0')!;
    expect(snap.players.map((x) => x.id)).not.toContain('h1');
    // The hider itself and the seeker are in the hider's view.
    expect(m.buildSnapshot('h1')!.players.map((x) => x.id)).toEqual(expect.arrayContaining(['h0', 'h1']));
  });

  it('a revealed hider is sent while reveal > 0 and dropped after it decays', () => {
    const m = setup();
    place(m, 'h0', 30, LANE_Y);
    place(m, 'h1', 10, LANE_Y);
    m.emitSound(10, LANE_Y, 1, 'run', 'h1');
    expect(m.buildSnapshot('h0')!.players.map((x) => x.id)).toContain('h1');
    run(m, 1 / m.settings.revealDecay + 0.2);
    expect(m.buildSnapshot('h0')!.players.map((x) => x.id)).not.toContain('h1');
  });

  it('a stunned hider is fully visible to the seeker', () => {
    const m = setup();
    p(m, 'h1').move.stunLeft = 1;
    expect(m.buildSnapshot('h0')!.players.find((x) => x.id === 'h1')).toBeDefined();
  });

  it('the seeker never receives ghosts or their bottles', () => {
    const m = setup({ humans: 3 });
    const g = p(m, 'h1');
    g.life = 'ghost';
    place(m, 'h1', 20, LANE_Y);
    place(m, 'h0', 10, LANE_Y);
    m.fire('h1', 30, LANE_Y);
    const snap = m.buildSnapshot('h0')!;
    expect(snap.players.map((x) => x.id)).not.toContain('h1');
    expect(snap.proj).toHaveLength(0);
    expect(m.buildSnapshot('h2')!.proj).toHaveLength(1);
  });

  it('footsteps of a hidden hider reach the seeker as audio only (no position)', () => {
    const m = setup();
    place(m, 'h0', 30, LANE_Y);
    place(m, 'h1', 22, LANE_Y);
    const evs = hold(m, 'h1', { mx: -1 }, 1.2);
    expect(sounds(evs, 'footstep')).toHaveLength(0);
    expect(audioOnly(evs, 'footstep').length).toBeGreaterThan(0);
    for (const e of audioOnly(evs)) expect(e).not.toHaveProperty('x');
  });

  it('a hidden hider holding a bottle betrays only the bottle', () => {
    const m = setup();
    place(m, 'h1', 8, 8);
    input(m, 'h1', { hold: true });
    run(m, DT);
    const snap = m.buildSnapshot('h0')!;
    expect(snap.players.map((x) => x.id)).not.toContain('h1');
    expect(snap.held).toHaveLength(1);
  });

  it('the seeker gets no hider data during the countdown', () => {
    const m = setup({ hunt: false });
    m.emitSound(p(m, 'h1').move.x, p(m, 'h1').move.y, 1, 'run', 'h1');
    expect(m.buildSnapshot('h0')!.players.map((x) => x.id)).not.toContain('h1');
    expect(sounds(m.buildEvents('h0'), 'run')).toHaveLength(0);
    skipCountdown(m);
  });
});

describe('server validation', () => {
  it('rejects speed hacks: extra inputs beyond the time budget are not applied at once', () => {
    const m = setup();
    place(m, 'h1', 5, LANE_Y);
    const pl = p(m, 'h1');
    const inputs = Array.from({ length: 30 }, (_, i) => ({ seq: pl.ack + i + 1, mx: 1, my: 0, run: true, ax: 30, ay: LANE_Y, dash: false, hold: false }));
    m.pushInputs('h1', inputs);
    m.step(DT);
    // One tick may consume at most ~ (DT + MAX_AHEAD) / DT inputs.
    expect(pl.move.x - 5).toBeLessThan(m.settings.runSpeed * 0.2);
  });

  it('actions respect cooldowns, ammo and role', () => {
    const m = setup();
    place(m, 'h1', 5, LANE_Y);
    expect(m.fire('h1', 10, LANE_Y)).toBe(true);
    expect(m.fire('h1', 10, LANE_Y)).toBe(true);
    expect(m.fire('h1', 10, LANE_Y)).toBe(false); // out of bottles
    expect(m.fire('h0', 20, LANE_Y)).toBe(true); // ball
    expect(m.fire('h0', 20, LANE_Y)).toBe(false); // cooldown
    expect(m.taunt('h0')).toBe(false); // seekers cannot taunt
    expect(m.dashClaim('h0', 'h1')).toBe(false); // not dashing
  });

  it('dash claims are validated with tolerance and lag history', () => {
    const m = setup();
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 14, LANE_Y + 2.0);
    p(m, 'h1').lastVisibleAt = m.time;
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    run(m, 0.35);
    // Within dashHitRadius + captureTolerance (2.3 m) of the path → accepted.
    expect(m.dashClaim('h0', 'h1')).toBe(true);
    expect(p(m, 'h1').life).toBe('caught');
  });

  it('a missed dash stuns the seeker and makes a revealing boom', () => {
    const m = setup();
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 30, 4);
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    const evs = run(m, 0.6);
    expect(sounds(evs, 'dashMiss')).toHaveLength(1);
    expect(p(m, 'h0').move.stunLeft).toBeGreaterThan(0);
  });

  it('friendly fire: a hider bottle stuns another hider', () => {
    const m = setup({ humans: 3 });
    place(m, 'h1', 5, LANE_Y);
    place(m, 'h2', 9, LANE_Y);
    m.fire('h1', 12, LANE_Y);
    run(m, 0.5);
    expect(p(m, 'h2').move.stunLeft).toBeGreaterThan(0);
  });

  it('ball whistles high when a hider is near the impact and low otherwise', () => {
    const m = setup();
    place(m, 'h0', 5, LANE_Y);
    place(m, 'h1', 14, LANE_Y + 4);
    m.fire('h0', 10, LANE_Y);
    expect(sounds(run(m, 0.5), 'whistleHit')).toHaveLength(1);
    const m2 = setup({ settings: { whistleDetectRadius: 2 } });
    place(m2, 'h0', 5, LANE_Y);
    place(m2, 'h1', 14, LANE_Y + 4);
    m2.fire('h0', 10, LANE_Y);
    expect(sounds(run(m2, 0.5), 'whistle')).toHaveLength(1);
  });

  it('refill only near a crate and only when missing bottles', () => {
    const m = setup();
    const c = m.layout.crates[0];
    place(m, 'h1', c.x + 0.5, c.y + 1.5);
    expect(m.refill('h1')).toBe(false); // full
    p(m, 'h1').bottles = 0;
    expect(m.refill('h1')).toBe(true);
    expect(p(m, 'h1').bottles).toBe(m.settings.bottlesPerHider);
    p(m, 'h1').bottles = 0;
    expect(m.refill('h1')).toBe(false); // cooldown
  });

  it('ghosts fly through walls but stay inside the ghost border', () => {
    const m = setup({ humans: 3 });
    p(m, 'h1').life = 'ghost';
    place(m, 'h1', 5, 5);
    hold(m, 'h1', { mx: -1, my: -1, run: true }, 3);
    const b = m.layout.map.ghostBounds;
    expect(p(m, 'h1').move.x).toBeCloseTo(b.x0, 3);
    expect(p(m, 'h1').move.y).toBeCloseTo(b.y0, 3);
  });

  it('ghost voice never makes in-game sound', () => {
    const m = setup({ humans: 3 });
    p(m, 'h1').life = 'ghost';
    m.setSpeaking('h1', true);
    expect(sounds(run(m, 2, 'h2'), 'voice')).toHaveLength(0);
  });

  it('bots wander and do not score', () => {
    const m = setup({ bots: 2 });
    const bot = [...m.players.values()].find((x) => x.isBot)!;
    const start = { x: bot.move.x, y: bot.move.y };
    run(m, 4);
    expect(Math.hypot(bot.move.x - start.x, bot.move.y - start.y)).toBeGreaterThan(1);
    expect(bot.score).toBe(0);
  });
});

describe('phase 2: power-ups', () => {
  it('a capture fills the meter and grants a seeker power-up; using it empties the slot', () => {
    const m = setup({ humans: 3 });
    place(m, 'h2', 30, 4);
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 12, LANE_Y);
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    const evs = run(m, 0.5);
    const k = p(m, 'h0').power;
    expect(k).not.toBeNull();
    expect(['invisible', 'speed', 'mute', 'turbo', 'camo']).toContain(k);
    expect(evs.some((e) => e.e === 'power' && !e.used)).toBe(true);
    run(m, 2.5); // dash-miss-free, out of the capture freeze
    expect(m.usePower('h0')).toBe(true);
    expect(p(m, 'h0').power).toBeNull();
    expect(effects(m, 'h0')).toContain(k);
  });

  it('bots never earn power-ups; caught hiders lose theirs', () => {
    const m = setup({ bots: 2 });
    run(m, 20);
    for (const b of m.players.values()) if (b.isBot) expect(b.power).toBeNull();
    p(m, 'h1').power = 'jam';
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 12, LANE_Y);
    input(m, 'h0', { dash: true, ax: 20, ay: LANE_Y });
    run(m, 0.5);
    expect(p(m, 'h1').life).toBe('caught');
    expect(p(m, 'h1').power).toBeNull();
  });

  it('invisible seeker: never sent to hiders, still sent to fellow seekers; its steps are audio-only for hiders', () => {
    const m = setup({ humans: 3, volunteers: 2, settings: { seekerCount: 2 } });
    place(m, 'h0', 10, LANE_Y);
    place(m, 'h1', 14, LANE_Y);
    place(m, 'h2', 20, LANE_Y);
    usePower(m, 'h0', 'invisible');
    expect(m.buildSnapshot('h2')!.players.some((x) => x.id === 'h0')).toBe(false);
    expect(m.buildSnapshot('h1')!.players.some((x) => x.id === 'h0')).toBe(true);
    const evs = hold(m, 'h0', { mx: 1, ax: 40, ay: LANE_Y }, 1.2, 'h2');
    expect(sounds(evs, 'footstep').filter((e) => e.id === 'h0')).toEqual([]);
    expect(audioOnly(evs, 'footstep').length).toBeGreaterThan(0);
  });

  it('camo: hiders see the seeker as an anonymous hider', () => {
    const m = setup();
    usePower(m, 'h0', 'camo');
    const seen = m.buildSnapshot('h1')!.players.find((x) => x.id === 'h0')!;
    expect(seen.role).toBe('hider');
    expect(seen.anon).toBe(true);
    expect(m.buildSnapshot('h0')!.me!.role).toBe('seeker');
  });

  it('mute steps: walking makes no footsteps at all', () => {
    const m = setup();
    place(m, 'h1', 5, LANE_Y);
    usePower(m, 'h1', 'mute');
    const evs = hold(m, 'h1', { mx: 1, ax: 40, ay: LANE_Y }, 2, 'h1');
    expect(sounds(evs, 'footstep')).toEqual([]);
  });

  it('jam: seekers get no sound positions and see the jam timer; hiders still do', () => {
    const m = setup({ humans: 3 });
    place(m, 'h0', 12, LANE_Y);
    place(m, 'h1', 10, LANE_Y);
    place(m, 'h2', 20, LANE_Y);
    usePower(m, 'h1', 'jam');
    expect(m.buildSnapshot('h0')!.me!.jammed).toBeGreaterThan(0);
    m.emitSound(20, LANE_Y, 1, 'run', 'h2');
    const seekerEvs = m.buildEvents('h0');
    expect(sounds(seekerEvs)).toEqual([]);
    expect(audioOnly(seekerEvs, 'run').length).toBe(1);
    expect(sounds(m.buildEvents('h1'), 'run').length).toBe(1);
  });

  it('super-jump: jumps clear low solids (mugs) but not walls', () => {
    const walk = (power: boolean) => {
      const m = setup();
      place(m, 'h1', 4.5, 6.5); // arena mug at x 6..8, y 6..8
      if (power) usePower(m, 'h1', 'jump');
      hold(m, 'h1', { mx: 1, jump: true, ax: 40, ay: 6.5 }, 2);
      return p(m, 'h1').move.x;
    };
    expect(walk(false)).toBeLessThan(6);
    expect(walk(true)).toBeGreaterThan(8.5);
    const m = setup();
    place(m, 'h1', 3, LANE_Y);
    usePower(m, 'h1', 'jump');
    hold(m, 'h1', { mx: -1, jump: true }, 1.5);
    expect(p(m, 'h1').move.x).toBeGreaterThan(1); // perimeter still blocks
  });

  it('turbo dash: longer and no stun on a miss', () => {
    const m = setup();
    place(m, 'h1', 30, 4);
    place(m, 'h0', 3, LANE_Y);
    usePower(m, 'h0', 'turbo');
    input(m, 'h0', { dash: true, ax: 30, ay: LANE_Y });
    run(m, 1);
    expect(p(m, 'h0').move.x).toBeGreaterThan(3 + m.settings.dashDistance + 1);
    expect(p(m, 'h0').move.stunLeft).toBe(0);
  });
});

describe('phase 2: traps', () => {
  it('traps are seeded, spaced and never on solids', () => {
    const m = setup({ settings: { duckCount: 12, bananaCount: 8, mousetrapCount: 6, alarmCount: 4 } });
    expect(m.traps.length).toBe(30);
    for (const a of m.traps) for (const b of m.traps) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(m.settings.trapMinSpacing);
    const again = setup({ settings: { duckCount: 12, bananaCount: 8, mousetrapCount: 6, alarmCount: 4 } });
    expect(again.traps.map((t) => [t.k, t.x, t.y])).toEqual(m.traps.map((t) => [t.k, t.x, t.y]));
  });

  it('a mousetrap stuns and snaps where everyone can hear it; a stunned hider is visible to the seeker', () => {
    const m = setup();
    place(m, 'h1', 12, LANE_Y);
    trapAt(m, 'mousetrap', 12, LANE_Y);
    const evs = run(m, DT * 2);
    expect(p(m, 'h1').move.stunLeft).toBeGreaterThan(0);
    expect(sounds(evs, 'snap').length).toBe(1);
    expect(m.buildSnapshot('h0')!.players.some((x) => x.id === 'h1')).toBe(true);
  });

  it('a banana peel slips the victim and slides away', () => {
    const m = setup();
    place(m, 'h1', 10, LANE_Y);
    const t = trapAt(m, 'banana', 12, LANE_Y);
    hold(m, 'h1', { mx: 1, ax: 40, ay: LANE_Y }, 1);
    expect(t.x).toBeGreaterThan(13);
    expect(p(m, 'h1').move.stunLeft).toBeGreaterThan(0);
  });
});

describe('phase 2: map events', () => {
  it('events run in order, no repeats, at most mapEventCount', () => {
    const m = setup({ settings: { mapEventCount: 3, mapEventFirstAt: 5, mapEventGap: 40, huntDuration: 200 } });
    const seen: string[] = [];
    run(m, 150, 'h0', () => { if (m.event && seen[seen.length - 1] !== m.event.k) seen.push(m.event.k); });
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('hot duck passes on touch, including to the seeker', () => {
    const m = setup();
    place(m, 'h0', 30, 4);
    place(m, 'h1', 10, LANE_Y);
    m.startEvent('hotDuck');
    expect(m.event!.carrier).toBe('h1');
    place(m, 'h0', 11, LANE_Y);
    run(m, DT * 2);
    expect(m.event!.carrier).toBe('h0');
    expect(m.buildSnapshot('h1')!.event).toMatchObject({ k: 'hotDuck', carrier: 'h0' });
  });

  it('invisible traps: still trigger, but are not sent', () => {
    const m = setup();
    place(m, 'h1', 12, LANE_Y);
    trapAt(m, 'mousetrap', 12, LANE_Y);
    m.startEvent('invisibleTraps');
    run(m, DT * 2);
    expect(m.buildSnapshot('h1')!.traps).toEqual([]);
    expect(p(m, 'h1').move.stunLeft).toBeGreaterThan(0);
  });

  it('triple traps adds two waves of ducks and bananas and removes them at the end', () => {
    const m = setup({ settings: { duckCount: 2, bananaCount: 2 } });
    expect(m.traps.length).toBe(4);
    m.startEvent('tripleTraps');
    expect(m.traps.length).toBe(8);
    run(m, m.settings.tripleTrapsDuration / 2 + 0.5);
    expect(m.traps.length).toBe(12);
    run(m, m.settings.tripleTrapsDuration);
    expect(m.traps.length).toBe(4);
  });
});

describe('jump', () => {
  it.each(['duck', 'banana', 'mousetrap', 'alarm'] as const)('jumping over a %s sets nothing off', (k) => {
    const m = setup();
    place(m, 'h1', 10, LANE_Y);
    const t = trapAt(m, k, 11.5, LANE_Y);
    input(m, 'h1', { mx: 1, run: true, jump: true, ax: 40, ay: LANE_Y });
    hold(m, 'h1', { mx: 1, run: true, ax: 40, ay: LANE_Y }, 0.8);
    expect(p(m, 'h1').move.x).toBeGreaterThan(13);
    expect(t.armed).toBe(true);
    expect(t.ringsLeft).toBe(0);
    expect(p(m, 'h1').move.stunLeft).toBe(0);
  });

  it('taking off from a trap and landing on one both set it off', () => {
    const m = setup();
    place(m, 'h1', 10, LANE_Y);
    const under = trapAt(m, 'mousetrap', 10, LANE_Y);
    input(m, 'h1', { jump: true });
    run(m, DT);
    expect(under.armed).toBe(false);

    const m2 = setup();
    place(m2, 'h1', 10, LANE_Y);
    input(m2, 'h1', { jump: true });
    run(m2, 0.15);
    const below = trapAt(m2, 'mousetrap', 10, LANE_Y);
    run(m2, 0.15);
    expect(below.armed).toBe(true); // still in the air
    run(m2, 0.4);
    expect(below.armed).toBe(false);
    expect(p(m2, 'h1').move.stunLeft).toBeGreaterThan(0);
  });

  it('a jump dodges a ground dash (and its lag claim); without the jump the dash catches', () => {
    const dashAt = (jump: boolean) => {
      const m = setup();
      place(m, 'h0', 5, LANE_Y);
      place(m, 'h1', 8, LANE_Y);
      input(m, 'h0', { dash: true, ax: 40, ay: LANE_Y });
      input(m, 'h1', { jump });
      run(m, 0.5);
      m.dashClaim('h0', 'h1');
      return p(m, 'h1').life;
    };
    expect(dashAt(false)).toBe('caught');
    expect(dashAt(true)).toBe('alive');
  });

  it('a pounce (dash from the air) catches a jumping hider', () => {
    const m = setup();
    place(m, 'h0', 5, LANE_Y);
    place(m, 'h1', 8, LANE_Y);
    input(m, 'h0', { jump: true });
    run(m, 0.1);
    input(m, 'h0', { dash: true, ax: 40, ay: LANE_Y });
    input(m, 'h1', { jump: true });
    run(m, 0.5);
    expect(p(m, 'h1').life).toBe('caught');
  });

  it('landing is a run step on the sonar (mute silences it); no steps while in the air', () => {
    const land = (mute: boolean) => {
      const m = setup();
      place(m, 'h1', 10, LANE_Y);
      if (mute) usePower(m, 'h1', 'mute');
      input(m, 'h1', { jump: true });
      return sounds(run(m, 0.7, 'h1'), 'run').length;
    };
    expect(land(false)).toBe(1);
    expect(land(true)).toBe(0);
    const m = setup();
    place(m, 'h1', 10, LANE_Y);
    input(m, 'h1', { mx: 1, run: true, jump: true, ax: 40, ay: LANE_Y });
    expect(sounds(hold(m, 'h1', { mx: 1, run: true, ax: 40, ay: LANE_Y }, 0.4, 'h1'), 'run')).toEqual([]);
    const g = setup();
    place(g, 'h1', 10, LANE_Y);
    expect(sounds(hold(g, 'h1', { mx: 1, run: true, ax: 40, ay: LANE_Y }, 0.4, 'h1'), 'run').length).toBeGreaterThan(0);
  });

  it('others see the jump height in the snapshot', () => {
    const m = setup({ humans: 3 });
    place(m, 'h1', 10, LANE_Y);
    input(m, 'h1', { jump: true });
    run(m, 0.25);
    const seen = () => m.buildSnapshot('h2')!.players.find((pl) => pl.id === 'h1')!;
    expect(seen().z).toBeGreaterThan(0.4);
    run(m, 0.4);
    expect(seen().z).toBeUndefined();
  });
});
