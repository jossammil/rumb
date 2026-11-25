// A uniform grid over projected points, so that distance queries visit the
// points near a location instead of every point. The grid only narrows the
// search: callers still apply their own exact distance test to each
// candidate, and candidates come back in ascending index order where the
// order matters, so every result (sums included) is the same as a scan over
// all points. Points that are missing or not finite are left out of the grid;
// the full scans skip them too, because their distances are NaN. Pure.

/** Below this many points a full scan is as fast, and the callers keep it. */
export const GRID_MIN = 64;

/**
 * Builds the grid: { x0, y0, size, nx, ny, start, items }. Cell c holds
 * items[start[c] … start[c + 1]) in ascending index order. The cell size
 * aims at about two points per cell, or is `cell` metres when given.
 */
export function pointGrid(xy, { cell } = {}) {
  const n = xy.length;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    m = 0;
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = xy[i];
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    ok[i] = 1;
    m++;
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  if (!m) return { x0: 0, y0: 0, size: 1, nx: 1, ny: 1, start: new Int32Array(2), items: new Int32Array(0) };
  const w = x1 - x0,
    h = y1 - y0;
  // Two points per cell over the extent; a line of points gets cells along it.
  let size = cell > 0 ? cell : Math.max(Math.sqrt((2 * w * h) / m), Math.max(w, h) / m);
  if (!(size > 0)) size = 1;
  // Never more cells than about four per point.
  const cap = 4 * m + 16;
  while (Math.floor(w / size + 1) * Math.floor(h / size + 1) > cap) size *= 2;
  const nx = Math.floor(w / size) + 1,
    ny = Math.floor(h / size) + 1;
  const cellOf = new Int32Array(n),
    start = new Int32Array(nx * ny + 1);
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const c = cellIndex(xy[i][0], xy[i][1], x0, y0, size, nx, ny);
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nx * ny),
    items = new Int32Array(m);
  // A counting sort in index order keeps each cell ascending.
  for (let i = 0; i < n; i++) if (ok[i]) items[fill[cellOf[i]]++] = i;
  return { x0, y0, size, nx, ny, start, items };
}

function clamp(v, hi) {
  return v < 0 ? 0 : v > hi ? hi : v;
}

function cellIndex(x, y, x0, y0, size, nx, ny) {
  return clamp(Math.floor((y - y0) / size), ny - 1) * nx + clamp(Math.floor((x - x0) / size), nx - 1);
}

/**
 * The cell block around (x, y) that holds every point within r, widened by
 * one cell on each side so rounding at a cell edge cannot lose a point:
 * [ix0, ix1, iy0, iy1].
 */
function block(g, x, y, r) {
  if (!(r < Infinity)) return [0, g.nx - 1, 0, g.ny - 1];
  const ix = (v) => Math.floor((v - g.x0) / g.size),
    iy = (v) => Math.floor((v - g.y0) / g.size);
  return [
    clamp(ix(x - r) - 1, g.nx - 1),
    clamp(ix(x + r) + 1, g.nx - 1),
    clamp(iy(y - r) - 1, g.ny - 1),
    clamp(iy(y + r) + 1, g.ny - 1),
  ];
}

function collect(g, [ix0, ix1, iy0, iy1], sorted) {
  let count = 0;
  for (let cy = iy0; cy <= iy1; cy++) count += g.start[cy * g.nx + ix1 + 1] - g.start[cy * g.nx + ix0];
  const out = new Int32Array(count);
  let k = 0;
  for (let cy = iy0; cy <= iy1; cy++) {
    const a = g.start[cy * g.nx + ix0],
      b = g.start[cy * g.nx + ix1 + 1];
    out.set(g.items.subarray(a, b), k);
    k += b - a;
  }
  // Each cell is ascending, but not the cells together.
  if (sorted && (ix1 > ix0 || iy1 > iy0)) out.sort();
  return out;
}

/**
 * Every point that could lie within r of (x, y): a superset the caller
 * filters with its own distance test. Ascending by index when `sorted`.
 */
export function within(g, x, y, r, { sorted = true } = {}) {
  return collect(g, block(g, x, y, r), sorted);
}

/**
 * The k nearest points to point i by the caller's ranking: `rank(js)`
 * returns the chosen indices (from candidates in ascending index order) and
 * the distance of the last one chosen, { best, last }. Rings of cells are
 * added until the k-th distance is shorter than any point outside the block
 * could be, so the ranking over the candidates equals the ranking over all
 * points, ties included.
 */
export function nearest(g, x, y, k, rank) {
  // A location off the grid starts at the ring that reaches it.
  const gap = Math.max(g.x0 - x, x - (g.x0 + g.nx * g.size), g.y0 - y, y - (g.y0 + g.ny * g.size), 0);
  for (let ring = Math.max(1, Math.ceil(gap / g.size)); ; ring++) {
    const b = block(g, x, y, ring * g.size);
    const all = b[0] === 0 && b[1] === g.nx - 1 && b[2] === 0 && b[3] === g.ny - 1;
    const { best, last } = rank(collect(g, b, true));
    if (all || (best.length === k && last < outside(g, x, y, b) * (1 - 1e-12))) return best;
  }
}

/** How close a point outside the block could be to (x, y). */
function outside(g, x, y, [ix0, ix1, iy0, iy1]) {
  let d = Infinity;
  if (ix0 > 0) d = Math.min(d, x - (g.x0 + ix0 * g.size));
  if (ix1 < g.nx - 1) d = Math.min(d, g.x0 + (ix1 + 1) * g.size - x);
  if (iy0 > 0) d = Math.min(d, y - (g.y0 + iy0 * g.size));
  if (iy1 < g.ny - 1) d = Math.min(d, g.y0 + (iy1 + 1) * g.size - y);
  return Math.max(0, d - g.size * 1e-9);
}
