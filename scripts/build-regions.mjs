// Builds states' data folders with the R pipeline, writes each catalog and
// checks the result. Run at the repository root:
//   node scripts/build-regions.mjs [ids...] [--all] [--out-root .cache/data]
//                                  [--jobs 2] [--pin] [--keep]
// ids are data ids, abbreviations or FIPS codes from scripts/regions.json, or
// us for the national counties; --all builds every state and DC (not us). Each region goes to <out-root>/<id>/, with
// its log in .cache/build/<id>/build.log. --keep skips a region whose folder
// already passes the checks. --pin records downloads instead of checking them
// (scripts/lib/region.R). Mississippi's committed catalog is copied, not
// written, because its labels and text were edited by hand.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { regionCatalog } from "./region-catalog.mjs";
import { checkRegion } from "./check-region.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const flags = new Set(["--all", "--pin", "--keep"]);
const valued = new Set(["--out-root", "--jobs"]);
const wanted = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
for (const a of args) if (a.startsWith("--") && !flags.has(a) && !valued.has(a)) throw new Error("Unknown option " + a);
const outRoot = option("--out-root", ".cache/data");
const jobs = Math.max(1, Number(option("--jobs", 2)));
const pin = args.includes("--pin");
const keep = args.includes("--keep");

const manifest = JSON.parse(fs.readFileSync("scripts/regions.json", "utf8"));
const regions = manifest.regions;
const find = (want) =>
  [...regions, manifest.national].find((r) => [r.id, r.abbr.toLowerCase(), r.fips].includes(String(want).toLowerCase())) ??
  (() => {
    throw new Error("Unknown state " + want);
  })();
const todo = args.includes("--all") ? regions : wanted.map(find);
if (!todo.length) {
  console.error("Name the states to build, or pass --all.");
  process.exit(2);
}
const template = JSON.parse(fs.readFileSync("public/data/ms/catalog.json", "utf8"));

function run(command, argv, log) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(log, "\n$ " + command + " " + argv.join(" ") + "\n");
    const out = fs.openSync(log, "a");
    const child = spawn(command, argv, { stdio: ["ignore", out, out] });
    child.on("error", reject);
    child.on("close", (code) => {
      fs.closeSync(out);
      code === 0 ? resolve() : reject(new Error(command + " " + argv[0] + " failed; see " + log));
    });
  });
}

async function build(region) {
  const out = path.join(outRoot, region.id);
  const buildDir = path.join(".cache/build", region.id);
  fs.mkdirSync(buildDir, { recursive: true });
  const log = path.join(buildDir, "build.log");
  if (keep && fs.existsSync(path.join(out, "catalog.json")) && !checkRegion(out).problems.length)
    return { region, skipped: true };
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(log, new Date().toISOString() + " " + region.name + "\n");
  const common = ["--state", region.id, "--out", out, ...(pin ? ["--pin"] : [])];
  const started = Date.now();
  for (const script of ["prepare-data.R", "prepare-layers.R", "prepare-tables.R", "prepare-outline.R", "prepare-basemap.R"])
    await run("Rscript", ["scripts/" + script, ...common], log);
  // The comparison reference is a tract extract; the national counties have none.
  const places = path.join(process.env.RUMB_SOURCE_CACHE || ".cache/sources", "us", "PLACES_tract_GIS_2025.csv");
  if (!region.unit) await run("python3", ["scripts/prepare-places.py", places, "--state", region.id, "--out", out], log);
  const catalog =
    region.id === "ms"
      ? template
      : regionCatalog(region, out, { template, backdrop: JSON.parse(fs.readFileSync(path.join(buildDir, "backdrop.json"), "utf8")) });
  fs.writeFileSync(path.join(out, "catalog.json"), JSON.stringify(catalog, null, 1) + "\n");
  // Every region shares public/data/shared/world-land.geojson.
  fs.rmSync(path.join(out, "world-land.geojson"), { force: true });
  const { problems, notes } = checkRegion(out);
  if (problems.length) throw new Error(region.name + " failed its checks:\n  " + problems.join("\n  "));
  return { region, seconds: (Date.now() - started) / 1000, notes };
}

const queue = [...todo];
const failures = [];
async function worker() {
  while (queue.length) {
    const region = queue.shift();
    try {
      const r = await build(region);
      console.log(r.skipped ? `kept  ${region.id}` : `built ${region.id} in ${r.seconds.toFixed(0)} s · ${r.notes.join(" · ")}`);
    } catch (error) {
      failures.push(region.id);
      console.log(`FAIL  ${region.id}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, worker));
if (failures.length) {
  console.log("Failed: " + failures.join(", "));
  process.exit(1);
}
