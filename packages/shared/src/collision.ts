import { isSolid, type Layout } from './maps';

/** Push a circle out of solid tiles. Returns corrected position. */
function resolve(layout: Layout, x: number, y: number, r: number, jumping: boolean): { x: number; y: number } {
  const minX = Math.floor(x - r), maxX = Math.floor(x + r);
  const minY = Math.floor(y - r), maxY = Math.floor(y + r);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!isSolid(layout, tx, ty, jumping)) continue;
      const nx = Math.max(tx, Math.min(x, tx + 1));
      const ny = Math.max(ty, Math.min(y, ty + 1));
      const dx = x - nx, dy = y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        y = ny + (dy / d) * r;
      } else {
        // Center inside the tile: push along the shallowest axis.
        const left = x - tx, right = tx + 1 - x, up = y - ty, down = ty + 1 - y;
        const m = Math.min(left, right, up, down);
        if (m === left) x = tx - r;
        else if (m === right) x = tx + 1 + r;
        else if (m === up) y = ty - r;
        else y = ty + 1 + r;
      }
    }
  }
  return { x, y };
}

/** Move a circle by (dx, dy) against the tile grid, sliding along walls. */
export function moveCircle(layout: Layout, x: number, y: number, dx: number, dy: number, r: number, jumping = false): { x: number; y: number; blocked: boolean } {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  let px = x, py = y;
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    const tx = px + dx / steps, ty = py + dy / steps;
    const p = resolve(layout, tx, ty, r, jumping);
    if (Math.abs(p.x - tx) > 1e-6 || Math.abs(p.y - ty) > 1e-6) blocked = true;
    px = p.x;
    py = p.y;
  }
  return { x: px, y: py, blocked };
}

/** Grid ray (DDA) from (x0,y0) to (x1,y1). Returns the fraction t∈[0,1] of the first solid hit, or 1. */
export function raycast(layout: Layout, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  let tx = Math.floor(x0), ty = Math.floor(y0);
  if (isSolid(layout, tx, ty)) return 0;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * tDeltaY : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t > 1) return 1;
    if (isSolid(layout, tx, ty)) return t;
  }
}

/** First t∈[0,1] where segment p0→p1 comes within r of circle center c, or -1. */
export function segmentCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
