// Offline use: registers the service worker (public/sw.js), offers a reload
// when a new version takes over, and "Download for offline" fetches every
// file in offline.json through the worker so it is cached.

/**
 * createOffline({ status, notify, onState(state) }) where state is
 * "unsupported", "online", "partial" (some files cached) or "ready".
 */
export function createOffline({ status, notify, onState }) {
  const supported = "serviceWorker" in navigator && "caches" in self;
  const url = (file) => new URL(file, document.baseURI).href;

  async function manifest() {
    const res = await fetch("offline.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not read the offline file list (" + res.status + ").");
    return res.json();
  }

  /** Counts how many of the offline files are already cached. */
  async function check() {
    if (!supported) return onState("unsupported");
    try {
      const { files } = await manifest();
      let cached = 0;
      for (const file of files) if (await caches.match(url(file), { ignoreSearch: true })) cached++;
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

  async function download() {
    if (!supported) throw new Error("This browser cannot keep rumb for offline use.");
    await controlled();
    const { files } = await manifest();
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
      navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => r.unregister()));
      return onState("online");
    }
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker:", error));
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController)
        notify("rumb was updated.", { action: () => location.reload(), label: "Reload" });
      check();
    });
    navigator.serviceWorker.ready.then(check);
  }

  return { supported, register, download, check };
}
