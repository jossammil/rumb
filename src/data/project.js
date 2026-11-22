// Project files (.rumb): a stored ZIP with project.json (the state), the
// imported files under imports/ and the reference files under base/.
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";

const options = { useWebWorkers: false, level: 0 };
// "field-atlas" is the format name written before the app was renamed rumb.
const FORMATS = ["rumb", "field-atlas"];
export async function packProject(state, inputs, baseFiles) {
  const zip = new ZipWriter(new BlobWriter("application/zip"), options);
  const files = [...inputs].map(([table, file], i) => ({
    table,
    name: file.name,
    path: "imports/" + i,
    size: file.size,
  }));
  await zip.add(
    "project.json",
    new TextReader(
      JSON.stringify({ format: "rumb", version: 1, state, files }),
    ),
  );
  for (const item of files)
    await zip.add(item.path, new BlobReader(inputs.get(item.table)));
  for (const [name, blob] of Object.entries(baseFiles))
    await zip.add("base/" + name, new BlobReader(blob));
  return zip.close();
}
/**
 * Reads a project. `reference` names the reference table (no import may use it)
 * and the base/ files it must contain (`required`) or may contain (`optional`).
 */
export async function unpackProject(file, reference) {
  const zip = new ZipReader(new BlobReader(file), options);
  try {
    const entries = new Map(
      (await zip.getEntries()).map((e) => [e.filename, e]),
    );
    const read = (path, writer) => {
      const e = entries.get(path);
      if (!e || e.directory)
        throw new Error("Project is missing " + path + ".");
      return e.getData(writer, { checkSignature: true, useWebWorkers: false });
    };
    const m = JSON.parse(await read("project.json", new TextWriter()));
    if (
      !FORMATS.includes(m.format) ||
      m.version !== 1 ||
      !m.state ||
      !Array.isArray(m.files)
    )
      throw new Error(
        "Choose a rumb project (.rumb) or a Field Atlas project (.bgis).",
      );
    const inputs = new Map();
    for (const f of m.files) {
      if (
        !/^[a-z_][a-z0-9_]*$/.test(f.table) ||
        f.table === reference.table ||
        inputs.has(f.table)
      )
        throw new Error("Project contains an invalid table name.");
      const blob = await read(f.path, new BlobWriter());
      if (blob.size !== f.size)
        throw new Error("Imported file size mismatch for " + f.name);
      inputs.set(f.table, new File([blob], f.name));
    }
    const base = {};
    for (const name of reference.required)
      base[name] = await read("base/" + name, new BlobWriter());
    for (const name of reference.optional || [])
      if (entries.has("base/" + name))
        base[name] = await read("base/" + name, new BlobWriter());
    return { state: m.state, inputs, base };
  } finally {
    await zip.close();
  }
}
