// Marks the side sections a view-only layer (core/scope.js) turns off: the
// filter and the spatial analysis are made inert, under a note that says why
// and offers the counties, or the state at the map's center.
import { stateOf } from "../core/regions.js";
import { layerScope } from "../core/scope.js";
import { $, h } from "../ui/dom.js";

const SECTIONS = ["sec-filter", "sec-analyze"];

export function renderScope(app) {
  const l = app.layer(),
    { viewOnly, reason } = layerScope(l);
  for (const id of SECTIONS) {
    const section = $(id);
    if (!section) continue;
    section.classList.toggle("view-only", viewOnly);
    section.querySelector(".scope-note")?.remove();
    for (const child of section.children) if (child.tagName !== "H2") child.inert = viewOnly;
    if (!viewOnly) continue;
    section.querySelector("h2").after(
      h(
        "div",
        { class: "scope-note", "data-scope": id },
        h("p", { class: "subtle", text: reason }),
        h("button", {
          class: "plain-btn",
          "data-scope-action": "counties",
          text: "Use " + app.ref.name,
          onclick: () => app.focusLayer(app.ref.id),
        }),
        h("button", {
          class: "plain-btn",
          "data-scope-action": "state",
          text: "Open the state at the map's center",
          onclick: () => openStateAtCenter(app, l),
        }),
      ),
    );
  }
}

/** Reopens the app in the state under the map's center, at the same place. */
function openStateAtCenter(app, l) {
  const map = app.atlas.map;
  const hit = map.queryRenderedFeatures(map.project(map.getCenter()), { layers: ["lyr-" + l.id + "-fill"] })[0];
  const state = hit && stateOf(l.meta, hit.id);
  if (!state) return app.notify("Zoom in until tracts show at the map's center, then try again.");
  if (!app.hasRegion(state.id)) return app.notify(state.name + " is not available here.");
  const { center, zoom } = app.atlas.camera();
  app.openRegion(state.id, { extra: { at: [center[0].toFixed(5), center[1].toFixed(5), zoom.toFixed(2)].join(",") } });
}
