// Spatial access to facilities, measured from each area's center (of
// population, where the data has one) to point facilities, in straight lines
// in the region's projection, so not travel times:
// - the distance to the nearest facility;
// - the number of facilities within a distance;
// - the enhanced two-step floating catchment area ratio (E2SFCA; Luo & Wang
//   2003, Luo & Qi 2009), with a Gaussian distance decay (Dai 2010) or a
//   step: each facility's supply divided by the weighted population it can
//   reach, summed back over the facilities each area can reach, per 10,000
//   people.
// Pure.
import { GRID_MIN, nearest as nearestIn, pointGrid, within as withinOf } from "./grid.js";

export const METRES_PER_MILE = 1609.344;
const EDGE = Math.exp(-0.5);

/** The decay weight at distance d within catchment d0: Gaussian (1 at 0, 0 at d0) or a step. */
export function decay(d, d0, kind = "gaussian") {
  if (d > d0) return 0;
  if (kind === "step") return 1;
  return (Math.exp(-0.5 * (d / d0) ** 2) - EDGE) / (1 - EDGE);
}

/**
 * Access measures for demand points (xy, population) and supply points (xy,
 * size). Distances are in metres in; miles out. `within` and `catchment`
 * are miles. Returns { nearest, count, ratio } aligned with the demand.
 */
export function accessMeasures(demand, supply, { within = 10, catchment = 30, kind = "gaussian", grid } = {}) {
  const nD = demand.xy.length,
    nS = supply.xy.length;
  if (!nS) throw new Error("The facility layer has no points.");
  const d0 = catchment * METRES_PER_MILE,
    reach = within * METRES_PER_MILE;
  const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  const nearest = new Array(nD).fill(Infinity),
    count = new Array(nD).fill(0);
  // Step 1: each facility's supply over the decay-weighted population it serves.
  const served = new Float64Array(nS);
  const pairs = [];
  // Above a few dozen facilities the search goes through a uniform grid
  // (grid.js). Each area still meets its facilities in index order, so the
  // sums come out the same.
  const index = (grid ?? nS >= GRID_MIN) ? pointGrid(supply.xy) : null;
  const reachOf = Math.max(reach, d0);
  for (let i = 0; i < nD; i++) {
    const p = demand.xy[i];
    if (!p) continue;
    let js = null,
      m = nS;
    if (index && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(reachOf)) {
      // The nearest facility may lie past both radii.
      const near = nearestIn(index, p[0], p[1], 1, (cs) => {
        let best = -1,
          bd = Infinity;
        for (const j of cs) {
          const d = dist(p, supply.xy[j]);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
        return { best: best >= 0 ? [best] : [], last: bd };
      });
      if (near.length) nearest[i] = dist(p, supply.xy[near[0]]);
      js = withinOf(index, p[0], p[1], reachOf);
      m = js.length;
    }
    for (let t = 0; t < m; t++) {
      const j = js ? js[t] : t;
      const d = dist(p, supply.xy[j]);
      if (d < nearest[i]) nearest[i] = d;
      if (d <= reach) count[i]++;
      if (d <= d0) {
        const g = decay(d, d0, kind);
        pairs.push(i, j, g);
        const pop = demand.population[i];
        if (Number.isFinite(pop) && pop > 0) served[j] += g * pop;
      }
    }
  }
  const ratio = new Array(nD).fill(0);
  // Step 2: each area sums the ratios of the facilities it can reach.
  for (let k = 0; k < pairs.length; k += 3) {
    const i = pairs[k],
      j = pairs[k + 1],
      g = pairs[k + 2];
    if (served[j] > 0) ratio[i] += (g * supply.size[j]) / served[j];
  }
  return {
    nearest: nearest.map((d, i) => (demand.xy[i] ? d / METRES_PER_MILE : null)),
    count: count.map((c, i) => (demand.xy[i] ? c : null)),
    ratio: ratio.map((r, i) => (demand.xy[i] ? r * 10000 : null)),
  };
}
