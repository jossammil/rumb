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
 *
 * The size comes from a one-byte range request, not HEAD: GitHub Pages
 * compresses, and its HEAD Content-Length is the gzip size, while a 206's
 * Content-Range always ends with the file's own. A server that ignores ranges
 * sends the whole file, which is then read from memory.
 */
const remote = new Map();
export async function remoteFile(url) {
  if (!remote.has(url))
    remote.set(
      url,
      openRemote(url).catch((error) => {
        remote.delete(url);
        throw error;
      }),
    );
  return remote.get(url);
}

async function openRemote(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  const total = res.status === 206 && /\/(\d+)$/.exec(res.headers.get("Content-Range") || "")?.[1];
  if (!total) return res.arrayBuffer();
  await res.body?.cancel();
  return cachedAsyncBuffer(await asyncBufferFromUrl({ url, byteLength: Number(total) }));
}

/** Some columns of a remote Parquet file as { ids, columns }, like readTable. */
export async function readColumns(url, names, { idColumn = "GEOID" } = {}) {
  const file = await remoteFile(url);
  const objects = await parquetReadObjects({ file, columns: [idColumn, ...names] });
  const columns = {};
  for (const key of names) columns[key] = objects.map((r) => (r[key] == null || Number.isNaN(r[key]) ? null : typeof r[key] === "bigint" ? Number(r[key]) : r[key]));
  return { ids: objects.map((r) => String(r[idColumn])), columns };
}
