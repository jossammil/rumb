// The open workspace's data: the region catalog, its reference files (fetched
// once and kept as Blobs so a project can bundle them), imported files, the
// DuckDB connection and neighbor graphs. No DOM here beyond fetch, File and Blob.
import { loadLibrary, referenceLayer } from "../catalog/catalog.js";
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
        collection: display,
        builtIn: true,
        reference: true,
        referenceFields: true,
      };
    },
    /** Fields that can color a layer. */
    fieldList(layer) {
      if (layer.id === ref.id) return ref.measures;
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
