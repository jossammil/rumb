// "Smooth a rate…": adds empirical Bayes, spatial EB and window rates, excess
// risk and exact Poisson limits as fields of the focus layer, for any measure
// with a numerator and a denominator (stats/rates.js). The fields are kept as
// a small spec on the layer's stack entry, so projects and share links carry
// the spec and rebuild the values.
import { poolOf } from "../stats/pool.js";
import { RATE_METHODS } from "../stats/rates.js";
import { $, h, options } from "../ui/dom.js";

const ORDER = ["eb", "seb", "sr", "er", "ci"];
const NOTES = {
  eb: "shrinks each rate toward the state's rate, more where the population is small",
  seb: "shrinks each rate toward its neighborhood's rate (itself and touching areas)",
  sr: "events over population across each area and its touching neighbors",
  er: "observed events over those expected at the state's rate",
  ci: "exact Poisson, for counts of events such as deaths or births",
};

export function openSmooth(app) {
  const { state } = app,
    l = app.layer(),
    entry = state.stack.find((e) => e.id === l.id);
  const rates = app.fieldList(l).filter((f) => poolOf(app.fieldMeta(l, f))?.denominator && !l.derivedFields?.includes(f));
  if (!rates.length) throw new Error("This layer has no rates with counts to smooth.");
  const polygons = app.kindOf(l) !== "point";
  const measure = h(
    "select",
    { id: "smooth-measure" },
    options(rates.map((f) => [f, app.label(f)]), rates.includes(state.measure) ? state.measure : rates[0]),
  );
  // Poisson limits suit event rates; survey estimates (ACS) carry margins of error instead.
  const events = app.fieldMeta(l, measure.value)?.format === "rate";
  const boxes = ORDER.map((m) =>
    h(
      "label",
      { class: "checkbox" + (RATE_METHODS[m].spatial && !polygons ? " disabled" : "") },
      h("input", {
        type: "checkbox",
        "data-method": m,
        checked: m === "eb" || (m === "seb" && polygons) || (m === "ci" && events),
        disabled: RATE_METHODS[m].spatial && !polygons,
      }),
      RATE_METHODS[m].label.charAt(0).toUpperCase() + RATE_METHODS[m].label.slice(1) + ": " + NOTES[m],
    ),
  );
  const source = h("p", { class: "subtle" });
  const refresh = () => {
    const pool = poolOf(app.fieldMeta(l, measure.value));
    source.textContent = "From " + app.label(pool.numerator, l) + " ÷ " + app.label(pool.denominator, l) + ".";
  };
  measure.onchange = refresh;
  const existing = () => (entry?.derived || []).find((d) => d.measure === measure.value);
  async function apply(methods) {
    const others = (app.state.stack.find((e) => e.id === l.id)?.derived || []).filter((d) => d.measure !== measure.value);
    const derived = methods.length ? [...others, { kind: "rate", measure: measure.value, methods }] : others;
    app.store.set({ stack: app.state.stack.map((e) => (e.id === l.id ? { ...e, derived } : e)) });
    app.status("Smoothing " + app.label(measure.value, l) + "…", "running");
    await app.ensureDerived();
    $("dialog").close();
    const first = methods.find((m) => m !== "er" && m !== "ci") || methods[0];
    if (first) await app.setMeasure(RATE_METHODS[first].prefix + measure.value);
    else {
      if (/^(eb|seb|sr|er|lcl|ucl)_/.test(app.state.measure)) await app.setMeasure(measure.value);
      app.renderAll();
    }
    app.notify(methods.length ? "Added smoothed fields for " + app.label(measure.value, l) + "." : "Removed the smoothed fields.");
  }
  const checked = () => boxes.map((b) => b.querySelector("input")).filter((i) => i.checked && !i.disabled).map((i) => i.dataset.method);
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body smooth" },
      h("h2", { text: "Smooth a rate" }),
      h("p", {
        class: "subtle",
        text: "Rates on small populations jump around. These fields steady them, or show how uncertain they are. Each appears under Derived in Color by.",
      }),
      h("label", { for: "smooth-measure", text: "Rate" }),
      measure,
      source,
      boxes,
      !polygons && h("p", { class: "subtle", text: "Spatial methods need areas that touch, so they are off for points." }),
      h(
        "div",
        { class: "actions" },
        h("button", {
          class: "primary",
          id: "smooth-go",
          text: "Add fields",
          onclick: (ev) => app.perform(ev.currentTarget, () => apply(checked())),
        }),
        existing() &&
          h("button", {
            class: "secondary",
            id: "smooth-remove",
            text: "Remove this rate's fields",
            onclick: (ev) => app.perform(ev.currentTarget, () => apply([])),
          }),
      ),
    ),
  );
  refresh();
  $("dialog").showModal();
}
