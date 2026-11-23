// The open workspace's data: the region catalog, its reference files (fetched
// once and kept as Blobs so a project can bundle them), imported files, the
// DuckDB connection and neighbor graphs. No DOM here beyond fetch, File and Blob.
import { loadLibrary, referenceLayer, validateTables } from "../catalog/catalog.js";
import { numericFields } from "./features.js";

export function createWorkspace(catalog, { status = () => {}, onDatabase = () => {} } = {}) {
  const ref = referenceLayer(catalog);
  let blobs = {},
    display = null,
    neighborData = null,
    inputs = new Map(),
    databasePromise = null;
  // Contiguity computed for imported polygon layers, by `${layerId}-${rule}`.
  const graphs = new Map();
  // The layer library and the library layers read so far (parsed GeoJSON and neighbors).
  let libraryPromise = null;
  const layerData = new Map(),
    layerGraphs = new Map();
  // Attribute tables that join to the reference layer by id (ACS profile, CDC
  // PLACES) and centers of population, listed in tables/index.json and read on
  // first use. `merged` is the reference collection with the loaded tables'
  // columns added to its features' properties.
  let tableIndexPromise = null,
    tableIndex = null,
    merged = null;
  const tableColumns = new Map(),
    centerData = new Map();

  async function asset(name) {
    if (blobs[name]) return blobs[name];
    const res = await fetch(catalog.path + name);
    if (!res.ok) throw new Error("Unable to read " + name + " (" + res.status + ").");
    return (blobs[name] = await res.blob());
  }
  const json = async (name) => JSON.parse(await (await asset(name)).text());

  async function loadDisplay() {
    display = await json(ref.files.display);
    return display;
  }
  async function neighbors() {
    neighborData ??= await json(ref.files.neighbors);
    return neighborData;
  }

  /** What DuckDB needs to register the reference layer. */
  async function reference(files = blobs, geo = display) {
    const parquet = files[ref.files.parquet] || (await asset(ref.files.parquet));
    return {
      table: ref.id,
      file: new File([parquet], ref.files.parquet),
      display: geo,
      idField: ref.idField,
      labelField: ref.labelField,
      idText: catalog.region.name + " " + (ref.noun || "feature") + " " + ref.idField,
    };
  }
  async function openWith(files, geo, imports) {
    const { openDatabase } = await import("../data/database.js");
    const engine = await openDatabase({ reference: await reference(files, geo) });
    try {
      for (const [name, file] of imports) await engine.importFile(file, name);
    } catch (error) {
      await engine.close();
      throw error;
    }
    // Attribute tables join by id in SQL too. Without them (offline before they
    // were saved), the database still opens.
    try {
      for (const t of sqlTables(await tables())) {
        await loadTable(t.id);
        await engine.addTable(t.name, tableColumns.get(t.id), ref.idField);
      }
    } catch {}
    return engine;
  }
  function db() {
    if (!databasePromise) {
      status("Opening browser database…");
      onDatabase("loading");
      databasePromise = openWith(blobs, display, inputs).then(
        (engine) => {
          onDatabase("ready");
          return engine;
        },
        (error) => {
          databasePromise = null;
          onDatabase("idle");
          throw error;
        },
      );
    }
    return databasePromise;
  }

  /** SQL view names for the attribute tables: tract_acs, tract_places. */
  const sqlTables = (index) =>
    (index?.tables || []).map((t) => ({ id: t.id, name: (ref.noun || "feature") + "_" + t.id, title: t.name }));
  /** The table index ({ tables, centers }), read once; empty when the region has none. */
  function tables() {
    tableIndexPromise ??= (ref.tables ? json(ref.tables) : Promise.resolve({ tables: [], centers: {} })).then(
      (index) => (tableIndex = validateTables(index)),
      (error) => {
        tableIndexPromise = null;
        throw error;
      },
    );
    return tableIndexPromise;
  }
  const tableOf = (field) =>
    tableIndex?.tables.find((t) => t.fields[field] || t.measures.includes(field));
  /** Reads a table's columns and adds them to the reference features. */
  async function loadTable(id) {
    const index = await tables();
    const table = index.tables.find((t) => t.id === id);
    if (!table) throw new Error("This region has no table called " + id + ".");
    if (!tableColumns.has(id)) {
      const data = await json(table.file);
      if (!Array.isArray(data.ids) || !data.columns) throw new Error(table.name + " is not a table file.");
      tableColumns.set(id, data);
      merged = null;
    }
    return table;
  }
  /** Loads whatever tables the given fields come from. Unknown fields are left alone. */
  async function ensureFields(fields) {
    const wanted = [...new Set(fields.filter(Boolean))];
    if (!wanted.length || !ref.tables) return;
    await tables();
    for (const id of new Set(wanted.map((f) => tableOf(f)?.id).filter(Boolean))) await loadTable(id);
  }
  /** The reference features with every loaded table's columns as properties. */
  function referenceCollection() {
    if (!display || !tableColumns.size) return display;
    if (merged?.base === display && merged.count === tableColumns.size) return merged.collection;
    const extra = display.features.map(() => ({}));
    const position = new Map(display.features.map((f, i) => [String(f.properties?.[ref.idField] ?? f.id), i]));
    for (const data of tableColumns.values()) {
      const rows = data.ids.map((id) => position.get(String(id)));
      for (const [name, values] of Object.entries(data.columns))
        rows.forEach((i, k) => {
          if (i != null) extra[i][name] = values[k];
        });
    }
    const collection = {
      ...display,
      features: display.features.map((f, i) => ({ ...f, properties: { ...f.properties, ...extra[i] } })),
    };
    merged = { base: display, count: tableColumns.size, collection };
    return collection;
  }
  /** The region's outline (GeoJSON), for point patterns and density surfaces; read once. */
  let outlinePromise = null;
  function outline() {
    if (!catalog.region.outline) return Promise.reject(new Error("This region has no outline for point patterns."));
    outlinePromise ??= json(catalog.region.outline).catch((error) => {
      outlinePromise = null;
      throw error;
    });
    return outlinePromise;
  }
  /** Centers of population for a layer ({ ids, lon, lat, population }), or null when none ship. */
  async function centers(layerId) {
    const index = await tables();
    // The table index keys centers by layer id; the reference layer's is its id ("tracts").
    const entry = index.centers?.[layerId];
    if (!entry) return null;
    if (!centerData.has(layerId)) centerData.set(layerId, await json(entry.file));
    return centerData.get(layerId);
  }

  /** The library of add-on layers, read once on first use. */
  function library() {
    libraryPromise ??= loadLibrary(async () => json(catalog.library), catalog).catch((error) => {
      libraryPromise = null;
      throw error;
    });
    return libraryPromise;
  }
  /** A library layer's metadata (after library() has resolved), or undefined. */
  const libraryMeta = (id, lib) => lib?.layers.find((l) => l.id === id);
  /** Reads a library layer's features; returns { meta, collection }. */
  async function loadLayer(id) {
    const meta = libraryMeta(id, await library());
    if (!meta) throw new Error("This region has no layer called " + id + ".");
    if (!layerData.has(id)) {
      const collection = await json(meta.file);
      if (!Array.isArray(collection.features)) throw new Error(meta.name + " has no features.");
      layerData.set(id, collection);
    }
    return { meta, collection: layerData.get(id) };
  }
  /** Queen and rook neighbors of a library polygon layer, keyed by feature id. */
  async function loadLayerNeighbors(id) {
    if (!layerGraphs.has(id)) {
      const meta = libraryMeta(id, await library());
      layerGraphs.set(id, meta?.neighbors ? await json(meta.neighbors) : null);
    }
    return layerGraphs.get(id);
  }

  /**
   * The base/ files a project carries: the reference files always; Compare's
   * reference when used; and the files of library layers in the saved stack.
   * `optional` takes the saved state so a restore can find them.
   */
  const projectFiles = () => ({
    required: [ref.files.display, ref.files.parquet, ref.files.neighbors, ref.files.sources].filter(Boolean),
    optional: (state) => [
      ref.compare?.reference,
      ...(tableColumns.size ? [ref.tables, ...[...tableColumns.keys()].map((id) => tableIndex.tables.find((t) => t.id === id).file)] : []),
      ...(state?.stack || []).flatMap((e) => {
        const meta = libraryMeta(e.id, libraryNow);
        return meta ? [meta.file, meta.neighbors] : [];
      }),
    ].filter(Boolean),
  });
  let libraryNow = null;

  return {
    catalog,
    ref,
    asset,
    loadDisplay,
    neighbors,
    graphs,
    projectFiles,
    /** The library: a promise of { groups, layers }. */
    library: () => library().then((lib) => (libraryNow = lib)),
    loadLayer,
    loadLayerNeighbors,
    /** The table index: a promise of { tables, centers }. */
    tables,
    /** The attribute tables' SQL views ({ id, name, title }), once the index is read. */
    sqlTables: () => sqlTables(tableIndex),
    loadTable,
    ensureFields,
    centers,
    outline,
    /** The table metadata a reference field comes from, once the index is read. */
    tableOf,
    /** A table field's metadata, or undefined. */
    tableField: (field) => tableOf(field)?.fields[field],
    /** Table fields named here whose values are not loaded yet. */
    missingFields: (fields) =>
      fields.filter((f) => {
        const t = f && tableOf(f);
        return t && !tableColumns.has(t.id);
      }),
    /** A library layer's neighbor graph ({ queen, rook }) once loaded, or undefined. */
    layerNeighbors: (id) => layerGraphs.get(id) ?? undefined,
    /** A loaded library layer's features, or undefined. */
    layerCollection: (id) => layerData.get(id),
    /** A library layer's metadata once the library is loaded, or undefined. */
    meta: (id) => libraryMeta(id, libraryNow),
    db,
    reference,
    get display() {
      return display;
    },
    get neighborData() {
      return neighborData;
    },
    get inputs() {
      return inputs;
    },
    get databaseOpen() {
      return !!databasePromise;
    },
    /** The reference layer as a map layer. */
    referenceView() {
      return {
        id: ref.id,
        name: ref.name,
        collection: referenceCollection(),
        builtIn: true,
        reference: true,
        referenceFields: true,
      };
    },
    /** Fields that can color a layer. */
    fieldList(layer) {
      if (layer.id === ref.id) return [...ref.measures, ...(tableIndex?.tables.flatMap((t) => t.measures) || [])];
      if (layer.library) return layer.meta.measures;
      return numericFields(layer.collection.features);
    },
    /**
     * Opens a project's files in a fresh database before anything is replaced,
     * so a bad archive leaves the open workspace as it was. Returns a commit().
     */
    async stage({ base, inputs: nextInputs }) {
      const geo = JSON.parse(await base[ref.files.display].text()),
        graph = JSON.parse(await base[ref.files.neighbors].text());
      if (!Array.isArray(geo.features) || !graph.queen || !graph.rook)
        throw new Error("Project contains invalid reference geography or weights.");
      const engine = nextInputs.size ? await openWith(base, geo, nextInputs) : null;
      return {
        display: geo,
        commit() {
          const previous = databasePromise;
          graphs.clear();
          layerData.clear();
          layerGraphs.clear();
          merged = null;
          blobs = { ...base };
          display = geo;
          neighborData = graph;
          inputs = nextInputs;
          databasePromise = engine ? Promise.resolve(engine) : null;
          onDatabase(engine ? "ready" : "idle");
          if (previous) previous.then((old) => old.close()).catch(() => {});
        },
      };
    },
  };
}
