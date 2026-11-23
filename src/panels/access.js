// "Access to facilities…": for each area of the focus layer, the miles to the
// nearest facility of a point layer, how many lie within a distance, and the
// E2SFCA ratio of supply to the population that can reach it (stats/access.js).
// The fields are a small spec on the layer's stack entry, so projects and
// share links rebuild them.
import { accessFields } from "../core/derived.js";
import { $, h, options } from "../ui/dom.js";

export async function openAccess(app) {
  const { state } = app,
    l = app.layer();
  if (app.kindOf(l) !== "polygon") throw new Error("Make a polygon layer the focus to measure access from its areas.");
  const library = await app.ws.library();
  // Facilities: point layers on the map first, then the library's.
  const shown = state.stack.map((e) => app.layerById(e.id)).filter((x) => x && x.id !== l.id && app.kindOf(x) === "point");
  const choices = [
    ...shown.map((x) => [x.id, x.name + " (on the map)"]),
    ...library.layers.filter((m) => m.geometry === "point" && !shown.some((x) => x.id === m.id)).map((m) => [m.id, m.name]),
  ];
  if (!choices.length) throw new Error("There are no point layers to measure access to.");
  const layer = h("select", { id: "access-layer" }, options(choices));
  const size = h("select", { id: "access-size" });
  const metaOf = (id) => app.layerById(id)?.meta || library.layers.find((m) => m.id === id);
  const refreshSize = () => {
    const meta = metaOf(layer.value);
    const numeric = Object.entries(meta?.fields || {}).filter(([, f]) => f.format === "integer" || f.format === "number");
    size.replaceChildren(...options([["", "Each facility counts once"], ...numeric.map(([k, f]) => [k, "Weighted by " + f.label.toLowerCase()])]));
  };
  layer.onchange = refreshSize;
  // Population: the layer's population field, and for tracts the ACS age counts.
  const populationField = l.meta?.populationField || (l.reference && app.ref.populationField);
  const populations = [
    populationField && [populationField, app.label(populationField, l)],
    l.reference && ["acs_age65_count", "Population 65 and over (ACS)"],
    l.reference && ["acs_under18_count", "Population under 18 (ACS)"],
  ].filter(Boolean);
  if (!populations.length) throw new Error("This layer has no population field to measure access for.");
  const population = h("select", { id: "access-population" }, options(populations));
  const within = h("input", { id: "access-within", type: "number", min: 0.5, max: 200, step: 0.5, value: 10 });
  const catchment = h("input", { id: "access-catchment", type: "number", min: 0.5, max: 200, step: 0.5, value: 30 });
  const decay = h(
    "select",
    { id: "access-decay" },
    options([
      ["gaussian", "Gaussian: nearer facilities count more"],
      ["step", "Step: every facility in the catchment counts fully"],
    ]),
  );
  async function apply() {
    const spec = {
      kind: "access",
      layer: layer.value,
      size: size.value || null,
      population: population.value,
      within: Number(within.value),
      catchment: Number(catchment.value),
      decay: decay.value,
    };
    if (!app.state.stack.some((e) => e.id === spec.layer)) await app.ws.loadLayer(spec.layer);
    const others = (app.state.stack.find((e) => e.id === l.id)?.derived || []).filter((d) => !(d.kind === "access" && d.layer === spec.layer));
    app.store.set({ stack: app.state.stack.map((e) => (e.id === l.id ? { ...e, derived: [...others, spec] } : e)) });
    app.status("Measuring access…", "running");
    await app.ensureDerived();
    $("dialog").close();
    await app.setMeasure(accessFields(spec)[2]);
    app.notify("Added access to " + (metaOf(spec.layer)?.name || spec.layer) + " as fields, under Derived.");
  }
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body access" },
      h("h2", { text: "Access to facilities" }),
      h("p", {
        class: "subtle",
        text: "From each area's center of population, in straight lines (not travel times): miles to the nearest facility, how many are within a distance, and the E2SFCA ratio of facilities (or their capacity) to the people who can reach them.",
      }),
      h("label", { for: "access-layer", text: "Facilities" }),
      layer,
      h("label", { for: "access-size", text: "Supply" }),
      size,
      h("label", { for: "access-population", text: "People" }),
      population,
      h(
        "div",
        { class: "two-fields" },
        h("div", null, h("label", { for: "access-within", text: "Count within (mi)" }), within),
        h("div", null, h("label", { for: "access-catchment", text: "Catchment (mi)" }), catchment),
      ),
      h("label", { for: "access-decay", text: "Distance decay" }),
      decay,
      h("div", { class: "actions" }, h("button", { class: "primary", id: "access-go", text: "Add fields", onclick: (ev) => app.perform(ev.currentTarget, apply) })),
    ),
  );
  refreshSize();
  $("dialog").showModal();
}
