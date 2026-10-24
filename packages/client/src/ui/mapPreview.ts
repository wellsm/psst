import { buildLayout, isSolid, type MapDef } from '@psst/shared';

const COLORS: Record<string, string> = {
  '#': '#8a5a3b', X: '#ff8f3c', O: '#55c8ff', L: '#a0693f', '*': '#ffd23f', '~': '#bfe6ff', ':': '#b7793d', '=': '#e84a5f',
};

/** Per-theme floor/wall/box/rug colors so thumbnails tell maps apart at a glance. */
const THEME_COLORS: Record<MapDef['theme'], { floor: string; '#': string; X: string; '=': string }> = {
  kitchen: { floor: '#f6ead2', '#': '#8a5a3b', X: '#ff8f3c', '=': '#e84a5f' },
  terrarium: { floor: '#ead59b', '#': '#5fb8d0', X: '#9b6a3c', '=': '#4caf50' },
  playroom: { floor: '#e9c79a', '#': '#4d8dff', X: '#ff4d5e', '=': '#4d8dff' },
  snowglobe: { floor: '#f4f8ff', '#': '#7fb9e6', X: '#7a4b2a', '=': '#7ed957' },
};

/** Thumbnail edge in canvas pixels; every map is letterboxed into the same square. */
export const PREVIEW_SIZE = 240;

/** Draws a top-down thumbnail of a map (seed 0 layout) into a fixed-size square canvas. */
export function drawMapPreview(canvas: HTMLCanvasElement, mapId: string, stations: number) {
  const layout = buildLayout(mapId, 0, stations);
  const { width, height, tiles, def } = layout.map;
  const theme = THEME_COLORS[def.theme];
  const px = Math.floor(PREVIEW_SIZE / Math.max(width, height));
  const ox = Math.floor((PREVIEW_SIZE - width * px) / 2);
  const oy = Math.floor((PREVIEW_SIZE - height * px) / 2);
  canvas.width = canvas.height = PREVIEW_SIZE;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  g.fillStyle = theme.floor;
  g.fillRect(ox, oy, width * px, height * px);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = tiles[y * width + x];
      let col: string | undefined = c === '#' || c === 'X' || c === '=' ? theme[c] : COLORS[c];
      if (c === 'C' || c === '?') col = isSolid(layout, x, y) ? (c === 'C' ? '#7ed957' : '#dddddd') : undefined;
      if (c === 'S') col = '#4d8dff';
      if (c === 'P') col = '#ff4d5e';
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
}
