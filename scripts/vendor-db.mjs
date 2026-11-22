// Stage the matching single-threaded DuckDB browser runtime and the official
// signed extensions in .cache/vendor/duckdb-<version>/, which scripts/build.mjs
// copies into dist/vendor/. Cache entries are checked before reuse, including
// on later offline builds. Run on its own with `npm run vendor`.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = dirname(
  createRequire(import.meta.url).resolve("@duckdb/duckdb-wasm"),
);
const extensionPath = "v1.4.3/wasm_eh";
const sums = {
  parquet: "22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55",
  spatial: "04b776946da64a15a7b14501790c75093e38f876acc46b2922f0daeb6aaa1d60",
  json: "b997276c8e15cc3ebdeda340d73d15dc1c4f4755ad281280451cb0a2f79302e9",
};
const hash = (b) => createHash("sha256").update(b).digest("hex");
const packageInfo = JSON.parse(
  await readFile(join(dist, "../package.json"), "utf8"),
);
export const folder = "duckdb-" + packageInfo.version;
const target = join(here, "../.cache/vendor", folder);
if (packageInfo.version !== "1.32.0")
  throw new Error("Update extension pins alongside the DuckDB-Wasm version.");
await mkdir(join(target, "extensions", extensionPath), { recursive: true });
for (const file of ["duckdb-eh.wasm", "duckdb-browser-eh.worker.js"]) {
  await copyFile(join(dist, file), join(target, file));
}
await Promise.all(
  Object.entries(sums).map(async ([name, checksum]) => {
    const path = extensionPath + "/" + name + ".duckdb_extension.wasm";
    const file = join(target, "extensions", path);
    const existing = await readFile(file).catch(() => null);
    if (existing && hash(existing) === checksum) return;
    const response = await fetch("https://extensions.duckdb.org/" + path);
    if (!response.ok)
      throw new Error(
        "Cannot fetch " + name + " extension: HTTP " + response.status,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (hash(bytes) !== checksum)
      throw new Error("Checksum mismatch for " + name);
    const temporary = file + "." + process.pid + ".tmp";
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  }),
);
console.log("DuckDB " + packageInfo.version + " browser assets and 1.4.3 extensions verified.");
