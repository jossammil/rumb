import { compareAreas, comparisonCSV } from "./compare-score.js";
import { node, escape as e, number, saveBlob } from "./ui.js";

const quadrants = {
  HH: ["High / high", "#82517d"],
  HL: ["High / low", "#c67d39"],
  LH: ["Low / high", "#5389ac"],
  LL: ["Low / low", "#91b8a0"],
};
const scale = ["#e4eccf", "#b2d7ad", "#70b49e", "#348a82", "#17575c"];
const unavailable = "#b6bdb5";
const option = (value, text) =>
  `<option value="${e(value)}">${e(text)}</option>`;
const isPolygon = (f) => ["Polygon", "MultiPolygon"].includes(f.geometry?.type);
const idOf = (f) => String(f.id ?? f.properties.GEOID);
const acs = {
  poverty_pct: "Population below poverty",
  child_poverty_pct: "Children below poverty",
};
const axes = ["X", "Y", "Third"];

export function comparisonWorkspace({
  atlas,
  state,
  layers,
  fieldList,
  asset,
  status,
}) {
  let epoch = 0,
    active,
    fields,
    features,
    props,
    ref,
    config,
    result,
    page,
    order,
    ascending,
    only;
  const panel = node("cmp-panel");
  const label = (field) =>
    active.id === "tracts" ? acs[field] || ref.measures[field].label : field;
  const raw = (v, digits = 2) =>
    v == null
      ? "Unavailable"
      : number(v, digits) + (active.id === "tracts" ? "%" : "");
  function leave() {
    epoch++;
    result = null;
    active = null;
  }
  async function open(id, fit = false) {
    const token = ++epoch;
    const options = layers().filter(
      (l) =>
        l.collection.features.length && l.collection.features.every(isPolygon),
    );
    active = options.find((l) => l.id === id) || options[0];
    node("cmp-layer").innerHTML = options
      .map((l) => option(l.id, l.name))
      .join("");
    node("cmp-layer").value = state().compareLayer = active.id;
    result = null;
    ref = null;
    node("cmp-results").hidden = true;
    node("cmp-export").disabled = true;
    node("cmp-count").textContent = "Preparing comparison…";
    node("legend").replaceChildren();
    node("inspect-panel").hidden = true;
    node("map-title").textContent = active.name;
    node("map-subtitle").textContent = "Area comparison";
    node("foot-context").textContent = active.name;
    node("map-credit").textContent =
      active.id === "tracts"
        ? "U.S. Census Bureau · CDC PLACES"
        : "Local polygon layer";
    atlas.draw([]);
    atlas.select([], []);
    if (fit || active.id !== id) atlas.fit(active.collection, 0);
    try {
      if (active.id === "tracts") {
        const data = JSON.parse(await (await asset("places-2025.json")).text());
        if (token !== epoch) return;
        ref = data;
      }
      features = active.collection.features.map((f) =>
        ref
          ? { ...f, properties: { ...f.properties, ...ref.byId[idOf(f)] } }
          : f,
      );
      props = new Map(features.map((f) => [idOf(f), f.properties]));
      fields = ref
        ? [
            "poverty_pct",
            "transportation_barrier_pct",
            "child_poverty_pct",
            ...Object.keys(ref.measures).filter(
              (k) => k !== "transportation_barrier_pct",
            ),
          ]
        : fieldList(active);
      if (fields.length < 2)
        throw new Error(
          "This layer needs at least two numeric fields. Choose another polygon layer or map a query with more fields.",
        );
      config = state().comparisons[active.id] ??= {
        components: fields
          .slice(0, 2)
          .map((field) => ({ field, weight: 50, direction: "higher" })),
        color: "score",
        selected: [],
      };
      if (config.components.some((c) => !fields.includes(c.field)))
        throw new Error("A saved comparison field is missing from this layer.");
      config.selected = [...new Set(config.selected)].filter((id) =>
        props.has(id),
      );
      page = 0;
      order = "rank";
      ascending = true;
      only = false;
      node("cmp-unranked").checked = false;
      node("cmp-only").checked = false;
      node("cmp-color").value = config.color;
      editor(config.components);
      calculate(config.components);
      node("cmp-results").hidden = false;
      node("cmp-export").disabled = false;
    } catch (err) {
      if (token === epoch) node("cmp-count").textContent = err.message;
    }
  }
  function editor(parts) {
    node("cmp-error").textContent = "";
    node("cmp-components").innerHTML = parts
      .map(
        (c, i) =>
          `<div class="cmp-fields"><label>${axes[i]} indicator<select id="cmp-field-${i}">${fields.map((f) => option(f, label(f))).join("")}</select></label><label>Scores higher<select id="cmp-direction-${i}"><option value="higher">Higher values</option><option value="lower">Lower values</option></select></label><label>Weight %<input id="cmp-weight-${i}" type="number" min="0" max="100" step="any" required></label></div>`,
      )
      .join("");
    parts.forEach((c, i) => {
      node("cmp-field-" + i).value = c.field;
      node("cmp-direction-" + i).value = c.direction;
      node("cmp-weight-" + i).value = c.weight;
    });
    node("cmp-add").hidden = parts.length === 3 || fields.length < 3;
    node("cmp-remove").hidden = parts.length !== 3;
  }
  const draft = () =>
    Array.from(node("cmp-components").children, (_, i) => ({
      field: node("cmp-field-" + i).value,
      direction: node("cmp-direction-" + i).value,
      weight: node("cmp-weight-" + i).valueAsNumber,
    }));
  node("cmp-add").onclick = () => {
    const parts = draft();
    parts.push({
      field: fields.find((f) => !parts.some((c) => c.field === f)),
      direction: "higher",
    });
    editor(parts.map((c, i) => ({ ...c, weight: [34, 33, 33][i] })));
  };
  node("cmp-remove").onclick = () =>
    editor(
      draft()
        .slice(0, 2)
        .map((c) => ({ ...c, weight: 50 })),
    );
  node("cmp-form").onsubmit = (ev) => {
    ev.preventDefault();
    try {
      calculate(draft());
      node("cmp-error").textContent = "";
    } catch (err) {
      node("cmp-error").textContent = err.message;
    }
  };
  function calculate(parts) {
    result = compareAreas(features, parts);
    config.components = result.components;
    page = 0;
    const message = `${number(result.eligibleCount)} of ${number(features.length)} areas ranked · ${number(features.length - result.eligibleCount)} unranked`;
    node("cmp-count").textContent = message;
    status(message);
    node("cmp-method").innerHTML =
      "<p>Percentiles use the lowest tied rank among areas with all chosen indicators. A constant indicator receives the 50th percentile. A lower-values direction reverses the percentile before weighting. Rank uses the summed contributions rounded to one decimal. Tied scores share the lowest rank.</p><p>Quadrants use the first two raw values and their medians across all eligible areas. Values equal to the median count as high. Selections and map extent do not affect the calculation.</p>" +
      (ref
        ? '<p>ACS 2020–2024 estimates cover people for whom poverty status was determined, with a separate under-18 measure. Margins of error use 90% confidence. CDC PLACES 2025 reports modeled crude prevalence for adults 18 and older using 2023 BRFSS, with 95% confidence intervals. PLACES models can include county-level poverty as a predictor. Pairing a modeled indicator with ACS poverty can give related information extra weight. Scores use point estimates.</p><p><a href="https://data.census.gov/table/ACSST5Y2024.S1701" target="_blank" rel="noreferrer">ACS S1701</a> · <a href="https://data.cdc.gov/d/yjkw-uj5s" target="_blank" rel="noreferrer">CDC PLACES tract estimates</a> · <a href="https://www.cdc.gov/places/methodology/index.html" target="_blank" rel="noreferrer">Model methodology</a></p>'
        : "");
    if (ref) {
      for (const { field } of parts) {
        const measure = ref.measures[field];
        if (measure) {
          const definition = document.createElement("p");
          definition.textContent = measure.label + " · " + measure.definition;
          node("cmp-method").append(definition);
        }
      }
    }
    drawMap();
    plot();
    selection();
  }
  function legend() {
    return (
      config.color === "score"
        ? scale.map((color, i) => ({
            color,
            text: ["0–<20", "20–<40", "40–<60", "60–<80", "80–100"][i],
          }))
        : Object.values(quadrants).map(([text, color]) => ({ text, color }))
    ).concat({ color: unavailable, text: "Unranked" });
  }
  function drawMap() {
    atlas.draw(
      features.map((f) => {
        const r = result.byId.get(idOf(f));
        const color = r.reason
          ? unavailable
          : config.color === "quadrant"
            ? quadrants[r.quadrant][1]
            : scale[Math.min(4, Math.floor(r.score / 20))];
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: { __atlas_id: r.id, __atlas_color: color },
        };
      }),
    );
    node("map-subtitle").textContent =
      config.color === "score"
        ? "Weighted score · 0 to 100"
        : "Quadrants · X / Y";
    node("legend").innerHTML =
      '<div class="legend-title">' +
      e(node("map-subtitle").textContent) +
      '</div><div class="cmp-key">' +
      legend()
        .map(
          (x) =>
            `<span><i class="chip" style="background:${x.color}"></i>${x.text}</span>`,
        )
        .join("") +
      "</div>";
  }
  function plot() {
    const rows = result.rows.filter((r) => !r.reason);
    const domains = [0, 1].map((i) => {
      const v = rows.map((r) => r.values[i]);
      return rows.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
    });
    const pos = (i, v) => {
      const [min, max] = domains[i];
      const t = max === min ? 0.5 : (v - min) / (max - min);
      return i ? 153 - t * 136 : 38 + t * 343;
    };
    const [mx, my] = result.medians;
    node("cmp-axes").textContent = config.components
      .slice(0, 2)
      .map((c, i) => axes[i] + " · " + label(c.field) + (ref ? " (%)" : ""))
      .join("     /     ");
    node("cmp-medians").textContent =
      "Median X " + raw(mx) + " · Median Y " + raw(my);
    node("cmp-plot").innerHTML = rows.length
      ? `<path d="M38 12V153H386" stroke="#8c9e90" fill="none"/><g stroke="#78887f" stroke-dasharray="4 3"><path d="M${pos(0, mx)} 12V153 M38 ${pos(1, my)}H381"/></g><g class="cmp-ticks"><text x="38" y="176">${number(domains[0][0])}</text><text x="382" y="176" text-anchor="end">${number(domains[0][1])}</text><text x="34" y="19" text-anchor="end">${number(domains[1][1])}</text><text x="34" y="153" text-anchor="end">${number(domains[1][0])}</text></g>` +
        rows
          .map(
            (r) =>
              `<circle data-id="${e(r.id)}" cx="${pos(0, r.values[0])}" cy="${pos(1, r.values[1])}" r="3.2" fill="${quadrants[r.quadrant][1]}"><title>${e(r.name)} · ${raw(r.values[0])} / ${raw(r.values[1])}</title></circle>`,
          )
          .join("")
      : '<text x="20" y="90">No complete observations</text>';
  }
  function table() {
    const ids = new Set(config.selected);
    const rows = result.rows
      .filter(
        (r) =>
          (!only || ids.has(r.id)) &&
          (!node("cmp-unranked").checked || r.reason),
      )
      .sort((a, b) => {
        if (order !== "name" && (a.reason || b.reason))
          return (
            Number(!!a.reason) - Number(!!b.reason) || a.id.localeCompare(b.id)
          );
        const cmp =
          order === "name"
            ? a.name.localeCompare(b.name, undefined, { numeric: true })
            : a[order] - b[order];
        return (ascending ? cmp : -cmp) || a.id.localeCompare(b.id);
      });
    page = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
    node("cmp-table").tBodies[0].innerHTML = rows
      .slice(page * 25, page * 25 + 25)
      .map(
        (r) =>
          `<tr data-id="${e(r.id)}" class="${ids.has(r.id) ? "chosen" : ""}"><td>${r.rank ?? "—"}</td><td><button aria-pressed="${ids.has(r.id)}">${e(r.name)}</button><small>${e([props.get(r.id).county, r.id].filter(Boolean).join(" · "))}</small>${r.reason ? "<small>" + e(r.reason) + "</small>" : ""}</td><td>${r.score?.toFixed(1) ?? "—"}</td><td>${quadrants[r.quadrant]?.[0] ?? "Unranked"}</td></tr>`,
      )
      .join("");
    node("cmp-page").textContent = rows.length
      ? `${page * 25 + 1}–${Math.min(rows.length, (page + 1) * 25)} of ${number(rows.length)}`
      : "No matching areas";
    node("cmp-prev").disabled = page === 0;
    node("cmp-next").disabled = (page + 1) * 25 >= rows.length;
    panel
      .querySelectorAll("[data-sort]")
      .forEach((b) =>
        b.parentNode.setAttribute(
          "aria-sort",
          b.dataset.sort === order
            ? ascending
              ? "ascending"
              : "descending"
            : "none",
        ),
      );
  }
  function selection() {
    const ids = new Set(config.selected);
    atlas.select(config.selected, []);
    for (const dot of node("cmp-plot").querySelectorAll("circle")) {
      dot.classList.toggle("chosen", ids.has(dot.dataset.id));
      if (ids.has(dot.dataset.id)) dot.parentNode.append(dot);
    }
    node("cmp-selection").textContent = ids.size + " selected";
    node("cmp-clear").disabled = !ids.size;
    const r = result.byId.get(config.selected.at(-1));
    node("cmp-details").innerHTML = r
      ? `<h2>${e(r.name)}</h2><p>${e(r.id)} · ${e(r.reason || "Rank " + r.rank + " · Score " + r.score.toFixed(1))}</p>` +
        config.components
          .map((c, i) => {
            const p = props.get(r.id),
              ci = ref?.measures[c.field] && p[c.field + "_ci"],
              moe =
                ref && acs[c.field] ? p[c.field.replace("_pct", "_moe")] : null;
            const uncertainty = ci
              ? " · 95% CI " + ci.map((v) => raw(v)).join("–")
              : moe != null
                ? " · 90% MOE ±" + number(moe) + " percentage points"
                : "";
            return `<p><strong>${e(label(c.field))}</strong> · ${raw(r.values[i])}${uncertainty}<br>${r.reason ? "" : number(r.percentiles[i] * 100) + " percentile · " + number(r.contributions[i], 2) + " score points"}</p>`;
          })
          .join("")
      : "<p>Select an area on the map, plot or table to inspect its score.</p>";
    table();
  }
  function toggle(id) {
    if (!result?.byId.has(id)) return;
    config.selected = config.selected.includes(id)
      ? config.selected.filter((x) => x !== id)
      : [...config.selected, id];
    selection();
  }
  node("cmp-table").onclick = (ev) => {
    const sort = ev.target.closest("[data-sort]");
    if (sort) {
      ascending =
        order === sort.dataset.sort
          ? !ascending
          : sort.dataset.sort !== "score";
      order = sort.dataset.sort;
      page = 0;
      table();
      return;
    }
    const row = ev.target.closest("[data-id]");
    if (row) {
      const focus = row.contains(document.activeElement);
      toggle(row.dataset.id);
      if (focus)
        node("cmp-table")
          .querySelector(
            'tr[data-id="' + CSS.escape(row.dataset.id) + '"] button',
          )
          ?.focus();
    }
  };
  node("cmp-plot").onclick = (ev) => {
    const dot = ev.target.closest("circle");
    if (dot) toggle(dot.dataset.id);
  };
  node("cmp-prev").onclick = () => {
    page--;
    table();
  };
  node("cmp-next").onclick = () => {
    page++;
    table();
  };
  node("cmp-unranked").onchange = () => {
    page = 0;
    table();
  };
  node("cmp-only").onchange = (ev) => {
    only = ev.target.checked;
    page = 0;
    table();
  };
  node("cmp-clear").onclick = () => {
    config.selected = [];
    selection();
  };
  node("cmp-color").onchange = (ev) => {
    config.color = ev.target.value;
    drawMap();
  };
  node("cmp-layer").onchange = (ev) => open(ev.target.value, true);
  node("cmp-export").onclick = () =>
    saveBlob(
      new Blob([comparisonCSV(result, config.selected)], {
        type: "text/csv;charset=utf-8",
      }),
      "area-comparison.csv",
    );
  setupSplitter(atlas);
  return {
    open,
    leave,
    toggle,
    collection: () => active?.collection,
    image: () =>
      result &&
      atlas.image(
        active.name,
        node("map-subtitle").textContent,
        legend(),
        ref
          ? "ACS 2020–2024 · CDC PLACES 2025 · Natural Earth"
          : "Local polygon layer · Natural Earth",
      ),
  };
}

function setupSplitter(atlas) {
  const bar = node("cmp-split"),
    host = node("map-view"),
    narrow = matchMedia("(max-width: 760px)");
  let size = 45,
    mobileSize = 55;
  function update(value) {
    value = Math.min(75, Math.max(30, value));
    if (narrow.matches) mobileSize = value;
    else size = value;
    host.style.setProperty("--cmp-size", value + "%");
    bar.setAttribute("aria-valuenow", String(Math.round(value)));
    bar.setAttribute(
      "aria-orientation",
      narrow.matches ? "horizontal" : "vertical",
    );
    atlas.map.resize();
  }
  bar.setAttribute("aria-valuemin", "30");
  bar.setAttribute("aria-valuemax", "75");
  narrow.onchange = () => update(narrow.matches ? mobileSize : size);
  narrow.onchange();
  bar.onpointerdown = (ev) => bar.setPointerCapture(ev.pointerId);
  bar.onpointermove = (ev) => {
    if (!bar.hasPointerCapture(ev.pointerId)) return;
    const r = host.getBoundingClientRect();
    update(
      100 *
        (narrow.matches
          ? (r.bottom - ev.clientY) / r.height
          : (r.right - ev.clientX) / r.width),
    );
  };
  bar.onkeydown = (ev) => {
    const keys = narrow.matches
      ? ["ArrowDown", "ArrowUp"]
      : ["ArrowRight", "ArrowLeft"];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    update(
      (narrow.matches ? mobileSize : size) + (ev.key === keys[1] ? 5 : -5),
    );
  };
}
