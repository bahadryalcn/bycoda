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
import {
  cachedRemoteCapabilities,
  loadRemoteSession,
  REMOTE_CAPABILITIES_TTL_MS,
  remoteRequest,
} from "./connections";
import {
  listRemoteConnections,
  readRemoteConnection,
  subscribeChanges,
  subscribeRemoteRecovered,
} from "./remoteHealth";
import {
  captureConnectionGeneration,
  environmentForMachine,
  readRemoteLifecycle,
  subscribeConnectionInvalidated,
} from "./remoteLifecycle";
import { boundedSet } from "../../../shared/lib/store";

export const cachedSessionSnapshots = new Map<string, HostSession>();
export const cachedDescriptors = new Map<string, HostDescriptor>();
/** False while the machine's descriptor is not cached yet, so callers use the safe full read. */
export const machineSupportsLazyHistory = (machineId: string) =>
  !!cachedDescriptors.get(machineId)?.capabilities.includes("sessions.lazyHistory");

/** The connection state an `environment.describe` was asked under. */
export type DescriptorValidation = {
  environmentId: string;
  generation: number;
  epoch: number;
  capabilities: string[] | undefined;
};
type ValidatedDescriptor = DescriptorValidation & { descriptor: HostDescriptor; expiresAt: number };
const validatedDescriptors = new Map<string, ValidatedDescriptor>();
/** Bumped by every outage, recovery or failed read, so an answer in flight cannot be trusted. */
const validationEpochs = new Map<string, number>();
/** A recovery that names no machine applies to environments with no epoch of their own yet. */
let allEnvironmentsEpoch = 0;
const validationEpoch = (environmentId: string) =>
  allEnvironmentsEpoch + (validationEpochs.get(environmentId) ?? 0);
let watchingConnections = false;

/** Ends trust in what this environment's Host last proved; the next open describes it again. */
export function invalidateValidatedDescriptors(environmentId?: string) {
  if (!environmentId) {
    allEnvironmentsEpoch++;
    validatedDescriptors.clear();
    return;
  }
  validationEpochs.set(environmentId, (validationEpochs.get(environmentId) ?? 0) + 1);
  for (const [machineId, entry] of validatedDescriptors)
    if (entry.environmentId === environmentId) validatedDescriptors.delete(machineId);
}

function watchConnections() {
  if (watchingConnections) return;
  watchingConnections = true;
  subscribeChanges(() => {
    for (const [environmentId, state] of listRemoteConnections())
      if (state.status !== "connected") invalidateValidatedDescriptors(environmentId);
  });
  subscribeRemoteRecovered(invalidateValidatedDescriptors);
  subscribeConnectionInvalidated(invalidateValidatedDescriptors);
}

/** Call before asking the Host, so anything that happens during the request voids its answer. */
export function captureDescriptorValidation(environmentId: string): DescriptorValidation {
  watchConnections();
  return {
    environmentId,
    generation: captureConnectionGeneration(environmentId),
    epoch: validationEpoch(environmentId),
    capabilities: cachedRemoteCapabilities(environmentId),
  };
}

const validationIsCurrent = (validation: DescriptorValidation) =>
  validation.generation === readRemoteLifecycle(validation.environmentId).generation &&
  validation.epoch === validationEpoch(validation.environmentId) &&
  // The shared store keeps one array until the Host advertises something different.
  validation.capabilities === cachedRemoteCapabilities(validation.environmentId) &&
  readRemoteConnection(validation.environmentId).status === "connected";

/** Stores a descriptor whose identity the caller checked against `validation.environmentId`. */
export function rememberValidatedDescriptor(
  machineId: string,
  validation: DescriptorValidation,
  descriptor: HostDescriptor,
) {
  boundedSet(cachedDescriptors, machineId, descriptor);
  if (descriptor.environmentId === validation.environmentId && validationIsCurrent(validation))
    boundedSet(validatedDescriptors, machineId, {
      ...validation,
      descriptor,
      // Providers can change without changing the advertised RPC capabilities.
      expiresAt: Date.now() + REMOTE_CAPABILITIES_TTL_MS,
    });
  else validatedDescriptors.delete(machineId);
}

/** The descriptor this Host proved on the current connection, if it can still be trusted.
 * Requests stay fenced by their own expected environment; this only skips the repeat describe. */
export function validatedDescriptor(
  machineId: string,
  environmentId: string,
): HostDescriptor | undefined {
  const entry = validatedDescriptors.get(machineId);
  if (!entry) return undefined;
  if (
    entry.environmentId === environmentId &&
    Date.now() < entry.expiresAt &&
    entry.descriptor.environmentId === environmentId &&
    entry.descriptor === cachedDescriptors.get(machineId) &&
    validationIsCurrent(entry)
  )
    return entry.descriptor;
  validatedDescriptors.delete(machineId);
  return undefined;
}

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
  validatedDescriptors.clear();
  validationEpochs.clear();
  resetRemoteModelCatalogCacheForTests();
}

/** Fetches a host conversation into the snapshot cache, so its tab opens with
 * the transcript already laid out, as a local session read from disk does. */
export async function preloadRemoteSession(machineId: string, sessionId: string): Promise<void> {
  const key = snapshotKey(machineId, sessionId);
  if (cachedSessionSnapshots.has(key)) return;
  const environmentId = environmentForMachine(machineId);
  let host = environmentId ? validatedDescriptor(machineId, environmentId) : undefined;
  if (!host) {
    const validation = environmentId ? captureDescriptorValidation(environmentId) : undefined;
    host = requireHostDescriptor(
      await remoteRequest<HostDescriptor>(machineId, "environment.describe", {
        supportedProviders: REMOTE_PROVIDERS,
      }),
    );
    if (environmentId && host.environmentId !== environmentId)
      throw Object.assign(
        new Error("Host identity changed. Reconnect this machine before continuing."),
        { code: "RPC_WS_IDENTITY" },
      );
    if (validation) rememberValidatedDescriptor(machineId, validation, host);
    else boundedSet(cachedDescriptors, machineId, host);
  }
  const lazyHistory = host.capabilities.includes("sessions.lazyHistory");
  const pages = lazyHistory || host.capabilities.includes("sessions.pages");
  const snapshot = await loadRemoteSession(machineId, sessionId, undefined, {
    pages,
    partialHistory: lazyHistory,
    deferPreviews: true,
  });
  rememberSessionSnapshot(key, snapshot, host.environmentId);
}
