// Rate smoothing against spdep (EBest; EBlocal with geoda = TRUE), window
// rates and excess risk against their formulas in R, exact Poisson limits
// against poisson.test, and ACS reliability classes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acsReliability,
  empiricalBayes,
  excessRisk,
  rateFields,
  rateLimits,
  rateSpec,
  spatialEmpiricalBayes,
  spatialRate,
} from "../src/stats/rates.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = read("./stats-reference.json").rates;
const close = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(Math.abs(want), 1e-300), `${what}: ${got} vs ${want}`);

const chr = read("../public/data/ms/layers/chr_counties_2025.geojson").features;
const tracts = read("../public/data/ms/tracts.geojson").features.map((f) => f.properties);
const queen = read("../public/data/ms/neighbors.json").queen;

test("global empirical Bayes, excess risk and Poisson limits match R on County Health Rankings", () => {
  const events = chr.map((f) => f.properties.v138_numerator ?? null),
    base = chr.map((f) => f.properties.v138_denominator ?? null);
  const at = new Map(chr.map((f, i) => [String(f.id), i]));
  const { estimates, a, b } = empiricalBayes(events, base);
  close(a, ref.chr.a, 1e-10, "a");
  close(b, ref.chr.b, 1e-12, "b");
  const excess = excessRisk(events, base),
    limits = rateLimits(events, base);
  ref.chr.ids.forEach((id, k) => {
    const i = at.get(id);
    close(estimates[i], ref.chr.eb[k], 1e-10, "EB " + id);
    close(excess[i], ref.chr.excess[k], 1e-12, "excess " + id);
    close(limits[i][0], ref.chr.lower[k], 1e-12, "lower " + id);
    close(limits[i][1], ref.chr.upper[k], 1e-12, "upper " + id);
  });
  // Counties without counts (suppressed below 10) stay out, not zero.
  const missing = chr.findIndex((f) => f.properties.v138_numerator == null);
  assert.equal(estimates[missing], null);
});

test("spatial empirical Bayes and window rates match spdep and R over the queen graph", () => {
  const ids = ref.tracts.ids,
    index = new Map(ids.map((id, i) => [id, i]));
  const props = new Map(tracts.map((p) => [p.GEOID, p]));
  const events = ids.map((id) => props.get(id).poverty_count),
    base = ids.map((id) => props.get(id).poverty_universe);
  const rows = ids.map((id) => queen[id].filter((j) => index.has(j)).map((j) => index.get(j)));
  const seb = spatialEmpiricalBayes(events, base, rows),
    window = spatialRate(events, base, rows);
  ids.forEach((id, i) => {
    close(seb[i], ref.tracts.seb[i], 1e-10, "spatial EB " + id);
    close(window[i], ref.tracts.window[i], 1e-12, "window " + id);
  });
});

test("rate specs become derived fields on the measure's scale", () => {
  assert.equal(rateSpec({ kind: "rate", measure: "x", methods: ["nope"] }), null);
  assert.deepEqual(rateSpec({ kind: "rate", measure: "x", methods: ["eb", "eb", "ci"] }), {
    kind: "rate",
    measure: "x",
    methods: ["eb", "ci"],
  });
  const features = [
    { properties: { e: 5, n: 1000 } },
    { properties: { e: 0, n: 500 } },
    { properties: { e: 30, n: 2000 } },
    { properties: { e: null, n: 100 } },
  ];
  const rows = [[1], [0, 2], [1], []];
  const out = rateFields(features, { kind: "rate", measure: "r", methods: ["eb", "sr", "er", "ci"] }, {
    info: { format: "rate" },
    pool: { numerator: "e", denominator: "n", scale: 1000 },
    label: "Rate",
    rows,
  });
  assert.deepEqual(out.fields, ["eb_r", "sr_r", "er_r", "lcl_r", "ucl_r"]);
  assert.equal(out.values.sr_r[1], (35 / 3500) * 1000);
  assert.equal(out.values.eb_r[3], null);
  assert.equal(out.extraFields.eb_r.label, "Rate: empirical Bayes");
  assert.ok(out.values.lcl_r[0] < 5 && out.values.ucl_r[0] > 5);
});

test("ACS estimates are classed by their coefficient of variation", () => {
  assert.equal(acsReliability(20, 3), "high"); // CV 9%
  assert.equal(acsReliability(20, 10), "medium"); // CV 30%
  assert.equal(acsReliability(5, 6), "low"); // CV 73%
  assert.equal(acsReliability(0, 2), "low");
  assert.equal(acsReliability(null, 2), null);
});
