// Drag-and-drop anywhere on the page, with an overlay while files are over it.
// A depth counter keeps the overlay steady as the pointer crosses child elements.
import { $ } from "./dom.js";

export function setupDrop(onFiles) {
  const overlay = $("drop");
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types?.includes("Files");
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.hidden = false;
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  document.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    depth = 0;
    overlay.hidden = true;
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    onFiles([...e.dataTransfer.files]);
  });
}
