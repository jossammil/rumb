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
  { id: "measure", label: "Measure distance and area", group: "Tools" },
  { id: "count-points", label: "Count the map's points in each area (or stop)", group: "Analysis" },
  { id: "filter-radius", label: "Filter by distance from a point (radius)", group: "Filter" },
  { id: "filter-buffer", label: "Filter by distance from the selection (buffer)", group: "Filter" },
  { id: "filter-draw", label: "Filter by a drawn area", group: "Filter" },
  { id: "filter-clear", label: "Clear the filter", group: "Filter" },
  { id: "locate", label: "Show my location", group: "Tools" },
  { id: "run-analysis", label: "Run the chosen spatial analysis", group: "Analysis" },
  { id: "hot-spots", label: "Find hot and cold spots (Getis–Ord Gi*)", group: "Analysis" },
  { id: "export-stats", label: "Export analysis statistics as CSV", group: "Analysis" },
  { id: "import", label: "Import data files", group: "File" },
  { id: "open", label: "Open a project", group: "File" },
  { id: "save", label: "Save the project", group: "File" },
  { id: "export", label: "Export the map as PNG", group: "File" },
  { id: "share", label: "Copy a share link", group: "File" },
  { id: "export-data", label: "Export layer data (CSV, GeoJSON, GeoParquet)…", group: "File" },
  { id: "report", label: "Printable report (PDF)…", group: "File" },
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
