import type { NewThreadBackgroundEffect } from "./appearance";

type WorkerResponse = { id: number; result?: Blob; error?: string };

let worker: Worker | null = null;
let nextRequestId = 0;
let appliedRevision = 0;
let activeObjectUrl: string | null = null;
const pending = new Map<
  number,
  {
    resolve: (result?: Blob) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    owner: Worker;
  }
>();
/** A decode or render that outlives this is treated as a hung worker and recreated. */
const REQUEST_TIMEOUT_MS = 20_000;
const loadedSources = new Map<string, Promise<void>>();
const effectCache = new Map<string, Promise<Blob>>();
const MAX_CACHED_REVISIONS = 3;

function revisionOf(key: string) {
  const match = /[?&]v=(\d+)/.exec(key);
  return match ? Number(match[1]) : 0;
}

/** Retain only the newest source revisions, including all effect/theme variants. */
function pruneByRevision(map: Map<string, unknown>) {
  const revisions = new Set<number>();
  for (const key of map.keys()) revisions.add(revisionOf(key));
  if (revisions.size <= MAX_CACHED_REVISIONS) return;
  const keep = new Set([...revisions].sort((a, b) => b - a).slice(0, MAX_CACHED_REVISIONS));
  for (const key of map.keys()) {
    if (!keep.has(revisionOf(key))) map.delete(key);
  }
}

/** A transient fetch or worker error must remain retryable. */
function forgetOnReject<K>(map: Map<K, Promise<unknown>>, key: K) {
  const entry = map.get(key);
  entry?.catch(() => {
    if (map.get(key) === entry) map.delete(key);
  });
}

/**
 * Settle every request the dead worker owned and drop it, so the next request
 * starts a fresh worker. Sources it held are gone with it and reload on demand;
 * the rejection reaches the caller's existing fallback to the original image.
 */
function failWorker(failed: Worker, reason: string) {
  if (worker === failed) {
    worker = null;
    loadedSources.clear();
  }
  try {
    failed.terminate();
  } catch {
    // Already gone.
  }
  for (const [id, request] of Array.from(pending)) {
    if (request.owner !== failed) continue;
    pending.delete(id);
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
}

function backgroundWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("./newThreadBackgroundEffects.worker.ts", import.meta.url), {
    type: "module",
  });
  worker = created;
  created.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  created.onerror = () => failWorker(created, "The background effect worker stopped unexpectedly.");
  created.onmessageerror = () =>
    failWorker(created, "The background effect worker returned an unreadable message.");
  return created;
}

function request(message: object, transfer?: Transferable[]) {
  const id = ++nextRequestId;
  return new Promise<Blob | undefined>((resolve, reject) => {
    let target: Worker;
    try {
      target = backgroundWorker();
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }
    const timer = setTimeout(
      () => failWorker(target, "The background effect worker did not respond."),
      REQUEST_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer, owner: target });
    try {
      target.postMessage({ ...message, id }, transfer ?? []);
    } catch (cause) {
      pending.delete(id);
      clearTimeout(timer);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

async function ensureSource(sourceKey: string, src: string) {
  let loading = loadedSources.get(sourceKey);
  if (!loading) {
    loading = fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to read the background image.");
        return response.arrayBuffer();
      })
      .then(async (bytes) => {
        await request({ kind: "load", sourceKey, bytes }, [bytes]);
      });
    loadedSources.set(sourceKey, loading);
    pruneByRevision(loadedSources);
    forgetOnReject(loadedSources, sourceKey);
  }
  return loading;
}

export async function prepareNewThreadBackgroundEffect(
  sourceKey: string,
  src: string,
  effect: NewThreadBackgroundEffect,
  light: boolean,
) {
  const themeKey = effect === "none" || effect === "dither" ? false : light;
  const cacheKey = `${sourceKey}:${effect}:${themeKey}`;
  let prepared = effectCache.get(cacheKey);
  if (!prepared) {
    prepared = ensureSource(sourceKey, src).then(async () => {
      const result = await request({
        kind: "render",
        sourceKey,
        effect,
        light: themeKey,
      });
      if (!result) throw new Error("The background effect returned no image.");
      return result;
    });
    effectCache.set(cacheKey, prepared);
    pruneByRevision(effectCache);
    forgetOnReject(effectCache, cacheKey);
  }
  return prepared;
}

export function clearPreparedNewThreadBackground() {
  appliedRevision += 1;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  document.documentElement.style.removeProperty("--chat-background-image");
  document.documentElement.classList.remove("chat-background-effect-ready");
  document.documentElement.classList.remove("chat-background-gradient-blur");
}

export async function applyPreparedNewThreadBackground(
  sourceKey: string,
  src: string,
  effect: NewThreadBackgroundEffect,
  light: boolean,
) {
  const revision = ++appliedRevision;
  const root = document.documentElement;
  root.classList.remove("chat-background-effect-ready");
  root.classList.toggle("chat-background-gradient-blur", effect === "gradient-blur");
  if (effect === "none" || effect === "gradient-blur") {
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
    root.style.setProperty("--chat-background-image", `url(${JSON.stringify(src)})`);
    requestAnimationFrame(() => {
      if (revision === appliedRevision) {
        root.classList.add("chat-background-effect-ready");
      }
    });
    return;
  }
  let blob: Blob;
  try {
    blob = await prepareNewThreadBackgroundEffect(sourceKey, src, effect, light);
  } catch {
    if (revision !== appliedRevision) return;
    root.style.setProperty("--chat-background-image", `url(${JSON.stringify(src)})`);
    root.classList.add("chat-background-effect-ready");
    return;
  }
  if (revision !== appliedRevision) return;
  const objectUrl = URL.createObjectURL(blob);
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = objectUrl;
  root.style.setProperty("--chat-background-image", `url(${JSON.stringify(objectUrl)})`);
  requestAnimationFrame(() => {
    if (revision === appliedRevision) {
      root.classList.add("chat-background-effect-ready");
    }
  });
}
