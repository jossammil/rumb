// Every action rumb can take, by name. Buttons, single-letter keys
// (core/keys.js), the command palette and the help sheet all use this list,
// so a command has one label and one key everywhere.

/** { id, label, group } in palette order. Handlers are bound in main.js. */
export const COMMANDS = [
  { id: "palette", label: "Command palette", group: "Help" },
  { id: "view-map", label: "Go to the map", group: "View" },
  { id: "view-compare", label: "Go to Compare areas", group: "View" },
  { id: "view-data", label: "Go to the data library", group: "View" },
  { id: "view-sql", label: "Go to the SQL editor", group: "View" },
  { id: "layers", label: "Show layers", group: "Map" },
  { id: "add-layer", label: "Add a layer from the library…", group: "Map" },
  { id: "layer-down", label: "Focus the layer below", group: "Map" },
  { id: "layer-up", label: "Focus the layer above", group: "Map" },
  { id: "roads-position", label: "Draw roads above or below areas", group: "Map" },
  { id: "style", label: "Show map style", group: "Map" },
  { id: "analyze", label: "Show spatial analysis", group: "Map" },
  { id: "find", label: "Find a feature", group: "Map" },
  { id: "fit", label: "Fit the layer to the map", group: "Map" },
  { id: "zoom-in", label: "Zoom in", group: "Map" },
  { id: "zoom-out", label: "Zoom out", group: "Map" },
  { id: "clear-selection", label: "Clear the selection", group: "Map" },
  { id: "graticule", label: "Show or hide the 1° grid", group: "Map" },
  { id: "run-analysis", label: "Find clusters (Moran's I and LISA)", group: "Analysis" },
  { id: "export-stats", label: "Export cluster statistics as CSV", group: "Analysis" },
  { id: "import", label: "Import data files", group: "File" },
  { id: "open", label: "Open a project", group: "File" },
  { id: "save", label: "Save the project", group: "File" },
  { id: "export", label: "Export the map as PNG", group: "File" },
  { id: "offline", label: "Download for offline use", group: "File" },
  { id: "theme-next", label: "Next theme", group: "Appearance" },
  { id: "appearance", label: "Appearance…", group: "Appearance" },
  { id: "coords", label: "Switch coordinates (decimal / DMS)", group: "Appearance" },
  { id: "help", label: "Keyboard shortcuts and about", group: "Help" },
];

/** Binds handlers by command id and returns runCommand(id). Unknown ids are ignored. */
export function bindCommands(handlers) {
  return (id) => {
    const run = handlers[id];
    return run ? run() : undefined;
  };
}
