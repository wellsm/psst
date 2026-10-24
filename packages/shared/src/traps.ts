import { isSolid, type Layout } from './maps';
import { Rng, dist, type Vec2 } from './math';
import type { MatchSettings } from './settings';

// Phase 2 traps (briefing §14): scattered by seed on a grid, kept apart by a minimum spacing.
export type TrapKind = 'duck' | 'banana' | 'mousetrap' | 'alarm';

export const TRAP_KINDS: readonly TrapKind[] = ['duck', 'banana', 'mousetrap', 'alarm'];

/** Traps never spawn this close to a spawn marker or the beacon. */
const KEEP_CLEAR = 3;

export interface TrapSpot {
  k: TrapKind;
  x: number;
  y: number;
}

export function trapCount(kind: TrapKind, s: MatchSettings): number {
  switch (kind) {
    case 'duck': return s.duckCount;
    case 'banana': return s.bananaCount;
    case 'mousetrap': return s.mousetrapCount;
    case 'alarm': return s.alarmCount;
  }
}

/**
 * Deterministic trap placement: grid points on free tiles, at least `trapMinSpacing` from each other and
 * from `existing` traps. When the map runs out of spots, later traps are dropped.
 */
export function layoutTraps(layout: Layout, seed: number, s: MatchSettings, counts: Partial<Record<TrapKind, number>>, existing: readonly Vec2[] = []): TrapSpot[] {
  const rng = new Rng(seed ^ 0x7a9b);
  const { map } = layout;
  const g = s.trapGridSize;
  const avoid = [map.hiderSpawn, map.seekerSpawn, map.beacon];
  const spots: Vec2[] = [];
  for (let y = g / 2; y < map.height; y += g) {
    for (let x = g / 2; x < map.width; x += g) {
      if (isSolid(layout, Math.floor(x), Math.floor(y))) continue;
      if (avoid.some((a) => dist(a.x, a.y, x, y) < KEEP_CLEAR)) continue;
      spots.push({ x, y });
    }
  }
  const kinds: TrapKind[] = [];
  for (const k of TRAP_KINDS) for (let i = 0; i < (counts[k] ?? 0); i++) kinds.push(k);
  const queue = rng.shuffle(kinds);
  const placed: Vec2[] = [...existing];
  const out: TrapSpot[] = [];
  for (const sp of rng.shuffle(spots)) {
    if (out.length >= queue.length) break;
    if (placed.some((p) => dist(p.x, p.y, sp.x, sp.y) < s.trapMinSpacing)) continue;
    placed.push(sp);
    out.push({ k: queue[out.length], x: sp.x, y: sp.y });
  }
  return out;
}
