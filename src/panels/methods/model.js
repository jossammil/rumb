// Regression controls: the model type and its covariates. The measure on the
// map is the outcome (for count models, its numerator with the denominator
// as the offset); the Neighbors setting gives the weights for the spatial
// diagnostics and the spatial models.
import { h, options } from "../../ui/dom.js";
import { COUNT_TYPES, MODEL_TYPES } from "../../stats/models.js";
import { poolOf } from "../../stats/pool.js";

export function render(app, mount) {
  const { state } = app,
    l = app.layer();
  const model = { type: "ols", xs: [], ...state.model };
  const countNote = () => {
    const pool = poolOf(app.fieldMeta(l, state.measure));
    return pool?.denominator
      ? " Counts: " + app.label(pool.numerator, l) + ", with log(" + app.label(pool.denominator, l) + ") as the offset."
      : " This measure has no counts; choose a rate with a numerator and a denominator.";
  };
  // Read the model at the moment of the change: quick ticks can outrun a redraw.
  const current = () => ({ type: "ols", xs: [], ...app.state.model });
  const set = (patch) => {
    app.analysis.clearResults();
    app.store.set({ model: { ...current(), ...patch } });
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
          const on = ev.target.checked;
          if (on) await app.ws.ensureFields([f]).catch(app.fail);
          // Read the choice after the wait: other ticks may have landed while the table loaded.
          const now = current().xs;
          set({ xs: on ? [...new Set([...now, f])] : now.filter((x) => x !== f) });
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
    h("p", {
      class: "subtle",
      id: "model-note",
      text:
        (model.xs.length ? model.xs.length + " covariates chosen." : "Choose at least one covariate.") +
        (model.type === "lag" || model.type === "error"
          ? " Spatial models use the Neighbors setting below, which must be symmetric (not plain k nearest)." +
            " Above 2,500 areas, log|I − ρW| is approximated (Chebyshev) and standard errors come from a numerical Hessian; at most 20,000 areas."
          : "") +
        (COUNT_TYPES.has(model.type) ? countNote() : ""),
    }),
  );
}
