// rumb service worker: offline use.
// - The app shell (page, scripts, styles, fonts) is cached when the worker
//   installs, with the default region's catalog and display geography.
// - DuckDB and GeoDaLib (vendor/<name>-<version>/) and the rest of the data are
//   cached the first time they load, or by "Download for offline" (the vendor
//   files and the open region's data).
// - Each region's data (data/<id>/) has its own cache, named by a hash of its
//   files, so rebuilding one state leaves the others cached; the index and
//   data/shared/ have one too.
// - Byte-range requests are answered from a cached file when there is one.
// No cross-origin isolation headers are added: single-threaded DuckDB does not
// need them, and they would restrict cross-origin assets.
// scripts/build.mjs fills in VERSION, DATA_CACHES, PRECACHE and PREDATA.
const VERSION = "__VERSION__";
const DATA_CACHES = "__DATA_CACHES__";
const PRECACHE = "__PRECACHE__";
const PREDATA = "__PREDATA__";
const SHELL = `rumb-shell-${VERSION}`;
/** The cache for a data path: its region's (data/<id>/…), else the shared one. */
const dataCache = (path) => DATA_CACHES[path.split("/")[1]] || DATA_CACHES.shared;
// Vendor folders carry their version, so one cache can keep them across app versions.
const VENDOR = "rumb-vendor-v1";
const scope = new URL(self.registration.scope);
const at = (path) => new Request(new URL(path, scope), { cache: "reload" });

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await (await caches.open(SHELL)).addAll(PRECACHE.map(at));
      for (const path of PREDATA) await (await caches.open(dataCache(path))).add(at(path));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Older builds kept all data in one rumb-data-<hash> cache; it goes too.
        const stale =
          (name.startsWith("rumb-shell-") && name !== SHELL) ||
          (name.startsWith("rumb-data-") && !Object.values(DATA_CACHES).includes(name));
        if (stale) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200 && response.type === "basic")
    await cache.put(request, response.clone());
  return response;
}

async function shell(request) {
  const cache = await caches.open(SHELL);
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.pathname === scope.pathname) {
    const page = await cache.match(new URL("./index.html", scope));
    if (page) return page;
  }
  return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
}

/** A 206 slice of a cached file, or null when the file is not cached. */
async function cachedRange(request) {
  const hit = await caches.match(request.url, { ignoreSearch: true });
  if (!hit) return null;
  const body = await hit.arrayBuffer();
  const size = body.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if (!m || (!m[1] && !m[2])) return null;
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end)
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const headers = new Headers(hit.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

/** HEAD from the cache (DuckDB asks for sizes before reading). */
async function cachedHead(request) {
  const hit = await caches.match(request.url, { ignoreSearch: true });
  if (!hit) return fetch(request);
  const headers = new Headers(hit.headers);
  headers.set("Content-Length", String((await hit.clone().arrayBuffer()).byteLength));
  return new Response(null, { status: 200, headers });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (path === "sw.js") return;
  if (request.method === "HEAD") {
    event.respondWith(cachedHead(request));
    return;
  }
  if (request.method !== "GET") return;
  if (request.headers.has("range")) {
    event.respondWith(cachedRange(request).then((r) => r || fetch(request)));
    return;
  }
  if (path.startsWith("vendor/")) event.respondWith(cacheFirst(VENDOR, request));
  else if (path.startsWith("data/")) event.respondWith(cacheFirst(dataCache(path), request));
  else event.respondWith(shell(request));
});
