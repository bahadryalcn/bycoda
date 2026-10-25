import type { MachineChanges, MachineChangesRequest } from "./protocol";
import { remoteBackoffDelay, withBackoffJitter } from "./remotePollingPolicy";
import { remoteRequest } from "./connections";
import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { environmentForMachine, subscribeConnectionInvalidated } from "./remoteLifecycle";

export type MachineChannelDemand = {
  active?: { projectId: string; sessionId: string; lastActiveAt: number };
  inlineSync?: boolean;
  sessions?: readonly { sessionId: string; revision: number }[];
  projects?: readonly { projectId: string; known?: string }[];
  git?: readonly { cwd: string; known?: string }[];
  tasksKnown?: string;
};
export type MachineChannelListener = (changes: MachineChanges) => void;

type Subscriber = {
  demand: MachineChannelDemand | (() => MachineChannelDemand);
  listener: MachineChannelListener;
  onError?: (error: unknown) => void;
  responseSequence: number;
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
};
const channels = new Map<string, Channel>();
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
  const onVisibility = () => {
    if (!document.hidden) wake();
  };
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
  const projects = new Map<string, string | undefined>();
  const git = new Map<string, string | undefined>();
  const taskEtags = new Set<string>();
  let inlineSync = false;
  const inlineSessionIds = new Set<string>();
  const activeSessions = new Map<string, number>();
  for (const { demand: source } of channel.subscribers) {
    const demand = typeof source === "function" ? source() : source;
    if (demand.active) {
      const { projectId, sessionId, lastActiveAt } = demand.active;
      channel.recentProjects.set(
        projectId,
        Math.max(channel.recentProjects.get(projectId) ?? 0, lastActiveAt),
      );
      activeSessions.set(sessionId, Math.max(activeSessions.get(sessionId) ?? 0, lastActiveAt));
    }
    inlineSync ||= demand.inlineSync === true;
    for (const session of demand.sessions ?? []) {
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
  for (const subscriber of [...channel.subscribers]) {
    try {
      if (sequence < subscriber.responseSequence) continue;
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
      subscriber.listener(delivered);
    } catch {
      /* one consumer cannot interrupt others */
    }
  }
}

/** Update the native union immediately without starting a second held poll. */
function refreshDemand(machineId: string, channel: Channel) {
  const key = demandKey(mergedDemand(channel));
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
      const demand = mergedDemand(channel);
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
      if (!channel.stopped)
        for (const subscriber of [...channel.subscribers]) {
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
    const demand = mergedDemand(channel);
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
    for (const subscriber of [...channel.subscribers]) {
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
      subscriptionId: `renderer-${++channelSequence}-${Math.random().toString(36).slice(2)}`,
    };
    channels.set(machineId, channel);
    startWake();
  }
  const subscriber: Subscriber = { demand, listener, onError, responseSequence: 0 };
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
    if (channel!.timer) clearTimeout(channel!.timer);
    channel!.timer = undefined;
    channels.delete(machineId);
    if (!channels.size) stopWake?.();
    // Release the native cross-window union even when the last listener closes.
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
    if (channel.timer) clearTimeout(channel.timer);
  }
  channels.clear();
  stopWake?.();
}
