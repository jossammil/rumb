// Talks to the statistics worker (stats/worker.js). One worker stays alive
// between requests, so GeoDaLib's wasm loads once; cancelling stops it, and
// the next request starts a fresh one.

let worker = null,
  nextId = 0;
const pending = new Map();

function failAll(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}
function stop() {
  worker?.terminate();
  worker = null;
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("stats-worker.js", document.baseURI), { type: "module" });
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    stop();
    failAll(new Error(event.message || "The statistics worker failed to load."));
  };
  return worker;
}

/** Sends { type: "analyze" | "weights", ... } and resolves the worker's result. */
export function callStats(request, signal) {
  return new Promise((resolve, reject) => {
    const canceled = () => new DOMException("Analysis canceled", "AbortError");
    if (signal?.aborted) {
      reject(canceled());
      return;
    }
    const id = ++nextId;
    const done = () => signal?.removeEventListener("abort", abort);
    // A running permutation test cannot be interrupted, so cancelling ends the worker.
    const abort = () => {
      stop();
      failAll(canceled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve: (value) => (done(), resolve(value)),
      reject: (error) => (done(), reject(error)),
    });
    ensureWorker().postMessage({ ...request, id });
  });
}
