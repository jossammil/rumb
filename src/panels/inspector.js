// The inspector card on the map: the selected feature's value and its margin
// of error, the plain-language reading of its cluster, and the analysis
// summary with the Moran scatterplot.
import { fieldInfo } from "../catalog/catalog.js";
import { number } from "../catalog/format.js";
import { clusters } from "../map/classify.js";
import { $, fill, h, icon, s } from "../ui/dom.js";

const row = (key, val) => h("div", null, h("dt", { text: key }), h("dd", { text: String(val) }));

/** The Moran scatterplot: standardized value against the neighbor average. */
export function scatter(result, selected, onPick) {
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
      "aria-label":
        "Moran scatterplot. Horizontal axis is the standardized measure. Vertical axis is the standardized neighbor average.",
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
      s("text", { x: 125, y: 158, text: "Standardized measure" }),
      s("text", { transform: "translate(12 76) rotate(-90)", text: "Neighbor average" }),
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

  /** Outlines the selection and its neighbors; returns the neighbor IDs. */
  function applyNeighbors() {
    const { state } = app;
    const id = state.selected;
    if (!id) {
      app.atlas.select({ layer: state.active });
      return null;
    }
    const l = app.layer(),
      graph = l.reference
        ? app.ws.neighborData?.[state.rule]
        : app.ws.graphs.get(l.id + "-" + state.rule);
    const adjacent = state.result?.byId?.[id]?.neighbors ?? graph?.[id];
    app.atlas.select({ layer: state.active, ids: id, neighbors: adjacent || [] });
    return adjacent;
  }

  function featureBlock({ feature, id, adjacent }) {
    const { state, ref } = app;
    const props = feature.properties || {},
      measure = state.measure,
      record = state.result?.byId?.[id],
      // Margins of error and denominators apply to the reference layer's own fields.
      info = app.layer().referenceFields ? fieldInfo(app.catalog, measure) : null,
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
    if (info?.count)
      metrics.push(row(info.countLabel || app.label(info.count), number(props[info.count], 0)));
    if (info?.universe)
      metrics.push(
        row(info.universeLabel || app.label(info.universe), number(props[info.universe], 0)),
      );
    if (adjacent)
      metrics.push(row(state.result ? "Eligible neighbors" : "Adjacent areas", adjacent.length));
    if (record) {
      if (record.reason) metrics.push(row("Analysis", record.reason));
      else
        metrics.push(
          row("Local Moran’s I", number(record.localI, 4)),
          row("Permutation p", number(record.p, 4)),
          row("FDR q", number(record.q, 4)),
          row("Classification", clusters[record.cluster][0]),
        );
    }
    let reading = null;
    if (record && record.z != null) {
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
    const group = ref.groupField ? props[ref.groupField] : null;
    return h(
      "section",
      { class: "inspect-block" },
      h(
        "div",
        { class: "inspection-head" },
        h("h3", { text: props[ref.labelField] ?? props.name ?? props.NAME ?? "Feature " + id }),
      ),
      h("p", { class: "subtle", text: [group, props[ref.idField] ?? id].filter(Boolean).join(" · ") }),
      h("div", { class: "score", text: value }),
      h("div", { class: "subtle", text: app.label(measure) }),
      h("dl", { class: "metrics" }, metrics),
      reading,
    );
  }

  function analysisBlock() {
    const { state } = app,
      result = state.result;
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
      h("div", { class: "inspection-head" }, h("h3", { text: "Cluster analysis" })),
      h("p", { class: "subtle", text: result.studyName + " · " + state.rule + " neighbors" }),
      h(
        "dl",
        { class: "metrics" },
        row("Global Moran’s I", number(result.globalI, 4)),
        row("Permutation p", number(result.globalP, 4)),
        row("Eligible areas", number(result.n, 0)),
      ),
      h("div", { class: "segmented" }, mode("value", "Measure"), mode("cluster", "Clusters")),
      scatter(result, state.selected, (id) => app.selectFeature(id)),
      h(
        "p",
        { class: "subtle" },
        result.permutations + " permutations · Seed " + result.seed,
        h("br"),
        (result.fdr ? "FDR-adjusted q" : "Unadjusted local p") + " ≤ " + result.alpha,
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
      state.result && analysisBlock(),
    );
    // Reference-layer neighbors load on first selection.
    if (state.selected && !app.ws.neighborData && app.layer().reference)
      app.ws
        .neighbors()
        .then(() => {
          if (app.state.selected && app.state.inspector) render();
        })
        .catch(app.fail);
  }
  return { render };
}
