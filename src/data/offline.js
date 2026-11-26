// Offline use: registers the service worker (public/sw.js), offers a reload
// when a new version takes over, and "Download for offline" fetches every
// file in offline.json through the worker so it is cached.

/**
 * The files "Download for offline" fetches for region `id`: the vendor
 * runtimes, the shared data and that region's data. Older offline lists had
 * only `files`.
 */
export const offlineFiles = (list, id) =>
  list.regions ? [...list.vendor, ...list.shared, ...(list.regions[id] || [])] : list.files;

/**
 * Above this many bytes of a region's own data (the national map's tiles; the
 * largest state, California, has 36 MB), "Download for offline" says how much
 * it downloads in all and waits for a yes.
 */
export const LARGE_OFFLINE = 50 * 1024 * 1024;

/** Whether keeping region `id` offline should ask first. */
export const offlineAsks = (list, id) => (list.bytes?.[id] || 0) > LARGE_OFFLINE;

/** What keeping region `id` offline downloads, in bytes, or null when the list does not say. */
export const offlineBytes = (list, id) => (list.bytes ? (list.bytes.base || 0) + (list.bytes[id] || 0) : null);

/**
 * How many of `urls` are among `cachedUrls` (the cached requests' URLs),
 * ignoring query strings as the service worker's lookups do.
 */
export function countCached(urls, cachedUrls) {
  const bare = (u) => u.split(/[?#]/)[0];
  const have = new Set(Array.from(cachedUrls, bare));
  return urls.filter((u) => have.has(bare(u))).length;
}

/**
 * createOffline({ status, notify, onState(state), region }) where state is
 * "unsupported", "online", "partial" (some files cached) or "ready", and
 * `region` is the open region's id.
 */
export function createOffline({ status, notify, onState, region }) {
  const supported = "serviceWorker" in navigator && "caches" in self;
  const url = (file) => new URL(file, document.baseURI).href;

  async function manifest() {
    const res = await fetch("offline.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not read the offline file list (" + res.status + ").");
    return res.json();
  }

  /**
   * Counts how many of the offline files are already cached, from one list of
   * each cache's requests rather than a lookup per file.
   */
  async function check() {
    if (!supported) return onState("unsupported");
    try {
      const files = offlineFiles(await manifest(), region);
      const lists = await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()));
      const cached = countCached(files.map(url), lists.flat().map((r) => r.url));
      onState(cached === files.length ? "ready" : cached ? "partial" : "online");
    } catch {
      onState(navigator.onLine ? "online" : "partial");
    }
  }

  async function controlled() {
    if (navigator.serviceWorker.controller) return;
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    // The worker claims open pages when it activates; give it a moment.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Reload the page once, then try again.")), 5000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /**
   * Caches the app and the open region. A large region (the national map's
   * tiles) is opt-in: the first call says its size and offers the download.
   */
  async function download({ confirmed = false } = {}) {
    if (!supported) throw new Error("This browser cannot keep rumb for offline use.");
    const list = await manifest();
    const bytes = offlineBytes(list, region);
    if (!confirmed && offlineAsks(list, region)) {
      const mb = Math.round(bytes / 1048576) + " MB";
      notify("Keeping this region offline downloads " + mb + ".", {
        action: () => download({ confirmed: true }).catch((e) => notify(e.message, { error: true })),
        label: "Download " + mb,
      });
      return;
    }
    await controlled();
    const files = offlineFiles(list, region);
    let done = 0;
    for (const file of files) {
      status("Caching for offline… " + ++done + " of " + files.length, "loading");
      const res = await fetch(file);
      if (!res.ok) throw new Error("Could not cache " + file + " (" + res.status + ").");
      await res.arrayBuffer();
    }
    // Ask the browser not to evict the cache under storage pressure.
    const persisted = await navigator.storage?.persist?.().catch(() => false);
    await check();
    notify(
      "rumb is ready offline: the app, DuckDB and " +
        files.filter((f) => f.startsWith("data/")).length +
        " data files." +
        (persisted ? "" : " The browser may still clear them if storage runs low."),
    );
  }

  function register(dev) {
    if (!supported) return onState("unsupported");
    if (dev) {
      // The dev server rebuilds on save; a cached shell would hide the changes.
      navigator.serviceWorker
        .getRegistrations()
        .then((all) => all.forEach((r) => r.unregister().catch(() => {})), () => {});
      return onState("online");
    }
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker:", error));
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController)
        notify("rumb was updated.", { action: () => location.reload(), label: "Reload" });
      check();
    });
    // WebKit rejects `ready` ("Context is stopped") when the page leaves before
    // the worker is ready, and a page that has stopped cannot run a handler
    // added later, so the rejection is handled here, where the promise is made.
    navigator.serviceWorker.ready.then(check, () => {});
  }

  return { supported, register, download, check };
}
