// Bivariate cluster controls: the second measure whose neighboring values
// each area's measure is compared with.
import { h, options } from "../../ui/dom.js";

export function render(app, mount) {
  const { state } = app,
    l = app.layer();
  const fields = app.fieldList(l).filter((f) => f !== state.measure);
  const select = h(
    "select",
    {
      id: "y-field",
      onchange: async (ev) => {
        const yField = ev.target.value || null;
        app.analysis.clearResults();
        app.store.set({ yField });
        if (yField) await app.ws.ensureFields([yField]).catch(app.fail);
        app.renderAll();
      },
    },
    options([["", "Choose a measure…"], ...fields.map((f) => [f, app.label(f)])]),
  );
  select.value = fields.includes(state.yField) ? state.yField : "";
  mount.replaceChildren(h("label", { for: "y-field", text: "Against neighbors' values of" }), select);
}
