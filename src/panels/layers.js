// The layer list: the region's reference layer, then layers mapped from SQL.
import { number } from "../catalog/format.js";
import { $, h, icon } from "../ui/dom.js";

export function renderLayers(app) {
  const { state } = app;
  const entry = (id, name, description) =>
    h(
      "button",
      {
        class: "layer" + (id === state.active ? " active" : ""),
        "data-layer": id,
        onclick: () => {
          if (id !== app.state.active) app.showLayer(id);
        },
      },
      h("span", { class: "layer-icon" }, icon("layers", 18)),
      h("span", { class: "layer-text" }, h("strong", { text: name }), h("small", { text: description })),
      id === state.active && h("span", { class: "tick" }, icon("check")),
    );
  const ref = app.ws.referenceView();
  const l = app.layer();
  const list = [
    entry(ref.id, ref.name, number(ref.collection.features.length) + " " + (app.ref.nouns || "features")),
    ...state.layers.map((x) => entry(x.id, x.name, number(x.collection.features.length) + " features")),
  ];
  if (l.sql)
    list.push(
      h("button", {
        class: "plain-btn",
        text: "Inspect layer SQL",
        onclick: () => {
          app.store.set({ sql: l.sql });
          app.setView("sql");
        },
      }),
    );
  $("layer-list").replaceChildren(...list);
}
