import { getAllWindows } from "@tauri-apps/api/window";
import { sweepEmptyAttachmentLedgers } from "./attachmentOwnership";
import type { RemoteQueue } from "./remoteQueue";

const V1 = "bycoda:shared-queue:v1:";
const V2 = "bycoda:shared-queue:v2:";
const SEND = ":send";
const INSTANCE_PREFIX = "bycoda:desktop-instance:v1:";

export const STORAGE_FULL_MESSAGE =
  "This device's local storage is full. Old queue records were cleaned up but there is still no room; the message stays queued.";

export const isQuotaError = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  ((error as { name?: string }).name === "QuotaExceededError" ||
    (error as { name?: string }).name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (error as { code?: number }).code === 22);

/** The sessions this window serves and the id of its own queue client, for the sweep. */
let known: { hasSession: (id: string) => boolean; clientId: string } | undefined;
export function setQueueStorageOwner(owner: typeof known): void {
  known = owner;
}
/** Desktop instance ids of the windows that are open now; unknown until first looked up. */
let liveInstances: Set<string> | undefined;
export async function refreshLiveDesktopInstances(ownId: string): Promise<void> {
  try {
    const ids = new Set<string>([ownId.replace(/^desktop:/, "")]);
    for (const window of await getAllWindows()) {
      const id = localStorage.getItem(INSTANCE_PREFIX + window.label);
      if (id) ids.add(id);
    }
    liveInstances = ids;
  } catch {
    // Unknown: only records with nothing to lose are swept.
  }
}

type SavedQueue = { base?: RemoteQueue; desired?: RemoteQueue; takeOwnership?: boolean };
const parse = (raw: string | null): SavedQueue | undefined => {
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as SavedQueue;
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
};
const hasMessages = (record: SavedQueue) =>
  !!record.base?.messages?.length || !!record.desired?.messages?.length;
/** Nothing in the record exists only here: the host (or the journal-free state) holds it all. */
function clean(record: SavedQueue): boolean {
  if (record.takeOwnership) return false;
  const edited = (queue?: RemoteQueue) =>
    JSON.stringify([queue?.messages ?? [], queue?.status, queue?.editingId]);
  return edited(record.base) === edited(record.desired);
}

/**
 * Removes saved shared-queue records nothing needs. A record is kept while it has
 * an unsettled send journal, an edit not yet written to the host, or belongs to a
 * queue this window serves right now. Everything it drops is either empty or a copy
 * of what the host holds, so a window that needs it reads the host again.
 */
export function sweepQueueStorage(keep?: string): number {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(V1) || key?.startsWith(V2)) keys.push(key);
  }
  const own = known?.clientId;
  let removed = 0;
  for (const key of keys) {
    if (key.endsWith(SEND) || key.endsWith(":adopted") || key === keep) continue;
    const v1 = key.startsWith(V1);
    let tuple: unknown;
    try {
      tuple = JSON.parse(key.slice((v1 ? V1 : V2).length));
    } catch {
      continue;
    }
    if (!Array.isArray(tuple)) continue;
    const owner = String(tuple[2] ?? "");
    if (v1 && owner !== "desktop") continue; // other computers' clients keep their own key
    if (v1 && localStorage.getItem(`${key}:adopted`) !== null) {
      // A window already copied this record and its journal into its own keys.
      for (const suffix of ["", SEND, ":adopted"]) localStorage.removeItem(key + suffix);
      removed++;
      continue;
    }
    if (localStorage.getItem(key + SEND) !== null) continue; // unsettled send: never
    const raw = localStorage.getItem(key);
    const record = parse(raw);
    // An unreadable record is dropped only when it has no journal (checked above).
    const droppable = !record
      ? true
      : !clean(record)
        ? false
        : !hasMessages(record) ||
          (!v1 &&
            owner !== own &&
            !!liveInstances &&
            !liveInstances.has(owner.replace(/^desktop:/, ""))) ||
          (!v1 && owner === own && !!known && !known.hasSession(String(tuple[1])));
    if (!droppable) continue;
    localStorage.removeItem(key);
    removed++;
  }
  return removed + sweepEmptyAttachmentLedgers();
}

/** Every shared-queue write goes through here: a full store is cleaned once, then retried. */
export function writeQueueStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  try {
    sweepQueueStorage(key);
    localStorage.setItem(key, value);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const full = new Error(STORAGE_FULL_MESSAGE, { cause: error });
    full.name = "QuotaExceededError";
    throw full;
  }
}
