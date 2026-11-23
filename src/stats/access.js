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
export function accessMeasures(demand, supply, { within = 10, catchment = 30, kind = "gaussian" } = {}) {
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
  for (let i = 0; i < nD; i++) {
    const p = demand.xy[i];
    if (!p) continue;
    for (let j = 0; j < nS; j++) {
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
