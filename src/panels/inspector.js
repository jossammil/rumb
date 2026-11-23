// The inspector card on the map: the selected feature's value and its margin
// of error, the plain-language reading of its cluster, and the analysis
// summary with the Moran scatterplot.
import { number } from "../catalog/format.js";
import { formatValue, popupRows } from "../catalog/popup.js";
import { featureId } from "../core/features.js";
import { aggregate, coverageLabel, neighborsOf, poolOf } from "../stats/pool.js";
import { clusters } from "../map/classify.js";
import { basisOf, methodOf } from "../stats/methods.js";
import { acsReliability, rateLimits, UNSTABLE_EVENTS } from "../stats/rates.js";
import { $, fill, h, icon, s } from "../ui/dom.js";

const row = (key, val) => h("div", null, h("dt", { text: key }), h("dd", { text: String(val) }));

/** The Moran scatterplot: standardized value against the neighbor average. */
export function scatter(result, selected, onPick, [xLabel, yLabel] = ["Standardized measure", "Neighbor average"]) {
  const points = Object.entries(result.byId).filter(
    ([, r]) => Number.isFinite(r.z) && Number.isFinite(r.lag),
  );
  const span = Math.max(0.1, ...points.flatMap(([, r]) => [Math.abs(r.z), Math.abs(r.lag)]));
  const x = (z) => 125 + (z / span) * 93,
    y = (lag) => 76 - (lag / span) * 57;
  const dots = points.map(([id, r]) =>
    s(
      "circle",
      {
        "data-point": id,
        cx: x(r.z),
        cy: y(r.lag),
        r: 2.9,
        class: r.cluster === "NS" ? "ns-dot" : null,
        fill: r.cluster === "NS" ? null : clusters[r.cluster][1],
        opacity: 0.7,
        onclick: () => onPick(id),
      },
      s("title", { text: id }),
    ),
  );
  const sel = result.byId[selected];
  return s(
    "svg",
    {
      class: "scatter",
      viewBox: "0 0 250 165",
      role: "img",
      "aria-label": "Moran scatterplot. Horizontal axis: " + xLabel + ". Vertical axis: " + yLabel + ".",
    },
    s("rect", { x: 26, y: 9, width: 199, height: 133, rx: 3, class: "plot-bg" }),
    s("path", { d: "M26 76h199M125 9v133", class: "plot-axis", "stroke-dasharray": "3 3" }),
    s("path", {
      d: "M32 " + y(-span * result.globalI) + "L218 " + y(span * result.globalI),
      class: "plot-fit",
    }),
    dots,
    sel?.z != null &&
      s("circle", {
        cx: x(sel.z),
        cy: y(sel.lag),
        r: 5,
        class: "plot-mark",
        "pointer-events": "none",
      }),
    s(
      "g",
      { "font-size": 9, class: "plot-text", "text-anchor": "middle" },
      s("text", { x: 125, y: 158, text: xLabel }),
      s("text", { transform: "translate(12 76) rotate(-90)", text: yLabel }),
    ),
  );
}

const MEANING = {
  HH: "This is a high-value cluster.",
  LL: "This is a low-value cluster.",
  HL: "This feature is a high-value spatial outlier.",
  LH: "This feature is a low-value spatial outlier.",
};

export function createInspector(app) {
  const pane = $("inspect-panel");

  /** The selected ids: the inspected feature and any others picked with Shift. */
  const selection = () => [...new Set([...(app.state.picks || []), app.state.selected].filter(Boolean).map(String))];
  /**
   * The focus layer's contiguity graph for the current rule, once loaded.
   * Distance-based rules pool a selection with the areas that touch it (queen).
   */
  function graphOf(l) {
    const { state } = app,
      rule = state.rule === "rook" ? "rook" : "queen";
    return l.reference
      ? app.ws.neighborData?.[rule]
      : l.library
        ? app.ws.layerNeighbors(l.id)?.[rule]
        : app.ws.graphs.get(l.id + "-" + rule);
  }

  /** Outlines the selection and dashes its neighbors; returns the inspected feature's neighbors. */
  function applyNeighbors() {
    const { state } = app;
    const id = state.selected,
      ids = selection();
    if (!ids.length) {
      app.atlas.select({ layer: state.active });
      return null;
    }
    const graph = graphOf(app.layer());
    const adjacent = state.result?.byId?.[id]?.neighbors ?? graph?.[id];
    const dashed = ids.length > 1 ? neighborsOf(ids, graph) : adjacent || [];
    app.atlas.select({ layer: state.active, ids, neighbors: dashed });
    return adjacent;
  }

  /**
   * Pooled measures over the selected areas, their neighbors and both
   * (map_pdo's Selected / Neighbors / Total), for fields that pool.
   */
  function selectionBlock(l) {
    const { state } = app,
      ids = selection();
    if (!ids.length || app.kindOf(l) === "point") return null;
    // Table fields pool once their table is read.
    const fields = app
      .fieldList(l)
      .filter((f) => poolOf(app.fieldMeta(l, f)) && !app.ws.missingFields([f]).length);
    if (!fields.length) return null;
    const ordered = [state.measure, ...fields].filter((f, i, all) => fields.includes(f) && all.indexOf(f) === i);
    const props = new Map(l.collection.features.map((f) => [featureId(f), f.properties]));
    const graph = graphOf(l);
    const neighbors = graph ? neighborsOf(ids, graph) : [];
    const sets = [
      ["Selected", ids],
      ["Neighbors", neighbors],
      ["Total", [...ids, ...neighbors]],
    ].filter(([, list], i) => i === 0 || graph);
    const rowOf = (field) => {
      const info = app.fieldMeta(l, field),
        pool = poolOf(info);
      const cells = sets.map(([, list]) => {
        const agg = aggregate(list.map((id) => props.get(id)).filter(Boolean), pool);
        return h("td", { title: "Coverage " + coverageLabel(agg), text: agg.value == null ? "—" : formatValue(agg.value, { format: info.format || "number", unit: info.unit }) });
      });
      // Pools of an age-adjusted measure's counts give a crude rate.
      const label = app.label(field, l) + (pool.crude ? " (crude)" : "");
      return h("tr", { "data-pool": field }, h("th", { scope: "row", text: label }), cells);
    };
    const head = h("tr", null, h("th"), sets.map(([name, list]) => h("th", { scope: "col", text: name + " (" + list.length + ")" })));
    const first = ordered.slice(0, 4),
      rest = ordered.slice(4);
    return h(
      "section",
      { class: "inspect-block selection-block" },
      h("div", { class: "inspection-head" }, h("h3", { text: ids.length === 1 ? "Pooled with neighbors" : ids.length + " areas selected" })),
      h("p", { class: "subtle", text: "Sums of counts, then the rate. Shift-click areas to add or remove them." }),
      h("table", { class: "pool-table" }, h("thead", null, head), h("tbody", null, first.map(rowOf))),
      rest.length &&
        h(
          "details",
          { class: "pool-more" },
          h("summary", { text: rest.length + " more measures" }),
          h("table", { class: "pool-table" }, h("tbody", null, rest.map(rowOf))),
        ),
    );
  }

  function featureBlock({ feature, id, adjacent }) {
    const { state, ref } = app;
    const l = app.layer(),
      fields = app.searchFields(l);
    const props = feature.properties || {},
      measure = state.measure,
      record = state.result?.byId?.[id],
      // Margins of error and denominators apply to the reference layer's own fields.
      info = app.fieldMeta(l, measure),
      unit = info?.unit || "";
    const value =
      measure && props[measure] != null
        ? number(props[measure]) + unit
        : measure
          ? "Unavailable"
          : "";
    const metrics = [];
    if (info?.moe)
      metrics.push(
        row(
          (ref.moeLevel || 90) + "% margin of error",
          props[info.moe] == null ? "Unavailable" : "±" + number(props[info.moe]) + " pp",
        ),
      );
    // How far to trust the estimate: the ACS margin's coefficient of
    // variation, or for event rates the exact Poisson limits and NCHS's rule.
    if (info?.moe && props[measure] != null) {
      const level = info.confidence || ref.moeLevel || 90;
      const grade = acsReliability(props[measure], props[info.moe], level);
      if (grade) {
        const cv = props[measure] ? (props[info.moe] / (level === 95 ? 1.96 : 1.645) / Math.abs(props[measure])) * 100 : null;
        metrics.push(row("Reliability", grade + (cv != null ? " (CV " + number(cv, 0) + "%)" : "")));
      }
    }
    const pool = poolOf(info);
    if (info?.format === "rate" && pool?.kind === "ratio" && pool.denominator && !info.smoothed) {
      const e = props[pool.numerator],
        limits = rateLimits([e], [props[pool.denominator]], pool.scale ?? 1)[0];
      if (limits)
        metrics.push(row("95% limits (exact Poisson)", number(limits[0]) + "–" + number(limits[1]) + unit));
      if (Number.isFinite(e) && e < UNSTABLE_EVENTS) metrics.push(row("Reliability", "Unstable: " + e + " events (fewer than 20)"));
    }
    if (info?.lcl && info?.ucl)
      metrics.push(
        row(
          (info.ci || 95) + "% confidence interval",
          props[info.lcl] == null ? "Unavailable" : number(props[info.lcl]) + "–" + number(props[info.ucl]) + unit,
        ),
      );
    if (info?.modelBased) metrics.push(row("Estimate", "Model-based (" + (info.source || "modeled") + ")"));
    if (info?.count)
      metrics.push(row(info.countLabel || app.label(info.count), number(props[info.count], 0)));
    if (info?.universe)
      metrics.push(
        row(info.universeLabel || app.label(info.universe), number(props[info.universe], 0)),
      );
    // Library layers list their catalog fields too.
    if (l.meta)
      for (const r of popupRows(l.meta, props, { skip: [fields.labelField, measure] }))
        metrics.push(row(r.label, r.text));
    if (adjacent)
      metrics.push(row(state.result ? "Eligible neighbors" : "Adjacent areas", adjacent.length));
    const method = methodOf(state.result);
    if (record) {
      if (record.reason) metrics.push(row("Analysis", record.reason));
      else metrics.push(...method.featureRows(record, state.result).map(([k, v]) => row(k, v)));
    }
    let reading = null;
    if (method.reading && record && record.z != null) {
      const { result } = state;
      const side = (v) => (v > 0 ? "above" : v < 0 ? "below" : "at");
      const lagValue = record.lag * result.sd + result.mean;
      const meaning =
        record.cluster === "NS"
          ? "The local test did not reach the selected significance threshold."
          : MEANING[record.cluster] || "";
      reading = h("p", {
        class: "cluster-reading",
        text:
          "The feature is " +
          side(record.z) +
          " the study mean (" +
          number(result.mean) +
          unit +
          "). Its neighbors average " +
          number(lagValue) +
          unit +
          ", " +
          side(record.lag) +
          " that mean. " +
          meaning,
      });
    }
    const group = fields.groupField ? props[fields.groupField] : null;
    return h(
      "section",
      { class: "inspect-block" },
      h(
        "div",
        { class: "inspection-head" },
        h("h3", { text: props[fields.labelField] ?? props.name ?? props.NAME ?? "Feature " + id }),
      ),
      // Library points are numbered by source row, which means nothing to a reader.
      h("p", {
        class: "subtle",
        text: [group, (fields.idField && props[fields.idField]) ?? (l.library && /^\d+$/.test(id) ? null : id)]
          .filter(Boolean)
          .join(" · "),
      }),
      measure && h("div", { class: "score", text: value }),
      measure && h("div", { class: "subtle", text: app.label(measure) }),
      h("dl", { class: "metrics" }, metrics),
      reading,
    );
  }

  function analysisBlock() {
    const { state } = app,
      result = state.result,
      method = methodOf(result);
    const mode = (name, text) =>
      h("button", {
        "data-mode": name,
        class: state.mode === name ? "active" : "",
        text,
        onclick: () => {
          app.store.set({ mode: name });
          app.draw();
        },
      });
    return h(
      "section",
      { class: "inspect-block" },
      h("div", { class: "inspection-head" }, h("h3", { text: method.title })),
      h("p", { class: "subtle", text: result.studyName + " · " + basisOf(result, state.rule) }),
      h("dl", { class: "metrics" }, method.summaryRows(result).map(([k, v]) => row(k, v))),
      h("div", { class: "segmented" }, mode("value", "Measure"), mode("cluster", method.modeLabel)),
      method.scatter && scatter(result, state.selected, (id) => app.selectFeature(id), method.scatterLabels),
      h(
        "p",
        { class: "subtle" },
        result.permutations + " " + (method.trials || "permutations") + " · Seed " + result.seed,
        h("br"),
        method.ruleText ? method.ruleText(result) : (result.fdr ? "FDR-adjusted q" : "Unadjusted local p") + " ≤ " + result.alpha,
      ),
      h(
        "button",
        { class: "plain-btn", id: "save-results", onclick: () => app.analysis.exportStats() },
        icon("download", 13),
        "Export statistics",
      ),
    );
  }

  function render() {
    const { state } = app;
    if (state.view === "compare") return;
    const adjacent = applyNeighbors();
    if (!state.inspector || (!state.selected && !state.result)) {
      pane.hidden = true;
      return;
    }
    pane.hidden = false;
    const feature = app.values.get(state.selected);
    fill(
      pane,
      h(
        "button",
        {
          id: "dismiss-inspect",
          class: "iconbtn dismiss",
          "aria-label": "Close inspector",
          onclick: () => {
            app.store.set({ selected: null, inspector: false });
            render();
          },
        },
        icon("close", 14),
      ),
      feature && featureBlock({ feature, id: state.selected, adjacent }),
      selectionBlock(app.layer()),
      state.result && analysisBlock(),
    );
    // Reference-layer and library neighbors load on first selection.
    const l = app.layer();
    if (state.selected && l.library && l.meta.neighbors && app.ws.layerNeighbors(l.id) === undefined)
      app.ws
        .loadLayerNeighbors(l.id)
        .then(() => {
          if (app.state.selected && app.state.inspector) render();
        })
        .catch(app.fail);
    if (state.selected && !app.ws.neighborData && l.reference)
      app.ws
        .neighbors()
        .then(() => {
          if (app.state.selected && app.state.inspector) render();
        })
        .catch(app.fail);
  }
  return { render };
}
