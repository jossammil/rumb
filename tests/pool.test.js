// Point counts against GEOS (st_within on the display files) and pooled
// measures against map_project's measure_aggregate rules, computed in R.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countPoints } from "../src/geo/counts.js";
import { projectedIndex } from "../src/geo/filter.js";
import { transverseMercator } from "../src/geo/project.js";
import { aggregate, coverageLabel, neighborsOf, poolOf } from "../src/stats/pool.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./counts-reference.json");
const catalog = read("../public/data/ms/catalog.json");
const library = read("../public/data/ms/layers/library.json");
const projection = transverseMercator(catalog.region.projection.tmerc);
const layer = (p) => read("../public/data/ms/" + p);
const index = (c) => projectedIndex(c, projection, (f) => String(f.id));
const stations = index(layer("layers/fire_stations_2020.geojson"));

test("points counted in each tract and county match GEOS", () => {
  for (const [file, expected] of [["tracts.geojson", ref.tracts], ["layers/chr_counties_2025.geojson", ref.counties]]) {
    const counts = countPoints(index(layer(file)), stations);
    assert.deepEqual(Object.fromEntries(counts), expected, file);
  }
});

test("pooled measures for a county, its neighbors and both match R", () => {
  const chr = library.layers.find((l) => l.id === "chr_counties_2025");
  const graph = layer(chr.neighbors).queen;
  const neighbors = neighborsOf([ref.selected], graph).sort();
  assert.deepEqual(neighbors, ref.neighbors);
  const rows = new Map(layer(chr.file).features.map((f) => [String(f.id), f.properties]));
  const pick = (ids) => ids.map((id) => rows.get(id));
  for (const [field, want] of Object.entries(ref.pooled)) {
    const pool = poolOf(chr.fields[field]);
    for (const [part, ids] of [["selected", [ref.selected]], ["neighbors", neighbors], ["total", [ref.selected, ...neighbors]]]) {
      const got = aggregate(pick(ids), pool),
        r = want[part];
      const label = field + " " + part;
      if (r.value == null) assert.equal(got.value, null, label);
      else assert.ok(Math.abs(got.value - r.value) <= 1e-9 * Math.max(1, Math.abs(r.value)), label + ` ${got.value} vs ${r.value}`);
      assert.equal(got.used, r.used, label);
      assert.equal(got.total, r.total, label);
      assert.equal(got.suppressed, r.suppressed, label);
    }
  }
});

test("pooling rules, coverage labels and reference fields", () => {
  const pool = { kind: "ratio", numerator: "n", denominator: "d", scale: 100, flag: "f" };
  const rows = [
    { n: 10, d: 100, f: 0 },
    { n: 5, d: 50, f: 1 },
    { n: 99, d: 100, f: 2 },
    { n: null, d: 10, f: 0 },
    { n: 3, d: 0 },
  ];
  const agg = aggregate(rows, pool);
  assert.equal(agg.value, 10);
  assert.deepEqual([agg.used, agg.total, agg.suppressed, agg.unreliable], [2, 5, 1, 1]);
  assert.equal(coverageLabel(agg), "2 of 5 (1 suppressed, 1 unreliable)");
  assert.equal(aggregate([{ n: 2 }, { n: 3 }], { kind: "count", numerator: "n" }).value, 5);
  assert.equal(aggregate([], pool).value, null);
  // Tract fields pool their count over their universe.
  const tract = poolOf(catalog.layers[0].fields.poverty_pct);
  assert.deepEqual(tract, { kind: "ratio", numerator: "poverty_count", denominator: "poverty_universe", scale: 100 });
  assert.equal(poolOf({ label: "x" }), null);
});
