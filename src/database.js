import {
  AsyncDuckDB,
  ConsoleLogger,
  DuckDBDataProtocol,
  LogLevel,
} from "@duckdb/duckdb-wasm";

const sqlString = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const ident = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const appURL = (path) => new URL(path, document.baseURI).href;
const geoTypes = new Set(["GEOMETRY", "WKB_BLOB"]);
const isGeo = (type) => geoTypes.has(type) || type.startsWith("GEOMETRY(");
const keyNames =
  /^(geo_?id(?:fq)?|geoid\d{2}|statefp|countyfp|tractce|fips|zip(?:code)?|zcta5ce\d{2})$/i;
const geometryLimit = 32 * 1024 * 1024;

function tableName(fileName) {
  const simple =
    fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "layer";
  return /^[a-z_]/.test(simple) ? simple : "layer_" + simple;
}
function safeLimit(value, max) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error("The result limit must be between 1 and " + max + ".");
  return value;
}
function plain(value) {
  if (typeof value === "bigint")
    return Number.isSafeInteger(Number(value))
      ? Number(value)
      : value.toString();
  if (value instanceof Uint8Array)
    return "[binary, " + value.length + " bytes]";
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toJSON === "function") return plain(value.toJSON());
  if (Array.isArray(value) || ArrayBuffer.isView(value))
    return Array.from(value, plain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}
function convertRows(table) {
  return Array.from(table, (row) => plain(row.toJSON()));
}
function columnList(table) {
  return convertRows(table).map((row) => ({
    name: row.column_name,
    type: row.column_type,
  }));
}

// The build copies DuckDB into a folder named for its version (scripts/build.mjs).
const DUCKDB = __DUCKDB_FOLDER__;
async function startRuntime() {
  const worker = new Worker(
    appURL(DUCKDB + "/duckdb-browser-eh.worker.js"),
  );
  const engine = new AsyncDuckDB(new ConsoleLogger(LogLevel.WARNING), worker);
  try {
    await engine.instantiate(appURL(DUCKDB + "/duckdb-eh.wasm"));
    await engine.open({
      maximumThreads: 1,
      query: { castDecimalToDouble: true },
    });
    const conn = await engine.connect();
    const repo = appURL(DUCKDB + "/extensions");
    await conn.query("SET custom_extension_repository = " + sqlString(repo));
    await conn.query("LOAD parquet; LOAD json; LOAD spatial");
    return { engine, conn };
  } catch (error) {
    await engine.terminate();
    throw error;
  }
}

export async function openDatabase({ tractsFile, tractDisplay } = {}) {
  const { engine, conn } = await startRuntime();
  const sources = new Map();
  let nextFile = 0;
  const execute = async (sql) => convertRows(await conn.query(sql));
  const describe = async (sql) =>
    columnList(await conn.query("DESCRIBE " + sql));
  const count = async (name) =>
    Number((await execute("SELECT count(*) AS n FROM " + ident(name)))[0].n);
  let displayIndex;
  const checkSource = (name) => {
    if (!sources.has(name)) throw new Error("Unknown source " + name);
    return sources.get(name);
  };

  // Parsing through DuckDB accepts its SQL dialect, including CTEs, while ensuring
  // that previews, exports and map layers all run one SELECT.
  async function selectStatement(input) {
    const sql = input.trim().replace(/;+\s*$/, "");
    if (!sql) throw new Error("Enter a SELECT query.");
    const [{ parsed }] = await execute(
      "SELECT json_serialize_sql(" + sqlString(sql) + ")::VARCHAR AS parsed",
    );
    const ast = JSON.parse(parsed);
    if (ast.error)
      throw new Error(ast.error_message || "Enter one SELECT query.");
    if (ast.statements?.length !== 1)
      throw new Error("Use one SELECT query at a time.");
    return sql;
  }
  async function inspect(name) {
    const info = checkSource(name);
    return {
      name,
      columns: info.columns.map((c) => ({ ...c })),
      geometry: info.geometry,
      rows: info.rows,
    };
  }

  async function parquetInfo(file) {
    const rows = await execute(
      "SELECT decode(value) AS metadata FROM parquet_kv_metadata(" +
        sqlString(file) +
        ") WHERE key = 'geo'::BLOB",
    );
    if (!rows.length) return null;
    const metadata = JSON.parse(rows[0].metadata);
    const column = metadata.primary_column;
    const spec = metadata.columns?.[column];
    if (!column || !spec)
      throw new Error(
        "GeoParquet metadata is missing its primary geometry definition.",
      );
    if ("crs" in spec && !spec.crs)
      throw new Error(
        "This GeoParquet file declares an unknown CRS. Assign its CRS before import.",
      );
    const crs = spec.crs;
    let sourceCRS = "OGC:CRS84";
    if (crs) {
      sourceCRS =
        crs.id?.authority && crs.id?.code
          ? crs.id.authority + ":" + crs.id.code
          : typeof crs === "string"
            ? crs
            : JSON.stringify(crs);
    }
    return { column, sourceCRS };
  }
  async function reader(file, suffix) {
    const path = sqlString(file);
    if (suffix === "csv") {
      let read = "read_csv(" + path + ", header=true, sample_size=20480";
      const columns = await describe(
        "SELECT * FROM " + read + ", all_varchar=true)",
      );
      const ids = columns.filter((c) => keyNames.test(c.name));
      if (ids.length)
        read +=
          ", types={" +
          ids.map((c) => sqlString(c.name) + ": 'VARCHAR'").join(", ") +
          "}";
      return { from: read + ")" };
    }
    if (suffix === "parquet" || suffix === "geoparquet") {
      return {
        from: "read_parquet(" + path + ")",
        spatial: await parquetInfo(file),
      };
    }
    if (suffix === "geojson" || suffix === "json") {
      const [{ layers }] = await execute(
        "SELECT layers FROM ST_Read_Meta(" + path + ")",
      );
      const field = layers?.[0]?.geometry_fields?.[0];
      if (!field)
        throw new Error(
          "Choose a GeoJSON feature collection with a geometry field.",
        );
      const crs = field.crs;
      const sourceCRS =
        crs?.auth_name && crs?.auth_code
          ? crs.auth_name + ":" + crs.auth_code
          : crs?.wkt || "OGC:CRS84";
      return {
        from: "ST_Read(" + path + ")",
        spatial: { column: field.name || "geom", sourceCRS },
      };
    }
    throw new Error("Choose a CSV, Parquet, GeoParquet, or GeoJSON file.");
  }

  async function addFile(file, name, suffix) {
    if (sources.has(name))
      throw new Error("A layer named " + name + " already exists.");
    const path = "source_" + ++nextFile + "." + suffix;
    await engine.registerFileHandle(
      path,
      file,
      DuckDBDataProtocol.BROWSER_FILEREADER,
      true,
    );
    try {
      const { from, spatial } = await reader(path, suffix);
      const fields = await describe("SELECT * FROM " + from);
      let select = "SELECT * FROM " + from;
      if (spatial) {
        const field =
          fields.find((c) => c.name === spatial.column) ||
          fields.find((c) => isGeo(c.type));
        if (!field)
          throw new Error(
            "Could not find the primary geometry field in " + name + ".",
          );
        // Keep every attribute; a pre-existing ordinary column named geometry would be ambiguous.
        if (
          field.name !== "geometry" &&
          fields.some((c) => c.name.toLowerCase() === "geometry")
        ) {
          throw new Error(
            "Rename the non-spatial geometry attribute before import.",
          );
        }
        const col = ident(field.name);
        let expr =
          field.type === "BLOB" || field.type === "WKB_BLOB"
            ? "ST_GeomFromWKB(" + col + ")"
            : col;
        if (!/^(EPSG:4326|OGC:CRS84|OGC:CRS84H)$/i.test(spatial.sourceCRS)) {
          expr =
            "ST_Transform(" +
            expr +
            ", " +
            sqlString(spatial.sourceCRS) +
            ", 'EPSG:4326', always_xy:=true)";
        }
        select =
          "SELECT * EXCLUDE (" +
          col +
          "), " +
          expr +
          " AS geometry FROM " +
          from;
      }
      await conn.query("CREATE TEMP VIEW " + ident(name) + " AS " + select);
      const columns = await describe("SELECT * FROM " + ident(name));
      const geometry = columns.find((c) => isGeo(c.type))?.name || null;
      const rows = await count(name);
      // Validate the transform before registering the view. Unknown CRS errors then surface at import.
      if (geometry)
        await conn.query(
          "SELECT ST_AsText(ST_Centroid(" +
            ident(geometry) +
            ")) FROM " +
            ident(name) +
            " WHERE " +
            ident(geometry) +
            " IS NOT NULL LIMIT 1",
        );
      sources.set(name, { path, columns, geometry, rows });
      return inspect(name);
    } catch (error) {
      await conn.query("DROP VIEW IF EXISTS " + ident(name));
      await engine.dropFile(path);
      throw error;
    }
  }
  async function importFile(file, preferredName) {
    const base = tableName(file.name || "layer");
    let name = preferredName || base;
    if (preferredName && !/^[a-z_][a-z0-9_]*$/.test(preferredName))
      throw new Error("Invalid saved SQL table name.");
    if (!preferredName) {
      let n = 2;
      while (sources.has(name)) name = base + "_" + n++;
    }
    return addFile(file, name, file.name.split(".").pop().toLowerCase());
  }
  async function query(input, { limit = 100 } = {}) {
    safeLimit(limit, 10000);
    const sql = await selectStatement(input);
    const columns = await describe("SELECT * FROM (" + sql + ") AS described");
    const projection = columns
      .map((c) =>
        isGeo(c.type)
          ? "ST_GeometryType(" +
            ident(c.name) +
            ")::VARCHAR AS " +
            ident(c.name)
          : ident(c.name),
      )
      .join(", ");
    const rows = await execute(
      "SELECT " +
        projection +
        " FROM (" +
        sql +
        ") AS source LIMIT " +
        (limit + 1),
    );
    const truncated = rows.length > limit;
    return { columns, rows: rows.slice(0, limit), truncated };
  }
  async function mapQuery(input, { idColumn = "GEOID", limit = 10000 } = {}) {
    safeLimit(limit, 50000);
    const sql = await selectStatement(input);
    const columns = await describe("SELECT * FROM (" + sql + ") AS described");
    const id = columns.find(
      (c) => c.name.toLowerCase() === idColumn.toLowerCase(),
    )?.name;
    let geom = columns.find((c) => isGeo(c.type))?.name;
    const from = "(" + sql + ") AS q";
    if (!geom) {
      if (!id)
        throw new Error(
          "Include a geometry column or Mississippi tract GEOID to map this query.",
        );
      if (!displayIndex) {
        if (!tractDisplay) {
          const response = await fetch(appURL("data/tracts.geojson"));
          if (!response.ok)
            throw new Error(
              "Could not read the Mississippi display geography.",
            );
          tractDisplay = await response.json();
        }
        displayIndex = new Map(
          tractDisplay.features.map((f) => [
            String(f.properties.GEOID),
            f.geometry,
          ]),
        );
      }
    }
    const attrs = columns
      .filter((c) => !isGeo(c.type))
      .map((c) => ident(c.name));
    let gname = "__rumb_geometry";
    while (columns.some((c) => c.name === gname)) gname += "_";
    const select = [...attrs];
    if (geom)
      select.push(
        "ST_AsGeoJSON(" + ident(geom) + ")::VARCHAR AS " + ident(gname),
      );
    const sub =
      "SELECT " +
      select.join(", ") +
      " FROM " +
      from +
      (geom ? " WHERE " + ident(geom) + " IS NOT NULL" : "") +
      " LIMIT " +
      (limit + 1);
    const stream = await conn.send(
      "SELECT * FROM (" + sub + ") AS result",
      true,
    );
    const features = [];
    let bytes = 0,
      seen = 0,
      truncated = false;
    for await (const batch of stream) {
      for (const arrowRow of batch) {
        const row = plain(arrowRow.toJSON());
        const raw = row[gname];
        bytes += raw?.length || 0;
        if (++seen > limit || bytes > geometryLimit) {
          truncated = true;
          break;
        }
        if (geom) delete row[gname];
        const geometry = geom
          ? JSON.parse(raw)
          : displayIndex.get(String(row[id]).trim());
        if (!geometry) continue;
        features.push({
          type: "Feature",
          properties: row,
          geometry,
          id: id && row[id] != null ? String(row[id]) : null,
        });
      }
      if (truncated) {
        await conn.cancelSent();
        break;
      }
    }
    // GeoJSON attribute IDs can be absent or duplicated after a join. Assign unique
    // feature IDs without modifying source columns or colliding with genuine IDs.
    const ids = new Set(features.map((f) => f.id).filter((id) => id !== null));
    const used = new Set();
    for (const [i, feature] of features.entries()) {
      if (feature.id === null || used.has(feature.id)) {
        feature.id = "row_" + i;
        while (ids.has(feature.id) || used.has(feature.id)) feature.id += "_";
      }
      used.add(feature.id);
    }
    return { collection: { type: "FeatureCollection", features }, truncated };
  }
  function joinSQL(name, key) {
    const source = checkSource(name);
    if (!source.columns.some((c) => c.name === key))
      throw new Error("Choose a join column.");
    const taken = new Set(
      checkSource("tracts").columns.map((c) => c.name.toLowerCase()),
    );
    const attrs = source.columns
      .filter((c) => c.name !== key && !isGeo(c.type))
      .map((c) => {
        let alias = c.name;
        while (taken.has(alias.toLowerCase())) alias = name + "_" + alias;
        taken.add(alias.toLowerCase());
        return (
          "s." + ident(c.name) + (alias === c.name ? "" : " AS " + ident(alias))
        );
      });
    return (
      "SELECT t.* EXCLUDE (geometry)" +
      (attrs.length ? ",\n       " + attrs.join(",\n       ") : "") +
      "\nFROM tracts AS t\nLEFT JOIN " +
      ident(name) +
      " AS s\n  ON t.GEOID = trim(CAST(s." +
      ident(key) +
      " AS VARCHAR))"
    );
  }
  async function joinReport(name, key) {
    joinSQL(name, key);
    const column = ident(key);
    const rows = await execute(
      "WITH groups AS (SELECT trim(CAST(" +
        column +
        " AS VARCHAR)) AS id, count(*) AS n FROM " +
        ident(name) +
        " GROUP BY 1) SELECT " +
        "coalesce(sum(n) FILTER (WHERE t.GEOID IS NOT NULL), 0) AS matched, " +
        "coalesce(sum(n) FILTER (WHERE t.GEOID IS NULL), 0) AS unmatched, " +
        "count(*) FILTER (WHERE n > 1 AND id IS NOT NULL AND id <> '') AS \"duplicateKeys\", " +
        '(SELECT count(*) FROM tracts) - count(t.GEOID) AS "missingTracts" FROM groups LEFT JOIN tracts AS t ON id = t.GEOID',
    );
    return rows[0];
  }
  function pointCountSQL(name) {
    const { geometry } = checkSource(name);
    if (!geometry) throw new Error("Choose an imported point layer.");
    // ST_Within excludes boundary points, avoiding double-counting shared edges.
    return (
      "SELECT t.GEOID, t.name, count(p." +
      ident(geometry) +
      ") AS point_count\nFROM tracts AS t\nLEFT JOIN " +
      ident(name) +
      " AS p\n  ON ST_Within(p." +
      ident(geometry) +
      ", t.geometry)\nGROUP BY t.GEOID, t.name"
    );
  }
  async function exportCSV(input) {
    const sql = await selectStatement(input);
    const file = "rumb_export_" + crypto.randomUUID() + ".csv";
    // Prefer on-disk staging for large exports, including Safari's worker-accessible OPFS.
    let directory, handle;
    try {
      directory = await navigator.storage.getDirectory();
      handle = await directory.getFileHandle(file, { create: true });
    } catch {
      /* A virtual file still works when persistent site storage is unavailable. */
    }
    if (handle) {
      try {
        await engine.registerFileHandle(
          "opfs://" + file,
          handle,
          DuckDBDataProtocol.BROWSER_FSACCESS,
          true,
        );
        await conn.query(
          "COPY (" +
            sql +
            ") TO " +
            sqlString("opfs://" + file) +
            " (FORMAT CSV, HEADER, USE_TMP_FILE false)",
        );
        await engine.dropFile("opfs://" + file);
        // A detached browser Blob remains readable after the temporary OPFS entry is removed.
        const copy = await new Response((await handle.getFile()).stream(), {
          headers: { "Content-Type": "text/csv;charset=utf-8" },
        }).blob();
        await directory.removeEntry(file);
        return copy;
      } catch (e) {
        await engine.dropFile("opfs://" + file).catch(() => {});
        await directory.removeEntry(file).catch(() => {});
        throw e;
      }
    }
    try {
      await conn.query(
        "COPY (" +
          sql +
          ") TO " +
          sqlString(file) +
          " (FORMAT CSV, HEADER, USE_TMP_FILE false)",
      );
      return new Blob([await engine.copyFileToBuffer(file)], {
        type: "text/csv;charset=utf-8",
      });
    } finally {
      await engine.dropFile(file).catch(() => {});
    }
  }
  async function drop(name) {
    if (name === "tracts")
      throw new Error("The reference tract layer is built in.");
    const src = checkSource(name);
    await conn.query("DROP VIEW " + ident(name));
    sources.delete(name);
    await engine.dropFile(src.path);
  }
  async function close() {
    await conn.close();
    await engine.terminate();
  }
  try {
    if (!tractsFile) {
      const response = await fetch(appURL("data/tracts.parquet"));
      if (!response.ok)
        throw new Error(
          "Could not load the canonical Mississippi tract file (HTTP " +
            response.status +
            ").",
        );
      tractsFile = new File([await response.blob()], "tracts.parquet");
    }
    await addFile(tractsFile, "tracts", "parquet");
    // A streaming result owns the connection until its last batch. Queue concurrent
    // UI calls so a new preview cannot overwrite an in-flight export or map stream.
    let queue = Promise.resolve();
    const serial =
      (fn) =>
      (...args) => {
        const next = queue.then(() => fn(...args));
        queue = next.catch(() => {});
        return next;
      };
    return {
      inspect: serial(inspect),
      importFile: serial(importFile),
      query: serial(query),
      mapQuery: serial(mapQuery),
      joinSQL,
      joinReport: serial(joinReport),
      pointCountSQL,
      exportCSV: serial(exportCSV),
      drop: serial(drop),
      close: serial(close),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
