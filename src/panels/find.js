// Find a feature by name, group (county) or ID, then select and zoom to it.
import { featureId } from "../core/features.js";
import { $, h } from "../ui/dom.js";

/** Features matching a search term, at most `limit`. Pure, for the palette too. */
export function findFeatures(features, term, { labelField, groupField }, limit = 12) {
  const q = term.trim().toLowerCase();
  return features
    .filter((f) =>
      [featureId(f), f.properties?.[labelField], f.properties?.[groupField]]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
    .slice(0, limit);
}

export function openFind(app) {
  const dialog = $("dialog"),
    ref = app.ref;
  const input = h("input", { id: "find-term", type: "search", autocomplete: "off" });
  const results = h("div", { id: "find-results" });
  function search() {
    const matches = findFeatures(app.records(), input.value, ref);
    results.replaceChildren(
      ...(matches.length
        ? matches.map((f) => {
            const id = featureId(f),
              p = f.properties || {};
            return h(
              "button",
              {
                class: "layer",
                "data-find": id,
                onclick: () => {
                  dialog.close();
                  app.selectFeature(id);
                  app.atlas.fit({ features: [app.values.get(id)] });
                },
              },
              h(
                "span",
                { class: "layer-text" },
                h("strong", { text: p[ref.labelField] || id }),
                h("small", { text: [p[ref.groupField], id].filter(Boolean).join(" · ") }),
              ),
            );
          })
        : [h("p", { text: "No matches." })]),
    );
  }
  input.oninput = search;
  $("dialog-content").replaceChildren(
    h(
      "div",
      { class: "dialog-body" },
      h("h2", { text: "Find a feature" }),
      h("label", { for: "find-term", text: "Name, " + (ref.groupField || "group") + " or feature ID" }),
      input,
      results,
    ),
  );
  search();
  dialog.showModal();
  input.focus();
}
