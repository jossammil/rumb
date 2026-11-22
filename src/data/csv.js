// CSV text for every export: cells are quoted only when they need it, rows end
// in CRLF, and missing values become empty cells.

export function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

/** [[header…], [row…], …] → CSV text. */
export const csvText = (rows) =>
  rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
