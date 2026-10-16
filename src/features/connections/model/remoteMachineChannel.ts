import type { MachineChanges, MachineChangesRequest } from "./protocol";
import { remoteBackoffDelay, withBackoffJitter } from "./remotePollingPolicy";
import { remoteRequest } from "./connections";
import { startPerformanceSpan } from "../../../shared/lib/performanceTrace";

export type MachineChannelDemand = {
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
};
type Channel = {
  subscribers: Set<Subscriber>;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  failures: number;
  instanceId?: string;
  polling: boolean;
  subscriptionId: string;
};
const channels = new Map<string, Channel>();
/** Git cursors a host answers per poll. */
const GIT_CURSOR_LIMIT = 32;
let channelSequence = 0;

function mergedDemand(channel: Channel): MachineChangesRequest {
  const sessions = new Map<string, number>();
  const projects = new Map<string, string | undefined>();
  const git = new Map<string, string | undefined>();
  const taskEtags = new Set<string>();
  let inlineSync = false;
  for (const { demand: source } of channel.subscribers) {
    const demand = typeof source === "function" ? source() : source;
    inlineSync ||= demand.inlineSync === true;
    for (const session of demand.sessions ?? [])
      sessions.set(
        session.sessionId,
        Math.min(sessions.get(session.sessionId) ?? session.revision, session.revision),
      );
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
    ...(inlineSync ? { inlineSync: true } : {}),
    ...(channel.instanceId ? { instanceId: channel.instanceId } : {}),
    sessions: [...sessions].map(([sessionId, revision]) => ({
      sessionId,
      revision,
    })),
    projects: [...projects].map(([projectId, known]) => ({
      projectId,
      ...(known ? { known } : {}),
    })),
    ...(git.size
      ? {
          // Past the host's limit the rest keep their own refresh triggers.
          git: [...git]
            .slice(0, GIT_CURSOR_LIMIT)
            .map(([cwd, known]) => ({ cwd, ...(known ? { known } : {}) })),
        }
      : {}),
    ...(taskEtags.size ? { tasksKnown: taskEtags.size === 1 ? [...taskEtags][0] : "" } : {}),
    waitMs: 20_000,
  };
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
  const done = startPerformanceSpan("remote-control");
  let delay = 0;
  try {
    const changes = await remoteRequest<MachineChanges>(
      machineId,
      "machine.changes",
      mergedDemand(channel),
    );
    if (channel.stopped) return;
    if (
      !changes ||
      typeof changes.instanceId !== "string" ||
      !Array.isArray(changes.sessions) ||
      !Array.isArray(changes.projects)
    )
      throw new Error("Invalid machine changes response");
    const reset =
      changes.reset || (!!channel.instanceId && channel.instanceId !== changes.instanceId);
    channel.instanceId = changes.instanceId;
    channel.failures = 0;
    const delivered = reset && !changes.reset ? { ...changes, reset: true } : changes;
    for (const subscriber of [...channel.subscribers]) {
      try {
        subscriber.listener(delivered);
      } catch {
        /* one consumer cannot interrupt others */
      }
    }
  } catch (error) {
    if (channel.stopped) return;
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
    schedule(machineId, channel, delay || 100);
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
      subscriptionId: `renderer-${++channelSequence}-${Math.random().toString(36).slice(2)}`,
    };
    channels.set(machineId, channel);
  }
  const subscriber: Subscriber = { demand, listener, onError };
  channel.subscribers.add(subscriber);
  if (channel.timer) clearTimeout(channel.timer);
  channel.timer = undefined;
  schedule(machineId, channel);
  return () => {
    channel!.subscribers.delete(subscriber);
    if (channel!.subscribers.size) return;
    channel!.stopped = true;
    if (channel!.timer) clearTimeout(channel!.timer);
    channel!.timer = undefined;
    channels.delete(machineId);
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
}
