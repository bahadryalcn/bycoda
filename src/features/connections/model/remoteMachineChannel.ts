import type {
  HostSession,
  HostSessionSummary,
  MachineChanges,
  MachineChangesRequest,
  SessionSync,
} from "./protocol";
import { remoteBackoffDelay, withBackoffJitter } from "./remotePollingPolicy";
import { cachedRemoteCapabilities, mayStartTunnel, remoteRequest } from "./connections";
import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";
import { subscribeRemoteRecovered } from "./remoteHealth";
import {
  captureConnectionGeneration,
  environmentForMachine,
  subscribeConnectionInvalidated,
} from "./remoteLifecycle";
import {
  EnvironmentRuntime,
  type RuntimeStreamMetadata,
} from "../../../shared/lib/host-runtime/environmentRuntime";
import {
  SessionSummarySchema,
  SessionViewSchema,
  SessionSyncSchema,
} from "../../../shared/model/host-contracts";
import { createTauriHostConnection } from "../../../platform/tauri/hostConnection";
import { z } from "zod";

export type MachineChannelDemand = {
  active?: { projectId: string; sessionId: string; lastActiveAt: number };
  inlineSync?: boolean;
  sessions?: readonly { sessionId: string; revision: number; sourceEpoch?: string }[];
  projects?: readonly { projectId: string; known?: string }[];
  git?: readonly { cwd: string; known?: string }[];
  tasksKnown?: string;
};
export type MachineChannelApplicationReceipt = { appliedRevision: number };
export type MachineChannelApplicationContext = { isCurrent(): boolean };
export type MachineChannelListener = (
  changes: MachineChanges,
  application?: MachineChannelApplicationContext,
) => void | MachineChannelApplicationReceipt | Promise<void | MachineChannelApplicationReceipt>;

type Subscriber = {
  demand: MachineChannelDemand | (() => MachineChannelDemand);
  listener: MachineChannelListener;
  onError?: (error: unknown) => void;
  responseSequence: number;
  committedRevisions: Map<string, number>;
  streamEpochs: Map<string, string>;
};
type Channel = {
  subscribers: Set<Subscriber>;
  /** Consecutive polls that answered "nothing changed" at once. */
  unchangedStreak?: number;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  failures: number;
  instanceId?: string;
  polling: boolean;
  subscriptionId: string;
  epoch: number;
  refreshPending: boolean;
  recentProjects: Map<string, number>;
  demandVersion: number;
  demandRefresh?: Promise<void>;
  sentDemand?: string;
  requestSequence: number;
  responseSequence: number;
  wsFailed?: boolean;
  wsRoute?: { runtime: EnvironmentRuntime; release(): void };
  /** Watches the route's readiness so a stuck WebSocket falls back to HTTP. */
  wsWatch?: ReturnType<typeof setInterval>;
  wsSubscriptions: Map<string, () => void>;
};
const channels = new Map<string, Channel>();
type NativeRoute = {
  runtime: EnvironmentRuntime;
  environmentId: string;
  accessEpoch: string;
  refs: number;
};
const nativeRoutes = new Map<string, NativeRoute>();

/** Shared logical scope for channel demand and optional unary callers in this window. */
export function acquireRemoteHostRuntime(
  machineId: string,
): { runtime: EnvironmentRuntime; release(): void } | undefined {
  const environmentId = environmentForMachine(machineId);
  if (
    !environmentId ||
    !cachedRemoteCapabilities(environmentId)?.includes("transport.ws.sessions.v2")
  )
    return undefined;
  const accessEpoch = String(captureConnectionGeneration(environmentId));
  let route = nativeRoutes.get(machineId);
  if (route && (route.environmentId !== environmentId || route.accessEpoch !== accessEpoch)) {
    nativeRoutes.delete(machineId);
    void route.runtime.close().catch(() => {});
    route = undefined;
  }
  if (!route) {
    if (nativeRoutes.size >= 64) throw new Error("Host runtime route limit reached");
    route = {
      environmentId,
      accessEpoch,
      refs: 0,
      runtime: new EnvironmentRuntime(
        { environmentId, principalId: `native:${machineId}`, accessEpoch },
        createTauriHostConnection(machineId, {
          allowConnect: mayStartTunnel(machineId, false, false),
        }),
      ),
    };
    nativeRoutes.set(machineId, route);
  }
  route.refs++;
  const retained = route;
  let released = false;
  return {
    runtime: retained.runtime,
    release: () => {
      if (released) return;
      released = true;
      if (--retained.refs || nativeRoutes.get(machineId) !== retained) return;
      nativeRoutes.delete(machineId);
      void retained.runtime.close().catch(() => {});
    },
  };
}

function releaseWs(channel: Channel) {
  if (channel.wsWatch) clearInterval(channel.wsWatch);
  channel.wsWatch = undefined;
  for (const release of channel.wsSubscriptions.values()) release();
  channel.wsSubscriptions.clear();
  channel.wsRoute?.release();
  channel.wsRoute = undefined;
}
/** A WS route that is not ready (connecting or retry-wait) this long is abandoned for HTTP. */
const WS_NOT_READY_MS = 5_000;
/** Same fallback for a WS error and for a route that never becomes ready. */
function failWs(machineId: string, channel: Channel, error: unknown, notify = true) {
  if (channel.stopped || channel.wsFailed) return;
  channel.wsFailed = true;
  releaseWs(channel);
  for (const subscriber of notify ? channel.subscribers : []) {
    try {
      subscriber.onError?.(error);
    } catch {
      /* consumer isolation */
    }
  }
  schedule(machineId, channel);
}
function watchWsRoute(machineId: string, channel: Channel) {
  if (channel.wsWatch) clearInterval(channel.wsWatch);
  let notReadySince: number | undefined;
  channel.wsWatch = setInterval(() => {
    const transport = channel.wsRoute?.runtime.state?.transport;
    if (!transport || transport === "ready") {
      notReadySince = undefined;
      return;
    }
    notReadySince ??= Date.now();
    if (Date.now() - notReadySince >= WS_NOT_READY_MS) {
      console.warn(`[remote] Host WebSocket stayed ${transport}; falling back to HTTP`);
      // A slow network route can still be served over HTTP. Report the load as
      // failed only if that fallback fails; admission failures remain immediate.
      failWs(
        machineId,
        channel,
        new Error("Host WebSocket did not become ready"),
        transport === "blocked" || transport === "closed",
      );
    }
  }, 1_000);
}
/** Git cursors a host answers per poll. */
const GIT_CURSOR_LIMIT = 32;
let channelSequence = 0;
let stopWake: (() => void) | undefined;

function startWake() {
  if (stopWake) return;
  const wake = (environmentId?: string, reset = false) => {
    for (const [machineId, channel] of channels) {
      const environment = environmentForMachine(machineId);
      if (environmentId && environment && environment !== environmentId) continue;
      if (reset) {
        releaseWs(channel);
        const route = nativeRoutes.get(machineId);
        if (route) {
          nativeRoutes.delete(machineId);
          void route.runtime.close().catch(() => {});
        }
        channel.wsFailed = false;
        channel.epoch++;
        channel.refreshPending = true;
      }
      channel.failures = 0;
      if (channel.timer) clearTimeout(channel.timer);
      channel.timer = undefined;
      if (channel.polling && !reset) refreshDemand(machineId, channel);
      schedule(machineId, channel);
    }
  };
  const onVisibility = () => wake();
  const unsubscribe = subscribeRemoteRecovered((environmentId) => wake(environmentId, true));
  const stopInvalidation = subscribeConnectionInvalidated((environmentId) =>
    wake(environmentId, true),
  );
  const onWake = () => wake();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onVisibility);
  }
  stopWake = () => {
    unsubscribe();
    stopInvalidation();
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVisibility);
    }
    stopWake = undefined;
  };
}

function mergedDemand(channel: Channel): MachineChangesRequest {
  const sessions = new Map<string, number>();
  const sessionEpochs = new Map<string, string | undefined>();
  const projects = new Map<string, string | undefined>();
  const git = new Map<string, string | undefined>();
  const taskEtags = new Set<string>();
  let inlineSync = false;
  const inlineSessionIds = new Set<string>();
  const activeSessions = new Map<string, number>();
  const activeProjectIds = new Set<string>();
  for (const { demand: source } of channel.subscribers) {
    const demand = typeof source === "function" ? source() : source;
    if (demand.active) {
      const { projectId, sessionId, lastActiveAt } = demand.active;
      activeProjectIds.add(projectId);
      channel.recentProjects.set(
        projectId,
        Math.max(channel.recentProjects.get(projectId) ?? 0, lastActiveAt),
      );
      activeSessions.set(sessionId, Math.max(activeSessions.get(sessionId) ?? 0, lastActiveAt));
    }
    inlineSync ||= demand.inlineSync === true;
    for (const session of demand.sessions ?? []) {
      if (!sessionEpochs.has(session.sessionId)) sessionEpochs.set(session.sessionId, session.sourceEpoch);
      else if (sessionEpochs.get(session.sessionId) !== session.sourceEpoch)
        sessionEpochs.set(session.sessionId, undefined);
      if (demand.inlineSync === true) inlineSessionIds.add(session.sessionId);
      sessions.set(
        session.sessionId,
        Math.min(sessions.get(session.sessionId) ?? session.revision, session.revision),
      );
    }
    for (const project of demand.projects ?? []) {
      if (!projects.has(project.projectId)) projects.set(project.projectId, project.known);
      else if (projects.get(project.projectId) !== project.known)
        projects.set(project.projectId, undefined);
    }
    for (const checkout of demand.git ?? []) {
      if (!git.has(checkout.cwd)) git.set(checkout.cwd, checkout.known);
      else if (git.get(checkout.cwd) !== checkout.known) git.set(checkout.cwd, undefined);
    }
    if (demand.tasksKnown !== undefined) taskEtags.add(demand.tasksKnown);
  }
  // Recency is advisory metadata. Keep every active project and bound inactive history.
  if (channel.recentProjects.size > 512) {
    const inactive = [...channel.recentProjects]
      .filter(([id]) => !activeProjectIds.has(id))
      .sort((a, b) => a[1] - b[1]);
    for (const [id] of inactive) {
      if (channel.recentProjects.size <= 512) break;
      channel.recentProjects.delete(id);
    }
  }
  return {
    subscriptionId: channel.subscriptionId,
    ...(activeSessions.size
      ? {
          activeSessions: [...activeSessions].map(([sessionId, lastActiveAt]) => ({
            sessionId,
            lastActiveAt,
          })),
        }
      : {}),
    ...(channel.recentProjects.size
      ? {
          activeProjects: [...channel.recentProjects]
            .filter(([id]) => projects.has(id))
            .map(([projectId, lastActiveAt]) => ({ projectId, lastActiveAt })),
        }
      : {}),
    ...(inlineSync ? { inlineSync: true, inlineSessionIds: [...inlineSessionIds] } : {}),
    ...(channel.instanceId && !channel.refreshPending ? { instanceId: channel.instanceId } : {}),
    sessions: [...sessions].map(([sessionId, revision]) => ({
      sessionId,
      revision: channel.refreshPending ? 0 : revision,
      ...(!channel.refreshPending && sessionEpochs.get(sessionId)
        ? { sourceEpoch: sessionEpochs.get(sessionId) }
        : {}),
    })),
    projects: [...projects].map(([projectId, known]) => ({
      projectId,
      ...(known && !channel.refreshPending ? { known } : {}),
    })),
    ...(git.size
      ? {
          // Past the host's limit the rest keep their own refresh triggers.
          git: [...git].slice(0, GIT_CURSOR_LIMIT).map(([cwd, known]) => ({
            cwd,
            ...(known && !channel.refreshPending ? { known } : {}),
          })),
        }
      : {}),
    ...(taskEtags.size
      ? { tasksKnown: !channel.refreshPending && taskEtags.size === 1 ? [...taskEtags][0] : "" }
      : {}),
    waitMs: 20_000,
  };
}

const projectSnapshotSchema = z.strictObject({
  etag: z.string(),
  sessions: z.array(SessionSummarySchema),
});
function sessionSnapshot(data: unknown, sessionId: string): HostSession {
  const value = SessionViewSchema.parse(data);
  const session = value.session;
  if (
    session.id !== sessionId ||
    typeof session.title !== "string" ||
    typeof session.cwd !== "string" ||
    typeof session.harness !== "string" ||
    typeof session.model !== "string" ||
    typeof session.runtimeMode !== "string" ||
    typeof session.modelSettings !== "object" ||
    session.modelSettings === null ||
    Array.isArray(session.modelSettings) ||
    Object.values(session.modelSettings).some((value) => typeof value !== "string") ||
    !Array.isArray(session.blocks) ||
    session.blocks.some(
      (block) =>
        typeof block !== "object" ||
        block === null ||
        Array.isArray(block) ||
        typeof block.id !== "string" ||
        typeof block.role !== "string" ||
        typeof block.text !== "string",
    ) ||
    value.history ||
    value.historyLoading
  )
    throw new Error("Host stream is incompatible with a full transcript consumer");
  // Neutral read metadata is strict; feature-owned Session/Block extensions
  // remain opaque. The required full-transcript fields above are checked here.
  return value as unknown as HostSession;
}
function replacementDelta(value: HostSession, base: number): SessionSync {
  const { blocks, ...session } = value.session;
  const { blockRevisions: _blockRevisions, ...metadata } = value;
  return {
    kind: "delta",
    base,
    value: { ...metadata, session },
    blocks,
    blockIds: blocks.map((block) => block.id),
  };
}
type SessionStreamUpdate =
  | { kind: "snapshot"; value: HostSession }
  | Extract<SessionSync, { kind: "delta" }>;
function sessionStreamUpdate(
  data: unknown,
  id: string,
  metadata: RuntimeStreamMetadata,
): SessionStreamUpdate {
  if (metadata.kind === "snapshot") {
    const value = sessionSnapshot(data, id);
    if (metadata.revision !== undefined && metadata.revision !== value.revision)
      throw new Error("Host snapshot revision changed");
    return { kind: "snapshot", value };
  }
  const delta = SessionSyncSchema.parse(data);
  if (
    delta.kind !== "delta" ||
    delta.partial ||
    delta.base !== metadata.baseRevision ||
    delta.value.revision !== metadata.revision ||
    delta.value.revision <= delta.base ||
    new Set(delta.blockIds).size !== delta.blockIds.length
  )
    throw new Error("Invalid full transcript delta");
  sessionSnapshot(
    { ...delta.value, session: { ...delta.value.session, blocks: delta.blocks } },
    id,
  );
  const blockIds = new Set(delta.blockIds);
  if (
    new Set(delta.blocks.map((block) => block.id)).size !== delta.blocks.length ||
    delta.blocks.some((block) => typeof block.id !== "string" || !blockIds.has(block.id))
  )
    throw new Error("Invalid changed transcript blocks");
  return delta as unknown as Extract<SessionSync, { kind: "delta" }>;
}

/** Reconcile logical WS interests and leave other feature demand on bounded HTTP. */
function transportDemand(machineId: string, channel: Channel): MachineChangesRequest {
  for (const subscriber of channel.subscribers) {
    const current =
      typeof subscriber.demand === "function" ? subscriber.demand() : subscriber.demand;
    const sessions = new Set(current.sessions?.map((session) => session.sessionId));
    for (const id of subscriber.committedRevisions.keys())
      if (!sessions.has(id)) subscriber.committedRevisions.delete(id);
    for (const id of subscriber.streamEpochs.keys())
      if (!sessions.has(id)) subscriber.streamEpochs.delete(id);
  }
  const demand = mergedDemand(channel);
  const environmentId = environmentForMachine(machineId);
  const enabled =
    !channel.wsFailed &&
    environmentId &&
    cachedRemoteCapabilities(environmentId)?.includes("transport.ws.sessions.v2");
  const desired = new Set<string>();
  if (enabled) {
    for (const project of demand.projects) desired.add(`project:${project.projectId}`);
    for (const sessionId of demand.inlineSessionIds ?? []) desired.add(`session:${sessionId}`);
  }
  for (const [key, release] of channel.wsSubscriptions)
    if (!desired.has(key)) {
      release();
      channel.wsSubscriptions.delete(key);
    }
  if (desired.size && !channel.wsRoute) {
    channel.wsRoute = acquireRemoteHostRuntime(machineId);
    if (channel.wsRoute) watchWsRoute(machineId, channel);
  }
  if (!desired.size && channel.wsRoute) {
    if (channel.wsWatch) clearInterval(channel.wsWatch);
    channel.wsWatch = undefined;
    channel.wsRoute.release();
    channel.wsRoute = undefined;
  }
  const route = channel.wsRoute;
  if (route)
    for (const key of desired) {
      if (channel.wsSubscriptions.has(key)) continue;
      const id = key.slice(key.indexOf(":") + 1);
      const kind = key.startsWith("session:") ? "session" : "project";
      const onError = (error: unknown) => failWs(machineId, channel, error);
      let release: () => void;
      try {
        release =
          kind === "session"
            ? route.runtime.retain(
                { kind: "session", sessionId: id },
                {
                  parse: (data, metadata) => sessionStreamUpdate(data, id, metadata),
                  commit: async (update, input) => {
                    const subscribers = [...channel.subscribers];
                    for (const subscriber of subscribers) {
                      if (!input.isCurrent() || channel.stopped)
                        throw new Error("Stale Host subscription consumer");
                      if (!channel.subscribers.has(subscriber)) continue;
                      const current =
                        typeof subscriber.demand === "function"
                          ? subscriber.demand()
                          : subscriber.demand;
                      const session = current.sessions?.find((session) => session.sessionId === id);
                      if (!session) continue;
                      const value = update.value;
                      const epochChanged = subscriber.streamEpochs.get(id) !== input.cursor.epoch ||
                        (!!update.value.sourceEpoch && update.value.sourceEpoch !== session.sourceEpoch);
                      if (epochChanged && update.kind !== "snapshot")
                        throw new Error("Host stream epoch requires a snapshot");
                      const committed = subscriber.committedRevisions.get(id);
                      const base =
                        epochChanged ? 0 : committed !== undefined && committed >= session.revision
                          ? committed
                          : session.revision;
                      if (
                        current.inlineSync === true &&
                        ((!epochChanged && value.revision < base) ||
                          (update.kind === "delta" &&
                            (update.base !== base ||
                              (committed !== undefined && session.revision > committed))))
                      )
                        throw new Error("Host delta requires a fresh application baseline");
                      const receipt = await subscriber.listener(
                        {
                          instanceId: channel.instanceId ?? `ws:${environmentId}`,
                          reset: epochChanged,
                          checkedSessions: [id],
                          checkedProjects: [],
                          projects: [],
                          sessions: [
                            {
                              sessionId: id,
                              revision: value.revision,
                              ...(value.sourceEpoch ? { sourceEpoch: value.sourceEpoch } : {}),
                              ...(current.inlineSync === true
                                ? {
                                    sync:
                                      update.kind === "snapshot"
                                        ? replacementDelta(update.value, base)
                                        : update,
                                  }
                                : {}),
                            },
                          ],
                        },
                        {
                          isCurrent: () =>
                            input.isCurrent() &&
                            !channel.stopped &&
                            channel.subscribers.has(subscriber),
                        },
                      );
                      if (!input.isCurrent())
                        throw new Error("Host subscription changed during application");
                      if (current.inlineSync === true) {
                        if (
                          !receipt ||
                          !Number.isSafeInteger(receipt.appliedRevision) ||
                          receipt.appliedRevision < value.revision
                        )
                          throw new Error("Host transcript was not committed by this consumer");
                        subscriber.committedRevisions.set(id, receipt.appliedRevision);
                      }
                      subscriber.streamEpochs.set(id, input.cursor.epoch);
                    }
                  },
                  closed: async () => {
                    const subscribers = [...channel.subscribers];
                    for (const subscriber of subscribers) {
                      const current =
                        typeof subscriber.demand === "function"
                          ? subscriber.demand()
                          : subscriber.demand;
                      if (current.sessions?.some((session) => session.sessionId === id))
                        await subscriber.listener({
                          instanceId: channel.instanceId ?? `ws:${environmentId}`,
                          reset: false,
                          checkedSessions: [id],
                          checkedProjects: [],
                          projects: [],
                          sessions: [{ sessionId: id, revision: 0, deleted: true }],
                        });
                    }
                  },
                  onError,
                },
              )
            : route.runtime.retain(
                { kind: "project", projectId: id },
                {
                  parse: (data) => projectSnapshotSchema.parse(data),
                  commit: async (value, input) => {
                    const subscribers = [...channel.subscribers];
                    for (const subscriber of subscribers) {
                      if (!input.isCurrent() || channel.stopped)
                        throw new Error("Stale Host subscription consumer");
                      const current =
                        typeof subscriber.demand === "function"
                          ? subscriber.demand()
                          : subscriber.demand;
                      if (!current.projects?.some((project) => project.projectId === id)) continue;
                      await subscriber.listener({
                        instanceId: channel.instanceId ?? `ws:${environmentId}`,
                        reset: false,
                        checkedSessions: [],
                        checkedProjects: [id],
                        sessions: [],
                        projects: [
                          {
                            projectId: id,
                            etag: value.etag,
                            sessions: value.sessions as HostSessionSummary[],
                          },
                        ],
                      });
                      if (!input.isCurrent())
                        throw new Error("Host subscription changed during application");
                    }
                  },
                  onError,
                },
              );
      } catch (error) {
        onError(error);
        break;
      }
      channel.wsSubscriptions.set(key, release);
    }
  const sessions = demand.sessions.filter(
    (session) => !channel.wsSubscriptions.has(`session:${session.sessionId}`),
  );
  const projects = demand.projects.filter(
    (project) => !channel.wsSubscriptions.has(`project:${project.projectId}`),
  );
  return {
    ...demand,
    sessions,
    projects,
    inlineSessionIds: demand.inlineSessionIds?.filter((id) =>
      sessions.some((session) => session.sessionId === id),
    ),
  };
}
function hasHttpDemand(demand: MachineChangesRequest, channel: Channel): boolean {
  return (
    !channel.wsSubscriptions.size ||
    !!(
      demand.sessions.length ||
      demand.projects.length ||
      demand.tasksKnown !== undefined ||
      demand.git?.length ||
      demand.activeSessions?.length ||
      demand.activeProjects?.length
    )
  );
}

/** Longest back-off between polls that keep answering "nothing changed" at once. */
const UNCHANGED_REPLY_MAX_MS = 1_000;

function demandKey(demand: MachineChangesRequest): string {
  // Cursor advances and active timestamps are answers/activity, not new interests.
  // Including them would turn a streamed response into another urgent request.
  return JSON.stringify({
    sessions: demand.sessions.map(({ sessionId }) => sessionId),
    projects: demand.projects.map(({ projectId }) => projectId),
    git: demand.git?.map(({ cwd }) => cwd),
    tasks: demand.tasksKnown !== undefined,
    inlineSync: demand.inlineSync === true,
    inlineSessionIds: demand.inlineSessionIds,
    activeSessions: demand.activeSessions?.map(({ sessionId }) => sessionId),
    activeProjects: demand.activeProjects?.map(({ projectId }) => projectId),
  });
}

function deliver(channel: Channel, changes: MachineChanges, reset: boolean, sequence: number) {
  const delivered = reset && !changes.reset ? { ...changes, reset: true } : changes;
  const checkedSessions = changes.checkedSessions && new Set(changes.checkedSessions);
  const checkedProjects = changes.checkedProjects && new Set(changes.checkedProjects);
  const subscribers = [...channel.subscribers];
  for (const subscriber of subscribers) {
    try {
      if (sequence < subscriber.responseSequence) continue;
      if (reset) {
        subscriber.committedRevisions.clear();
        subscriber.streamEpochs.clear();
      }
      if (!reset && checkedSessions && checkedProjects) {
        const demand =
          typeof subscriber.demand === "function" ? subscriber.demand() : subscriber.demand;
        const hasDemand = demand.sessions?.length || demand.projects?.length;
        if (
          hasDemand &&
          demand.tasksKnown === undefined &&
          !demand.git?.length &&
          !demand.sessions?.some(({ sessionId }) => checkedSessions.has(sessionId)) &&
          !demand.projects?.some(({ projectId }) => checkedProjects.has(projectId))
        )
          continue;
      }
      subscriber.responseSequence = sequence;
      void Promise.resolve(subscriber.listener(delivered)).catch((error) => {
        try {
          subscriber.onError?.(error);
        } catch {
          /* consumer isolation */
        }
      });
    } catch {
      /* one consumer cannot interrupt others */
    }
  }
}

/** Update the native union immediately without starting a second held poll. */
function refreshDemand(machineId: string, channel: Channel) {
  const key = demandKey(transportDemand(machineId, channel));
  if (key === channel.sentDemand) return;
  channel.demandVersion++;
  if (channel.demandRefresh || !channel.polling || channel.stopped) return;
  channel.epoch++;
  const run = async () => {
    let version: number;
    do {
      version = channel.demandVersion;
      const epoch = channel.epoch;
      const sequence = ++channel.requestSequence;
      const demand = transportDemand(machineId, channel);
      channel.sentDemand = demandKey(demand);
      const changes = await remoteRequest<MachineChanges>(machineId, "machine.changes", {
        ...demand,
        waitMs: 0,
      });
      if (channel.stopped || epoch !== channel.epoch) return;
      if (
        !changes ||
        typeof changes.instanceId !== "string" ||
        !Array.isArray(changes.sessions) ||
        !Array.isArray(changes.projects)
      )
        throw new Error("Invalid machine changes response");
      if (sequence < channel.responseSequence && channel.instanceId !== changes.instanceId) return;
      const reset =
        channel.refreshPending ||
        changes.reset ||
        (!!channel.instanceId && channel.instanceId !== changes.instanceId);
      channel.instanceId = changes.instanceId;
      channel.responseSequence = Math.max(sequence, channel.responseSequence);
      channel.refreshPending = false;
      channel.failures = 0;
      deliver(channel, changes, reset, sequence);
    } while (!channel.stopped && channel.subscribers.size && version !== channel.demandVersion);
  };
  channel.demandRefresh = run()
    .catch((error) => {
      const subscribers = [...channel.subscribers];
      if (!channel.stopped)
        for (const subscriber of subscribers) {
          try {
            subscriber.onError?.(error);
          } catch {
            /* isolate consumers */
          }
        }
    })
    .finally(() => {
      channel.demandRefresh = undefined;
      // A subscription can change between the run's last await and this cleanup.
      if (channel.polling && !channel.stopped) refreshDemand(machineId, channel);
    });
}

function schedule(machineId: string, channel: Channel, delay = 0) {
  if (channel.stopped || channel.polling || channel.timer || !channel.subscribers.size) return;
  if (!hasHttpDemand(transportDemand(machineId, channel), channel)) return;
  channel.timer = setTimeout(() => {
    channel.timer = undefined;
    void poll(machineId, channel);
  }, delay);
}

async function poll(machineId: string, channel: Channel) {
  if (channel.stopped || channel.polling || !channel.subscribers.size) return;
  channel.polling = true;
  const epoch = channel.epoch;
  const refreshing = channel.refreshPending;
  const done = startPerformanceSpan("remote-control");
  const startedAt = Date.now();
  let delay = 0;
  try {
    const sequence = ++channel.requestSequence;
    const demand = transportDemand(machineId, channel);
    if (!hasHttpDemand(demand, channel)) return;
    channel.sentDemand = demandKey(demand);
    const changes = await remoteRequest<MachineChanges>(machineId, "machine.changes", demand);
    if (channel.stopped || epoch !== channel.epoch) return;
    if (
      !changes ||
      typeof changes.instanceId !== "string" ||
      !Array.isArray(changes.sessions) ||
      !Array.isArray(changes.projects)
    )
      throw new Error("Invalid machine changes response");
    const reset =
      refreshing ||
      changes.reset ||
      (!!channel.instanceId && channel.instanceId !== changes.instanceId);
    channel.instanceId = changes.instanceId;
    channel.responseSequence = Math.max(sequence, channel.responseSequence);
    channel.failures = 0;
    // Replies with nothing in them that keep coming back at once mean the host
    // cannot hold the poll open; re-arming every 100 ms would spin. Back off
    // across such a streak, up to a second; any change or a held poll resets it.
    if (
      !reset &&
      !changes.sessions.length &&
      !changes.projects.length &&
      !changes.tasks &&
      !changes.git?.length &&
      Date.now() - startedAt < UNCHANGED_REPLY_MAX_MS
    ) {
      channel.unchangedStreak = (channel.unchangedStreak ?? 0) + 1;
      delay = Math.min(UNCHANGED_REPLY_MAX_MS, 100 * 2 ** (channel.unchangedStreak - 1));
    } else channel.unchangedStreak = 0;
    channel.refreshPending = false;
    deliver(channel, changes, reset, sequence);
  } catch (error) {
    if (channel.stopped || epoch !== channel.epoch) return;
    const subscribers = [...channel.subscribers];
    for (const subscriber of subscribers) {
      try {
        subscriber.onError?.(error);
      } catch {
        /* isolate consumers */
      }
    }
    channel.failures = Math.min(6, channel.failures + 1);
    delay = withBackoffJitter(remoteBackoffDelay(channel.failures));
  } finally {
    done();
    channel.polling = false;
    schedule(machineId, channel, epoch !== channel.epoch ? 0 : delay || 100);
  }
}

/** Share one long-poll per remote machine among visible session and list consumers. */
export function subscribeRemoteMachineChannel(
  machineId: string,
  demand: MachineChannelDemand | (() => MachineChannelDemand),
  listener: MachineChannelListener,
  onError?: (error: unknown) => void,
): () => void {
  let channel = channels.get(machineId);
  if (!channel) {
    channel = {
      subscribers: new Set(),
      stopped: false,
      failures: 0,
      polling: false,
      epoch: 0,
      refreshPending: false,
      recentProjects: new Map(),
      demandVersion: 0,
      requestSequence: 0,
      responseSequence: 0,
      wsSubscriptions: new Map(),
      subscriptionId: `renderer-${++channelSequence}-${Math.random().toString(36).slice(2)}`,
    };
    channels.set(machineId, channel);
    startWake();
  }
  const subscriber: Subscriber = {
    demand,
    listener,
    onError,
    responseSequence: 0,
    committedRevisions: new Map(),
    streamEpochs: new Map(),
  };
  channel.subscribers.add(subscriber);
  if (channel.timer) clearTimeout(channel.timer);
  channel.timer = undefined;
  if (channel.polling) refreshDemand(machineId, channel);
  schedule(machineId, channel);
  return () => {
    channel!.subscribers.delete(subscriber);
    if (channel!.subscribers.size) {
      if (channel!.polling) refreshDemand(machineId, channel!);
      return;
    }
    channel!.stopped = true;
    releaseWs(channel!);
    if (channel!.timer) clearTimeout(channel!.timer);
    channel!.timer = undefined;
    channels.delete(machineId);
    if (!channels.size) stopWake?.();
    // Release the native cross-window union even when the last listener closes.
    if (channel!.sentDemand !== undefined)
      void remoteRequest(machineId, "machine.changes", {
        subscriptionId: channel!.subscriptionId,
        sessions: [],
        projects: [],
        waitMs: 0,
      }).catch(() => {});
  };
}

export function resetRemoteMachineChannelsForTests() {
  for (const channel of channels.values()) {
    channel.stopped = true;
    releaseWs(channel);
    if (channel.timer) clearTimeout(channel.timer);
  }
  channels.clear();
  for (const route of nativeRoutes.values()) void route.runtime.close().catch(() => {});
  nativeRoutes.clear();
  stopWake?.();
}
