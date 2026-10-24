import { Rng, type Vec2 } from './math';

// Tile legend (1 tile = 1 m):
// '#' perimeter  'X' box/counter  'O' mug/bowl  'L' leg/cube  '*' beacon
// '~' puddle (noisy)  ':' crumbs (noisy)  '=' rug  '.' floor
// 'C' crate candidate  '?' variable cover candidate  'S' hider spawn  'P' seeker spawn

export type Surface = 'floor' | 'water' | 'crumbs' | 'rug';
export type MapId = 'kitchen' | 'arena' | 'playroom' | 'snowglobe';

export interface MapDef {
  id: MapId;
  ascii: readonly string[];
  /** Visual theme key used by the renderer. */
  theme: 'kitchen' | 'terrarium' | 'playroom' | 'snowglobe';
}

export const GHOST_BORDER = 6;

const KITCHEN: MapDef = {
  id: 'kitchen',
  theme: 'kitchen',
  ascii: [
    '##############################################',
    '#..............XX............XX............C.#',
    '#.~~~.....OO...XX.==.........XX.........~~~~.#',
    '#.~~~..?..OO...XX..........?.XX..OO.....~~~~.#',
    '#..............XX............XX..OO.....~~~~.#',
    '#..............XX............XX..............#',
    '#.....S......................XX..............#',
    '#............................XX.......XX.....#',
    '#....................::::.............XX.....#',
    '#....................::::.............XX.....#',
    '#.LL......OO...XX.L..::::..L..........XX..?..#',
    '#.LL......OO...XX............................#',
    '#..............XX..?.........XX..............#',
    '#............C.XX..........C.XX.....?........#',
    '#..............XX............XX..............#',
    '#XXXX....XXXXXXXXXXX......XXXXXXXXXX....XXXXX#',
    '#XXXX....XXXXXXXXXXX......XXXXXXXXXX....XXXXX#',
    '#..............XX...........CXX..............#',
    '#...........?..XX.L........L.XX..........?...#',
    '#...XX.........XX......?.....XX..............#',
    '#...XX..............::::::...................#',
    '#...XX..............::::::...................#',
    '#C........OO........::**::............XXXX..C#',
    '#.........OO........::**::............XXXX...#',
    '#...................::::::...................#',
    '#......~~~..........::::::......~~~~.........#',
    '#..L...~~~.....XX.....?......XX.~~~~......L..#',
    '#......~~~..?..XX.L........L.XX.~~~~..?......#',
    '#..............XXC...........XX..............#',
    '#XXXXXX....XXXXXXXXX......XXXXXXXX....XXXXXXX#',
    '#XXXXXX....XXXXXXXXX......XXXXXXXX....XXXXXXX#',
    '#..............XX........?...XX......~~~.....#',
    '#..............XX............XX..............#',
    '#..OO..........XX............XX..OO.......L..#',
    '#..OO.....L....XX.........L......OO..........#',
    '#..............XX......................?.....#',
    '#......?.....................................#',
    '#............................................#',
    '#....................::::....XX.......P......#',
    '#....XX..~~~~........::::....XX..............#',
    '#....XX..~~~~..XX....::::....XX..............#',
    '#....XX..~~~~..XX.OO.........XX..........OO..#',
    '#.?............XX.OO.........XX..L.......OO..#',
    '#..............XXC.....===...XX..............#',
    '#C.............XX............XX.............C#',
    '##############################################',
  ],
};

const ARENA: MapDef = {
  id: 'arena',
  theme: 'terrarium',
  ascii: [
    '######################################',
    '#.................C..................#',
    '#........~~~~........................#',
    '#..S.....~~~~........................#',
    '#..............C.....................#',
    '#....................................#',
    '#.....OO....OO....XX....OO....OO.....#',
    '#.....OO....OO....XX....OO....OO.....#',
    '#....................................#',
    '#........C......======......C.....~~.#',
    '#.................................~~.#',
    '#.................................~~.#',
    '#.....OO....OO.?........OO....OO..~~.#',
    '#.....OO....OO..........OO....OO.....#',
    '#....................................#',
    '#...?..........::::::::..?...........#',
    '#....................................#',
    '#....................................#',
    '#C....XX..........**..........XX....C#',
    '#.....XX..........**..........XX.....#',
    '#....................................#',
    '#....................................#',
    '#...........?..::::::::..........?...#',
    '#....................................#',
    '#.....OO....OO..........OO....OO.....#',
    '#.~~..OO....OO........?.OO....OO.....#',
    '#.~~.................................#',
    '#.~~.................................#',
    '#.~~.....C......======......C........#',
    '#....................................#',
    '#.....OO....OO....XX....OO....OO.....#',
    '#.....OO....OO....XX....OO....OO.....#',
    '#....................................#',
    '#.....................C..............#',
    '#........................~~~~.....P..#',
    '#........................~~~~........#',
    '#.................C..................#',
    '######################################',
  ],
};

const PLAYROOM: MapDef = {
  id: 'playroom',
  theme: 'playroom',
  ascii: [
    '############################################',
    '#..........................................#',
    '#...................S......................#',
    '#..XXXXXXXXXX...............XXXXXXXXXXXX...#',
    '#..X........X...............XXXXXXXXXXXX...#',
    '#..X.C......X...~~~~..X....................#',
    '#..X...?........~~~~..X..........?.......C.#',
    '#..X............~~~~..X..L.................#',
    '#..X......L.X.........X.....XXXXX..XXXXX...#',
    '#..X........X..............................#',
    '#..XXXX..XXXX......C.......................#',
    '#.......................?..................#',
    '#.............OO............OO......?......#',
    '#.............OO............OO...XX........#',
    '#....XX.C.......============.....XX......L.#',
    '#....XX......C..==?=========.........~~~...#',
    '#...............============.........~~~...#',
    '#........XX.....===::::::===.........~~~...#',
    '#........XX.....===::::::===.........~~~...#',
    '#..~~~......?...===::**::===...............#',
    '#..~~~..........===::**::===..C..........?.#',
    '#..~~~..........===::::::===.....X.........#',
    '#.........X.....===::::::===.....X.........#',
    '#.........X.....============.....X.....XX..#',
    '#.C.......X.....=========?==.....X.....XX..#',
    '#....XX.........============...............#',
    '#....XX.......OO............OO......?......#',
    '#.............OO............OO.............#',
    '#..........................................#',
    '#............................LL......LL....#',
    '#..XXXXXXXXX..X...OO....L....LL......LL....#',
    '#.............X...OO.......................#',
    '#........L....X..................?.......C.#',
    '#...?.........X...................C........#',
    '#.....XXXXX...X..?.....~~~~................#',
    '#.....XXXXX...X........~~~~..LL......LL....#',
    '#...........C................LL......LL....#',
    '#.C...................P....C...............#',
    '#..........................................#',
    '############################################',
  ],
};

const SNOWGLOBE: MapDef = {
  id: 'snowglobe',
  theme: 'snowglobe',
  ascii: [
    '##########################################',
    '#############................#############',
    '###########....................###########',
    '#########..........XXXX..........#########',
    '########..........................########',
    '#######........C.....S.............#######',
    '######..............................######',
    '#####..==......XX........XX......==..#####',
    '####...==......XX........XX.....C==...####',
    '###................?...................###',
    '###....................C...............###',
    '##......................................##',
    '##...........................?..........##',
    '#............~~~...........~~~...........#',
    '#............~~~OO......OO.~~~...........#',
    '#......XX..?.~~~OO......OO.~~~...XX......#',
    '#......XX........................XX......#',
    '#..................?..?........C.........#',
    '#...C.............::::::.................#',
    '#..X..............::::::.?............X..#',
    '#..X.........OO...::**::....OO........X..#',
    '#..X.........OO..?::**::....OO........X.L#',
    '#..X..............::::::.........?....X..#',
    '#.................::::::.?...............#',
    '#.................?...................C..#',
    '#......XX.?C..........?..........XX......#',
    '#......XX.......OO......OO.......XX......#',
    '#............~~~OO......OO.~~~...........#',
    '#............~~~...........~~~...........#',
    '##...........~~~...........~~~..........##',
    '##......................................##',
    '###.........................?..........###',
    '###..............?.C...................###',
    '####...==......XX........XX......==...####',
    '#####..==.C....XX........XX......==..#####',
    '######..............................######',
    '#######............................#######',
    '########.............P.....C......########',
    '#########..........XXXX..........#########',
    '###########....................###########',
    '#############........L.......#############',
    '##########################################',
  ],
};

export const MAPS: readonly MapDef[] = [KITCHEN, ARENA, PLAYROOM, SNOWGLOBE];
export const MAP_IDS: readonly MapId[] = MAPS.map((m) => m.id);

export function getMapDef(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? KITCHEN;
}

const STATIC_SOLID = new Set(['#', 'X', 'O', 'L', '*']);
/** Solids low enough to hop over with the super-jump power-up (crates and variable covers too). */
const STATIC_LOW = new Set(['O']);

export interface MapData {
  def: MapDef;
  width: number;
  height: number;
  /** Raw tile chars, row-major. */
  tiles: string[];
  hiderSpawn: Vec2;
  seekerSpawn: Vec2;
  beacon: Vec2;
  crateCandidates: Vec2[];
  variableCandidates: Vec2[];
  /** Ghosts fly within these bounds (playable area expanded by GHOST_BORDER). */
  ghostBounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Map side (m) by player count at match start; smaller maps are stretched up to it, never shrunk. */
export const MAP_SIDES: readonly { maxPlayers: number; side: number }[] = [
  { maxPlayers: 6, side: 46 },
  { maxPlayers: 9, side: 52 },
  { maxPlayers: Infinity, side: 58 },
];

export function mapSideFor(players: number): number {
  return MAP_SIDES.find((s) => players <= s.maxPlayers)!.side;
}

/** Crates and traps grow with the floor: ×1 up to the smallest side, then by area (0 = as drawn = ×1). */
export function areaScale(side: number): number {
  const base = MAP_SIDES[0].side;
  return side > base ? (side * side) / (base * base) : 1;
}

/** Floor-like tiles a stretch seam may cross (they just get bigger). */
const SEAM_FREE = new Set(['.', '~', ':', '=']);

/** Rows that may be repeated: every other tile continues straight through, so objects get longer, never wider. */
function seamRows(rows: readonly string[]): number[] {
  const out: number[] = [];
  for (let y = 1; y < rows.length - 1; y++) {
    let ok = true;
    for (let x = 0; ok && x < rows[y].length; x++) {
      const c = rows[y][x];
      if (!SEAM_FREE.has(c) && (rows[y - 1][x] !== c || rows[y + 1][x] !== c)) ok = false;
    }
    if (ok) out.push(y);
  }
  return out;
}

/** Repeats seam rows (spread over the seams) until there are `target` rows. */
function stretchRows(rows: readonly string[], target: number): string[] {
  const extra = target - rows.length;
  const seams = seamRows(rows);
  if (extra <= 0 || !seams.length) return [...rows];
  const times = new Map<number, number>();
  for (let i = 0; i < extra; i++) {
    const y = seams[Math.floor(((i + 0.5) * seams.length) / extra)];
    times.set(y, (times.get(y) ?? 0) + 1);
  }
  return rows.flatMap((r, y) => Array<string>(1 + (times.get(y) ?? 0)).fill(r));
}

const transpose = (rows: readonly string[]) => [...rows[0]].map((_, x) => rows.map((r) => r[x]).join(''));

/** The map's ASCII stretched to at least `side` × `side` tiles (0 = as drawn). */
export function stretchAscii(ascii: readonly string[], side: number): string[] {
  return transpose(stretchRows(transpose(stretchRows(ascii, side)), side));
}

const cache = new Map<string, MapData>();

export function loadMap(id: string, side = 0): MapData {
  const def = getMapDef(id);
  const cacheKey = `${def.id}:${side}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const ascii = stretchAscii(def.ascii, side);
  const height = ascii.length;
  const width = ascii[0].length;
  const tiles: string[] = [];
  const crateCandidates: Vec2[] = [];
  const variableCandidates: Vec2[] = [];
  let hiderSpawn: Vec2 = { x: 2.5, y: 2.5 };
  let seekerSpawn: Vec2 = { x: width - 2.5, y: height - 2.5 };
  let bx = 0, by = 0, bn = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = ascii[y][x];
      tiles.push(c);
      if (c === 'S') hiderSpawn = { x: x + 0.5, y: y + 0.5 };
      if (c === 'P') seekerSpawn = { x: x + 0.5, y: y + 0.5 };
      if (c === 'C') crateCandidates.push({ x, y });
      if (c === '?') variableCandidates.push({ x, y });
      if (c === '*') { bx += x + 0.5; by += y + 0.5; bn++; }
    }
  }
  const data: MapData = {
    def,
    width,
    height,
    tiles,
    hiderSpawn,
    seekerSpawn,
    beacon: bn ? { x: bx / bn, y: by / bn } : { x: width / 2, y: height / 2 },
    crateCandidates,
    variableCandidates,
    ghostBounds: { x0: 1 - GHOST_BORDER, y0: 1 - GHOST_BORDER, x1: width - 1 + GHOST_BORDER, y1: height - 1 + GHOST_BORDER },
  };
  cache.set(cacheKey, data);
  return data;
}

export type VariableKind = 'cube' | 'bowl' | 'spool';

export interface Layout {
  map: MapData;
  seed: number;
  /** 1 = solid, row-major. */
  solid: Uint8Array;
  /** 1 = low solid (super-jump passes over it), row-major. */
  low: Uint8Array;
  crates: Vec2[];
  /** Variable covers that became solid, with a visual kind. */
  covers: { x: number; y: number; kind: VariableKind }[];
}

/** Deterministic layout: same (map, seed, stations, side) gives the same result everywhere. */
export function buildLayout(mapId: string, seed: number, stations: number, side = 0): Layout {
  const map = loadMap(mapId, side);
  const rng = new Rng(seed);
  const solid = new Uint8Array(map.width * map.height);
  const low = new Uint8Array(map.width * map.height);
  for (let i = 0; i < map.tiles.length; i++) {
    if (STATIC_SOLID.has(map.tiles[i])) solid[i] = 1;
    if (STATIC_LOW.has(map.tiles[i])) low[i] = 1;
  }
  const wanted = Math.round(stations * areaScale(side));
  const crates = rng.shuffle([...map.crateCandidates]).slice(0, Math.max(0, Math.min(wanted, map.crateCandidates.length)));
  for (const c of crates) solid[c.y * map.width + c.x] = low[c.y * map.width + c.x] = 1;
  const kinds: VariableKind[] = ['cube', 'bowl', 'spool'];
  const covers: Layout['covers'] = [];
  for (const v of map.variableCandidates) {
    if (rng.next() < 0.5) {
      solid[v.y * map.width + v.x] = low[v.y * map.width + v.x] = 1;
      covers.push({ x: v.x, y: v.y, kind: kinds[rng.int(kinds.length)] });
    }
  }
  return { map, seed, solid, low, crates, covers };
}

/** `jumping`: low solids do not block (super-jump). */
export function isSolid(layout: Layout, tx: number, ty: number, jumping = false): boolean {
  const { width, height } = layout.map;
  if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
  const i = ty * width + tx;
  return layout.solid[i] === 1 && !(jumping && layout.low[i] === 1);
}

/** True when a circle overlaps a low solid tile (a jumper standing on top of one). */
export function onLowSolid(layout: Layout, x: number, y: number, r: number): boolean {
  const { width } = layout.map;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= layout.map.height || layout.low[ty * width + tx] !== 1) continue;
      const nx = Math.max(tx, Math.min(x, tx + 1)), ny = Math.max(ty, Math.min(y, ty + 1));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
  }
  return false;
}

export function surfaceAt(map: MapData, x: number, y: number): Surface {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 'floor';
  const c = map.tiles[ty * map.width + tx];
  if (c === '~') return 'water';
  if (c === ':') return 'crumbs';
  if (c === '=') return 'rug';
  return 'floor';
}

export const isNoisySurface = (s: Surface) => s === 'water' || s === 'crumbs';

/** Spawn points clustered around a spawn marker, only on free tiles. */
export function spawnCluster(layout: Layout, center: Vec2, count: number, rng: Rng): Vec2[] {
  const out: Vec2[] = [];
  const cx = Math.floor(center.x), cy = Math.floor(center.y);
  const free: Vec2[] = [];
  for (let r = 0; r <= 4 && free.length < Math.max(count, 12); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (!isSolid(layout, cx + dx, cy + dy)) free.push({ x: cx + dx + 0.5, y: cy + dy + 0.5 });
    }
  }
  for (let i = 0; i < count; i++) {
    const p = free[i % free.length] ?? center;
    out.push({ x: p.x + rng.range(-0.15, 0.15), y: p.y + rng.range(-0.15, 0.15) });
  }
  return out;
}

/** BFS path on the tile grid (8-way, no corner cutting). Returns tile centers excluding start. */
export function findPath(layout: Layout, from: Vec2, to: Vec2): Vec2[] {
  const { width, height } = layout.map;
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const gx = Math.floor(to.x), gy = Math.floor(to.y);
  if (isSolid(layout, gx, gy)) return [];
  const prev = new Int32Array(width * height).fill(-1);
  const start = sy * width + sx;
  const goal = gy * width + gx;
  prev[start] = start;
  const queue = [start];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const x = cur % width, y = (cur / width) | 0;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (isSolid(layout, nx, ny)) continue;
      if (dx && dy && (isSolid(layout, x + dx, y) || isSolid(layout, x, y + dy))) continue;
      const ni = ny * width + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return [];
  const path: Vec2[] = [];
  for (let c = goal; c !== start; c = prev[c]) path.push({ x: (c % width) + 0.5, y: ((c / width) | 0) + 0.5 });
  return path.reverse();
}
