import { describe, expect, it } from 'vitest';
import { MAPS, buildLayout, findPath, isSolid, loadMap } from '../src/maps';

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
