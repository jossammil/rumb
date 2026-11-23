// Regression controls: the model type and its covariates. The measure on the
// map is the outcome; the Neighbors setting gives the weights for the
// spatial diagnostics (and, later, the spatial models).
import { h, options } from "../../ui/dom.js";
import { MODEL_TYPES } from "../../stats/models.js";

export function render(app, mount) {
  const { state } = app,
    l = app.layer();
  const model = { type: "ols", xs: [], ...state.model };
  const set = (patch) => {
    app.analysis.clearResults();
    app.store.set({ model: { ...model, ...patch } });
    app.renderAll();
  };
  const type = h(
    "select",
    { id: "model-type", onchange: (ev) => set({ type: ev.target.value }) },
    options(Object.entries(MODEL_TYPES)),
  );
  type.value = MODEL_TYPES[model.type] ? model.type : "ols";
  // Covariates come in the measure picker's groups; the outcome is left out.
  const groups = app
    .fieldGroups(l)
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f !== state.measure) }))
    .filter((g) => g.fields.length);
  const chosen = new Set(model.xs);
  const box = (f) =>
    h(
      "label",
      { class: "checkbox" },
      h("input", {
        type: "checkbox",
        "data-covariate": f,
        checked: chosen.has(f),
        onchange: async (ev) => {
          const xs = ev.target.checked ? [...model.xs, f] : model.xs.filter((x) => x !== f);
          if (ev.target.checked) await app.ws.ensureFields([f]).catch(app.fail);
          set({ xs });
        },
      }),
      app.label(f),
    );
  mount.replaceChildren(
    h("label", { for: "model-type", text: "Model" }),
    type,
    h("p", { class: "subtle", text: "Explains " + app.label(state.measure) + " (the measure on the map) with:" }),
    h(
      "div",
      { class: "covariates", id: "covariates" },
      groups.map((g) => h("fieldset", null, h("legend", { text: g.label }), g.fields.map(box))),
    ),
    h("p", { class: "subtle", id: "model-note", text: model.xs.length ? model.xs.length + " covariates chosen." : "Choose at least one covariate." }),
  );
}
