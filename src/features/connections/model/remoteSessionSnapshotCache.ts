import { canCacheRemoteSnapshot } from "./remoteHistoryGeneration";
import { snapshotWeight } from "./snapshotWeight";
import { writeRemotePageCache } from "./remotePageCache";
import { resetRemoteModelCatalogCacheForTests } from "./useRemoteModelCatalog";
import {
  REMOTE_PROVIDERS,
  requireHostDescriptor,
  type HostDescriptor,
  type HostSession,
} from "./protocol";
import { loadRemoteSession, remoteRequest } from "./connections";
import { boundedSet } from "../../../shared/lib/store";

const noop = () => {};
export const cachedSessionSnapshots = new Map<string, HostSession>();
export const cachedDescriptors = new Map<string, HostDescriptor>();
export const snapshotKey = (machineId: string, sessionId: string) => `${machineId}:${sessionId}`;
export function rememberSessionSnapshot(
  key: string,
  snapshot: HostSession,
  environmentId?: string,
) {
  const existing = cachedSessionSnapshots.get(key);
  if (existing === snapshot) return;
  if (!canCacheRemoteSnapshot(snapshot)) return;
  if (existing && existing.revision > snapshot.revision) return;
  cachedSessionSnapshots.delete(key);
  cachedSessionSnapshots.set(key, snapshot);
  if (cachedSessionSnapshots.size > 8)
    cachedSessionSnapshots.delete(cachedSessionSnapshots.keys().next().value!);
  let bytes = 0;
  for (const value of [...cachedSessionSnapshots.values()].reverse()) {
    bytes += snapshotWeight(value);
    if (bytes > 32 * 1024 * 1024) {
      for (const [entryKey, entry] of cachedSessionSnapshots)
        if (entry === value) cachedSessionSnapshots.delete(entryKey);
    }
  }
  if (environmentId)
    void writeRemotePageCache({ environmentId, sessionId: snapshot.session.id }, snapshot).catch(
      () => {
        // The page cache is best-effort: a failed write only means the next open reads the host.
      },
    );
}

/** Isolate UI harnesses that intentionally reuse machine/session identifiers. */
export function resetRemoteSessionCachesForTests() {
  cachedSessionSnapshots.clear();
  cachedDescriptors.clear();
  resetRemoteModelCatalogCacheForTests();
}

/** Fetches a host conversation into the snapshot cache, so its tab opens with
 * the transcript already laid out, as a local session read from disk does. */
export async function preloadRemoteSession(machineId: string, sessionId: string): Promise<void> {
  const key = snapshotKey(machineId, sessionId);
  if (cachedSessionSnapshots.has(key)) return;
  let host = cachedDescriptors.get(machineId);
  if (!host) {
    host = requireHostDescriptor(
      await remoteRequest<HostDescriptor>(machineId, "environment.describe", {
        supportedProviders: REMOTE_PROVIDERS,
      }),
    );
    boundedSet(cachedDescriptors, machineId, host);
  }
  const lazyHistory = host.capabilities.includes("sessions.lazyHistory");
  const pages = lazyHistory || host.capabilities.includes("sessions.pages");
  const snapshot = await loadRemoteSession(machineId, sessionId, undefined, {
    pages,
    partialHistory: lazyHistory,
    ...(pages ? { onPreviews: noop } : {}),
  });
  rememberSessionSnapshot(key, snapshot, host.environmentId);
}
