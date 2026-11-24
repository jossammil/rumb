// Statistics at large-state scale: synthetic inputs the size of California's
// tracts (9,129 areas), timed in Node. Run at the repository root:
//   node scripts/benchmark-stats.mjs            (every step)
//   node scripts/benchmark-stats.mjs scan25     (one step)
// Each step runs in its own Node process, so its peak memory is its own: the
// table shows the wall time, the peak resident set (process.resourceUsage's
// maxRSS) and process.memoryUsage()'s heap and array buffers at the step's
// end, against the budgets below.
//
// Inputs: 9,129 uniform random points (seeded) in a 1,000 × 1,200 km box with
// populations of 1,000–8,000 and cases at about 1%; their 6 nearest
// neighbors (made symmetric for the models) and the connecting distance band;
// and a 51 × 179 lattice (9,129 cells) with queen neighbors.
//
// Budgets (one laptop core; a browser tab runs about as fast as Node):
//   knn6        k = 6 nearest neighbors                        5 s   300 MB
//   band        the connecting distance band                   5 s   300 MB
//   lisa        local Moran, lattice queen, 999 permutations  10 s   400 MB
//   scan25      the scan to 25% of the population at 999
//               replicates: the first pass and its advice
//               (past the work budget), then the run at the
//               advised radius                                40 s   400 MB
//   scan50      the same to 50%                               45 s   400 MB
//   windows50   every window to 50%, built in full            15 s   400 MB
//   lag, error  ML models (Chebyshev), lattice queen and
//               symmetric knn6, with the OLS diagnostics      15 s   500 MB
// A step past its budget prints "over"; the script still exits 0, since
// times depend on the machine. Measured on 2026-11-23 (Apple silicon, Node
// 26, a busy machine): knn6 0.3 s / 58 MB; band 0.3 s / 70 MB; lisa
// 1.2 s / 106 MB; scan25 and scan50 advice in 3 s, then 61 mi at 999
// replicates in 25.5 s / 76 MB; windows50 (41.6 million entries) 6.1 s /
// 226 MB; lag and error 1.0 s / 175 MB.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectingBand, band, knn, symmetrize } from "../src/stats/neighbors.js";
import { randomGenerator } from "../src/stats/random.js";
import { scan, windows } from "../src/stats/scan.js";
import { analyze } from "../src/stats/stats.js";
import { fitModel } from "../src/stats/models.js";

const N = 9129,
  COLUMNS = 179,
  ROWS = 51;

/** The synthetic inputs, the same on every run. */
function inputs() {
  const random = randomGenerator(20261123);
  const xy = Array.from({ length: N }, () => [random() * 1e6, random() * 1.2e6]);
  const population = xy.map(() => 1000 + Math.round(random() * 7000));
  const cases = population.map((p) => Math.round(p * 0.01 * (0.5 + random())));
  const ids = xy.map((_, i) => "a" + String(i).padStart(5, "0"));
  // The lattice cell of area i: row ⌊i / 179⌋, column i mod 179.
  const queen = ids.map((_, i) => {
    const r = Math.floor(i / COLUMNS),
      c = i % COLUMNS,
      out = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr,
          cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < ROWS && cc >= 0 && cc < COLUMNS) out.push(rr * COLUMNS + cc);
      }
    return out;
  });
  // A smooth surface plus noise, so the models find dependence.
  const x1 = ids.map((_, i) => Math.sin(i / 400) + random()),
    x2 = ids.map(() => random() * 10);
  const y = ids.map((_, i) => 2 + x1[i] - 0.2 * x2[i] + Math.cos((i % COLUMNS) / 20) + random());
  return { xy, population, cases, ids, queen, x1, x2, y };
}

const byId = (ids, values) => Object.fromEntries(ids.map((id, i) => [id, values[i]]));
const graph = (ids, rows) => Object.fromEntries(ids.map((id, i) => [id, rows[i].map((j) => ids[j])]));

const STEPS = {
  knn6: { budget: [5, 300], run: ({ xy }) => `${knn(xy, 6).length} rows` },
  band: {
    budget: [5, 300],
    run: ({ xy }) => {
      const rows = band(xy, connectingBand(xy));
      return `mean ${(rows.reduce((s, r) => s + r.length, 0) / N).toFixed(1)} neighbors`;
    },
  },
  lisa: {
    budget: [10, 400],
    run: async ({ ids, queen, y }) => {
      const r = await analyze({ values: byId(ids, y), neighbors: graph(ids, queen), permutations: 999 });
      const hot = Object.values(r.byId).filter((a) => a.cluster === "HH").length;
      return `Moran's I ${r.globalI.toFixed(3)}, ${hot} high-high areas`;
    },
  },
  scan25: { budget: [40, 400], run: (d) => scanStep(d, 0.25) },
  scan50: { budget: [45, 400], run: (d) => scanStep(d, 0.5) },
  windows50: {
    budget: [15, 400],
    run: ({ xy, population }) => `${windows(xy, population, { maxPop: 0.5 }).order.length.toLocaleString("en-US")} entries`,
  },
  lag: { budget: [15, 500], run: (d) => modelStep(d, "lag") },
  error: { budget: [15, 500], run: (d) => modelStep(d, "error") },
};

// The scan as the app runs it: 999 replicates under the default budget, which
// returns advice; then the advised radius, which runs.
function scanStep({ ids, cases, population, xy }, maxPop) {
  const base = { ids, cases, population, points: xy, maxPop };
  let t = performance.now();
  const first = scan(base);
  const adviceMs = performance.now() - t;
  if (!first.advice) return `ran in full (${Math.round(adviceMs)} ms)`;
  const miles = first.advice.miles;
  t = performance.now();
  const run = scan({ ...base, maxMiles: miles });
  const runMs = performance.now() - t;
  return (
    `${first.advice.entries.toLocaleString("en-US")} entries, advice in ${(adviceMs / 1000).toFixed(1)} s; ` +
    `${miles} mi at 999 replicates in ${(runMs / 1000).toFixed(1)} s (${run.clusters.length} clusters)`
  );
}

function modelStep({ ids, xy, queen, x1, x2, y }, modelType) {
  const out = [];
  for (const [name, rows] of [
    ["queen", queen],
    ["knn6", symmetrize(knn(xy, 6))],
  ]) {
    const t = performance.now();
    const r = fitModel({
      values: byId(ids, y),
      covariates: { x1: byId(ids, x1), x2: byId(ids, x2) },
      neighbors: graph(ids, rows),
      weights: { kind: "queen" },
      modelType,
    });
    out.push(`${name} ${r.parameter.estimate.toFixed(3)} ± ${r.parameter.se.toFixed(3)} in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
  return out.join("; ");
}

const step = process.argv[2];
if (step && STEPS[step]) {
  const data = inputs();
  const t = performance.now();
  const note = await STEPS[step].run(data);
  const ms = performance.now() - t;
  const m = process.memoryUsage();
  console.log(JSON.stringify({ ms, maxRSS: process.resourceUsage().maxRSS * 1024, heap: m.heapUsed, buffers: m.arrayBuffers, note }));
} else if (step) {
  throw new Error("Unknown step " + step + ". Steps: " + Object.keys(STEPS).join(", "));
} else {
  const MB = (b) => (b / 2 ** 20).toFixed(0).padStart(5) + " MB";
  console.log(`Statistics at ${N.toLocaleString("en-US")} areas (Node ${process.version})\n`);
  console.log("step        time      peak RSS   heap   buffers  budget         note");
  for (const [name, { budget }] of Object.entries(STEPS)) {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: "utf8", maxBuffer: 1 << 24 });
    const r = JSON.parse(out.trim().split("\n").at(-1));
    const over = r.ms / 1000 > budget[0] || r.maxRSS / 2 ** 20 > budget[1];
    console.log(
      name.padEnd(10) +
        ((r.ms / 1000).toFixed(1) + " s").padStart(8) +
        MB(r.maxRSS).padStart(12) +
        MB(r.heap) +
        MB(r.buffers) +
        `  ${budget[0]} s, ${budget[1]} MB`.padEnd(15) +
        (over ? " over " : "      ") +
        r.note,
    );
  }
}
