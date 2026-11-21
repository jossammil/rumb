import { node, icon, number, escape as e, saveBlob } from "./ui.js";
const ident = (s) => '"' + s.replaceAll('"', '""') + '"';
const options = (fields, selection) =>
  fields
    .map(
      (f) =>
        '<option value="' +
        e(f.name) +
        '"' +
        (f.name === selection ? " selected" : "") +
        ">" +
        e(f.name) +
        "</option>",
    )
    .join("");
function grid(result) {
  return (
    '<div class="table-scroll"><table class="data-table"><thead><tr>' +
    result.columns
      .map(
        (c) =>
          "<th>" +
          e(c.name) +
          '<span class="field-tag">' +
          e(c.type) +
          "</span></th>",
      )
      .join("") +
    "</tr></thead><tbody>" +
    result.rows
      .map(
        (r) =>
          "<tr>" +
          result.columns
            .map(
              (c) =>
                "<td>" +
                e(
                  r[c.name] == null
                    ? "—"
                    : typeof r[c.name] === "object"
                      ? JSON.stringify(r[c.name])
                      : r[c.name],
                ) +
                "</td>",
            )
            .join("") +
          "</tr>",
      )
      .join("") +
    '</tbody></table></div><p class="subtle">' +
    number(result.rows.length) +
    " rows shown" +
    (result.truncated ? " · Preview limited" : "") +
    "</p>"
  );
}
export function createWorkbench(api) {
  let selected = "tracts",
    epoch = 0;
  const mount = node("work-content");
  let lastPreview = null;
  const fail = (error) =>
    '<p class="data-status error-text">' + e(error?.message || error) + "</p>";
  const action = (id, fn) => {
    const b = node(id);
    if (b) b.onclick = () => api.perform(b, fn);
  };
  const explain = () =>
    '<p class="help">Return geometry or a Mississippi tract GEOID to draw the result. Use aggregates to map large inputs.</p>';
  function tables() {
    const sources = api.inputs();
    return ["tracts", ...sources.keys()];
  }
  function showTables() {
    node("table-list").innerHTML = tables()
      .map(
        (t) =>
          '<button class="layer ' +
          (selected === t ? "active" : "") +
          '" data-table="' +
          e(t) +
          '"><span class="layer-icon">' +
          icon(t === "tracts" ? "map" : "data", 16) +
          '</span><span class="layer-text"><strong>' +
          e(t) +
          "</strong><small>" +
          e(
            t === "tracts"
              ? "Mississippi census tracts"
              : api.inputs().get(t).name,
          ) +
          "</small></span></button>",
      )
      .join("");
    for (const b of node("table-list").querySelectorAll("button"))
      b.onclick = () => {
        selected = b.dataset.table;
        api.setView("data");
      };
  }
  function sqlView() {
    const state = api.state();
    mount.innerHTML =
      '<div class="work-header"><h1>SQL editor</h1>' +
      explain() +
      '</div><section class="tool-card"><div class="preview-head"><h2>' +
      icon("code") +
      'DuckDB query</h2></div><label class="work-label" for="sql-input">SQL</label><textarea id="sql-input" class="scroll-sql" spellcheck="false"></textarea><div class="actions"><button id="run-query" class="primary">' +
      icon("play", 15) +
      'Run query</button><button id="map-query" class="secondary">' +
      icon("map", 16) +
      'Add result to map</button><button id="export-query" class="secondary">' +
      icon("download", 16) +
      'Export CSV</button></div><div id="query-status" role="status"></div></section><div id="query-grid"></div>';
    const edit = node("sql-input");
    edit.value = state.sql;
    edit.oninput = () => {
      state.sql = edit.value;
      lastPreview = null;
      node("query-grid").innerHTML = "";
    };
    edit.onkeydown = (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        node("run-query").click();
      }
    };
    const showPreview = (r) =>
      (node("query-grid").innerHTML =
        '<section class="tool-card"><h2>Query result</h2>' +
        grid(r) +
        "</section>");
    if (lastPreview?.sql === state.sql) showPreview(lastPreview.result);
    action("run-query", async () => {
      const sql = edit.value;
      const r = await (await api.db()).query(sql);
      if (edit.isConnected && edit.value === sql) {
        lastPreview = { sql, result: r };
        showPreview(r);
      }
    });
    action("map-query", () => api.mapSQL(edit.value, "Query result"));
    action("export-query", async () =>
      saveBlob(
        await (await api.db()).exportCSV(edit.value),
        "query-results.csv",
      ),
    );
  }
  async function dataView(token) {
    const table = selected;
    mount.innerHTML =
      '<div class="work-header"><h1>' +
      e(table) +
      "</h1><p>Opening table…</p></div>";
    try {
      const db = await api.db();
      const info = await db.inspect(table);
      const sql = "SELECT * FROM " + ident(table);
      const result = await db.query(sql, { limit: 30 });
      if (token !== epoch) return;
      const custom = table !== "tracts",
        keyed = info.columns.filter((c) => c.name !== info.geometry);
      const key =
        keyed.find((c) => /^(geoid|fips|tract_id)$/i.test(c.name))?.name ||
        keyed[0]?.name;
      const points =
        info.geometry &&
        result.rows.some((r) => /^(MULTI)?POINT$/i.test(r[info.geometry]));
      mount.innerHTML =
        '<div class="work-header"><h1>' +
        e(table) +
        "</h1><p>" +
        e(
          custom
            ? api.inputs().get(table)?.name
            : "2020–2024 ACS · Mississippi census tracts",
        ) +
        " · " +
        number(info.rows, 0) +
        " rows · " +
        info.columns.length +
        " columns</p></div>" +
        '<section class="tool-card"><h2>' +
        icon("layers") +
        'Use this table</h2><div class="actions"><button id="edit-source" class="secondary">' +
        icon("code", 16) +
        "Open in SQL</button>" +
        (info.geometry
          ? '<button id="map-source" class="secondary">' +
            icon("map", 16) +
            "Map layer</button>"
          : "") +
        (points
          ? '<button id="count-source" class="secondary">Count points by tract</button>'
          : "") +
        "</div>" +
        (points
          ? '<p class="subtle">Point counts use tract interiors. Points on a boundary are excluded.</p>'
          : "") +
        "</section>" +
        (custom
          ? '<section class="tool-card"><h2>Join to Mississippi tracts</h2><div class="form-row"><div><label for="join-key">Column containing tract GEOIDs</label><select id="join-key">' +
            options(keyed, key) +
            '</select></div><button class="secondary" id="check-join">Check join</button></div><div id="join-result" aria-live="polite"></div></section>'
          : "") +
        '<section class="tool-card"><h2>Table preview</h2>' +
        grid(result) +
        "</section>";
      const openSQL = (s) => {
        api.state().sql = s;
        lastPreview = null;
        api.setView("sql");
      };
      action("edit-source", () => openSQL(sql));
      action("map-source", () =>
        custom ? api.mapSQL(sql, table) : api.showBase(),
      );
      action("count-source", () => openSQL(db.pointCountSQL(table)));
      if (custom) {
        node("join-key").onchange = () => node("join-result").replaceChildren();
        action("check-join", async () => {
          const key = node("join-key").value,
            r = await db.joinReport(table, key);
          if (token !== epoch || node("join-key").value !== key) return;
          const join = db.joinSQL(table, key);
          node("join-result").innerHTML =
            '<p class="message data-status">' +
            number(r.matched) +
            " matched rows · " +
            number(r.unmatched) +
            " unmatched rows · " +
            number(r.duplicateKeys) +
            " duplicate keys · " +
            number(r.missingTracts) +
            ' tracts without a match</p><div class="actions"><button id="join-edit" class="secondary">Edit join SQL</button>' +
            (r.duplicateKeys || !r.matched
              ? ""
              : '<button id="join-map" class="primary">Map joined table</button>') +
            "</div>" +
            (r.duplicateKeys
              ? '<p class="subtle">Aggregate duplicate keys in SQL to produce one row per tract.</p>'
              : "");
          action("join-edit", () => openSQL(join));
          action("join-map", () =>
            api.mapSQL(join, table + " by tract", {
              tractJoined: true,
              preferred: keyed.filter((c) => c.name !== key).map((c) => c.name),
            }),
          );
        });
      }
    } catch (error) {
      if (token === epoch)
        mount.innerHTML =
          '<div class="work-header"><h1>' +
          e(table) +
          "</h1>" +
          fail(error) +
          "</div>";
    }
  }
  return {
    render(view) {
      const token = ++epoch;
      if (!tables().includes(selected)) selected = "tracts";
      if (view === "map") return;
      showTables();
      node("workside-title").textContent =
        view === "data" ? "Data library" : "Tables";
      if (view === "sql") sqlView();
      else dataView(token);
    },
    select(table) {
      selected = table;
    },
    reset() {
      selected = "tracts";
      lastPreview = null;
    },
  };
}
