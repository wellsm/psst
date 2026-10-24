import { INPUT_DT, Rng, type ClientInput, type GameEvent, type MatchSettings, type PowerKind, type TrapKind } from '@psst/shared';
import { Match, type TrapSim } from '../src/sim/Match';

export const DT = INPUT_DT;

export interface SetupOptions {
  humans?: number;
  bots?: number;
  settings?: Partial<MatchSettings>;
  map?: 'kitchen' | 'arena';
  /** Skip the countdown straight into the hunt. */
  hunt?: boolean;
  seed?: number;
  /** Humans h0..h(n-1) volunteer as seekers (default 1: only the host). */
  volunteers?: number;
}

/**
 * Creates a started match. Player 'h0' is the host and the only seeker volunteer, so with the
 * default seeker count it is always the seeker; 'h1'.. are hiders.
 */
export const QUIET: Partial<MatchSettings> = { duckCount: 0, bananaCount: 0, mousetrapCount: 0, alarmCount: 0, mapEventCount: 0 };

export function setup(o: SetupOptions = {}): Match {
  const rng = new Rng(o.seed ?? 7);
  const m = new Match({ random: () => rng.next() });
  const humans = o.humans ?? 2;
  for (let i = 0; i < humans; i++) m.addPlayer(`h${i}`, `Human${i}`);
  m.setMap('h0', o.map ?? 'arena');
  // Traps and map events would randomize the shared test lane: off unless a test asks for them.
  m.setSettings('h0', { ...QUIET, ...o.settings } as Record<string, number>);
  for (let i = 0; i < (o.bots ?? 0); i++) m.addBot('h0');
  for (let i = 1; i < humans; i++) {
    m.setReady(`h${i}`, true);
    m.setOptIn(`h${i}`, i < (o.volunteers ?? 1));
  }
  if (!m.start('h0')) throw new Error('match did not start');
  if (o.hunt !== false) skipCountdown(m);
  return m;
}

export function skipCountdown(m: Match) {
  m.phaseLeft = 1e-6;
  m.step(DT);
  m.flushEvents();
}

export function p(m: Match, id: string) {
  const pl = m.players.get(id);
  if (!pl) throw new Error(`no player ${id}`);
  return pl;
}

export function place(m: Match, id: string, x: number, y: number) {
  const pl = p(m, id);
  pl.move.x = x;
  pl.move.y = y;
  pl.campX = x;
  pl.campY = y;
  pl.history = [];
}

/** Steps the match for `seconds`, collecting events seen by `viewer` (default h0). */
export function run(m: Match, seconds: number, viewer = 'h0', perTick?: () => void): GameEvent[] {
  const out: GameEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    perTick?.();
    // Connected clients send an input every tick; idle humans send a neutral one.
    for (const pl of m.players.values()) if (!pl.isBot && !pl.queue.length) input(m, pl.id, {});
    m.step(DT);
    out.push(...m.buildEvents(viewer));
    m.flushEvents();
  }
  return out;
}

const seqs = new Map<string, number>();
export function input(m: Match, id: string, partial: Partial<ClientInput>) {
  const pl = p(m, id);
  const seq = Math.max(seqs.get(id) ?? 0, pl.ack) + 1;
  seqs.set(id, seq);
  const base: ClientInput = { seq, mx: 0, my: 0, run: false, ax: pl.move.x + 1, ay: pl.move.y, dash: false, jump: false, hold: false };
  m.pushInputs(id, [{ ...base, ...partial }]);
}

/** Holds an input for `seconds` (one input per tick). */
export function hold(m: Match, id: string, partial: Partial<ClientInput>, seconds: number, viewer = 'h0'): GameEvent[] {
  return run(m, seconds, viewer, () => input(m, id, partial));
}

export const sounds = (evs: GameEvent[], type?: string) =>
  evs.filter((e): e is Extract<GameEvent, { e: 'snd' }> => e.e === 'snd' && (!type || e.t === type));

export const audioOnly = (evs: GameEvent[], type?: string) =>
  evs.filter((e): e is Extract<GameEvent, { e: 'snda' }> => e.e === 'snda' && (!type || e.t === type));

/** Open 24 m wide lane in the arena (row y=16.5 is free from x=1 to x=36). */
export const LANE_Y = 16.5;

/** Drops an armed trap of kind `k` at (x, y). */
export function trapAt(m: Match, k: TrapKind, x: number, y: number): TrapSim {
  const t: TrapSim = { id: 1000 + m.traps.length, k, x, y, armed: true, rearmIn: 0, ringsLeft: 0, ringIn: 0, extra: false };
  m.traps.push(t);
  return t;
}

/** Puts power `k` in the slot of `id` and uses it. */
export function usePower(m: Match, id: string, k: PowerKind): boolean {
  p(m, id).power = k;
  return m.usePower(id);
}

export const effects = (m: Match, id: string) => m.buildSnapshot(id)!.me!.effects.map((e) => e.k);
