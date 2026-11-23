// Chart axes and bins: nice steps (from Plank), ticks and histogram bins. Pure.
import test from "node:test";
import assert from "node:assert/strict";
import { bins, niceStep, niceTicks } from "../src/ui/chart.js";

test("nice steps and ticks are 1, 2 or 5 times a power of ten", () => {
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(7, 5), 1);
  assert.equal(niceStep(0.37, 4), 0.1);
  assert.deepEqual(niceTicks(3.2, 47.9, 5), { lo: 0, hi: 50, ticks: [0, 10, 20, 30, 40, 50] });
  assert.deepEqual(niceTicks(-0.73, 0.41, 4).ticks, [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]);
  assert.deepEqual(niceTicks(5, 5).ticks, [4, 4.5, 5, 5.5, 6]);
});

test("histogram bins cover every value once", () => {
  const values = [0.5, 1.2, 1.9, 2.4, 9.99, 10, null];
  const b = bins(values, 5);
  assert.equal(b.reduce((s, x) => s + x.count, 0), 6);
  assert.equal(b[0].from, 0);
  assert.ok(b.at(-1).to >= 10);
});
