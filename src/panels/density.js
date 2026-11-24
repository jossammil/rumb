// "Density surface…": a kernel density surface of a point layer, drawn as a
// new layer of square cells inside the region's outline that can be styled,
// classified, analysed and exported like any polygon layer. The layer keeps
// its spec, so share links rebuild it (stats/points.js, core/derived.js).
import { defaultBandwidth } from "../stats/points.js";
import { $, h, options } from "../ui/dom.js";

export async function openDensity(app) {
  const { state } = app;
  const library = await app.ws.library();
  const shown = state.stack.map((e) => app.layerById(e.id)).filter((x) => x && app.kindOf(x) === "point");
  const choices = [
    ...shown.map((x) => [x.id, x.name + (x.id === state.active ? " (focus)" : " (on the map)")]),
    ...library.layers.filter((m) => m.geometry === "point" && !shown.some((x) => x.id === m.id)).map((m) => [m.id, m.name]),
  ];
  if (!choices.length) throw new Error("There are no point layers to make a surface of.");
  const source = h("select", { id: "density-source" }, options(choices, shown.some((x) => x.id === state.active) ? state.active : choices[0][0]));
  const weight = h("select", { id: "density-weight" });
  const bandwidth = h("input", { id: "density-bandwidth", type: "number", min: 0.1, max: 200, step: 0.1, placeholder: "Auto" });
  const cell = h("input", { id: "density-cell", type: "number", min: 0.1, max: 200, step: 0.1, placeholder: "Auto" });
  const note = h("p", { class: "subtle", id: "density-note" });
  const metaOf = (id) => app.layerById(id)?.meta || library.layers.find((m) => m.id === id);
  const refresh = async () => {
    const meta = metaOf(source.value);
    const numeric = Object.entries(meta?.fields || {}).filter(([, f]) => f.format === "integer" || f.format === "number");
    const was = weight.value;
    weight.replaceChildren(...options([["", "Each point counts once"], ...numeric.map(([k, f]) => [k, "Weighted by " + f.label.toLowerCase()])], was));
    // The automatic bandwidth, Esri's spatial variant of Silverman's rule, shown for reference.
    const l = app.layerById(source.value) || (await app.ws.loadLayer(source.value).then(() => app.layerById(source.value)).catch(() => null));
    const points = (l?.collection.features || []).filter((f) => f.geometry?.type === "Point");
    if (points.length > 1) {
      const xy = points.map((f) => app.tools.projection.forward(f.geometry.coordinates));
      const w = weight.value ? points.map((f) => Math.max(0, Number(f.properties?.[weight.value]) || 0)) : null;
      note.textContent =
        "Auto bandwidth for " + points.length + " points: " + (defaultBandwidth(xy, w) / 1609.344).toFixed(1) +
        " mi (Esri's spatial variant of Silverman's rule). Cells default to 1/100 of the state's width.";
    }
  };
  source.onchange = refresh;
  weight.onchange = refresh;
  async function apply() {
    app.status("Drawing the density surface…", "running");
    const layer = await app.generateDensity({
      kind: "density",
      source: source.value,
      weight: weight.value || null,
      bandwidth: Number(bandwidth.value) || null,
      cell: Number(cell.value) || null,
    });
    $("dialog").close();
    app.showGenerated(layer);
    app.notify("Added " + layer.name + ": " + layer.collection.features.length.toLocaleString() + " cells.");
  }
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body density" },
      h("h2", { text: "Density surface" }),
      h("p", {
        class: "subtle",
        text: "A quartic kernel spreads each point (or its weight) over a circle of the bandwidth, and the surface sums them per square mile, inside " + app.catalog.region.name + "'s outline.",
      }),
      h("label", { for: "density-source", text: "Points" }),
      source,
      h("label", { for: "density-weight", text: "Weight" }),
      weight,
      h(
        "div",
        { class: "two-fields" },
        h("div", null, h("label", { for: "density-bandwidth", text: "Bandwidth (mi)" }), bandwidth),
        h("div", null, h("label", { for: "density-cell", text: "Cell size (mi)" }), cell),
      ),
      note,
      h("div", { class: "actions" }, h("button", { class: "primary", id: "density-go", text: "Draw surface", onclick: (ev) => app.perform(ev.currentTarget, apply) })),
    ),
  );
  $("dialog").showModal();
  await refresh();
}
