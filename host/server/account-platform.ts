import { join } from "node:path";
import { ActivityService } from "../activity/activity-store";
import { SessionLifecycleStore } from "../sessions/lifecycle-store";
import {
  createSessionLifecycleService,
  type SessionLifecyclePorts,
} from "../domains/sessions/lifecycle-service";
import { SessionTaskLinks } from "../tasks/session-links";
import type { ServerBindings } from "./bindings";

/** Command types that carry new work into a conversation; they wake a settled session. */
const WAKING_COMMANDS = new Set(["send", "steer", "shell", "contextual", "plan"]);

/** How often idle sessions are checked for automatic settling. */
const AUTO_SETTLE_INTERVAL_MS = 60 * 60 * 1000;

type Dependencies = Pick<
  ServerBindings,
  | "engine"
  | "featureDirectory"
  | "tasks"
  | "sessionQueues"
  | "queueSessionKnown"
  | "hostRuns"
  | "commandService"
  | "sessionQueueService"
>;

function warn(error: unknown): void {
  console.warn("Session lifecycle update failed:", error);
}

/**
 * Local account-platform services: active time, session settling and session-task links.
 * Composition only: the services own the rules, this wires them to the engine's settle and
 * delete signals, the command path that wakes a settled session, and an hourly auto-settle.
 */
export async function createAccountPlatformRuntime(dependencies: Dependencies) {
  const directory = join(dependencies.featureDirectory, "session-lifecycle");
  const activity = new ActivityService(join(dependencies.featureDirectory, "activity"));
  const links = new SessionTaskLinks(directory, {
    taskExists: async (id) =>
      (await dependencies.tasks.list(undefined, false)).some((task) => task.id === id),
    now: Date.now,
  });
  const store = new SessionLifecycleStore(directory);

  const ports: SessionLifecyclePorts = {
    async runState(sessionId) {
      let known: string;
      try {
        known = await dependencies.queueSessionKnown(sessionId, true);
      } catch {
        return { exists: false, running: false, queued: 0 };
      }
      return {
        exists: true,
        running: known === "running" || (await dependencies.hostRuns(sessionId)),
        queued: (await dependencies.sessionQueues.get(sessionId)).messages.length,
      };
    },
    async activity() {
      const { store: sessions } = dependencies.engine;
      const rows = await Promise.all(
        (await sessions.projects()).map((project) => sessions.summaries(project.id)),
      );
      return rows.flat().map((row) => ({
        sessionId: row.id,
        lastActivityAt: row.lastActivityAt ?? row.updatedAt,
        pinned: row.pinned === true,
        archived: row.archived === true,
        running: row.status === "running",
        needsInput: row.needsInput === true,
      }));
    },
    now: Date.now,
  };
  const lifecycle = createSessionLifecycleService(store, ports);

  // New work wakes a settled session once the Host accepted it; Stop and answers never do.
  const commands = dependencies.commandService;
  const dispatch = commands.dispatch.bind(commands);
  commands.dispatch = async (raw, context, options) => {
    const result = await dispatch(raw, context, options);
    const command = raw as { type?: unknown; sessionId?: unknown } | null;
    if (typeof command?.type === "string" && WAKING_COMMANDS.has(command.type))
      await lifecycle.wake(String(command.sessionId ?? "")).catch(warn);
    return result;
  };
  const queues = dependencies.sessionQueueService;
  const change = queues.change.bind(queues);
  queues.change = async (params, context, options) => {
    const result = await change(params, context, options);
    await lifecycle.wake(String((params as { sessionId?: unknown }).sessionId ?? "")).catch(warn);
    return result;
  };

  // A turn ended: a settle that waited for it applies now.
  const settled = dependencies.engine.onSettled;
  dependencies.engine.onSettled = async (id, outcome) => {
    await settled?.(id, outcome);
    await lifecycle.turnEnded(id, outcome).catch(warn);
  };

  // A deleted session or task must not leave a lifecycle row or link behind.
  const deleteQueue = dependencies.sessionQueues.delete.bind(dependencies.sessionQueues);
  dependencies.sessionQueues.delete = async (id) => {
    await deleteQueue(id);
    await store.update(id, () => ({ result: undefined })).catch(warn);
    await links.unlink(id).catch(warn);
  };
  const taskDeleted = dependencies.tasks.onDelete;
  dependencies.tasks.onDelete = (task) => {
    taskDeleted?.(task);
    void links
      .prune(
        () => true,
        (id) => id !== task.id,
      )
      .catch(warn);
  };

  // Settles that were waiting when the Host stopped apply now; idle sessions settle hourly.
  await lifecycle.recover().catch(warn);
  const autoSettle = () => void lifecycle.autoSettle().catch(warn);
  autoSettle();
  const timer = setInterval(autoSettle, AUTO_SETTLE_INTERVAL_MS);
  timer.unref?.();
  return { activity, lifecycle, links, autoSettle, stop: () => clearInterval(timer) };
}

export type AccountPlatformRuntime = Awaited<ReturnType<typeof createAccountPlatformRuntime>>;
