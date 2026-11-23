// The geo core against PROJ: EPSG:3814 forward and inverse, measuring, and
// reading typed coordinates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator, regionProjection } from "../src/geo/project.js";
import { measurePath, pathLength, ringArea, formatMiles, METRES_PER_MILE } from "../src/geo/measure.js";
import { parseCoordinate } from "../src/geo/coords.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const catalog = read("../public/data/ms/catalog.json");
const mstm = transverseMercator(catalog.region.projection.tmerc);

test("EPSG:3814 matches PROJ to under a millimetre, and inverts", () => {
  const ref = read("./geo-reference.json");
  assert.ok(ref.points.length > 250);
  let worst = 0,
    worstBack = 0;
  for (const [lon, lat, x, y] of ref.points) {
    const [px, py] = mstm.forward([lon, lat]);
    worst = Math.max(worst, Math.hypot(px - x, py - y));
    const [blon, blat] = mstm.inverse([x, y]);
    worstBack = Math.max(worstBack, Math.abs(blon - lon), Math.abs(blat - lat));
  }
  assert.ok(worst < 0.001, "forward error " + worst + " m");
  assert.ok(worstBack < 1e-9, "inverse error " + worstBack + "°");
  // The false origin: 32.5°N 89.75°W maps to (500000, 1300000).
  const [x0, y0] = mstm.forward([-89.75, 32.5]);
  assert.ok(Math.abs(x0 - 500000) < 1e-6 && Math.abs(y0 - 1300000) < 1e-6);
  assert.deepEqual(regionProjection(catalog.region).forward([-89.75, 32.5]).map(Math.round), [500000, 1300000]);
});

test("lengths and areas in miles", () => {
  assert.equal(pathLength([[0, 0], [3, 4], [3, 10]]), 11);
  assert.equal(ringArea([[0, 0], [METRES_PER_MILE, 0], [METRES_PER_MILE, METRES_PER_MILE], [0, METRES_PER_MILE]]), METRES_PER_MILE ** 2);
  // A one-degree-of-latitude line near Jackson is about 69 miles.
  const north = measurePath([[-90.18, 32], [-90.18, 33]], mstm);
  assert.ok(Math.abs(north.miles - 69.0) < 0.2, north.miles);
  assert.equal(north.squareMiles, null);
  const box = measurePath([[-90.2, 32.2], [-90.1, 32.2], [-90.1, 32.3], [-90.2, 32.3]], mstm);
  assert.ok(box.squareMiles > 39 && box.squareMiles < 41, box.squareMiles);
  assert.ok(box.closedMiles > box.miles);
  assert.equal(formatMiles(0.4234), "0.42 mi");
  assert.equal(formatMiles(1234.5, "sq mi"), "1,235 sq mi");
});

test("typed coordinates: decimal, either order, and degrees-minutes-seconds", () => {
  const near = (got, want) => assert.ok(got && Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9, JSON.stringify(got));
  near(parseCoordinate("32.3, -90.18"), [-90.18, 32.3]);
  near(parseCoordinate("-90.18 32.3"), [-90.18, 32.3]);
  near(parseCoordinate("32.3 N, 90.18 W"), [-90.18, 32.3]);
  near(parseCoordinate("32°18′N 90°10′48″W"), [-90.18, 32.3]);
  near(parseCoordinate("N 32 18 W 90 10 48"), [-90.18, 32.3]);
  near(parseCoordinate("32 18 -90 10.8"), [-90.18, 32.3]);
  assert.equal(parseCoordinate("Jackson"), null);
  assert.equal(parseCoordinate("32.3"), null);
  assert.equal(parseCoordinate("95, 200"), null);
  assert.equal(parseCoordinate("32 61 N 90 W"), null);
});
