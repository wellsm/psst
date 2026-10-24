import { describe, expect, it } from 'vitest';
import { MAPS, MAP_SIDES, areaScale, buildLayout, findPath, isSolid, loadMap, mapSideFor } from '../src/maps';

describe.each(MAPS.map((m) => m.id))('map %s', (id) => {
  const map = loadMap(id);
  const layout = buildLayout(id, 1234, 10);
  // Worst case for connectivity: every variable cover solid.
  const full = buildLayout(id, 1, 10);
  for (const v of map.variableCandidates) full.solid[v.y * map.width + v.x] = 1;

  it('rows have consistent width', () => {
    for (const row of map.def.ascii) expect(row.length).toBe(map.width);
  });

  it('playable area is between 35x35 and 50x50 m', () => {
    const w = map.width - 2, h = map.height - 2;
    expect(w).toBeGreaterThanOrEqual(35);
    expect(w).toBeLessThanOrEqual(50);
    expect(h).toBeGreaterThanOrEqual(35);
    expect(h).toBeLessThanOrEqual(50);
  });

  it('has spawns, beacon at the center, noisy zones and ≥10 crate candidates', () => {
    expect(map.def.ascii.join('')).toContain('S');
    expect(map.def.ascii.join('')).toContain('P');
    expect(Math.abs(map.beacon.x - map.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(map.beacon.y - map.height / 2)).toBeLessThanOrEqual(1);
    expect(map.tiles.some((t) => t === '~' || t === ':')).toBe(true);
    expect(map.crateCandidates.length).toBeGreaterThanOrEqual(10);
  });

  it('every walkable tile is reachable even with all variable covers solid', () => {
    const walk: [number, number][] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (!isSolid(full, x, y)) walk.push([x, y]);
    const seen = new Set<string>([walk[0].join()]);
    const q = [walk[0]];
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k: [number, number] = [x + dx, y + dy];
        if (!isSolid(full, k[0], k[1]) && !seen.has(k.join())) { seen.add(k.join()); q.push(k); }
      }
    }
    expect(seen.size).toBe(walk.length);
  });

  it('cover is never more than ~7 m away', () => {
    let worst = 0;
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
      if (isSolid(layout, x, y)) continue;
      let best = Infinity;
      for (let j = 1; j < map.height - 1; j++) for (let i = 1; i < map.width - 1; i++) if (isSolid(layout, i, j)) best = Math.min(best, Math.hypot(i - x, j - y));
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThanOrEqual(7.5);
  });

  it('layout is deterministic from the seed', () => {
    const a = buildLayout(id, 42, 3), b = buildLayout(id, 42, 3), c = buildLayout(id, 43, 3);
    expect(a.crates).toEqual(b.crates);
    expect(a.covers).toEqual(b.covers);
    expect(JSON.stringify([a.crates, a.covers])).not.toBe(JSON.stringify([c.crates, c.covers]));
  });

  it('spawns are connected by a path', () => {
    expect(findPath(full, map.hiderSpawn, map.seekerSpawn).length).toBeGreaterThan(10);
  });
});

describe('map size by player count', () => {
  it('46 m up to 6 players, 52 m up to 9, then 58 m', () => {
    expect([1, 3, 6, 7, 9, 10, 12].map(mapSideFor)).toEqual([46, 46, 46, 52, 52, 58, 58]);
    expect([0, 46, 52, 58].map((s) => Math.round(areaScale(s) * 100) / 100)).toEqual([1, 1, 1.28, 1.59]);
  });

  describe.each(MAPS.map((m) => m.id))('%s stretched', (id) => {
    const count = (tiles: readonly string[], c: string) => tiles.join('').split(c).length - 1;
    it.each(MAP_SIDES.map((s) => s.side))('to %i m: exact size, same markers and objects, all floor connected', (side) => {
      const map = loadMap(id, side);
      expect([map.width, map.height]).toEqual([side, side]);
      // Single-tile markers and small objects are never repeated (only long walls/counters get longer).
      for (const c of ['S', 'P', 'C', '?', 'O']) expect(count(map.tiles, c)).toBe(count(loadMap(id).tiles, c));
      const full = buildLayout(id, 1, 10, side);
      for (const v of map.variableCandidates) full.solid[v.y * map.width + v.x] = 1;
      const walk: string[] = [];
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (!isSolid(full, x, y)) walk.push(`${x},${y}`);
      const seen = new Set([walk[0]]);
      const q = [walk[0]];
      while (q.length) {
        const [x, y] = q.shift()!.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y + dy}`;
          if (!isSolid(full, x + dx, y + dy) && !seen.has(k)) { seen.add(k); q.push(k); }
        }
      }
      expect(seen.size).toBe(walk.length);
    });
  });

  it('never shrinks a map; crates grow with the area', () => {
    expect(loadMap('kitchen', 46).tiles).toEqual(loadMap('kitchen').tiles);
    expect(buildLayout('kitchen', 1, 3, 58).crates.length).toBe(5);
    expect(buildLayout('kitchen', 1, 3, 46).crates.length).toBe(3);
  });
});
