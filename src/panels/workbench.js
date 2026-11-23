// The Data and SQL views: the table library, table previews, the join
// checker, the SQL editor, and adding a query result to the map.
import { number } from "../catalog/format.js";
import { featureId } from "../core/features.js";
import { ident } from "../data/sql.js";
import { filterSQL } from "../geo/filter-sql.js";
import { $, fill, h, icon, options, saveBlob } from "../ui/dom.js";

function grid(result) {
  const cell = (v) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "data-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            result.columns.map((c) => h("th", null, c.name, h("span", { class: "field-tag", text: c.type }))),
          ),
        ),
        h(
          "tbody",
          null,
          result.rows.map((r) => h("tr", null, result.columns.map((c) => h("td", { text: cell(r[c.name]) })))),
        ),
      ),
    ),
    h("p", {
      class: "subtle",
      text: number(result.rows.length) + " rows shown" + (result.truncated ? " · Preview limited" : ""),
    }),
  ];
}
const card = (...children) => h("section", { class: "tool-card" }, ...children);
const header = (title, ...rest) => h("div", { class: "work-header" }, h("h1", { text: title }), ...rest);

export function createWorkbench(app) {
  const ref = app.ref,
    noun = ref.noun || "feature";
  let selected = ref.id,
    epoch = 0,
    lastPreview = null;
  const mount = $("work-content");
  const button = (id, cls, iconName, text, run) =>
    h(
      "button",
      { id, class: cls, onclick: (ev) => app.perform(ev.currentTarget, run) },
      iconName && icon(iconName, 16),
      text,
    );
  // The reference layer, its attribute tables (once the database has them) and imports.
  const attributeTables = () => (app.ws.databaseOpen ? app.ws.sqlTables() : []);
  const tables = () => [ref.id, ...attributeTables().map((t) => t.name), ...app.ws.inputs.keys()];
  const tableTitle = (t) =>
    t === ref.id
      ? app.catalog.region.name + " " + (ref.nouns || "features")
      : attributeTables().find((x) => x.name === t)?.title || app.ws.inputs.get(t)?.name || t;
  const idText = () => app.catalog.region.name + " " + noun + " " + ref.idField;

  function showTables() {
    $("table-list").replaceChildren(
      ...tables().map((t) =>
        h(
          "button",
          {
            class: "layer" + (selected === t ? " active" : ""),
            "data-table": t,
            onclick: () => {
              selected = t;
              app.setView("data");
            },
          },
          h("span", { class: "layer-icon" }, icon(t === ref.id ? "map" : "data", 16)),
          h(
            "span",
            { class: "layer-text" },
            h("strong", { text: t }),
            h("small", { text: tableTitle(t) }),
          ),
        ),
      ),
    );
  }

  /** Runs SQL, then adds the result to the map as a new layer. */
  async function mapSQL(sql, name, opts = {}) {
    const engine = await app.ws.db();
    app.status("Preparing map layer…", "running");
    const preview = await engine.query(sql, { limit: 1 });
    const hasGeom = preview.columns.some((c) => /^(GEOMETRY|WKB_BLOB)/.test(c.type));
    const idKey = ref.idField.toLowerCase();
    const onReference =
      !!opts.referenceJoined || (!hasGeom && preview.columns.some((c) => c.name.toLowerCase() === idKey));
    const query =
      opts.referenceJoined && hasGeom
        ? "SELECT * EXCLUDE (geometry) FROM (" + sql.replace(/;+\s*$/, "") + ") AS joined"
        : sql;
    const { collection, truncated } = await engine.mapQuery(query);
    if (truncated)
      throw new Error(
        "This result exceeds the map preview budget. Filter or aggregate it in SQL, then add the complete result to the map.",
      );
    if (!collection.features.length) throw new Error("There are no matching geometries to map.");
    if (onReference) {
      // Key variants in SQL (geoid, GeoId) still index the reference layer's weights.
      const used = new Set();
      for (const f of collection.features) {
        const key = Object.keys(f.properties).find((k) => k.toLowerCase() === idKey);
        const id = String(f.properties[key]).trim();
        if (used.has(id))
          throw new Error(
            "The query has multiple rows per " + noun + ". Group by " + ref.idField + " before mapping it.",
          );
        used.add(id);
        f.id = id;
      }
    }
    const layer = {
      id: crypto.randomUUID(),
      name,
      sql,
      collection,
      reference: onReference,
      referenceFields: !!opts.referenceJoined,
    };
    const fields = app.fieldList(layer);
    layer.preferredMeasure =
      (opts.preferred || []).find((f) => fields.includes(f)) ||
      fields.find((f) => !Object.hasOwn(ref.fields || {}, f)) ||
      fields[0] ||
      "";
    app.addLayer(layer, sql);
  }

  function sqlView() {
    const state = app.state;
    const edit = h("textarea", { id: "sql-input", class: "scroll-sql", spellcheck: "false" });
    const results = h("div", { id: "query-grid" });
    const showPreview = (r) => results.replaceChildren(card(h("h2", { text: "Query result" }), grid(r)));
    edit.value = state.sql;
    edit.oninput = () => {
      app.store.set({ sql: edit.value });
      lastPreview = null;
      results.replaceChildren();
    };
    edit.onkeydown = (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        $("run-query").click();
      }
    };
    mount.replaceChildren(
      header(
        "SQL editor",
        h("p", {
          class: "help",
          text: "Return geometry or a " + idText() + " to draw the result. Use aggregates to map large inputs.",
        }),
      ),
      card(
        h("div", { class: "preview-head" }, h("h2", null, icon("code"), "DuckDB query")),
        h("label", { class: "work-label", for: "sql-input", text: "SQL" }),
        edit,
        h(
          "div",
          { class: "actions" },
          button("run-query", "primary", "play", "Run query", async () => {
            const sql = edit.value;
            const started = performance.now();
            const r = await (await app.ws.db()).query(sql);
            app.timings.lastQuery = Math.round(performance.now() - started);
            app.statusbar?.timing();
            if (edit.isConnected && edit.value === sql) {
              lastPreview = { sql, result: r };
              showPreview(r);
            }
          }),
          button("map-query", "secondary", "map", "Add result to map", () => mapSQL(edit.value, "Query result")),
          button("export-query", "secondary", "download", "Export CSV", async () =>
            saveBlob(await (await app.ws.db()).exportCSV(edit.value), "query-results.csv"),
          ),
        ),
        h("div", { id: "query-status", role: "status" }),
      ),
      results,
    );
    if (lastPreview?.sql === state.sql) showPreview(lastPreview.result);
  }

  async function dataView(token) {
    const table = selected;
    mount.replaceChildren(header(table, h("p", { text: "Opening table…" })));
    try {
      const db = await app.ws.db();
      const info = await db.inspect(table);
      const sql = "SELECT * FROM " + ident(table);
      const result = await db.query(sql, { limit: 30 });
      if (token !== epoch) return;
      const custom = table !== ref.id,
        keyed = info.columns.filter((c) => c.name !== info.geometry);
      const keyPattern = new RegExp("^(" + ref.idField + "|geoid|fips|tract_id)$", "i");
      const key = keyed.find((c) => keyPattern.test(c.name))?.name || keyed[0]?.name;
      const points =
        info.geometry && result.rows.some((r) => /^(MULTI)?POINT$/i.test(r[info.geometry]));
      const openSQL = (text) => {
        app.store.set({ sql: text });
        lastPreview = null;
        app.setView("sql");
      };
      const joinResult = h("div", { id: "join-result", "aria-live": "polite" });
      const joinKey = custom
        ? h("select", { id: "join-key", onchange: () => joinResult.replaceChildren() }, options(keyed.map((c) => c.name), key))
        : null;
      const checkJoin = async () => {
        const k = joinKey.value,
          r = await db.joinReport(table, k);
        if (token !== epoch || joinKey.value !== k) return;
        const join = db.joinSQL(table, k);
        fill(
          joinResult,
          h("p", {
            class: "message data-status",
            text:
              number(r.matched) +
              " matched rows · " +
              number(r.unmatched) +
              " unmatched rows · " +
              number(r.duplicateKeys) +
              " duplicate keys · " +
              number(r.missingReference) +
              " " +
              noun +
              "s without a match",
          }),
          h(
            "div",
            { class: "actions" },
            button("join-edit", "secondary", null, "Edit join SQL", () => openSQL(join)),
            !r.duplicateKeys &&
              r.matched > 0 &&
              button("join-map", "primary", null, "Map joined table", () =>
                mapSQL(join, table + " by " + noun, {
                  referenceJoined: true,
                  preferred: keyed.filter((c) => c.name !== k).map((c) => c.name),
                }),
              ),
          ),
          r.duplicateKeys > 0 &&
            h("p", {
              class: "subtle",
              text: "Aggregate duplicate keys in SQL to produce one row per " + noun + ".",
            }),
        );
      };
      fill(
        mount,
        header(
          table,
          h("p", {
            text:
              (custom ? tableTitle(table) : ref.summary || ref.name) +
              " · " +
              number(info.rows, 0) +
              " rows · " +
              info.columns.length +
              " columns",
          }),
        ),
        card(
          h("h2", null, icon("layers"), "Use this table"),
          h(
            "div",
            { class: "actions" },
            button("edit-source", "secondary", "code", "Open in SQL", () => openSQL(sql)),
            info.geometry &&
              button("map-source", "secondary", "map", "Map layer", () =>
                custom ? mapSQL(sql, table) : app.showLayer(ref.id),
              ),
            points &&
              button("count-source", "secondary", null, "Count points by " + noun, () =>
                openSQL(db.pointCountSQL(table)),
              ),
            // The map's spatial filter as SQL, for tables too large to filter in the page.
            custom &&
              info.geometry &&
              app.filter.current() &&
              button("filter-source", "secondary", null, "Apply the map's filter", () => {
                const filter = app.filter.current();
                const layer = filter.kind === "buffer" ? app.layerById(filter.layer) : null;
                const ids = new Set(filter.ids || []);
                openSQL(
                  filterSQL(table, info.geometry, filter, {
                    epsg: app.catalog.region.projection?.epsg || 4326,
                    base: layer ? layer.collection.features.filter((f) => ids.has(featureId(f))).map((f) => f.geometry) : [],
                  }),
                );
              }),
          ),
          points &&
            h("p", {
              class: "subtle",
              text: "Point counts use " + noun + " interiors. Points on a boundary are excluded.",
            }),
        ),
        custom &&
          card(
            h("h2", { text: "Join to " + ref.name }),
            h(
              "div",
              { class: "form-row" },
              h("div", null, h("label", { for: "join-key", text: "Column containing " + noun + " " + ref.idField + "s" }), joinKey),
              button("check-join", "secondary", null, "Check join", checkJoin),
            ),
            joinResult,
          ),
        card(h("h2", { text: "Table preview" }), grid(result)),
      );
    } catch (error) {
      if (token === epoch)
        mount.replaceChildren(
          header(table, h("p", { class: "data-status error-text", text: error?.message || String(error) })),
        );
    }
  }

  return {
    render(view) {
      const token = ++epoch;
      if (!tables().includes(selected)) selected = ref.id;
      if (view === "map") return;
      showTables();
      $("workside-title").textContent = view === "data" ? "Data library" : "Tables";
      if (view === "sql") sqlView();
      else dataView(token);
    },
    select(table) {
      selected = table;
    },
    reset() {
      selected = ref.id;
      lastPreview = null;
    },
  };
}
