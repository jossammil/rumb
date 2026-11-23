// The printable report: a letter-size page with the map, its legend, a
// summary, the filtered or selected features, counts, sources and methods,
// and notes, saved as PDF through the browser's print dialog. Loaded only
// when asked for. Each section can be left out.
import { methodOf } from "../stats/methods.js";
import { number, plural } from "../catalog/format.js";
import { formatValue } from "../catalog/popup.js";
import { featureId } from "../core/features.js";
import { formatPosition } from "../core/settings.js";
import { describeFilter } from "../geo/filter.js";
import { $, h } from "../ui/dom.js";
import { getSettings } from "../ui/themes.js";

export const SECTIONS = [
  ["map", "Title and map"],
  ["legend", "Legend"],
  ["summary", "Summary"],
  ["features", "Features (filtered or selected)"],
  ["counts", "Counts"],
  ["sources", "Sources and methods"],
  ["notes", "Notes"],
];

/** The map as an image, once it has drawn everything. */
async function mapImage(map) {
  await new Promise((resolve) => {
    map.once("idle", resolve);
    map.triggerRepaint();
  });
  return map.getCanvas().toDataURL("image/png");
}

/** Builds #print-root for the chosen sections ({ map: true, … }) and notes. */
export async function buildReport(app, { sections, title, notes }) {
  const { state } = app,
    l = app.layer();
  const where = ([lon, lat]) => formatPosition(lat, lon, getSettings().coords);
  const filter = app.filter.current();
  const kept = app.filter.keptFor(l);
  const selected = [...new Set([...(state.picks || []), state.selected].filter(Boolean).map(String))];
  const measureLabel = state.category ? app.label(state.category) : state.measure ? app.label(state.measure) : l.name;
  const parts = [];
  const section = (id, heading, ...body) => parts.push(h("section", { class: "print-section", "data-section": id }, heading && h("h2", { text: heading }), body));

  if (sections.map) {
    parts.push(
      h(
        "header",
        { class: "print-head", "data-section": "map" },
        h("h1", { text: title || $("map-title").textContent }),
        h("p", { text: measureLabel + " · " + $("map-subtitle").textContent }),
      ),
    );
    parts.push(h("img", { class: "print-map", alt: "Map of " + measureLabel, src: await mapImage(app.atlas.map) }));
  }
  if (sections.legend) {
    const items = app.style.legendItems().filter((x) => !x.missing);
    section(
      "legend",
      "Legend",
      h("p", { class: "print-legend-title", text: measureLabel }),
      h("div", { class: "print-legend" }, items.map((x) => h("span", null, h("i", { style: { background: x.color } }), x.text))),
      app.style.legendOthers().map((o) =>
        h("p", { class: "print-other" }, o.colors.slice(0, 5).map((c) => h("i", { style: { background: c } })), o.name + (o.note ? " (" + o.note + ")" : "")),
      ),
    );
  }
  if (sections.summary) {
    const rows = [
      ["Focus layer", l.name + " · " + plural(l.collection.features.length, "feature")],
      ["Colored by", measureLabel],
      state.measure && !state.category && ["Classes", state.count + " · " + state.classification + " · " + state.palette],
      filter && ["Filter", describeFilter(filter, where) + (state.filterMode === "hide" ? " (others hidden)" : " (others dimmed)")],
      selected.length && ["Selection", plural(selected.length, "feature")],
      state.result && [methodOf(state.result).title, methodOf(state.result).reportText(state.result)],
      state.result?.caution && ["Caution", state.result.caution],
      ["Layers shown", state.stack.filter((e) => e.visible).map((e) => app.layerById(e.id)?.name).filter(Boolean).join(", ")],
      ["Made", new Date().toLocaleString() + " · rumb " + app.version],
    ].filter(Boolean);
    // A method's own tables (a regression's coefficients and diagnostics) follow.
    const tables = state.result ? methodOf(state.result).details?.(state.result) || [] : [];
    section(
      "summary",
      "Summary",
      h("table", { class: "print-table" }, h("tbody", null, rows.map(([k, v]) => h("tr", null, h("th", { text: k }), h("td", { text: v }))))),
      tables.map((t) =>
        h(
          "table",
          { class: "print-table" },
          h("caption", { text: t.caption }),
          h("thead", null, h("tr", null, t.head.map((x) => h("th", { text: x })))),
          h("tbody", null, t.rows.map((r) => h("tr", null, r.map((x) => h("td", { text: x }))))),
        ),
      ),
    );
  }
  if (sections.features) {
    const ids = kept ? [...kept.keys()] : selected;
    if (ids.length) {
      const fields = app.searchFields(l),
        info = app.fieldMeta(l, state.measure);
      const byId = new Map(l.collection.features.map((f) => [featureId(f), f]));
      const order = kept ? ids.sort((a, b) => kept.get(a) - kept.get(b)) : ids;
      const showDistance = kept && filter?.kind !== "polygon";
      const rows = order.slice(0, 100).map((id) => {
        const p = byId.get(id)?.properties || {};
        return h(
          "tr",
          null,
          h("td", { text: String(p[fields.labelField] ?? p.name ?? id) }),
          h("td", { text: fields.groupField ? String(p[fields.groupField] ?? "") : "" }),
          state.measure && h("td", { class: "num", text: formatValue(p[state.measure], { format: info?.format || "number", unit: info?.unit }) ?? "—" }),
          showDistance && h("td", { class: "num", text: number(kept.get(id), 1) + " mi" }),
        );
      });
      section(
        "features",
        (kept ? "Kept by the filter" : "Selected") + " · " + l.name,
        h(
          "table",
          { class: "print-table" },
          h("thead", null, h("tr", null, h("th", { text: "Name" }), h("th", { text: fields.groupField ? "Place" : "" }), state.measure && h("th", { text: app.label(state.measure) }), showDistance && h("th", { text: "Distance" }))),
          h("tbody", null, rows),
        ),
        ids.length > 100 && h("p", { class: "print-note", text: "First 100 of " + number(ids.length, 0) + "; export the layer's data for all of them." }),
      );
    }
  }
  if (sections.counts && (filter || l.countFields)) {
    const rows = [];
    if (filter)
      for (const e of [...state.stack].reverse()) {
        const x = app.layerById(e.id);
        if (x && e.visible) rows.push([x.name, number(app.filter.keptFor(x).size, 0) + " of " + number(x.collection.features.length, 0) + " kept"]);
      }
    for (const f of l.countFields || [])
      if (f.startsWith("count_"))
        rows.push([app.label(f), number(l.collection.features.reduce((n, x) => n + (x.properties[f] || 0), 0), 0) + " in " + plural(l.collection.features.length, "area")]);
    section("counts", "Counts", h("table", { class: "print-table" }, h("tbody", null, rows.map(([k, v]) => h("tr", null, h("th", { text: k }), h("td", { text: v }))))));
  }
  if (sections.sources) {
    const credits = [];
    for (const e of state.stack) {
      const x = app.layerById(e.id);
      if (!x || !e.visible) continue;
      if (x.meta) credits.push(x.name + " (" + x.meta.vintage + "): " + x.meta.credit + ". " + (x.meta.source?.url || ""));
      else if (x.id === app.ref.id) credits.push(x.name + ": " + (app.ref.credit || "") + " · " + (app.ref.context || ""));
      else credits.push(x.name + ": a query layer made on this device.");
    }
    credits.push("Backdrop: " + app.catalog.region.credit + "; roads from Census TIGER/Line 2024.");
    const proj = app.catalog.region.projection?.name || "a local projection";
    section(
      "sources",
      "Sources and methods",
      h("ul", null, credits.map((c) => h("li", { text: c }))),
      h("p", { class: "print-note", text: "Distances are straight lines in " + proj + ", in miles. Natural breaks are Fisher's optimal classes; pooled rates sum counts before dividing. Display geometry is simplified." }),
    );
  }
  if (sections.notes && notes?.trim()) section("notes", "Notes", h("p", { class: "print-notes", text: notes }));
  const root = $("print-root") || document.body.appendChild(h("div", { id: "print-root" }));
  root.replaceChildren(...parts);
  return root;
}

/** The report dialog: choose sections, add a title and notes, then print or save as PDF. */
export function openReport(app) {
  const boxes = SECTIONS.map(([id, label]) =>
    h("label", { class: "checkbox" }, h("input", { type: "checkbox", "data-section": id, checked: true }), label),
  );
  const title = h("input", { id: "report-title", type: "text", value: $("map-title").textContent });
  const notes = h("textarea", { id: "report-notes", rows: 3, placeholder: "Notes printed at the end (optional)" });
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body report" },
      h("h2", { text: "Printable report" }),
      h("p", { class: "subtle", text: "A letter-size page of this map. Choose Save as PDF in the print dialog to keep a file." }),
      h("label", { for: "report-title", text: "Title" }),
      title,
      h("div", { class: "report-sections" }, boxes),
      notes,
      h("button", {
        class: "primary",
        id: "report-print",
        text: "Print or save as PDF",
        onclick: (ev) =>
          app.perform(ev.currentTarget, async () => {
            const sections = Object.fromEntries(boxes.map((b) => [b.querySelector("input").dataset.section, b.querySelector("input").checked]));
            await buildReport(app, { sections, title: title.value, notes: notes.value });
            $("dialog").close();
            window.print();
          }),
      }),
    ),
  );
  $("dialog").showModal();
}
