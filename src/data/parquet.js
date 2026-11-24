// The Parquet fast path: hyparquet (pure JavaScript, MIT) reads attribute
// tables without starting DuckDB. Loaded only when a Parquet table is first
// needed, so it is never part of the first map.
import { parquetReadObjects } from "hyparquet";

/**
 * A table file as { ids, columns }: `idColumn` gives the ids, and every other
 * column (or only `names`) becomes an array of numbers, with null for missing
 * values. `file` is an ArrayBuffer or any object with byteLength and slice().
 */
export async function readTable(file, { idColumn = "GEOID", names } = {}) {
  const rows = await parquetReadObjects({ file, columns: names && [idColumn, ...names] });
  const keys = names || Object.keys(rows[0] || {}).filter((k) => k !== idColumn);
  const columns = {};
  for (const key of keys) {
    const column = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][key];
      column[i] = v == null || Number.isNaN(v) ? null : typeof v === "bigint" ? Number(v) : v;
    }
    columns[key] = column;
  }
  return { ids: rows.map((r) => String(r[idColumn])), columns };
}
