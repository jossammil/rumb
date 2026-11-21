// R percent_rank uses the lowest rank in each group of equal values.
function rankField(rows, index, component) {
  const sorted = rows.slice().sort((a, b) => a.values[index] - b.values[index]);
  if (!sorted.length) return null;
  const constant = sorted[0].values[index] === sorted.at(-1).values[index];
  let first = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (row.values[index] !== sorted[first].values[index]) first = i;
    const percentile = constant ? 0.5 : first / (sorted.length - 1);
    row.percentiles[index] = percentile;
    const adjusted =
      component.direction === "higher" ? percentile : 1 - percentile;
    row.contributions[index] = adjusted * component.weight;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid].values[index];
  return sorted[mid - 1].values[index] / 2 + sorted[mid].values[index] / 2;
}

// One decimal place, with halfway values rounded to the even digit as in R.
function scoreToTenths(points) {
  const scaled = points * 10;
  const lower = Math.floor(scaled);
  if (scaled - lower === 0.5) return (lower + (lower % 2)) / 10;
  return Math.round(scaled) / 10;
}

export function compareAreas(features, components) {
  if (
    !Array.isArray(components) ||
    components.length < 2 ||
    components.length > 3
  )
    throw new Error("Choose two or three numeric fields to compare.");
  const fields = new Set();
  for (const component of components) {
    if (
      typeof component?.field !== "string" ||
      !component.field.trim() ||
      fields.has(component.field)
    )
      throw new Error("Choose a distinct numeric field for each component.");
    if (!["higher", "lower"].includes(component.direction))
      throw new Error("Choose higher or lower for each component direction.");
    if (
      !Number.isFinite(component.weight) ||
      component.weight <= 0 ||
      component.weight > 100
    )
      throw new Error(
        "Each weight must be a number greater than 0 and at most 100.",
      );
    fields.add(component.field);
  }
  const total = components.reduce(
    (sum, component) => sum + component.weight,
    0,
  );
  if (Math.abs(total - 100) > 1e-9) throw new Error("Weights must total 100.");

  const byId = new Map();
  const rows = features.map((feature) => {
    const properties = feature.properties ?? {};
    const sourceId = feature.id ?? properties.GEOID;
    if (
      sourceId == null ||
      !String(sourceId).trim() ||
      byId.has(String(sourceId))
    )
      throw new Error("Comparison requires a unique feature ID for each area.");
    const id = String(sourceId);
    const values = components.map(({ field }) =>
      Number.isFinite(properties[field]) ? properties[field] : null,
    );
    const missing = components
      .filter((_, i) => values[i] === null)
      .map(({ field }) => field);
    const row = {
      id,
      name: String(properties.name ?? id),
      values,
      percentiles: components.map(() => null),
      contributions: components.map(() => null),
      score: null,
      rank: null,
      quadrant: null,
      reason: missing.length ? "Unavailable: " + missing.join(", ") : null,
    };
    byId.set(id, row);
    return row;
  });
  const eligible = rows.filter((row) => row.reason === null);
  const medians = components
    .map((component, index) => rankField(eligible, index, component))
    .slice(0, 2);
  for (const row of eligible) {
    row.score = scoreToTenths(row.contributions.reduce((a, b) => a + b, 0));
    row.quadrant = medians
      .map((median, i) => (row.values[i] >= median ? "H" : "L"))
      .join("");
  }
  eligible.sort((a, b) => b.score - a.score);
  let rank = 0;
  for (let i = 0; i < eligible.length; i++) {
    if (!i || eligible[i].score !== eligible[i - 1].score) rank = i + 1;
    eligible[i].rank = rank;
  }
  return {
    rows,
    byId,
    eligibleCount: eligible.length,
    medians,
    components: components.map((c) => ({ ...c })),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

export function comparisonCSV(result, selectedIds = []) {
  const selection = new Set(Array.from(selectedIds, String));
  const headers = [
    "feature_id",
    "area_name",
    "selected",
    "rank",
    "score",
    "quadrant",
    "exclusion_reason",
    "eligible_areas",
    "total_areas",
    "x_median",
    "y_median",
  ];
  const componentKeys = [
    "field",
    "direction",
    "weight",
    "value",
    "percentile",
    "contribution",
  ];
  result.components.forEach((_, i) => {
    for (const key of componentKeys)
      headers.push("component_" + (i + 1) + "_" + key);
  });
  const lines = [headers.join(",")];
  const sorted = result.rows
    .slice()
    .sort(
      (a, b) =>
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        a.id.localeCompare(b.id, "en"),
    );
  for (const row of sorted) {
    const cells = [
      row.id,
      row.name,
      selection.has(row.id),
      row.rank,
      row.score,
      row.quadrant,
      row.reason,
      result.eligibleCount,
      result.rows.length,
      ...result.medians,
    ];
    result.components.forEach(({ field, direction, weight }, i) => {
      cells.push(
        field,
        direction,
        weight,
        row.values[i],
        row.percentiles[i],
        row.contributions[i],
      );
    });
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
