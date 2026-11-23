// Files in and out: importing data, saving a .rumb project and opening one
// (including Field Atlas .bgis projects from before the rename).
import { plural } from "../catalog/format.js";
import { normalizeState } from "../core/state.js";
import { palettes } from "../map/classify.js";
import { saveBlob } from "../ui/dom.js";

export function createFiles(app) {
  async function importFiles(files) {
    if (!files?.length) return;
    const engine = await app.ws.db();
    let last,
      errors = [];
    for (const file of files) {
      try {
        app.status("Importing " + file.name + "…", "running");
        const info = await engine.importFile(file);
        app.ws.inputs.set(info.name, file);
        last = info.name;
      } catch (err) {
        errors.push(file.name + " — " + err.message);
      }
    }
    if (last) {
      app.bench.select(last);
      app.setView("data");
    }
    if (errors.length) throw new Error(errors.join("\n"));
    app.notify("Imported " + plural(files.length, "file") + " on this device.");
  }

  async function saveProject() {
    app.status("Packaging project…", "running");
    const { packProject } = await import("../data/project.js");
    const { required, optional } = app.ws.projectFiles();
    const files = {};
    for (const name of required) files[name] = await app.ws.asset(name);
    const { state, ref } = app;
    const comparing = state.comparisons[ref.id] || (state.view === "compare" && state.compareLayer === ref.id);
    const compareFile = ref.compare?.reference;
    for (const name of optional(state))
      if (name !== compareFile || comparing) files[name] = await app.ws.asset(name);
    const saved = { ...state, camera: app.atlas.camera() };
    const blob = await packProject(saved, app.ws.inputs, files);
    saveBlob(blob, "project.rumb");
    app.notify("Project exported with its source data and settings.");
  }

  async function restoreProject(file) {
    if (!file) return;
    app.status("Opening project…", "running");
    const { unpackProject } = await import("../data/project.js");
    // Library layers in a saved stack need the library to find their files.
    await app.ws.library().catch(() => null);
    const next = await unpackProject(file, { table: app.ref.id, ...app.ws.projectFiles() });
    const saved = next.state;
    // A project from another region reopens the app there and restores itself.
    const region = app.projectRegion(saved);
    if (region !== app.catalog.region.id) {
      if (!app.hasRegion(region)) throw new Error("This project is for a region (" + region + ") this version of rumb does not have.");
      if (!(await stashPending(file))) throw new Error("This project is for another region. Open that region first, then the project.");
      app.status("Switching region…", "running");
      app.openRegion(region, { extra: { restore: "1" } });
      return;
    }
    if (
      !Array.isArray(saved.layers) ||
      saved.layers.some((l) => !Array.isArray(l.collection?.features)) ||
      !(saved.active === app.ref.id || saved.layers.some((l) => l.id === saved.active) || app.ws.meta(saved.active))
    )
      throw new Error("Project contains invalid layer or style definitions.");
    // A palette this version does not know falls back to the default.
    if (!palettes[saved.palette]) {
      app.notify("The project's color palette is not available here; using Lagoon.");
      saved.palette = "Lagoon";
    }
    // Imported tables open in a fresh database first, so a bad archive leaves
    // the open workspace untouched.
    const staged = await app.ws.stage(next);
    app.analysis.cancel();
    staged.commit();
    app.store.replace(normalizeState(saved, app.catalog, (id) => !!app.ws.meta(id)));
    await app.loadStack();
    await app.ensureTables();
    await app.ensureDerived();
    app.filter.drawShape();
    app.bench.reset();
    app.renderAll();
    app.setView(app.state.view, true);
    if (saved.camera) app.atlas.map.jumpTo(saved.camera);
    app.notify("Project restored.");
  }

  // A project waiting for its region: kept in Cache Storage across the reload.
  const PENDING = "rumb-pending",
    PENDING_KEY = "pending-project";
  async function stashPending(file) {
    if (!globalThis.caches) return false;
    const cache = await caches.open(PENDING);
    await cache.put(PENDING_KEY, new Response(file, { headers: { "x-name": encodeURIComponent(file.name || "project.rumb") } }));
    return true;
  }
  /** Restores the project a region switch left in the pending cache, then forgets it. */
  async function restorePending() {
    const url = new URL(location.href);
    url.searchParams.delete("restore");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (!globalThis.caches) return;
    const cache = await caches.open(PENDING);
    const res = await cache.match(PENDING_KEY);
    if (!res) return;
    await cache.delete(PENDING_KEY);
    const name = decodeURIComponent(res.headers.get("x-name") || "project.rumb");
    const file = new File([await res.blob()], name);
    await app.perform(null, () => restoreProject(file));
  }

  return { importFiles, saveProject, restoreProject, restorePending };
}
