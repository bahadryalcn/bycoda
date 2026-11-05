import type { NewThreadBackgroundEffect } from "./appearance";
import { BackgroundEffectCache, BACKGROUND_RENDER_BYTES } from "./backgroundEffectCache";

type WorkerResponse = { id: number; result?: Blob; error?: string; sourceKeys?: string[] };
let worker: Worker | null = null;
let nextRequestId = 0;
let appliedRevision = 0;
let activeObjectUrl: string | null = null;
let generation = 0;
let jobs = 0;
let tail: Promise<unknown> = Promise.resolve();
let idle: ReturnType<typeof setTimeout> | undefined;
let activeFetch: AbortController | null = null;
const REQUEST_TIMEOUT_MS = 20_000;
const IDLE_DISPOSE_MS = 30_000;
const loadedSources = new Set<string>();
const effectCache = new BackgroundEffectCache<Blob>(BACKGROUND_RENDER_BYTES, (blob) => blob.size);
const flights = new Map<
  string,
  { actual: Promise<Blob>; observed: Promise<Blob>; epoch: number }
>();
const pending = new Map<
  number,
  {
    resolve: (result?: Blob) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    owner: Worker;
  }
>();

function failWorker(failed: Worker, reason: string) {
  const current = worker === failed;
  if (current) {
    worker = null;
    generation++;
    loadedSources.clear();
    jobs = 0;
    tail = Promise.resolve();
    flights.clear();
  }
  try {
    failed.terminate();
  } catch {
    /* Already gone. */
  }
  for (const [id, request] of pending) {
    if (request.owner !== failed) continue;
    pending.delete(id);
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  if (current) scheduleIdleDisposal();
}

/** Dispose cached processing resources, never a currently displayed object URL. */
export function disposePreparedBackgroundEffects() {
  clearTimeout(idle);
  idle = undefined;
  activeFetch?.abort();
  if (worker) failWorker(worker, "Background processing was disposed.");
  else {
    generation++;
    jobs = 0;
    tail = Promise.resolve();
    flights.clear();
  }
  clearTimeout(idle);
  idle = undefined;
  loadedSources.clear();
  effectCache.clear();
}
function scheduleIdleDisposal() {
  clearTimeout(idle);
  idle = undefined;
  if (jobs) return;
  const original = worker,
    epoch = generation;
  idle = setTimeout(() => {
    if (!jobs && worker === original && generation === epoch) disposePreparedBackgroundEffects();
  }, IDLE_DISPOSE_MS);
}

function backgroundWorker() {
  if (worker) return worker;
  const created = new Worker(new URL("./newThreadBackgroundEffects.worker.ts", import.meta.url), {
    type: "module",
  });
  worker = created;
  created.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request || request.owner !== created || worker !== created) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (Array.isArray(data.sourceKeys) && data.sourceKeys.every((key) => typeof key === "string")) {
      loadedSources.clear();
      for (const key of data.sourceKeys) loadedSources.add(key);
    }
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
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timer = setTimeout(
      () => failWorker(target, "The background effect worker did not respond."),
      REQUEST_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer, owner: target });
    try {
      target.postMessage({ ...message, id }, transfer ?? []);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
function assertGeneration(epoch: number) {
  if (epoch !== generation) throw new Error("Background processing was superseded.");
}
async function ensureSource(sourceKey: string, src: string, epoch: number) {
  if (loadedSources.has(sourceKey)) return;
  const controller = new AbortController();
  activeFetch = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(src, { signal: controller.signal });
    if (!response.ok) throw new Error("Unable to read the background image.");
    const bytes = await response.arrayBuffer();
    assertGeneration(epoch);
    await request({ kind: "load", sourceKey, bytes }, [bytes]);
    assertGeneration(epoch);
    loadedSources.add(sourceKey);
  } finally {
    clearTimeout(timer);
    if (activeFetch === controller) activeFetch = null;
  }
}

export function prepareNewThreadBackgroundEffect(
  sourceKey: string,
  src: string,
  effect: NewThreadBackgroundEffect,
  light: boolean,
): Promise<Blob> {
  const identity = JSON.stringify([sourceKey, src]);
  const themeKey = effect === "none" || effect === "dither" ? false : light;
  const cacheKey = JSON.stringify([identity, effect, themeKey]);
  const cached = effectCache.get(cacheKey);
  if (cached) {
    scheduleIdleDisposal();
    return Promise.resolve(cached);
  }
  const existing = flights.get(cacheKey);
  if (existing?.epoch === generation) return existing.observed;
  clearTimeout(idle);
  idle = undefined;
  const epoch = generation;
  jobs++;
  // Fetch/decode/render stay one actual pipeline. Pending jobs hold only identity
  // and continuations, not parallel decoded bitmaps or transferred pixel arrays.
  const actual = tail
    .catch(() => {})
    .then(async () => {
      assertGeneration(epoch);
      await ensureSource(identity, src, epoch);
      assertGeneration(epoch);
      const result = await request({
        kind: "render",
        sourceKey: identity,
        effect,
        light: themeKey,
      });
      assertGeneration(epoch);
      if (!(result instanceof Blob)) throw new Error("The background effect returned no image.");
      effectCache.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      if (epoch === generation) {
        jobs--;
        scheduleIdleDisposal();
      }
    });
  tail = actual.then(
    () => undefined,
    () => undefined,
  );
  // A bounded observer supplies the existing source fallback. It never releases
  // unknown actual fetch work or admits a parallel replacement pipeline.
  const observed = new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Background processing is still pending.")),
      REQUEST_TIMEOUT_MS + 1_000,
    );
    void actual
      .then(
        (blob) => {
          clearTimeout(timer);
          resolve(blob);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      )
      .catch(() => {});
  });
  const original = { actual, observed, epoch };
  flights.set(cacheKey, original);
  const settled = () => {
    if (flights.get(cacheKey) === original) flights.delete(cacheKey);
  };
  void actual.then(settled, settled).catch(() => {});
  return observed;
}

if (typeof window !== "undefined")
  window.addEventListener("pagehide", disposePreparedBackgroundEffects);

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
