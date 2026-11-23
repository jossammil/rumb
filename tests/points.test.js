// Point patterns against formulas computed in R on sf's projection: the
// outline's area, average nearest neighbor, Ripley's L(d) − d, centrography
// (weighted, with Weiszfeld's median), Esri's default bandwidth and the
// quartic kernel density, for health departments and nursing-home beds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator } from "../src/geo/project.js";
import { mapGeometry } from "../src/geo/spatial.js";
import { randomGenerator } from "../src/stats/random.js";
import {
  averageNearestNeighbor,
  centrography,
  defaultBandwidth,
  densityGrid,
  ellipseRing,
  envelope,
  inside,
  polygonArea,
  quarticDensity,
  randomPoints,
  ripleyL,
} from "../src/stats/points.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./models-reference.json").points;
const catalog = read("../public/data/ms/catalog.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const outline = read("../public/data/ms/outline.geojson").features.map((f) => mapGeometry(f.geometry, projection.forward));
const polygons = outline.flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates));
const area = polygonArea(polygons);
const layer = (id, field) => {
  const f = read("../public/data/ms/layers/" + id + ".geojson").features;
  return { xy: f.map((x) => projection.forward(x.geometry.coordinates)), w: field ? f.map((x) => x.properties[field]) : null };
};
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

test("the outline's projected area matches sf", () => close(area, ref.area, 1e-6, "area"));

for (const [name, id, field] of [
  ["health", "public_health_departments_2010", null],
  ["nursing", "nursing_homes_2024", "beds"],
]) {
  test(`point pattern statistics for ${name} match R`, () => {
    const { xy, w } = layer(id, field);
    const want = ref[name];
    const ann = averageNearestNeighbor(xy, area);
    close(ann.observed, want.ann.observed, 1e-7, "observed");
    close(ann.expected, want.ann.expected, 1e-6, "expected");
    close(ann.ratio, want.ann.ratio, 1e-6, "ratio");
    close(ann.z, want.ann.z, 1e-6, "z");
    ripleyL(xy, area, want.distances).forEach((v, i) => close(v, want.L[i], 1e-6, "L " + i));
    const c = centrography(xy, w);
    close(c.mean[0], want.mean[0], 1e-9, "mean x");
    close(c.mean[1], want.mean[1], 1e-9, "mean y");
    close(c.median[0], want.median[0], 1e-6, "median x");
    close(c.median[1], want.median[1], 1e-6, "median y");
    close(c.standardDistance, want.standardDistance, 1e-7, "standard distance");
    close(c.ellipse.theta, want.theta, 1e-9, "theta");
    close(c.ellipse.sx, want.sx, 1e-7, "sx");
    close(c.ellipse.sy, want.sy, 1e-7, "sy");
    close(defaultBandwidth(xy, w), want.bandwidth, 1e-7, "bandwidth");
    want.at.forEach((p, i) => {
      close(quarticDensity(p, xy, w, want.bandwidth), want.density[i], 1e-6, "density " + i);
      close(quarticDensity(p, xy, w, 15 * 1609.344), want.density15[i], 1e-6, "density at 15 mi " + i);
    });
  });
}

test("CSR envelopes stay inside the outline and bracket the pattern's scale", () => {
  const random = randomGenerator(11);
  const pts = randomPoints(200, polygons, random);
  assert.ok(pts.every((p) => inside(p, polygons)));
  const d = [5, 20].map((m) => m * 1609.344);
  const { lo, hi } = envelope(90, polygons, area, d, 19, random);
  assert.ok(lo.every((v, i) => v <= hi[i]));
  // Health departments, about one per county, are more regular than random at 20 miles: below the envelope.
  const { xy } = layer("public_health_departments_2010");
  assert.ok(ripleyL(xy, area, d)[1] < lo[1], ripleyL(xy, area, d)[1] + " vs " + lo[1]);
});

test("the ellipse lies along the points' direction, and the density grid stays inside", () => {
  const line = Array.from({ length: 50 }, (_, i) => [i * 100 + (i % 3) * 5, i * 100 - (i % 3) * 5]);
  const ring = ellipseRing(centrography(line).ellipse);
  const far = ring.reduce((a, p) => (Math.hypot(p[0] - 2450, p[1] - 2450) > Math.hypot(a[0] - 2450, a[1] - 2450) ? p : a));
  assert.ok(Math.abs(Math.abs(Math.atan2(far[1] - 2450, far[0] - 2450)) - Math.PI / 4) < 0.05 || Math.abs(Math.abs(Math.atan2(far[1] - 2450, far[0] - 2450)) - (3 * Math.PI) / 4) < 0.05);
  const { xy } = layer("public_health_departments_2010");
  const grid = densityGrid(xy, null, polygons, { cell: 20000 });
  assert.ok(grid.cells.length > 50 && grid.cells.every(([x, y, v]) => inside([x, y], polygons) && v > 0));
});
