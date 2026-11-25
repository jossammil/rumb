// The Parquet fast path: hyparquet (pure JavaScript, MIT) reads attribute
// tables without starting DuckDB. Loaded only when a Parquet table is first
// needed, so it is never part of the first map.
import { asyncBufferFromUrl, cachedAsyncBuffer, parquetReadObjects } from "hyparquet";

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

/**
 * A Parquet file on the server, read by HTTP range requests: only the footer
 * and the column chunks asked for are fetched. Kept per URL, so each byte is
 * fetched once.
 */
const remote = new Map();
export async function remoteFile(url) {
  if (!remote.has(url))
    remote.set(
      url,
      asyncBufferFromUrl({ url }).then(cachedAsyncBuffer, (error) => {
        remote.delete(url);
        throw error;
      }),
    );
  return remote.get(url);
}

/**
 * Some columns of a remote Parquet file as { ids, columns }, like readTable;
 * `rows` ([start, end)) limits the read to those rows (one state's).
 */
export async function readColumns(url, names, { idColumn = "GEOID", rows } = {}) {
  const file = await remoteFile(url);
  const [rowStart, rowEnd] = rows || [];
  const objects = await parquetReadObjects({ file, columns: [idColumn, ...names], rowStart, rowEnd });
  const columns = {};
  for (const key of names) columns[key] = objects.map((r) => (r[key] == null || Number.isNaN(r[key]) ? null : typeof r[key] === "bigint" ? Number(r[key]) : r[key]));
  return { ids: objects.map((r) => String(r[idColumn])), columns };
}
