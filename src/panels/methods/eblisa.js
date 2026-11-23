// EB-adjusted cluster controls: which counts the empirical Bayes rates come
// from, or why the measure cannot be used.
import { h } from "../../ui/dom.js";
import { poolOf } from "../../stats/pool.js";

export function render(app, mount) {
  const l = app.layer(),
    pool = poolOf(app.fieldMeta(l, app.state.measure));
  mount.replaceChildren(
    h("p", {
      class: "subtle",
      id: "eb-note",
      text: pool?.denominator
        ? "Rates from " + app.label(pool.numerator, l) + " ÷ " + app.label(pool.denominator, l) +
          ", standardized by empirical Bayes (Assunção & Reis 1999) so small populations do not dominate."
        : "This measure has no counts. Choose a rate with a numerator and a denominator, such as poverty or a County Health Rankings rate.",
    }),
  );
}
