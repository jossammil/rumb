// The layer list: the layers on the map, top first, each with show/hide, move
// and remove controls; query layers that are not on the map; and the library
// dialog for adding catalog layers (facilities, districts, health rankings).
import { number, plural } from "../catalog/format.js";
import { rankItems } from "../ui/palette.js";
import { $, h, icon } from "../ui/dom.js";

/** "1,043 points · 2020", "82 areas · 2025", "878 census tracts". */
export function describeLayer(l, ref) {
  const n = l.collection.features.length;
  if (l.meta) {
    const noun = l.meta.geometry === "point" ? "point" : l.meta.geometry === "line" ? "line" : "area";
    return [plural(n, noun), l.meta.vintage].filter(Boolean).join(" · ");
  }
  if (l.id === ref.id) return number(n) + " " + (ref.nouns || "features");
  return number(n) + " features" + (l.sql ? " · query" : "");
}

export function renderLayers(app) {
  const { state } = app;
  const rows = [...state.stack].reverse().map((entry, i, top) => {
    const l = app.layerById(entry.id);
    if (!l) return null;
    const focus = entry.id === state.active;
    const tool = (name, label, onclick, disabled = false) =>
      h("button", { class: "iconbtn", "aria-label": label + " " + l.name, title: label, disabled, onclick }, icon(name, 14));
    return h(
      "div",
      { class: "stack-row" + (focus ? " active" : "") + (entry.visible ? "" : " hidden-layer"), "data-row": entry.id },
      h(
        "button",
        {
          class: "iconbtn eye",
          "aria-label": (entry.visible ? "Hide " : "Show ") + l.name,
          "aria-pressed": String(entry.visible),
          title: focus ? "The focus layer is always shown" : entry.visible ? "Hide" : "Show",
          disabled: focus,
          onclick: () => app.toggleLayer(entry.id),
        },
        icon(entry.visible ? "eye" : "eye-off", 15),
      ),
      h(
        "button",
        {
          class: "layer" + (focus ? " active" : ""),
          "data-layer": entry.id,
          title: focus ? "Focus layer: the style, inspector and analysis act on it" : "Make this the focus layer",
          onclick: () => {
            if (!focus) app.focusLayer(entry.id);
          },
        },
        h("span", {
          class: "layer-swatch " + (l.meta?.geometry || (l.id === app.ref.id ? "polygon" : "mixed")),
          style: { "--swatch": l.meta?.style?.color || "var(--accent)" },
        }),
        h("span", { class: "layer-text" }, h("strong", { text: l.name }), h("small", { text: describeLayer(l, app.ref) })),
        focus && h("span", { class: "tick" }, icon("check")),
      ),
      h(
        "span",
        { class: "stack-tools" },
        tool("up", "Move up", () => app.moveInStack(entry.id, 1), i === 0),
        tool("down", "Move down", () => app.moveInStack(entry.id, -1), i === top.length - 1),
        tool("close", "Remove from map", () => app.removeFromStack(entry.id), state.stack.length < 2),
      ),
    );
  });
  const offMap = state.layers.filter((l) => !state.stack.some((e) => e.id === l.id));
  const l = app.layer();
  const list = [
    ...rows,
    offMap.length && h("p", { class: "stack-note", text: "Query layers not on the map" }),
    ...offMap.map((x) =>
      h(
        "button",
        { class: "layer off-map", "data-layer": x.id, onclick: () => app.focusLayer(x.id) },
        h("span", { class: "layer-icon" }, icon("plus", 16)),
        h("span", { class: "layer-text" }, h("strong", { text: x.name }), h("small", { text: describeLayer(x, app.ref) })),
      ),
    ),
    l?.sql &&
      h("button", {
        class: "plain-btn",
        text: "Inspect layer SQL",
        onclick: () => {
          app.store.set({ sql: l.sql });
          app.setView("sql");
        },
      }),
  ];
  $("layer-list").replaceChildren(...list.filter(Boolean));
  $("roads-above").checked = state.roads !== "below";
}

/** The library dialog: catalog layers by group, searchable; choosing one adds it to the map. */
export async function openLibrary(app) {
  const dialog = $("dialog");
  const library = await app.ws.library();
  const input = h("input", { id: "library-term", type: "search", autocomplete: "off", placeholder: "Fire stations, schools, health…" });
  const results = h("div", { id: "library-results" });
  const onMap = new Set(app.state.stack.map((e) => e.id));
  const item = (meta) =>
    h(
      "button",
      {
        class: "layer",
        "data-library": meta.id,
        disabled: onMap.has(meta.id),
        onclick: () => {
          dialog.close();
          app.perform(null, () => app.addLibraryLayer(meta.id));
        },
      },
      h("span", { class: "layer-swatch " + meta.geometry, style: { "--swatch": meta.style?.color || "var(--accent)" } }),
      h(
        "span",
        { class: "layer-text" },
        h("strong", { text: meta.name }),
        h("small", {
          text: [plural(meta.count, meta.geometry === "point" ? "point" : "area"), meta.vintage, meta.credit]
            .filter(Boolean)
            .join(" · "),
        }),
      ),
      onMap.has(meta.id) && h("span", { class: "tick", title: "On the map" }, icon("check")),
    );
  function show() {
    const q = input.value.trim();
    if (q) {
      const ranked = rankItems(
        library.layers.map((meta) => ({ label: meta.name, group: meta.group, hint: meta.credit, meta })),
        q,
        40,
      );
      results.replaceChildren(...(ranked.length ? ranked.map((r) => item(r.meta)) : [h("p", { text: "No layers match." })]));
      return;
    }
    results.replaceChildren(
      ...library.groups.flatMap((group) => {
        const layers = library.layers.filter((m) => m.group === group);
        return layers.length ? [h("h3", { class: "library-group", text: group }), ...layers.map(item)] : [];
      }),
    );
  }
  input.oninput = show;
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body library" },
      h("h2", { text: "Add a layer" }),
      h("p", {
        class: "subtle",
        text: "Public layers for " + app.catalog.region.name + ". Each loads when you add it and is saved with the project.",
      }),
      h("label", { for: "library-term", class: "visually-hidden", text: "Search layers" }),
      input,
      results,
    ),
  );
  show();
  dialog.showModal();
  input.focus();
}
