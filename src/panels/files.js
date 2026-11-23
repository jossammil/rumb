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
    app.filter.drawShape();
    app.bench.reset();
    app.renderAll();
    app.setView(app.state.view, true);
    if (saved.camera) app.atlas.map.jumpTo(saved.camera);
    app.notify("Project restored.");
  }

  return { importFiles, saveProject, restoreProject };
}
