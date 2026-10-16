import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteDataState } from "./remoteDataState";
import {
  applySessionSync,
  type HostSession,
  type HostSessionSummary,
  type RemoteMachine,
  type SessionSync,
  type SessionSyncChunk,
  type SessionSyncResponse,
} from "./protocol";
import { subscribeRemoteMachineChannel } from "./remoteMachineChannel";
import { remoteProjectFor } from "./remoteProjects";
import type { RemoteRailSession } from "./remoteRailSessions";
import { blocksSending } from "./remoteConnection";
import {
  notifyRemoteRecovered,
  readRemoteConnection,
  recordRemoteConnection,
  resetRemoteConnection,
} from "./remoteHealth";
import { loadRemoteAutoReconnect } from "../../settings/model/settings";
import {
  bindRemoteAttachmentReaders,
  withRemoteAttachmentPreviews,
} from "./remoteAttachmentPreviews";
import { RemoteSessionLists } from "./remoteSessionLists";
import { remoteBackoffDelay } from "./remotePollingPolicy";
import { startRailPoller } from "./remoteRailPoller";
import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";
import { queueRemoteSummaryCache } from "./remoteSummaryCache";
import { deleteRemotePageCache } from "./remotePageCache";
import { isLocalSyncMachine } from "./localSync";
import {
  localHostSessionAccess,
  remoteHostSessionAccess,
  type HostSessionRequest,
  type SessionAccess,
} from "./sessionAccess";

const CHANGE = "bycoda:remote-machines";
export const REMOTE_HISTORY_CHANGE = "bycoda:remote-history";
export const REMOTE_HISTORY_UPDATED = "bycoda:remote-history-updated";
export const refreshRemoteProjectSessions = () =>
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
let cachedMachines: RemoteMachine[] = [];
let machinesLoaded = false;
export const OPEN_CONNECTIONS_EVENT = "bycoda:open-connections";
export const OPEN_REMOTE_PROJECT_EVENT = "bycoda:open-remote-project";
export const refreshRemoteMachines = () => window.dispatchEvent(new Event(CHANGE));
const RECONNECT = "bycoda:reconnect-machine";
let reconnectRequest: string | undefined;

/** Opens Connections settings and starts reconnecting this machine there, where
 * the SSH password and host-key prompts are answered. */
export function requestMachineReconnect(machineId: string) {
  reconnectRequest = machineId;
  window.dispatchEvent(new Event(RECONNECT));
  window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
}

/** The machine a view asked to reconnect, once, if it is one of `machines`. */
export function takeReconnectRequest(machines: RemoteMachine[]): RemoteMachine | undefined {
  const machine = machines.find((entry) => entry.id === reconnectRequest);
  if (machine) reconnectRequest = undefined;
  return machine;
}

export function subscribeReconnectRequests(listener: () => void): () => void {
  window.addEventListener(RECONNECT, listener);
  return () => window.removeEventListener(RECONNECT, listener);
}

const EDIT = "bycoda:edit-machine";
let editRequest: string | undefined;

/** Opens Connections settings with this machine's definition ready to edit. */
export function requestMachineEdit(machineId: string) {
  editRequest = machineId;
  window.dispatchEvent(new Event(EDIT));
  window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
}

/** The machine a view asked to edit, once, if it is one of `machines`. */
export function takeEditRequest(machines: RemoteMachine[]): RemoteMachine | undefined {
  const machine = machines.find((entry) => entry.id === editRequest);
  if (machine) editRequest = undefined;
  return machine;
}

export function subscribeEditRequests(listener: () => void): () => void {
  window.addEventListener(EDIT, listener);
  return () => window.removeEventListener(EDIT, listener);
}

const capabilitiesByEnvironment = new Map<string, string[]>();
const capabilityListeners = new Set<() => void>();
const capabilityLookups = new Map<string, Promise<string[] | undefined>>();
const capabilityFetchedAt = new Map<string, number>();
/** An `environment.describe` answer this young is reused; the machine status
 * watcher refreshes it every 15 s anyway. */
export const REMOTE_CAPABILITIES_TTL_MS = 20_000;

/** Forces the next `loadRemoteCapabilities` to ask the machine again, for a
 * machine that was edited, reconnected or removed. The last answer stays
 * readable through `cachedRemoteCapabilities`. */
export function invalidateRemoteCapabilities(environmentId: string) {
  capabilityFetchedAt.delete(environmentId);
}

/** What a machine's host last advertised in `environment.describe`. */
export function cachedRemoteCapabilities(environmentId: string): string[] | undefined {
  return capabilitiesByEnvironment.get(environmentId);
}

export function subscribeRemoteCapabilities(listener: () => void): () => void {
  capabilityListeners.add(listener);
  return () => capabilityListeners.delete(listener);
}

export function recordRemoteCapabilities(environmentId: string, advertised: unknown) {
  const next = Array.isArray(advertised)
    ? advertised.filter((entry): entry is string => typeof entry === "string")
    : [];
  capabilityFetchedAt.set(environmentId, Date.now());
  const previous = capabilitiesByEnvironment.get(environmentId);
  if (previous?.length === next.length && previous.every((entry, i) => entry === next[i])) return;
  capabilitiesByEnvironment.set(environmentId, next);
  capabilityListeners.forEach((listener) => listener());
}

/** Asks a machine for its capabilities, to learn whether its host is new enough. */
export function loadRemoteCapabilities(environmentId: string): Promise<string[] | undefined> {
  const fetchedAt = capabilityFetchedAt.get(environmentId);
  if (fetchedAt !== undefined && Date.now() - fetchedAt < REMOTE_CAPABILITIES_TTL_MS)
    return Promise.resolve(cachedRemoteCapabilities(environmentId));
  const pending = capabilityLookups.get(environmentId);
  if (pending) return pending;
  const lookup = (async () => {
    const machine = await remoteMachineFor(environmentId);
    if (!machine) return undefined;
    const host = await remoteRequest<{ capabilities?: unknown }>(
      machine.id,
      "environment.describe",
    );
    recordRemoteCapabilities(environmentId, host.capabilities);
    return cachedRemoteCapabilities(environmentId);
  })().finally(() => capabilityLookups.delete(environmentId));
  capabilityLookups.set(environmentId, lookup);
  return lookup;
}
const TAB_KEY = "bycoda.remote-tabs.v2";
export const REMOTE_TAB_BINDING_CHANGE = "bycoda:remote-tab-binding";
const WORKTREE_KEY = "bycoda.remote-pending-worktrees.v1";

export function remotePendingWorktree(shellId: string): string | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(WORKTREE_KEY) ?? "{}")[shellId];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The host checkout currently used by a remote tab. */
export function remoteTabCwd(project: string, shellId?: string): string | undefined {
  if (!shellId) return undefined;
  const sessionId = remoteSessionFor(shellId);
  return (
    (sessionId ? cachedRemoteSessionSummary(project, sessionId)?.cwd : undefined) ??
    remotePendingWorktree(shellId)
  );
}

export function rememberRemotePendingWorktree(shellId: string, path?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(WORKTREE_KEY) ?? "{}");
    if (path) all[shellId] = path;
    else delete all[shellId];
    localStorage.setItem(WORKTREE_KEY, JSON.stringify(all));
  } catch {
    /* selection is restored from the host once a session exists */
  }
}

/** The host session a tab in a remote project shows; none for a new session. */
export function remoteSessionFor(shellId: string): string | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(TAB_KEY) ?? "{}")[shellId];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
export function rememberRemoteSession(shellId: string, sessionId?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TAB_KEY) ?? "{}");
    if (sessionId) all[shellId] = sessionId;
    else delete all[shellId];
    localStorage.setItem(TAB_KEY, JSON.stringify(all));
  } catch {
    /* tab selection is best effort */
  }
  window.dispatchEvent(new Event(REMOTE_HISTORY_CHANGE));
  window.dispatchEvent(new Event(REMOTE_TAB_BINDING_CHANGE));
}

export {
  pendingRemoteCommand,
  pendingRemoteFollowup,
  savePendingRemoteCommand,
  clearPendingRemoteCommand,
} from "./remoteOutbox";

/** Whether a request may start a missing SSH tunnel. Always, unless the user
 * turned automatic reconnecting off: then only what the user did (`fresh`, or
 * `userInitiated`) may reconnect a machine already known to be down, and
 * background polls fail fast instead. A machine not known to be down (nothing
 * has failed yet, such as at startup) is still connected on first use. */
export function mayStartTunnel(machineId: string, fresh: boolean, userInitiated: boolean): boolean {
  if (fresh || userInitiated || loadRemoteAutoReconnect()) return true;
  const environmentId = cachedMachines.find((entry) => entry.id === machineId)?.environmentId;
  return !environmentId || !blocksSending(readRemoteConnection(environmentId).status);
}

/** `fresh` makes a dropped SSH tunnel be restarted now instead of answering
 * with the error of an attempt that failed moments ago; for a reconnect the
 * user asked for. `userInitiated` marks a request that exists because the user
 * acted (sending, opening a project), as opposed to a background poll. */
export function remoteRequest<T>(
  machineId: string,
  method: string,
  params: unknown = {},
  fresh = false,
  userInitiated = false,
): Promise<T> {
  return invoke<T>("remote_request", {
    machineId,
    method,
    params,
    ...(fresh ? { fresh } : {}),
    ...(mayStartTunnel(machineId, fresh, userInitiated) ? {} : { allowConnect: false }),
  });
}

const pendingSessionSyncs = new Map<string, Promise<SessionSync>>();
const pendingSessionPages = new Map<
  string,
  Promise<{
    sync: SessionSyncResponse;
    before?: number;
    totalBlocks: number;
    revision: number;
    value: HostSession;
  }>
>();
export function resetRemoteSessionReadsForTests(): void {
  pendingSessionSyncs.clear();
  pendingSessionPages.clear();
}
function sharedRead<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 64)
    return Promise.reject(new Error("Too many remote reads are already in progress"));
  const operation: Promise<T> = read().finally(() => {
    if (pending.get(key) === operation) pending.delete(key);
  });
  pending.set(key, operation);
  return operation;
}

/** Owner-routed API for reads and writes to the machine that owns the session. */
export function sessionAccessForMachine(
  machineId: string,
  fresh = false,
  userInitiated = false,
): SessionAccess {
  const machine = cachedMachines.find((entry) => entry.id === machineId);
  const kind = machine && isLocalSyncMachine(machine) ? "local" : "remote";
  const request: HostSessionRequest = async <T>(method: string, params: unknown) => {
    const result = await remoteRequest<T>(machineId, method, params, fresh, userInitiated);
    if (
      method === "sessions.delete" &&
      machine?.environmentId &&
      params &&
      typeof params === "object" &&
      "sessionId" in params &&
      typeof params.sessionId === "string"
    )
      void deleteRemotePageCache({
        environmentId: machine.environmentId,
        sessionId: params.sessionId,
      });
    return result;
  };
  return kind === "local" ? localHostSessionAccess(request) : remoteHostSessionAccess(request);
}

/** Reads one sync, assembling it from bounded pieces when the host chunks it. */
async function syncRemoteSession(
  machineId: string,
  sessionId: string,
  revision?: number,
  waitMs = 0,
  known?: HostSession,
): Promise<SessionSync> {
  const done = startPerformanceSpan("remote-sync");
  try {
    const loaded = known?.session.blocks;
    const key = JSON.stringify([
      machineId,
      sessionId,
      revision,
      known?.history?.before,
      loaded?.map((block) => block.id),
    ]);
    return sharedRead(pendingSessionSyncs, key, async () => {
      const response = await sessionAccessForMachine(machineId).sync(sessionId, {
        revision,
        waitMs,
        ...(known?.history
          ? {
              partial: true,
              loadedBlockIds: [...new Set((loaded ?? []).map((block) => block.id))],
              windowStart: known.history.before,
            }
          : {}),
      });
      return assembleSessionSync(machineId, sessionId, response);
    });
  } finally {
    done();
  }
}

async function assembleSessionSync(
  machineId: string,
  sessionId: string,
  response: SessionSyncResponse,
): Promise<SessionSync> {
  if (response.kind !== "chunked") return response;
  const maxTransferUnits = 32 * 1024 * 1024;
  if (
    !Number.isSafeInteger(response.length) ||
    response.length <= 0 ||
    response.length > maxTransferUnits
  )
    throw new Error("Session transfer exceeds the client safety limit");
  const pieces: string[] = [];
  let offset = 0;
  while (offset < response.length) {
    const { data } = await remoteRequest<SessionSyncChunk>(machineId, "sessions.syncChunk", {
      sessionId,
      transfer: response.transfer,
      offset,
    });
    if (typeof data !== "string" || data.length === 0 || data.length > response.length - offset)
      throw new Error("Session transfer returned an invalid chunk");
    pieces.push(data);
    offset += data.length;
  }
  if (offset !== response.length) throw new Error("Session transfer has an unexpected length");
  const payload = pieces.join("");
  const decodeDone = startPerformanceSpan("remote-decode", {
    units: payload.length,
  });
  try {
    const decoded = JSON.parse(payload) as SessionSync;
    decodeDone({ units: payload.length });
    return decoded;
  } catch (error) {
    decodeDone();
    throw error;
  }
}

function applyRemoteSessionSync(base: HostSession | undefined, update: SessionSync): HostSession {
  const blocks =
    update.kind === "snapshot"
      ? update.value.session.blocks.length
      : update.kind === "delta"
        ? update.blockIds.length
        : 0;
  const done = startPerformanceSpan("remote-apply", { blocks });
  try {
    const result = applySessionSync(base, update);
    done({ blocks: result.session.blocks.length });
    return result;
  } catch (error) {
    done();
    throw error;
  }
}

/** Fetches only what changed since `known`; falls back to a full snapshot. */
export async function loadRemoteSession(
  machineId: string,
  sessionId: string,
  known?: HostSession,
  options: {
    waitMs?: number;
    onPreviews?: (snapshot: HostSession) => void;
    pages?: boolean;
    partialHistory?: boolean;
    onHistory?: (snapshot: HostSession) => void;
    isCurrent?: () => boolean;
    onHistoryError?: (error: unknown) => void;
  } = {},
): Promise<HostSession> {
  if (known?.historyLoading) return known;
  // Hosts without sessions.lazyHistory cannot safely interpret a partial
  // sync. Refresh their bounded tail page instead of requesting a full history
  // snapshot (or sending ignored partial parameters).
  if (known?.history && !options.partialHistory) {
    const tail = await readRemoteSessionPage(machineId, sessionId);
    if (tail.revision === known.revision) return known;
    return {
      ...tail.value,
      history: {
        before: tail.before,
        revision: tail.revision,
        totalBlocks: tail.totalBlocks,
      },
    };
  }
  if (!known && options.pages) {
    const page = await readRemoteSessionPage(machineId, sessionId);
    const snapshot = {
      ...page.value,
      history: {
        before: page.before,
        revision: page.revision,
        totalBlocks: page.totalBlocks,
      },
    };
    if (options.onPreviews)
      setTimeout(() => {
        if (!(options.isCurrent?.() ?? true)) return;
        void withRemoteAttachmentPreviews(machineId, snapshot, undefined, (params) =>
          remoteRequest(machineId, "attachments.read", params),
        )
          .then(options.onPreviews)
          .catch((error) => {
            console.warn("connections operation failed", error);
          });
      }, 0);
    return snapshot;
  }
  const sync = (revision?: number, base?: HostSession) =>
    syncRemoteSession(
      machineId,
      sessionId,
      revision,
      revision === undefined ? 0 : options.waitMs,
      options.partialHistory ? base : undefined,
    );
  const update = await sync(known?.revision, known);
  let snapshot: HostSession;
  try {
    snapshot = applyRemoteSessionSync(known, update);
  } catch {
    if (known?.history) {
      const tail = await readRemoteSessionPage(machineId, sessionId);
      snapshot = {
        ...tail.value,
        history: {
          before: tail.before,
          revision: tail.revision,
          totalBlocks: tail.totalBlocks,
        },
      };
    } else snapshot = applyRemoteSessionSync(undefined, await sync(undefined, undefined));
  }
  snapshot = bindRemoteAttachmentReaders(machineId, snapshot, (params) =>
    remoteRequest(machineId, "attachments.read", params),
  );
  if (options.onPreviews) {
    void withRemoteAttachmentPreviews(machineId, snapshot, known, (params) =>
      remoteRequest(machineId, "attachments.read", params),
    )
      .then(options.onPreviews)
      .catch((error) => {
        console.warn("connections operation failed", error);
      });
    return snapshot;
  }
  // Adopted-session and preload consumers receive one complete snapshot and
  // have no callback through which independently downloaded images can arrive.
  return withRemoteAttachmentPreviews(machineId, snapshot, known, (params) =>
    remoteRequest(machineId, "attachments.read", params),
  );
}

async function readRemoteSessionPage(
  machineId: string,
  sessionId: string,
  before?: number,
  revision?: number,
) {
  const key = JSON.stringify([machineId, sessionId, before, revision]);
  return sharedRead(pendingSessionPages, key, async () => {
    const done = startPerformanceSpan(before === undefined ? "remote-tail" : "remote-history");
    try {
      const page = await sessionAccessForMachine(machineId).page(sessionId, before, revision);
      const raw = applyRemoteSessionSync(
        undefined,
        await assembleSessionSync(machineId, sessionId, page.sync),
      );
      const value = bindRemoteAttachmentReaders(machineId, raw, (params) =>
        remoteRequest(machineId, "attachments.read", params),
      );
      done({ blocks: value.session.blocks.length, revision: page.revision });
      return { ...page, value };
    } catch (error) {
      done();
      throw error;
    }
  });
}

/** Fetch the complete contents of one large block after its bounded preview. */
export async function loadRemoteBlock(
  machineId: string,
  sessionId: string,
  blockId: string,
  revision: number,
) {
  const response = await sessionAccessForMachine(machineId).block(sessionId, blockId, revision);
  const sync = await assembleSessionSync(machineId, sessionId, response);
  if (sync.kind !== "snapshot" || sync.value.revision !== revision) return undefined;
  const bound = bindRemoteAttachmentReaders(machineId, sync.value, (params) =>
    remoteRequest(machineId, "attachments.read", params),
  );
  const block = bound.session.blocks.find((entry) => entry.id === blockId);
  return block?.remoteContent ? undefined : block;
}

/** Load one explicitly requested older page. A page pinned to an old revision is discarded. */
export async function loadRemoteHistoryPage(
  machineId: string,
  sessionId: string,
  current: HostSession,
  isCurrent: () => boolean = () => true,
): Promise<HostSession | undefined> {
  const cursor = current.history;
  if (cursor?.before === undefined) return current;
  const page = await readRemoteSessionPage(machineId, sessionId, cursor.before, cursor.revision);
  if (!isCurrent() || page.revision !== current.revision || cursor.revision !== current.revision)
    return undefined;
  if (page.before !== undefined && page.before >= cursor.before)
    throw new Error("History cursor did not advance");
  const live = new Map(current.session.blocks.map((block) => [block.id, block]));
  const older = page.value.session.blocks.filter((block) => !live.has(block.id));
  return {
    ...current,
    history: {
      before: page.before,
      revision: current.revision,
      totalBlocks: page.totalBlocks,
    },
    session: {
      ...current.session,
      blocks: [...older, ...current.session.blocks],
    },
  };
}

/** The connected machine for an environment, from the last machine list read. */
export function knownRemoteMachine(environmentId: string): RemoteMachine | undefined {
  return cachedMachines.find((entry) => entry.environmentId === environmentId);
}

/** The connected machine for an environment, reading the list when needed. */
export async function remoteMachineFor(environmentId: string): Promise<RemoteMachine | undefined> {
  const known = knownRemoteMachine(environmentId);
  if (known || machinesLoaded) return known;
  const value = await invoke<RemoteMachine[]>("remote_machines");
  cachedMachines = Array.isArray(value) ? value : [];
  machinesLoaded = true;
  return knownRemoteMachine(environmentId);
}

export async function connectMachine(
  name: string,
  url: string,
  token: string,
): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine>("remote_connect", {
    name,
    url,
    token,
  });
  cachedMachines = [...cachedMachines.filter((entry) => entry.id !== machine.id), machine];
  invalidateRemoteCapabilities(machine.environmentId);
  machinesLoaded = true;
  window.dispatchEvent(new Event(CHANGE));
  return machine;
}

/** Saves a machine's new name or SSH address. Its id and environment id stay,
 * so every project on it keeps working. When the way in changed, the desktop
 * closes the old tunnel and the machine's connection status starts over. */
export async function updateMachine(
  machine: RemoteMachine,
  edit: {
    name: string;
    target: string;
    port: number | null;
    remotePort?: number;
    alternate?: string | null;
  },
  reconnect: boolean,
): Promise<RemoteMachine> {
  const saved = await invoke<RemoteMachine>("remote_machine_update", {
    machineId: machine.id,
    name: edit.name,
    target: edit.target,
    port: edit.port,
    remotePort: edit.remotePort ?? null,
    alternate: edit.alternate ?? null,
  });
  cachedMachines = cachedMachines.map((entry) => (entry.id === saved.id ? saved : entry));
  invalidateRemoteCapabilities(saved.environmentId);
  if (reconnect) {
    machineOnline.delete(saved.id);
    resetRemoteConnection(saved.environmentId);
  }
  window.dispatchEvent(new Event(CHANGE));
  return saved;
}

export async function disconnectMachine(machineId: string): Promise<void> {
  await invoke("remote_disconnect", { machineId });
  const environmentId = cachedMachines.find((entry) => entry.id === machineId)?.environmentId;
  if (environmentId) invalidateRemoteCapabilities(environmentId);
  cachedMachines = cachedMachines.filter((entry) => entry.id !== machineId);
  window.dispatchEvent(new Event(CHANGE));
}

export function useRemoteMachines(enabled = true): {
  machines: RemoteMachine[];
  loaded: boolean;
  loading: boolean;
  error?: string;
  refresh: () => void;
} {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refreshMachines = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const [state, setState] = useState<{
    machines: RemoteMachine[];
    loaded: boolean;
    loading: boolean;
    error?: string;
  }>({ machines: cachedMachines, loaded: machinesLoaded, loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let version = 0;
    const refresh = () => {
      const requestVersion = ++version;
      setState((previous) => ({ ...previous, loading: true }));
      void invoke<RemoteMachine[]>("remote_machines")
        .then((value) => {
          if (!disposed && requestVersion === version) {
            cachedMachines = Array.isArray(value) ? value : [];
            machinesLoaded = true;
            setState({
              machines: cachedMachines,
              loaded: true,
              loading: false,
            });
          }
        })
        .catch((reason) => {
          // A temporary connection failure should not blank every remote
          // panel while a fresh machine list is requested.
          if (!disposed && requestVersion === version)
            setState((previous) => ({
              ...previous,
              machines: cachedMachines,
              loading: false,
              error: String(reason).replace(/^Error: /, ""),
            }));
        });
    };
    refresh();
    window.addEventListener(CHANGE, refresh);
    return () => {
      disposed = true;
      window.removeEventListener(CHANGE, refresh);
    };
  }, [enabled, refreshVersion]);
  return { ...state, refresh: refreshMachines };
}

const STATUS = "bycoda:remote-machine-status";
const machineOnline = new Map<string, boolean>();
const statusWatchers = new Map<string, { count: number; timer?: ReturnType<typeof setTimeout> }>();

/** Records whether a machine answered its latest request, for every view
 * that shows its connection state. `error` is why it did not. */
export function reportRemoteMachineStatus(machineId: string, online: boolean, error?: unknown) {
  const environmentId = cachedMachines.find((entry) => entry.id === machineId)?.environmentId;
  if (environmentId)
    recordRemoteConnection(environmentId, online ? undefined : (error ?? "Machine is unreachable"));
  const wasOffline = machineOnline.get(machineId) === false;
  if (machineOnline.get(machineId) === online) return;
  machineOnline.set(machineId, online);
  window.dispatchEvent(new Event(STATUS));
  // Views that gave up on this machine reload as soon as it answers again.
  if (online && wasOffline) {
    if (environmentId) invalidateRemoteCapabilities(environmentId);
    notifyRemoteRecovered(environmentId);
  }
}

function watchMachineStatus(machineId: string): () => void {
  const existing = statusWatchers.get(machineId);
  if (existing) {
    existing.count++;
  } else {
    const watcher: { count: number; timer?: ReturnType<typeof setTimeout> } = {
      count: 1,
    };
    statusWatchers.set(machineId, watcher);
    let failures = 0;
    const poll = async () => {
      try {
        const host = await remoteRequest<{
          environmentId?: string;
          capabilities?: unknown;
        }>(machineId, "environment.describe");
        if (host?.environmentId) recordRemoteCapabilities(host.environmentId, host.capabilities);
        failures = 0;
        reportRemoteMachineStatus(machineId, true);
      } catch (reason) {
        failures = Math.min(4, failures + 1);
        reportRemoteMachineStatus(machineId, false, reason);
      }
      if (statusWatchers.get(machineId) === watcher)
        watcher.timer = setTimeout(
          () => void poll(),
          failures ? remoteBackoffDelay(failures) : 15_000,
        );
    };
    void poll();
  }
  return () => {
    const watcher = statusWatchers.get(machineId);
    if (!watcher || --watcher.count > 0) return;
    clearTimeout(watcher.timer);
    statusWatchers.delete(machineId);
  };
}

/** Whether a machine is reachable; undefined until the first check returns. */
export function useRemoteMachineOnline(machineId?: string): boolean | undefined {
  const [online, setOnline] = useState(() =>
    machineId ? machineOnline.get(machineId) : undefined,
  );
  useEffect(() => {
    if (!machineId) {
      setOnline(undefined);
      return;
    }
    const update = () => setOnline(machineOnline.get(machineId));
    update();
    window.addEventListener(STATUS, update);
    const unwatch = watchMachineStatus(machineId);
    return () => {
      window.removeEventListener(STATUS, update);
      unwatch();
    };
  }, [machineId]);
  return online;
}

const historyKey = (project: string) => `bycoda.remote-history.v2:${project}`;

function cachedSessions(project: string): HostSessionSummary[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey(project)) ?? "[]");
    return Array.isArray(value) ? (value as HostSessionSummary[]) : [];
  } catch {
    return [];
  }
}
export function cachedRemoteSessionSummary(project: string, sessionId: string) {
  return cachedSessions(project).find((session) => session.id === sessionId);
}

/** The last `sessions.list` answer per remote project, so the rail and the
 * open project's sidebar share one request instead of each asking. */
const sharedSessionLists = new RemoteSessionLists((machineId, projectId, known) => {
  const done = startPerformanceSpan("remote-list");
  return sessionAccessForMachine(machineId)
    .list(projectId, known)
    .then(
      (reply) => {
        done({
          sessions: Array.isArray(reply)
            ? reply.length
            : "sessions" in reply
              ? reply.sessions.length
              : 0,
        });
        return reply;
      },
      (error) => {
        done();
        throw error;
      },
    );
});
if (typeof window !== "undefined") {
  window.addEventListener(REMOTE_HISTORY_CHANGE, () => sharedSessionLists.invalidate());
  window.addEventListener(CHANGE, () => sharedSessionLists.invalidate());
}

export type RemoteProjectSessions = {
  /** Undefined when this machine is not connected on this computer. */
  machine?: RemoteMachine;
  sessions: HostSessionSummary[];
  loaded: boolean;
  /** Whether the list of machines has been read: until then `machine` is
   * undefined because it is not known yet, not because it is missing. */
  machinesLoaded: boolean;
  /** The machine did not answer and no list has arrived yet. */
  failed: boolean;
  dataState: RemoteDataState;
  refresh: () => void;
};

/** Lists a remote project's host sessions, keeping the last list visible
 * while the machine is unreachable. */
export function useRemoteProjectSessions(project: string, enabled = true): RemoteProjectSessions {
  const remote = enabled ? remoteProjectFor(project) : undefined;
  const {
    machines,
    loaded: machinesLoaded,
    error: machinesError,
    refresh: refreshMachines,
  } = useRemoteMachines(!!remote);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : undefined;
  const [sessionList, setSessionList] = useState(() => ({
    project,
    sessions: remote ? cachedSessions(project) : [],
  }));
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dataState, setDataState] = useState<RemoteDataState>({
    phase: "loading",
  });
  const lastVerified = useRef<number | undefined>(undefined);
  const verifiedProject = useRef(project);
  const [refresh, setRefresh] = useState(0);
  const refreshList = useCallback(() => setRefresh((value) => value + 1), []);
  const [capabilityVersion, setCapabilityVersion] = useState(0);
  useEffect(() => subscribeRemoteCapabilities(() => setCapabilityVersion((v) => v + 1)), []);
  useEffect(() => {
    if (!remote) return;
    const changed = () => setRefresh((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_HISTORY_CHANGE, changed);
  }, [!!remote]);
  useEffect(() => {
    if (verifiedProject.current !== project) {
      verifiedProject.current = project;
      lastVerified.current = undefined;
      setLoaded(false);
    }
    setSessionList((previous) =>
      previous.project === project
        ? previous
        : { project, sessions: remote ? cachedSessions(project) : [] },
    );
    setFailed(false);
    if (!remote || !machine) {
      setLoaded(false);
      lastVerified.current = undefined;
      setDataState({ phase: "loading" });
      return;
    }
    setDataState({ phase: "refreshing", updatedAt: lastVerified.current });
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let recovering = false;
    const fail = (reason: unknown) => {
      if (disposed) return;
      setFailed(true);
      setDataState({
        phase: "error",
        updatedAt: lastVerified.current,
        error: String(reason).replace(/^Error: /, ""),
      });
    };
    const saveList = (next: HostSessionSummary[]) => {
      recovering = false;
      if (disposed) return;
      setSessionList({ project, sessions: next });
      setLoaded(true);
      setFailed(false);
      lastVerified.current =
        sharedSessionLists.verifiedAt(machine.id, remote.projectId) ?? Date.now();
      setDataState((previous) =>
        previous.phase === (next.length ? "ready" : "empty") &&
        previous.updatedAt === lastVerified.current
          ? previous
          : {
              phase: next.length ? "ready" : "empty",
              updatedAt: lastVerified.current,
            },
      );
      try {
        const serialized = JSON.stringify(next);
        if (localStorage.getItem(historyKey(project)) !== serialized) {
          queueRemoteSummaryCache(historyKey(project), serialized);
          window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
        }
      } catch {
        /* refetch from host next time */
      }
    };
    if (cachedRemoteCapabilities(remote.environmentId)?.includes("machine.changes")) {
      const unsubscribe = subscribeRemoteMachineChannel(
        machine.id,
        () => ({
          projects: [
            {
              projectId: remote.projectId,
              known: sharedSessionLists.known(machine.id, remote.projectId),
            },
          ],
        }),
        (changes) => {
          const changed = changes.projects.find((entry) => entry.projectId === remote.projectId);
          const next =
            changed &&
            sharedSessionLists.applyChange(machine.id, remote.projectId, changed, changes.reset);
          if (next) saveList(next);
          else if (changed || changes.reset) {
            sharedSessionLists.invalidateProject(machine.id, remote.projectId);
            setDataState({
              phase: "refreshing",
              updatedAt: lastVerified.current,
            });
            void sharedSessionLists
              .load(machine.id, remote.projectId, true)
              .then(saveList)
              .catch(fail);
          } else if (recovering) {
            recovering = false;
            setDataState({
              phase: "refreshing",
              updatedAt: lastVerified.current,
            });
            void sharedSessionLists
              .load(machine.id, remote.projectId, true)
              .then(saveList)
              .catch(fail);
          }
        },
        (reason) => {
          recovering = true;
          fail(reason);
        },
      );
      void sharedSessionLists.load(machine.id, remote.projectId, true).then(saveList).catch(fail);
      return () => {
        disposed = true;
        unsubscribe();
      };
    }
    let firstRead = true;
    const poll = async () => {
      try {
        const force = firstRead || failures > 0;
        firstRead = false;
        const next = await sharedSessionLists.load(machine.id, remote.projectId, force);
        if (disposed) return;
        failures = 0;
        saveList(next);
      } catch (reason) {
        // Keep the cached list and back off while SSH is unavailable.
        failures = Math.min(4, failures + 1);
        fail(reason);
      }
      if (!disposed)
        timer = setTimeout(() => void poll(), failures ? remoteBackoffDelay(failures) : 3_000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [project, remote?.projectId, machine?.id, refresh, capabilityVersion]);
  // Effects run after render. Never expose the previous project's cards with
  // the new project's click handlers during that transition.
  const current = sessionList.project === project;
  return {
    machine,
    sessions: current ? sessionList.sessions : remote ? cachedSessions(project) : [],
    loaded: current && loaded,
    machinesLoaded,
    failed: current && failed,
    dataState: !current
      ? { phase: "loading" }
      : !machine
        ? machinesError
          ? { phase: "error", error: machinesError }
          : machinesLoaded
            ? {
                phase: "error",
                error: "Connect this project’s machine to load its sessions.",
              }
            : { phase: "loading" }
        : dataState.phase === "refreshing" &&
            !lastVerified.current &&
            sessionList.sessions.length === 0
          ? { phase: "loading" }
          : dataState,
    refresh: machine ? refreshList : refreshMachines,
  };
}

/** Lists the host sessions of every remote project on the rail, so one that
 * runs on its machine shows up without its project being opened here. A
 * project whose machine does not answer keeps its last list. */
export function useRemoteRailSessions(projects: readonly string[]): RemoteRailSession[] {
  const key = projects.join("\n");
  const { machines } = useRemoteMachines(projects.length > 0);
  const [sessions, setSessions] = useState<RemoteRailSession[]>([]);
  const [capabilityVersion, setCapabilityVersion] = useState(0);
  useEffect(() => subscribeRemoteCapabilities(() => setCapabilityVersion((v) => v + 1)), []);
  useEffect(() => {
    const targets = (key ? key.split("\n") : []).flatMap((project) => {
      const remote = remoteProjectFor(project);
      const machine =
        remote && machines.find((entry) => entry.environmentId === remote.environmentId);
      return remote && machine ? [{ project, remote, machine }] : [];
    });
    if (targets.length === 0) {
      setSessions([]);
      return;
    }
    // The cached list may be old: nothing in it counts as running until the host says so.
    const lists = new Map<string, { list: HostSessionSummary[]; fresh: boolean }>(
      targets.map(({ project }) => [
        project,
        {
          list: cachedSessions(project).map((session) => ({
            ...session,
            status: "idle" as const,
            needsInput: false,
          })),
          fresh: false,
        },
      ]),
    );
    let shown = "";
    const publish = () => {
      const next = [...lists].flatMap(([project, { list, fresh }]) =>
        list.map((session) => ({ project, session, fresh })),
      );
      const serialized = JSON.stringify(next);
      if (serialized === shown) return;
      shown = serialized;
      setSessions(next);
    };
    publish();
    const save = (project: string, next: HostSessionSummary[]) => {
      lists.set(project, { list: next, fresh: true });
      const stored = JSON.stringify(next);
      try {
        if (localStorage.getItem(historyKey(project)) !== stored) {
          queueRemoteSummaryCache(historyKey(project), stored);
          window.dispatchEvent(new Event(REMOTE_HISTORY_UPDATED));
        }
      } catch {
        /* the list is refetched next time */
      }
      publish();
    };
    const capable = targets.filter(({ machine }) =>
      cachedRemoteCapabilities(machine.environmentId)?.includes("machine.changes"),
    );
    const fallback = targets.filter((target) => !capable.includes(target));
    const cleanups: (() => void)[] = [];
    if (fallback.length)
      cleanups.push(
        startRailPoller({
          targets: fallback,
          load: ({ machine, remote }) => sharedSessionLists.load(machine.id, remote.projectId),
          onResult: ({ project }, next) => save(project, next),
        }),
      );
    for (const target of capable) {
      const { project, remote, machine } = target;
      cleanups.push(
        subscribeRemoteMachineChannel(
          machine.id,
          () => ({
            projects: [
              {
                projectId: remote.projectId,
                known: sharedSessionLists.known(machine.id, remote.projectId),
              },
            ],
          }),
          (changes) => {
            const changed = changes.projects.find((entry) => entry.projectId === remote.projectId);
            const next =
              changed &&
              sharedSessionLists.applyChange(machine.id, remote.projectId, changed, changes.reset);
            if (next) save(project, next);
            else if (changed || changes.reset) {
              sharedSessionLists.invalidateProject(machine.id, remote.projectId);
              void sharedSessionLists
                .load(machine.id, remote.projectId)
                .then((next) => save(project, next))
                .catch((error) => {
                  console.warn("connections operation failed", error);
                });
            }
          },
        ),
      );
      void sharedSessionLists
        .load(machine.id, remote.projectId)
        .then((next) => save(project, next))
        .catch((error) => {
          console.warn("connections operation failed", error);
        });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [key, machines, capabilityVersion]);
  return sessions;
}
