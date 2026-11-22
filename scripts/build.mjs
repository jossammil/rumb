// Builds dist/: the app bundle and the statistics worker, the static files in
// public/, and the self-hosted runtimes in versioned vendor folders (DuckDB and
// its signed extensions, GeoDaLib's wasm). Also writes dist/bundle-report.txt
// (what is in each JavaScript file, by library).
//   npm run build          minified, for publishing
//   npm run build:debug    readable code with source maps, for studying and debugging
//   npm run dev            build, then rebuild on change and serve at http://127.0.0.1:4180/bgis/
import { build, context } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const debug = process.env.RUMB_DEBUG === "1";
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lisaPkg = JSON.parse(
  await readFile("node_modules/@geoda/lisa/package.json", "utf8"),
);
const maplibrePkg = JSON.parse(
  await readFile("node_modules/maplibre-gl/package.json", "utf8"),
);

// 1. DuckDB's runtime and extensions, checked against pinned checksums and
//    staged in .cache/vendor/ (scripts/vendor-db.mjs).
const { folder: duckdbFolder } = await import("./vendor-db.mjs");
const lisaFolder = `geoda-lisa-${lisaPkg.version}`;

// 2. Static files as they are, then the versioned runtimes. The folder names
//    carry the version, so a cached copy of another build is never reused.
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await cp(`.cache/vendor/${duckdbFolder}`, `dist/vendor/${duckdbFolder}`, {
  recursive: true,
});
await cp(
  "node_modules/@duckdb/duckdb-wasm/LICENSE",
  `dist/vendor/${duckdbFolder}/LICENSE`,
).catch(() => {});
await mkdir(`dist/vendor/${lisaFolder}`, { recursive: true });
await cp(
  "node_modules/@geoda/lisa/wasm/geoda-lisa.wasm",
  `dist/vendor/${lisaFolder}/geoda-lisa.wasm`,
);

// 3. The app (src/main.js and what it imports) and the statistics worker, as ES
//    modules. Dynamic imports (DuckDB's bindings, zip.js, jsts, GeoDaLib) become
//    chunks that load only when first used. CSS imported from JS lands in app.css.
const options = {
  entryPoints: { app: "src/main.js", "stats-worker": "src/stats/worker.js" },
  bundle: true,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  outdir: "dist",
  platform: "browser",
  target: ["safari16", "chrome110", "firefox115"],
  minify: !debug && !watch,
  sourcemap: debug || watch ? "linked" : false,
  define: {
    __RUMB_VERSION__: JSON.stringify(pkg.version),
    // The dev server skips the service worker so edits show on reload.
    __RUMB_DEV__: JSON.stringify(watch),
    __DUCKDB_FOLDER__: JSON.stringify(`vendor/${duckdbFolder}`),
    __LISA_WASM__: JSON.stringify(`vendor/${lisaFolder}/geoda-lisa.wasm`),
  },
  // Fonts referenced from the CSS are copied under assets/ with a content hash.
  loader: { ".woff2": "file" },
  assetNames: "assets/[name]-[hash]",
  legalComments: "linked",
  metafile: true,
  logLevel: "warning",
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

if (watch) {
  // Static files are copied again on each rebuild (data/ only at the start).
  const recopy = {
    name: "recopy-public",
    setup(b) {
      b.onStart(async () => {
        for (const entry of await readdir("public"))
          if (entry !== "data")
            await cp(path.join("public", entry), path.join("dist", entry), {
              recursive: true,
            });
      });
    },
  };
  const ctx = await context({ ...options, plugins: [recopy] });
  await ctx.watch();
  await import("./serve.mjs");
  console.log("Watching src/ and public/ for changes.");
} else {
  const result = await build(options);

  // 4. What each JavaScript file contains, by library (for learning and size checks).
  const report = [];
  for (const [file, output] of Object.entries(result.metafile.outputs)) {
    if (!file.endsWith(".js")) continue;
    const byLibrary = {};
    for (const [input, info] of Object.entries(output.inputs)) {
      const name =
        /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input)?.[1] ||
        (input.startsWith("src/") ? "src (rumb)" : input);
      byLibrary[name] = (byLibrary[name] || 0) + info.bytesInOutput;
    }
    report.push(`${file}  ${(output.bytes / 1024).toFixed(0)} KB`);
    for (const [name, bytes] of Object.entries(byLibrary).sort((a, b) => b[1] - a[1]))
      report.push(`    ${name.padEnd(30)} ${(bytes / 1024).toFixed(1)} KB`);
  }
  await writeFile("dist/bundle-report.txt", `${report.join("\n")}\n`);

  // 5. The service worker and the offline list. The shell (everything but
  //    vendor/ and data/) is precached; its hash is the app version, so any
  //    change installs a new worker. Data has its own version, from its bytes.
  const rel = (f) => path.relative("dist", f).split(path.sep).join("/");
  const files = (await walk("dist")).map(rel).sort();
  const skip = (f) => f === "sw.js" || /\.(LEGAL\.txt|map)$/.test(f) || f === "bundle-report.txt";
  const shellFiles = files.filter((f) => !f.startsWith("vendor/") && !f.startsWith("data/") && !skip(f));
  const dataFiles = files.filter((f) => f.startsWith("data/") && !f.endsWith("/reference.json"));
  const vendorFiles = files.filter((f) => f.startsWith("vendor/") && !/LICENSE$/.test(f));
  const digest = async (files) => {
    const hash = createHash("sha256");
    for (const file of files) hash.update(file).update(await readFile(path.join("dist", file)));
    return hash.digest("hex").slice(0, 10);
  };
  const version = `${pkg.version}-${await digest(shellFiles)}${debug ? "-debug" : ""}`;
  const dataVersion = await digest(dataFiles);
  // Precached data: each region's catalog, display geography and backdrop.
  const index = JSON.parse(await readFile("dist/data/index.json", "utf8"));
  const predata = ["data/index.json"];
  for (const region of index.regions) {
    const base = "data/" + region.path;
    const catalog = JSON.parse(await readFile("dist/" + base + "catalog.json", "utf8"));
    predata.push(base + "catalog.json", base + catalog.layers[0].files.display);
    if (catalog.region.backdrop?.context) predata.push(base + catalog.region.backdrop.context);
  }
  await writeFile(
    "dist/offline.json",
    JSON.stringify({ version, dataVersion, files: [...vendorFiles, ...dataFiles] }, null, 1) + "\n",
  );
  const sw = (await readFile("public/sw.js", "utf8"))
    .replace('"__VERSION__"', JSON.stringify(version))
    .replace('"__DATA_VERSION__"', JSON.stringify(dataVersion))
    .replace('"__PRECACHE__"', JSON.stringify(["./", ...shellFiles, "offline.json"]))
    .replace('"__PREDATA__"', JSON.stringify(predata));
  await writeFile("dist/sw.js", sw);

  const outputs = Object.entries(result.metafile.outputs);
  const js = outputs.filter(([f]) => f.endsWith(".js"));
  const first = result.metafile.outputs["dist/app.js"].bytes;
  const all = js.reduce((n, [, o]) => n + o.bytes, 0);
  console.log(
    `Built rumb ${pkg.version}${debug ? ": debug build, readable code with source maps" : ""}`,
  );
  console.log(
    `  app.js ${(first / 1024).toFixed(0)} KB; all JS ${(all / 1024).toFixed(0)} KB across ${js.length} files. Details: dist/bundle-report.txt`,
  );
  console.log(
    `  MapLibre ${maplibrePkg.version}; ${duckdbFolder} and ${lisaFolder} in dist/vendor/, loaded on first use`,
  );
  console.log(
    `  service worker ${version}: ${shellFiles.length} shell files and ${predata.length} data files precached; ${vendorFiles.length + dataFiles.length} more in offline.json`,
  );
}
