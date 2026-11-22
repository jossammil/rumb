import { clusters, escape as e, icon, number } from "./ui.js";

export function callStats(request, signal) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("stats-worker.js", document.baseURI), {
      type: "module",
    });
    const end = (fn, arg) => {
      signal?.removeEventListener("abort", abort);
      w.terminate();
      fn(arg);
    };
    const abort = () =>
      end(reject, new DOMException("Analysis canceled", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    w.onmessage = ({ data }) =>
      data.ok ? end(resolve, data.result) : end(reject, new Error(data.error));
    w.onerror = (event) =>
      end(
        reject,
        new Error(event.message || "The statistics worker failed to load."),
      );
    w.postMessage({ id: 1, ...request });
  });
}
export function scatter(result, selected) {
  const points = Object.entries(result.byId).filter(
    ([, r]) => Number.isFinite(r.z) && Number.isFinite(r.lag),
  );
  const span = Math.max(
    0.1,
    ...points.flatMap(([, r]) => [Math.abs(r.z), Math.abs(r.lag)]),
  );
  const x = (z) => 125 + (z / span) * 93,
    y = (lag) => 76 - (lag / span) * 57;
  const dots = points
    .map(
      ([id, r]) =>
        '<circle data-point="' +
        e(id) +
        '" cx="' +
        x(r.z) +
        '" cy="' +
        y(r.lag) +
        '" r="2.9" fill="' +
        (r.cluster === "NS" ? "#7b9688" : clusters[r.cluster][1]) +
        '" opacity=".64"><title>' +
        e(id) +
        "</title></circle>",
    )
    .join("");
  const sel = result.byId[selected];
  const marked =
    sel?.z != null
      ? '<circle cx="' +
        x(sel.z) +
        '" cy="' +
        y(sel.lag) +
        '" r="5" fill="#143e34" stroke="white" stroke-width="1.5" pointer-events="none"/>'
      : "";
  return (
    '<svg class="scatter" viewBox="0 0 250 165" role="img" aria-label="Moran scatterplot. Horizontal axis is the standardized measure. Vertical axis is the standardized neighbor average."><rect x="26" y="9" width="199" height="133" rx="3" fill="#f2f6ef"/><path d="M26 76h199M125 9v133" stroke="#acbdad" stroke-dasharray="3 3"/><path d="M32 ' +
    y(-span * result.globalI) +
    "L218 " +
    y(span * result.globalI) +
    '" stroke="#697d6a"/>' +
    dots +
    marked +
    '<g font-size="9" fill="#54695a" text-anchor="middle"><text x="125" y="158">Standardized measure</text><text transform="translate(12 76) rotate(-90)">Neighbor average</text></g></svg>'
  );
}
const row = (key, val) =>
  "<div><dt>" + e(key) + "</dt><dd>" + e(val) + "</dd></div>";
export function inspection({
  feature,
  id,
  measure,
  label,
  result,
  selectedMode,
  rule,
  study,
  baseMeasures,
  eligibleNeighbors,
}) {
  const props = feature?.properties || {},
    record = result?.byId?.[id],
    isACS =
      baseMeasures && ["poverty_pct", "child_poverty_pct"].includes(measure),
    prefix = measure === "child_poverty_pct" ? "child_poverty" : "poverty";
  let area = "";
  if (feature) {
    area =
      '<section class="inspect-block"><div class="inspection-head"><h3>' +
      e(props.name ?? props.NAME ?? "Feature " + id) +
      '</h3></div><p class="subtle">' +
      [props.county, props.GEOID ?? id].filter(Boolean).map(e).join(" · ") +
      "</p>" +
      '<div class="score">' +
      (measure && props[measure] != null
        ? e(number(props[measure])) + (isACS ? "%" : "")
        : measure
          ? "Unavailable"
          : "") +
      '</div><div class="subtle">' +
      e(label) +
      '</div><dl class="metrics">' +
      (isACS
        ? row(
            "90% margin of error",
            props[prefix + "_moe"] == null
              ? "Unavailable"
              : "±" + number(props[prefix + "_moe"]) + " pp",
          ) +
          row("Below poverty", number(props[prefix + "_count"], 0)) +
          row("Population in universe", number(props[prefix + "_universe"], 0))
        : "") +
      (eligibleNeighbors
        ? row(
            result ? "Eligible neighbors" : "Adjacent areas",
            eligibleNeighbors.length,
          )
        : "") +
      (record
        ? record.reason
          ? row("Analysis", record.reason)
          : row("Local Moran’s I", number(record.localI, 4)) +
            row("Permutation p", number(record.p, 4)) +
            row("FDR q", number(record.q, 4)) +
            row("Classification", clusters[record.cluster][0])
        : "") +
      "</dl></section>";
  }
  if (record && record.z != null && feature) {
    const local = record.z > 0 ? "above" : record.z < 0 ? "below" : "at";
    const adjacent = record.lag > 0 ? "above" : record.lag < 0 ? "below" : "at";
    const suffix = isACS ? "%" : "";
    const lagValue = record.lag * result.sd + result.mean;
    const meaning =
      record.cluster === "NS"
        ? "The local test did not reach the selected significance threshold."
        : {
            HH: "This is a high-value cluster.",
            LL: "This is a low-value cluster.",
            HL: "This feature is a high-value spatial outlier.",
            LH: "This feature is a low-value spatial outlier.",
          }[record.cluster] || "";
    area = area.replace(
      "</dl></section>",
      '</dl><p class="cluster-reading">The feature is ' +
        local +
        " the study mean (" +
        number(result.mean) +
        suffix +
        "). Its neighbors average " +
        number(lagValue) +
        suffix +
        ", " +
        adjacent +
        " that mean. " +
        meaning +
        "</p></section>",
    );
  }
  let analysis = "";
  if (result) {
    analysis =
      '<section class="inspect-block"><div class="inspection-head"><h3>Cluster analysis</h3></div><p class="subtle">' +
      e(study) +
      " · " +
      e(rule) +
      ' neighbors</p><dl class="metrics">' +
      row("Global Moran’s I", number(result.globalI, 4)) +
      row("Permutation p", number(result.globalP, 4)) +
      row("Eligible areas", number(result.n, 0)) +
      "</dl>" +
      '<div class="segmented"><button data-mode="value" class="' +
      (selectedMode === "value" ? "active" : "") +
      '">Measure</button><button data-mode="cluster" class="' +
      (selectedMode === "cluster" ? "active" : "") +
      '">Clusters</button></div>' +
      scatter(result, id) +
      '<p class="subtle">' +
      e(result.permutations) +
      " permutations · Seed " +
      e(result.seed) +
      "<br>" +
      (result.fdr ? "FDR-adjusted q" : "Unadjusted local p") +
      " ≤ " +
      e(result.alpha) +
      '</p><button class="plain-btn" id="save-results">' +
      icon("download", 13) +
      "Export statistics</button></section>";
  }
  return (
    '<button id="dismiss-inspect" class="iconbtn" aria-label="Close inspector" style="float:right;position:relative;z-index:1">' +
    icon("close", 14) +
    "</button>" +
    area +
    analysis
  );
}
