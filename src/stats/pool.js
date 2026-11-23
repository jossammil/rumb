// Pooled measures over a set of areas: sum the numerators and denominators,
// then recompute the rate (ported from map_project's measure_aggregate). Only
// true additive counts pool, plus population-weighted means of prevalence
// estimates (kind "weighted": Σ value × weight / Σ weight, as for CDC PLACES). Rows that are suppressed (flag 2) or missing
// either side are left out of both sums and reported as reduced coverage,
// never dropped from one side alone. Pure.

/**
 * A field's pooling rule, or null: the catalog's `pool` ({ numerator,
 * denominator, scale, flag, kind }), or for reference fields with a count and
 * a universe, count / universe × 100.
 */
export function poolOf(info) {
  if (info?.pool) return { kind: "ratio", scale: 1, ...info.pool };
  if (info?.count && info?.universe)
    return { kind: "ratio", numerator: info.count, denominator: info.universe, scale: 100 };
  return null;
}

/** { value, used, total, suppressed, unreliable } of a pool over rows of properties. */
export function aggregate(rows, pool) {
  const ratio = (pool.kind || "ratio") === "ratio",
    weighted = pool.kind === "weighted";
  let num = 0,
    den = 0,
    used = 0,
    suppressed = 0,
    unreliable = 0;
  for (const p of rows) {
    const flag = pool.flag ? p?.[pool.flag] : null;
    if (flag === 2) {
      suppressed++;
      continue;
    }
    const n = p?.[pool.numerator],
      d = ratio ? p?.[pool.denominator] : weighted ? p?.[pool.weight] : 1;
    if (!Number.isFinite(n) || ((ratio || weighted) && !(Number.isFinite(d) && d > 0))) continue;
    num += weighted ? n * d : n;
    den += d;
    used++;
    if (flag === 1) unreliable++;
  }
  const value = !used ? null : ratio ? (num / den) * (pool.scale ?? 1) : weighted ? num / den : num;
  return { value, used, total: rows.length, suppressed, unreliable };
}

/** "78 of 82 (2 suppressed, 3 unreliable)". */
export function coverageLabel(agg) {
  const notes = [
    agg.suppressed && agg.suppressed + " suppressed",
    agg.unreliable && agg.unreliable + " unreliable",
  ].filter(Boolean);
  return agg.used + " of " + agg.total + (notes.length ? " (" + notes.join(", ") + ")" : "");
}

/** The neighbors of a set of areas: everything adjacent to one of them, not in the set. */
export function neighborsOf(ids, graph) {
  const set = new Set(ids),
    out = new Set();
  for (const id of set) for (const n of graph?.[id] || []) if (!set.has(n)) out.add(n);
  return [...out];
}
