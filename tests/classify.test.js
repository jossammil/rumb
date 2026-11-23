// Class breaks against R: Fisher's natural breaks (classInt) and standard
// deviations, for real fields with 3 to 9 classes; manual breaks and ramps.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classify,
  classOf,
  jenks,
  parseBreaks,
  ramp,
  palettes,
  paletteKind,
  sample,
  sdCuts,
  withinSS,
} from "../src/map/classify.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const reference = read("./classify-reference.json");
const values = new Map();
function field(file, name) {
  const key = file + name;
  if (!values.has(key))
    values.set(
      key,
      read("../" + file).features.map((f) => f.properties[name]).filter(Number.isFinite),
    );
  return values.get(key);
}

test("natural breaks match R classInt's Fisher breaks and minimum within-class sum of squares", () => {
  assert.ok(reference.cases.length >= 40);
  for (const c of reference.cases) {
    const x = field(c.file, c.field);
    assert.equal(x.length, c.n, c.field);
    const cuts = classify(x, c.k, "jenks");
    const label = `${c.field} k=${c.k}`;
    // The same partition of every value, and therefore the same optimum.
    const ours = x.map((v) => classOf(v, cuts)),
      theirs = x.map((v) => classOf(v, c.fisher));
    assert.deepEqual(ours, theirs, label);
    assert.ok(Math.abs(withinSS(x, cuts) - c.ssd) <= 1e-6 * Math.max(1, c.ssd), label + " SSD");
    cuts.forEach((cut, i) => assert.ok(Math.abs(cut - c.fisher[i]) <= 1e-9 * Math.max(1, Math.abs(cut)), label));
  }
});

test("standard-deviation breaks match R and centre on the mean", () => {
  for (const c of reference.cases) {
    const x = field(c.file, c.field);
    const cuts = classify(x, c.k, "sd");
    assert.equal(cuts.length, c.sd.length, `${c.field} k=${c.k}`);
    cuts.forEach((cut, i) => assert.ok(Math.abs(cut - c.sd[i]) <= 1e-9 * Math.max(1, Math.abs(cut))));
  }
  // Odd counts put the mean in the middle class; even counts make it a break.
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(sdCuts(xs, 4)[1], 5);
  assert.equal(classOf(5, sdCuts(xs, 3)), 1);
});

test("natural breaks keep ties together and handle few distinct values", () => {
  assert.deepEqual(jenks([1, 2, 2, 3, 10, 11, 12, 30], 3), [6.5, 21]);
  assert.deepEqual(jenks([5, 5, 5, 9, 9], 4), [7]);
  assert.deepEqual(jenks([4, 4, 4], 3), []);
  // Large inputs stay fast (divide and conquer over distinct values).
  const big = Array.from({ length: 10000 }, (_, i) => Math.sin(i) * 1000 + i / 10).sort((a, b) => a - b);
  const started = performance.now();
  assert.equal(jenks(big, 9).length, 8);
  assert.ok(performance.now() - started < 2000, "10,000 values in under 2 s");
});

test("manual breaks and long or diverging ramps", () => {
  assert.deepEqual(parseBreaks("10, 20;5  5"), [5, 10, 20]);
  assert.equal(parseBreaks("10, x"), null);
  assert.equal(parseBreaks("  "), null);
  assert.deepEqual(classify([1, 50], 5, "manual", { breaks: [30, 10, 10, NaN] }), [10, 30]);
  assert.equal(classify([1, 50], 5, "manual", { breaks: Array.from({ length: 12 }, (_, i) => i) }).length, 8);
  // Seven or fewer sequential classes take palette stops as before.
  assert.deepEqual(ramp("Lagoon", 7), palettes.Lagoon);
  assert.equal(new Set(ramp("Viridis", 9)).size, 9);
  assert.equal(ramp("Viridis", 9)[0], palettes.Viridis[0]);
  assert.equal(ramp("Viridis", 9)[8], palettes.Viridis[6]);
  // Diverging ramps keep their neutral middle in the middle.
  assert.equal(paletteKind("RdBu"), "diverging");
  assert.equal(paletteKind("Lagoon"), "sequential");
  for (const n of [3, 5, 7, 9]) assert.equal(ramp("RdBu", n)[(n - 1) / 2], palettes.RdBu[3], "RdBu " + n);
  assert.equal(sample(["#000000", "#ffffff"], 0), "#000000");
  assert.equal(sample(["#000000", "#ffffff"], 1), "#ffffff");
});
