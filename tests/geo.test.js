// The geo core against PROJ: EPSG:3814 and Albers (EPSG:5070, EPSG:3338, a
// custom Texas one) forward and inverse, the SQL filter's CRS, measuring, and
// reading typed coordinates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transverseMercator, albersEqualArea, regionProjection } from "../src/geo/project.js";
import { crsSQL, filterSQL } from "../src/geo/filter-sql.js";
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

test("Albers equal-area matches PROJ to a micrometre, and inverts to 1e-9°", () => {
  const { albers } = read("./geo-reference.json");
  assert.deepEqual(albers.map((c) => c.crs.slice(0, 10)), ["EPSG:5070", "EPSG:3338", "+proj=aea "]);
  for (const c of albers) {
    const p = albersEqualArea(c.aea);
    assert.ok(c.forward.length > 200 && c.inverse.length === c.forward.length, c.name);
    let worst = 0,
      worstBack = 0;
    for (const [lon, lat, x, y] of c.forward) {
      const [px, py] = p.forward([lon, lat]);
      worst = Math.max(worst, Math.hypot(px - x, py - y));
    }
    for (const [x, y, lon, lat] of c.inverse) {
      const [blon, blat] = p.inverse([x, y]);
      // ±180° are the same meridian; PROJ may return either.
      const dlon = Math.abs(blon - lon) > 359 ? 360 - Math.abs(blon - lon) : Math.abs(blon - lon);
      worstBack = Math.max(worstBack, dlon, Math.abs(blat - lat));
      assert.ok(blon >= -180 && blon <= 180, c.name + " longitude " + blon);
    }
    assert.ok(worst < 1e-6, c.name + " forward error " + worst + " m");
    assert.ok(worstBack < 1e-9, c.name + " inverse error " + worstBack + "°");
    // The origin maps to the false origin, and regionProjection reads .aea.
    const o = regionProjection({ projection: { aea: c.aea } }).forward([c.aea.lon0, c.aea.lat0]);
    assert.ok(Math.abs(o[0] - c.aea.x0) < 1e-6 && Math.abs(o[1] - c.aea.y0) < 1e-6, c.name);
  }
  // Aleutian points west of 180° come back with positive longitudes.
  const alaska = albersEqualArea(albers[1].aea);
  const [lon, lat] = alaska.inverse(alaska.forward([172.9, 52.9]));
  assert.ok(Math.abs(lon - 172.9) < 1e-9 && Math.abs(lat - 52.9) < 1e-9, lon + ", " + lat);
  const [ex, ey] = alaska.forward([172.9, 52.9]),
    [wx, wy] = alaska.forward([172.9 - 360, 52.9]);
  assert.ok(Math.hypot(ex - wx, ey - wy) < 1e-6);
});

test("the SQL filter's CRS: EPSG code, else PROJ string, else WGS84", () => {
  assert.equal(crsSQL(catalog.region.projection), "'EPSG:3814'");
  assert.equal(crsSQL({ proj: "+proj=aea +lat_1=27.6" }), "'+proj=aea +lat_1=27.6'");
  assert.equal(crsSQL(undefined), "'EPSG:4326'");
  const sql = filterSQL("t", "geom", { kind: "radius", center: [-90.18, 32.3], miles: 5 }, { crs: catalog.region.projection });
  assert.equal(
    sql,
    `SELECT *\nFROM "t"\nWHERE ST_DWithin(ST_Transform("geom", 'EPSG:4326', 'EPSG:3814', always_xy := true), ST_Transform(ST_Point(-90.18, 32.3), 'EPSG:4326', 'EPSG:3814', always_xy := true), 8046.72)`,
  );
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
