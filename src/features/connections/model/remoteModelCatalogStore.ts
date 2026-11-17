import type { HostModelCatalog } from "./protocol";

/** Last good model catalog per scope key. Disposable: a restart or slow link
 * shows it until the Host answers. Writes are coalesced and budgeted. */
export const REMOTE_MODEL_CATALOG_STORAGE_KEY = "bycoda.remote-models.v1";
export const REMOTE_MODEL_CATALOG_ENTRIES = 32;
export const REMOTE_MODEL_CATALOG_BYTES = 512 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isObjectArray = (value: unknown) => Array.isArray(value) && value.every(isRecord);

/** Trust-boundary parse for Host snapshots and persisted values; throws on malformed data. */
export function parseHostModelCatalog(data: unknown): HostModelCatalog {
  if (!isRecord(data)) throw new Error("Malformed model catalog");
  const { models, errors, pending, accounts } = data;
  if (!isRecord(models) || !Object.values(models).every(isObjectArray))
    throw new Error("Malformed model catalog models");
  if (!isRecord(errors) || !Object.values(errors).every((entry) => typeof entry === "string"))
    throw new Error("Malformed model catalog errors");
  if (
    pending !== undefined &&
    (!Array.isArray(pending) || !pending.every((entry) => typeof entry === "string"))
  )
    throw new Error("Malformed model catalog pending");
  if (accounts !== undefined) {
    if (
      !isRecord(accounts) ||
      !Object.values(accounts).every(
        (list) =>
          list === undefined ||
          (Array.isArray(list) &&
            list.every(
              (account) =>
                isRecord(account) &&
                typeof account.id === "string" &&
                typeof account.label === "string",
            )),
      )
    )
      throw new Error("Malformed model catalog accounts");
  }
  return data as unknown as HostModelCatalog;
}

let entries: Map<string, HostModelCatalog> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function load(): Map<string, HostModelCatalog> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = localStorage.getItem(REMOTE_MODEL_CATALOG_STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : undefined;
    if (isRecord(stored))
      for (const [key, value] of Object.entries(stored)) {
        try {
          entries.set(key, parseHostModelCatalog(value));
        } catch {
          /* drop one malformed entry */
        }
      }
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return entries;
}

function flush() {
  flushTimer = undefined;
  if (!entries) return;
  try {
    let text = JSON.stringify(Object.fromEntries(entries));
    // Evict oldest entries until the serialized value fits the budget.
    while (text.length * 2 > REMOTE_MODEL_CATALOG_BYTES && entries.size > 1) {
      entries.delete(entries.keys().next().value!);
      text = JSON.stringify(Object.fromEntries(entries));
    }
    localStorage.setItem(REMOTE_MODEL_CATALOG_STORAGE_KEY, text);
  } catch {
    /* cache is disposable */
  }
}

/** The persisted catalog of one scope, or undefined. Never throws. */
export function readPersistedModelCatalog(key: string): HostModelCatalog | undefined {
  return load().get(key);
}

/** Remember a catalog for this scope; the storage write is coalesced. */
export function persistModelCatalog(key: string, catalog: HostModelCatalog): void {
  const map = load();
  map.delete(key);
  map.set(key, catalog);
  while (map.size > REMOTE_MODEL_CATALOG_ENTRIES) map.delete(map.keys().next().value!);
  flushTimer ??= setTimeout(flush, 0);
}

/** Isolate tests: drop memory state and the stored value. */
export function resetRemoteModelCatalogStoreForTests() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  entries = undefined;
  try {
    localStorage.removeItem(REMOTE_MODEL_CATALOG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Force the coalesced write now (tests). */
export function flushRemoteModelCatalogStoreForTests() {
  clearTimeout(flushTimer);
  flush();
}

/** Drop in-memory state so the next read re-reads storage (tests simulating a restart). */
export function reloadRemoteModelCatalogStoreForTests() {
  flushRemoteModelCatalogStoreForTests();
  entries = undefined;
}
