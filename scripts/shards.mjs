// Splits the states CI builds into balanced shards by tract count (from the
// pinned TIGER counts in scripts/sources/), largest first onto the lightest
// shard. Mississippi and Delaware are committed, so they are left out. The
// national counties (scripts/regions.json "national") build in about a minute
// and join the lightest shard.
//   node scripts/shards.mjs N COUNT   prints shard N's ids (1-based), space-separated
import fs from "node:fs";

export function shards(count, skip = ["ms", "de"]) {
  const manifest = JSON.parse(fs.readFileSync("scripts/regions.json", "utf8"));
  const regions = manifest.regions.filter((r) => !skip.includes(r.id));
  const tracts = (id) => JSON.parse(fs.readFileSync(`scripts/sources/${id}.json`, "utf8")).tiger_tracts?.tracts ?? 0;
  const bins = Array.from({ length: count }, () => ({ ids: [], tracts: 0 }));
  for (const r of regions.map((r) => ({ id: r.id, n: tracts(r.id) })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))) {
    const bin = bins.reduce((a, b) => (b.tracts < a.tracts ? b : a));
    bin.ids.push(r.id);
    bin.tracts += r.n;
  }
  if (manifest.national && !skip.includes(manifest.national.id))
    bins.reduce((a, b) => (b.tracts < a.tracts ? b : a)).ids.push(manifest.national.id);
  return bins;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const [n, count] = process.argv.slice(2).map(Number);
  if (!(n >= 1 && n <= count)) {
    console.error("Usage: node scripts/shards.mjs N COUNT");
    process.exit(2);
  }
  console.log(shards(count)[n - 1].ids.join(" "));
}
