// Point symbols other than circles: square, triangle and diamond, drawn as
// signed-distance-field images so MapLibre can color and halo them at any
// size (icon-color, icon-halo). Pure, apart from addShapeImages(map).

export const SHAPES = ["circle", "square", "triangle", "diamond"];

/** Logical pixels: each image is SIZE wide; shapes have a half-size of HALF. */
export const SIZE = 24;
export const HALF = 8;
const RATIO = 2;
// MapLibre's SDF convention (as TinySDF): 0.75 at the edge, falling by 1 per RADIUS px outward.
const RADIUS = 6;
const CUTOFF = 0.25;

/** Signed distance (negative inside) from (x, y) to a shape centred on 0 with half-size s. */
export function shapeDistance(shape, x, y, s = HALF) {
  if (shape === "square") {
    const dx = Math.abs(x) - s,
      dy = Math.abs(y) - s;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }
  if (shape === "diamond") return (Math.abs(x) + Math.abs(y) - s * 1.25) / Math.SQRT2;
  if (shape === "triangle") {
    // An upward equilateral triangle, side 2r, centred on its bounding box
    // (Quilez's exact distance; image y runs down).
    const k = Math.sqrt(3),
      r = s * 1.15;
    let px = Math.abs(x) - r,
      py = -(y - r / (2 * k)) + r / k;
    if (px + k * py > 0) [px, py] = [(px - k * py) / 2, (-k * px - py) / 2];
    px -= Math.min(Math.max(px, -2 * r), 0);
    return -Math.hypot(px, py) * Math.sign(py);
  }
  return Math.hypot(x, y) - s;
}

/** RGBA pixels of a shape's distance field ({ width, height, data }), at 2x. */
export function shapeImage(shape) {
  const n = SIZE * RATIO,
    data = new Uint8ClampedArray(n * n * 4);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const x = (col + 0.5) / RATIO - SIZE / 2,
        y = (row + 0.5) / RATIO - SIZE / 2;
      const d = shapeDistance(shape, x, y);
      const i = (row * n + col) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * (1 - (d / RADIUS + CUTOFF)));
    }
  return { width: n, height: n, data };
}

export const shapeImageId = (shape) => "rumb-shape-" + shape;

/**
 * The hatch for unreliable estimates: diagonal stripes, a light line beside a
 * dark one, so they show on any fill color. 8 px tiles at 2x.
 */
export function hatchImage() {
  const n = 8 * RATIO,
    data = new Uint8ClampedArray(n * n * 4);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const d = (col + row) % n,
        i = (row * n + col) * 4;
      const light = d < RATIO,
        dark = d >= RATIO && d < 2 * RATIO;
      data[i] = data[i + 1] = data[i + 2] = light ? 255 : 20;
      data[i + 3] = light ? 200 : dark ? 170 : 0;
    }
  return { width: n, height: n, data };
}

/** Registers the non-circle shapes and the hatch with a MapLibre map (once). */
export function addShapeImages(map) {
  for (const shape of SHAPES.slice(1))
    if (!map.hasImage(shapeImageId(shape)))
      map.addImage(shapeImageId(shape), shapeImage(shape), { sdf: true, pixelRatio: RATIO });
  if (!map.hasImage("rumb-hatch")) map.addImage("rumb-hatch", hatchImage(), { pixelRatio: RATIO });
}
