// Keyboard shortcuts: which key runs which command, and when a key press is
// ordinary typing. The help sheet (ui/help.js) is made from SHORTCUTS.

/** [command id, keys as shown, what it does] */
export const SHORTCUTS = [
  ["palette", "Ctrl/⌘ K  or  :", "Command palette: run any command, switch layers, find places"],
  ["view-map", "1", "Map"],
  ["view-compare", "2", "Compare areas"],
  ["view-data", "3", "Data library"],
  ["view-sql", "4", "SQL editor"],
  ["layers", "L", "Layers"],
  ["add-layer", "N", "Add a layer from the library"],
  ["layer-down", "J", "Focus the layer below"],
  ["layer-up", "K", "Focus the layer above"],
  ["style", "S", "Map style"],
  ["analyze", "A", "Spatial analysis settings"],
  ["run-analysis", "R", "Run Find clusters"],
  ["find", "F  or  /", "Find a feature"],
  ["fit", "0", "Fit the layer"],
  ["zoom-in", "+", "Zoom in"],
  ["zoom-out", "−", "Zoom out"],
  ["import", "I", "Import data files"],
  ["open", "O", "Open a project"],
  ["save", "Ctrl/⌘ S", "Save the project"],
  ["export", "E", "Export the map as PNG"],
  ["theme-next", "T", "Next theme"],
  ["help", "?", "About rumb and these shortcuts"],
  ["escape", "Esc", "Close a panel or dialog; back to the map"],
];

/** Single keys, active while focus is not in a text box. */
export const KEY_OF = {
  ":": "palette",
  1: "view-map",
  2: "view-compare",
  3: "view-data",
  4: "view-sql",
  l: "layers",
  n: "add-layer",
  j: "layer-down",
  k: "layer-up",
  s: "style",
  a: "analyze",
  r: "run-analysis",
  f: "find",
  "/": "find",
  0: "fit",
  "+": "zoom-in",
  "=": "zoom-in",
  "-": "zoom-out",
  i: "import",
  o: "open",
  e: "export",
  t: "theme-next",
  "?": "help",
};

/** The key that triggers a command, for tooltips ("Export (E)"). */
export const keyHint = (id) => SHORTCUTS.find((s) => s[0] === id)?.[1] || "";

/** True when the key press belongs to a text box, so shortcuts stay out of the way. */
export function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT")
    return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(target.type);
  return false;
}

/** The command a key press asks for, or null. */
export function shortcutFor(e) {
  if (e.altKey || e.repeat) return null;
  const key = e.key || "";
  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return null;
    if (key.toLowerCase() === "k") return "palette";
    if (key.toLowerCase() === "s") return "save";
    return null;
  }
  if (isTyping(e.target)) return null;
  return KEY_OF[key] || KEY_OF[key.toLowerCase()] || null;
}
