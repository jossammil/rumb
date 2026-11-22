// Compare: rank polygon areas on two or three weighted indicators, with a
// linked map, scatterplot and table. Scoring itself is in stats/compare-score.js.
import { fieldInfo } from "../catalog/catalog.js";
import { number } from "../catalog/format.js";
import { featureId, isPolygon } from "../core/features.js";
import { exportMapImage } from "../map/export-png.js";
import { neutralColors } from "../map/basemap-style.js";
import { quadrantColors, ramp } from "../map/classify.js";
import { renderLegend } from "../map/legend.js";
import { compareAreas, comparisonCSV } from "../stats/compare-score.js";
import { $, h, options, s, saveBlob } from "../ui/dom.js";
import { setupSplitter } from "../ui/splitter.js";

const QUADRANTS = {
  HH: "High / high",
  HL: "High / low",
  LH: "Low / high",
  LL: "Low / low",
};
const SCORE_BANDS = ["0–<20", "20–<40", "40–<60", "60–<80", "80–100"];
const AXES = ["X", "Y", "Third"];
const PAGE = 25;

export function createCompare(app) {
  const scale = ramp("Lagoon", 5);
  let epoch = 0,
    active,
    fields,
    features,
    props,
    refData,
    config,
    result,
    page,
    order,
    ascending,
    only;
  const panel = $("cmp-panel");
  const onReference = () => active?.builtIn;
  const label = (field) =>
    onReference()
      ? fieldInfo(app.catalog, field)?.label || refData?.measures[field]?.label || field
      : field;
  const unit = () => (onReference() ? "%" : "");
  const raw = (v, digits = 2) => (v == null ? "Unavailable" : number(v, digits) + unit());

  function leave() {
    epoch++;
    result = null;
    active = null;
  }

  async function open(id, fit = false) {
    const token = ++epoch;
    const choices = app
      .allLayers()
      .filter((l) => l.collection.features.length && l.collection.features.every(isPolygon));
    active = choices.find((l) => l.id === id) || choices[0];
    $("cmp-layer").replaceChildren(...options(choices.map((l) => [l.id, l.name])));
    $("cmp-layer").value = active.id;
    app.store.set({ compareLayer: active.id });
    result = null;
    refData = null;
    $("cmp-results").hidden = true;
    $("cmp-export").disabled = true;
    $("cmp-count").textContent = "Preparing comparison…";
    $("legend").replaceChildren();
    $("inspect-panel").hidden = true;
    const compareInfo = app.ref.compare;
    app.setTitles({
      title: active.name,
      subtitle: "Area comparison",
      context: active.name,
      credit: onReference() ? compareInfo?.credit || app.ref.credit : "Local polygon layer",
    });
    app.atlas.draw([]);
    app.atlas.select([], []);
    if (fit || active.id !== id) app.atlas.fit(active.collection, 0);
    try {
      if (onReference() && compareInfo?.reference) {
        const data = JSON.parse(await (await app.ws.asset(compareInfo.reference)).text());
        if (token !== epoch) return;
        refData = data;
      }
      features = active.collection.features.map((f) =>
        refData ? { ...f, properties: { ...f.properties, ...refData.byId[featureId(f)] } } : f,
      );
      props = new Map(features.map((f) => [featureId(f), f.properties]));
      if (refData) {
        const lead = compareInfo.lead || [];
        fields = [...lead, ...[...app.ref.measures, ...Object.keys(refData.measures)].filter((k) => !lead.includes(k))];
      } else fields = app.fieldList(active);
      if (fields.length < 2)
        throw new Error(
          "This layer needs at least two numeric fields. Choose another polygon layer or map a query with more fields.",
        );
      const comparisons = app.state.comparisons;
      config = comparisons[active.id] ??= {
        components: fields.slice(0, 2).map((field) => ({ field, weight: 50, direction: "higher" })),
        color: "score",
        selected: [],
      };
      if (config.components.some((c) => !fields.includes(c.field)))
        throw new Error("A saved comparison field is missing from this layer.");
      config.selected = [...new Set(config.selected)].filter((x) => props.has(x));
      page = 0;
      order = "rank";
      ascending = true;
      only = false;
      $("cmp-unranked").checked = false;
      $("cmp-only").checked = false;
      $("cmp-color").value = config.color;
      editor(config.components);
      calculate(config.components);
      $("cmp-results").hidden = false;
      $("cmp-export").disabled = false;
    } catch (err) {
      if (token === epoch) $("cmp-count").textContent = err.message;
    }
  }

  function editor(parts) {
    $("cmp-error").textContent = "";
    $("cmp-components").replaceChildren(
      ...parts.map((c, i) =>
        h(
          "div",
          { class: "cmp-fields" },
          h(
            "label",
            null,
            AXES[i] + " indicator",
            h("select", { id: "cmp-field-" + i }, options(fields.map((f) => [f, label(f)]), c.field)),
          ),
          h(
            "label",
            null,
            "Scores higher",
            h(
              "select",
              { id: "cmp-direction-" + i },
              options([["higher", "Higher values"], ["lower", "Lower values"]], c.direction),
            ),
          ),
          h(
            "label",
            null,
            "Weight %",
            h("input", { id: "cmp-weight-" + i, type: "number", min: 0, max: 100, step: "any", required: true }),
          ),
        ),
      ),
    );
    parts.forEach((c, i) => {
      $("cmp-field-" + i).value = c.field;
      $("cmp-direction-" + i).value = c.direction;
      $("cmp-weight-" + i).value = c.weight;
    });
    $("cmp-add").hidden = parts.length === 3 || fields.length < 3;
    $("cmp-remove").hidden = parts.length !== 3;
  }
  const draft = () =>
    Array.from($("cmp-components").children, (_, i) => ({
      field: $("cmp-field-" + i).value,
      direction: $("cmp-direction-" + i).value,
      weight: $("cmp-weight-" + i).valueAsNumber,
    }));
  $("cmp-add").onclick = () => {
    const parts = draft();
    parts.push({ field: fields.find((f) => !parts.some((c) => c.field === f)), direction: "higher" });
    editor(parts.map((c, i) => ({ ...c, weight: [34, 33, 33][i] })));
  };
  $("cmp-remove").onclick = () => editor(draft().slice(0, 2).map((c) => ({ ...c, weight: 50 })));
  $("cmp-form").onsubmit = (ev) => {
    ev.preventDefault();
    try {
      calculate(draft());
      $("cmp-error").textContent = "";
    } catch (err) {
      $("cmp-error").textContent = err.message;
    }
  };

  function methods(parts) {
    const info = app.ref.compare;
    const paragraphs = [
      "Percentiles use the lowest tied rank among areas with all chosen indicators. A constant indicator receives the 50th percentile. A lower-values direction reverses the percentile before weighting. Rank uses the summed contributions rounded to one decimal. Tied scores share the lowest rank.",
      "Quadrants use the first two raw values and their medians across all eligible areas. Values equal to the median count as high. Selections and map extent do not affect the calculation.",
    ].map((text) => h("p", { text }));
    if (refData) {
      for (const text of info.notes || []) paragraphs.push(h("p", { text }));
      if (info.links?.length)
        paragraphs.push(
          h(
            "p",
            null,
            info.links.flatMap((link, i) => [
              i ? " · " : null,
              h("a", { href: link.url, target: "_blank", rel: "noreferrer", text: link.label }),
            ]),
          ),
        );
      for (const { field } of parts) {
        const measure = refData.measures[field];
        if (measure) paragraphs.push(h("p", { text: measure.label + " · " + measure.definition }));
      }
    }
    $("cmp-method").replaceChildren(...paragraphs);
  }

  function calculate(parts) {
    result = compareAreas(features, parts);
    config.components = result.components;
    page = 0;
    const message = `${number(result.eligibleCount)} of ${number(features.length)} areas ranked · ${number(features.length - result.eligibleCount)} unranked`;
    $("cmp-count").textContent = message;
    app.status(message);
    methods(parts);
    drawMap();
    plot();
    selection();
  }

  function legend() {
    return (
      config.color === "score"
        ? scale.map((color, i) => ({ color, text: SCORE_BANDS[i] }))
        : Object.entries(QUADRANTS).map(([key, text]) => ({ text, color: quadrantColors[key] }))
    ).concat({ color: neutralColors().na, text: "Unranked" });
  }
  function drawMap() {
    const { na } = neutralColors();
    app.atlas.draw(
      features.map((f) => {
        const r = result.byId.get(featureId(f));
        const color = r.reason
          ? na
          : config.color === "quadrant"
            ? quadrantColors[r.quadrant]
            : scale[Math.min(4, Math.floor(r.score / 20))];
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: { __rumb_id: r.id, __rumb_color: color },
        };
      }),
    );
    const subtitle = config.color === "score" ? "Weighted score · 0 to 100" : "Quadrants · X / Y";
    app.setTitles({ subtitle });
    renderLegend($("legend"), { kind: "categories", title: subtitle, items: legend() });
  }

  function plot() {
    const rows = result.rows.filter((r) => !r.reason);
    const domains = [0, 1].map((i) => {
      const v = rows.map((r) => r.values[i]);
      return rows.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
    });
    const pos = (i, v) => {
      const [min, max] = domains[i];
      const t = max === min ? 0.5 : (v - min) / (max - min);
      return i ? 153 - t * 136 : 38 + t * 343;
    };
    const [mx, my] = result.medians;
    $("cmp-axes").textContent = config.components
      .slice(0, 2)
      .map((c, i) => AXES[i] + " · " + label(c.field) + (unit() ? " (%)" : ""))
      .join("     /     ");
    $("cmp-medians").textContent = "Median X " + raw(mx) + " · Median Y " + raw(my);
    $("cmp-plot").replaceChildren(
      ...(rows.length
        ? [
            s("path", { d: "M38 12V153H386", class: "plot-axis", fill: "none" }),
            s(
              "g",
              { class: "plot-median", "stroke-dasharray": "4 3" },
              s("path", { d: `M${pos(0, mx)} 12V153 M38 ${pos(1, my)}H381` }),
            ),
            s(
              "g",
              { class: "cmp-ticks" },
              s("text", { x: 38, y: 176, text: number(domains[0][0]) }),
              s("text", { x: 382, y: 176, "text-anchor": "end", text: number(domains[0][1]) }),
              s("text", { x: 34, y: 19, "text-anchor": "end", text: number(domains[1][1]) }),
              s("text", { x: 34, y: 153, "text-anchor": "end", text: number(domains[1][0]) }),
            ),
            ...rows.map((r) =>
              s(
                "circle",
                {
                  "data-id": r.id,
                  cx: pos(0, r.values[0]),
                  cy: pos(1, r.values[1]),
                  r: 3.2,
                  fill: quadrantColors[r.quadrant],
                },
                s("title", { text: `${r.name} · ${raw(r.values[0])} / ${raw(r.values[1])}` }),
              ),
            ),
          ]
        : [s("text", { x: 20, y: 90, text: "No complete observations" })]),
    );
  }

  function table() {
    const ids = new Set(config.selected);
    const rows = result.rows
      .filter((r) => (!only || ids.has(r.id)) && (!$("cmp-unranked").checked || r.reason))
      .sort((a, b) => {
        if (order !== "name" && (a.reason || b.reason))
          return Number(!!a.reason) - Number(!!b.reason) || a.id.localeCompare(b.id);
        const cmp =
          order === "name"
            ? a.name.localeCompare(b.name, undefined, { numeric: true })
            : a[order] - b[order];
        return (ascending ? cmp : -cmp) || a.id.localeCompare(b.id);
      });
    page = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
    const group = app.ref.groupField;
    $("cmp-table").tBodies[0].replaceChildren(
      ...rows.slice(page * PAGE, page * PAGE + PAGE).map((r) =>
        h(
          "tr",
          { "data-id": r.id, class: ids.has(r.id) ? "chosen" : "" },
          h("td", { text: String(r.rank ?? "—") }),
          h(
            "td",
            null,
            h("button", { "aria-pressed": String(ids.has(r.id)), text: r.name }),
            h("small", { text: [props.get(r.id)?.[group], r.id].filter(Boolean).join(" · ") }),
            r.reason && h("small", { text: r.reason }),
          ),
          h("td", { text: r.score?.toFixed(1) ?? "—" }),
          h("td", { text: QUADRANTS[r.quadrant] ?? "Unranked" }),
        ),
      ),
    );
    $("cmp-page").textContent = rows.length
      ? `${page * PAGE + 1}–${Math.min(rows.length, (page + 1) * PAGE)} of ${number(rows.length)}`
      : "No matching areas";
    $("cmp-prev").disabled = page === 0;
    $("cmp-next").disabled = (page + 1) * PAGE >= rows.length;
    for (const b of panel.querySelectorAll("[data-sort]"))
      b.parentNode.setAttribute(
        "aria-sort",
        b.dataset.sort === order ? (ascending ? "ascending" : "descending") : "none",
      );
  }

  function selection() {
    const ids = new Set(config.selected);
    app.atlas.select(config.selected, []);
    for (const dot of $("cmp-plot").querySelectorAll("circle")) {
      dot.classList.toggle("chosen", ids.has(dot.dataset.id));
      if (ids.has(dot.dataset.id)) dot.parentNode.append(dot);
    }
    $("cmp-selection").textContent = ids.size + " selected";
    $("cmp-clear").disabled = !ids.size;
    const r = result.byId.get(config.selected.at(-1));
    $("cmp-details").replaceChildren(
      ...(r
        ? [
            h("h2", { text: r.name }),
            h("p", { text: r.id + " · " + (r.reason || "Rank " + r.rank + " · Score " + r.score.toFixed(1)) }),
            ...config.components.map((c, i) => {
              const p = props.get(r.id),
                ci = refData?.measures[c.field] && p[c.field + "_ci"],
                moeField = refData ? fieldInfo(app.catalog, c.field)?.moe : null,
                moe = moeField ? p[moeField] : null;
              const uncertainty = ci
                ? " · 95% CI " + ci.map((v) => raw(v)).join("–")
                : moe != null
                  ? " · " + (app.ref.moeLevel || 90) + "% MOE ±" + number(moe) + " percentage points"
                  : "";
              return h(
                "p",
                null,
                h("strong", { text: label(c.field) }),
                " · " + raw(r.values[i]) + uncertainty,
                h("br"),
                r.reason
                  ? ""
                  : number(r.percentiles[i] * 100) + " percentile · " + number(r.contributions[i], 2) + " score points",
              );
            }),
          ]
        : [h("p", { text: "Select an area on the map, plot or table to inspect its score." })]),
    );
    table();
  }

  function toggle(id) {
    if (!result?.byId.has(id)) return;
    config.selected = config.selected.includes(id)
      ? config.selected.filter((x) => x !== id)
      : [...config.selected, id];
    selection();
  }

  $("cmp-table").onclick = (ev) => {
    const sort = ev.target.closest("[data-sort]");
    if (sort) {
      ascending = order === sort.dataset.sort ? !ascending : sort.dataset.sort !== "score";
      order = sort.dataset.sort;
      page = 0;
      table();
      return;
    }
    const row = ev.target.closest("[data-id]");
    if (row) {
      const focus = row.contains(document.activeElement);
      toggle(row.dataset.id);
      if (focus)
        $("cmp-table").querySelector('tr[data-id="' + CSS.escape(row.dataset.id) + '"] button')?.focus();
    }
  };
  $("cmp-plot").onclick = (ev) => {
    const dot = ev.target.closest("circle");
    if (dot) toggle(dot.dataset.id);
  };
  $("cmp-prev").onclick = () => {
    page--;
    table();
  };
  $("cmp-next").onclick = () => {
    page++;
    table();
  };
  $("cmp-unranked").onchange = () => {
    page = 0;
    table();
  };
  $("cmp-only").onchange = (ev) => {
    only = ev.target.checked;
    page = 0;
    table();
  };
  $("cmp-clear").onclick = () => {
    config.selected = [];
    selection();
  };
  $("cmp-color").onchange = (ev) => {
    config.color = ev.target.value;
    drawMap();
  };
  $("cmp-layer").onchange = (ev) => open(ev.target.value, true);
  $("cmp-export").onclick = () =>
    saveBlob(
      new Blob([comparisonCSV(result, config.selected)], { type: "text/csv;charset=utf-8" }),
      "area-comparison.csv",
    );
  setupSplitter($("cmp-split"), $("map-view"), () => app.atlas.map.resize());

  return {
    open,
    leave,
    toggle,
    collection: () => active?.collection,
    image: () =>
      result &&
      exportMapImage(app.atlas.map, {
        title: active.name,
        subtitle: $("map-subtitle").textContent,
        legend: legend(),
        notes: refData
          ? app.ref.compare?.imageCredit || app.catalog.region.credit
          : "Local polygon layer · Natural Earth",
      }),
  };
}
