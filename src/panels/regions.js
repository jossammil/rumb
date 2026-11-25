// The state picker: every region the data index lists, searchable by name or
// abbreviation. It reads only the index, already loaded at start; choosing a
// state reopens the app there (core/regions.js).
import { $, h } from "../ui/dom.js";
import { number } from "../catalog/format.js";

/** Regions matching a search term, by name or id, in name order. Pure. */
export function matchRegions(regions, term) {
  const q = term.trim().toLowerCase();
  return [...regions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.id === q);
}

export function openRegions(app) {
  const dialog = $("dialog"),
    index = app.catalog.index,
    current = app.catalog.region.id;
  const input = h("input", { id: "region-term", type: "search", autocomplete: "off", placeholder: "Name or abbreviation" });
  const results = h("div", { id: "region-results", class: "region-list" });
  let shown = [];
  const go = (r) => {
    dialog.close();
    if (r.id !== current) app.openRegion(r.id);
  };
  function search() {
    shown = matchRegions(index.regions, input.value);
    results.replaceChildren(
      ...(shown.length
        ? shown.map((r) =>
            h(
              "button",
              { class: "layer" + (r.id === current ? " active" : ""), "data-region": r.id, "aria-current": r.id === current ? "true" : null, onclick: () => go(r) },
              h(
                "span",
                { class: "layer-text" },
                h("strong", { text: r.name }),
                h("small", { text: [r.id.toUpperCase(), r.tracts && number(r.tracts) + " tracts", r.counties && number(r.counties) + " counties", r.id === current && "open now"].filter(Boolean).join(" · ") }),
              ),
            ),
          )
        : [h("p", { text: "No state matches." })]),
    );
  }
  input.oninput = search;
  input.onkeydown = (e) => {
    if (e.key === "Enter" && shown[0]) {
      e.preventDefault();
      go(shown[0]);
    }
  };
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body" },
      h("h2", { text: "Change state" }),
      h("p", { class: "subtle", text: "The app reopens in the state you choose. Imported files stay on this device; save a project first to keep this map." }),
      h("label", { for: "region-term", text: "State" }),
      input,
      results,
    ),
  );
  search();
  dialog.showModal();
  input.focus();
}
