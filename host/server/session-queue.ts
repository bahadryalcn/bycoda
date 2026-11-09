import { type HostSession } from "../../src/features/connections/model/protocol";
import { LeaseHeldError } from "../../src/features/sync/model/runLease";
import { refuseHost } from "../domains/context";
import { QueueDrainer, queueRowCommands } from "../sessions/queue-drainer";
import type { ServerBindings } from "./bindings";
import { WATCH_STAMP_MS } from "./support";
export async function createSessionQueueRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "desktop"
    | "runLeases"
    | "sessionRead"
    | "featureMeta"
    | "sessionQueues"
    | "queueSessionKnown"
    | "adopt"
    | "touchSessionWorkspace"
    | "withRetiredDesktopWriters"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createSessionQueueRuntime>>) => void,
) {
  publish({
    get unreadableDesktopCopies() {
      return unreadableDesktopCopies;
    },
    get refresh() {
      return refresh;
    },
    get desktopWatch() {
      return desktopWatch;
    },
    get desktopRunHolder() {
      return desktopRunHolder;
    },
    get hostRuns() {
      return hostRuns;
    },
    get assertHostMayRun() {
      return assertHostMayRun;
    },
    get usageLimits() {
      return usageLimits;
    },
    get usageLimited() {
      return usageLimited;
    },
    get queueDrainer() {
      return queueDrainer;
    },
  });

  /** Pulls turns the desktop app ran in an adopted session since. */
  /** Desktop copies that could not be read, by the stamp they had then. */
  const unreadableDesktopCopies = new Map<string, number>();
  const refresh = async (
    id: string,
    known?: { updatedAt: number; running: boolean },
    signal?: AbortSignal,
  ) => {
    let current;
    try {
      current = await dependencies.engine.store.session(id, signal);
    } catch {
      return;
    }
    if (!current.desktop) return;
    if (current.authorityGeneration !== undefined) return;
    const stamp = known ?? (await dependencies.desktop.stampAsync(id, 0, signal));
    if (!stamp) return;
    if (stamp.running)
      throw new LeaseHeldError(dependencies.runLeases.holder(id)?.holder ?? "desktop");
    if (stamp.updatedAt <= current.desktop.updatedAt) return;
    // Cheap guards first: a session the host is running or rewinding is left
    // alone anyway, and an unreadable copy stays unreadable until it changes.
    if (current.status === "running" || dependencies.engine.desktopRefreshBlocked(id)) return;
    if (unreadableDesktopCopies.get(id) === stamp.updatedAt) return;
    const project = await dependencies.sessionRead(signal, () =>
      dependencies.engine.store.project(current.projectId),
    );
    const snapshot = await dependencies.desktop.snapshotAsync(id, project.id, project.cwd, signal);
    if (snapshot) {
      unreadableDesktopCopies.delete(id);
      signal?.throwIfAborted();
      // Accepted refresh mutation retains its original owner through settlement.
      await dependencies.engine.refreshFromDesktop(snapshot);
    } else {
      unreadableDesktopCopies.set(id, stamp.updatedAt);
      while (unreadableDesktopCopies.size > 256)
        unreadableDesktopCopies.delete(unreadableDesktopCopies.keys().next().value!);
    }
  };
  /** Where watchers of `id` should look: the desktop app's copy for a
   * desktop-only session, or for an adopted one the app is running a turn in. */
  const desktopWatch = async (id: string, polling = false, signal?: AbortSignal) => {
    if (!id) return undefined;
    let hosted: HostSession | undefined;
    try {
      hosted = await dependencies.engine.store.session(id, signal);
    } catch {
      /* desktop-only */
    }
    if (hosted && (!hosted.desktop || hosted.status === "running")) return undefined;
    const stamp = await dependencies.desktop.stampAsync(id, polling ? WATCH_STAMP_MS : 0, signal);
    if (!stamp) return undefined;
    if (hosted && !stamp.running) return undefined;
    const overlay = dependencies.desktop.live.overlay(id);
    return {
      projectId: hosted?.projectId,
      running: stamp.running,
      revision: Math.max(stamp.updatedAt, overlay?.changedAt ?? 0),
    };
  };
  /** Who runs a turn of `id` outside the host: a desktop window holding the run
   * lease, or an app that reports it busy without having asked for one. */
  const desktopRunHolder = async (id: string): Promise<Awaited<string | undefined>> =>
    dependencies.runLeases.holder(id)?.holder ??
    ((await desktopWatch(id))?.running ? "desktop" : undefined);
  const hostRuns = async (id: string) => {
    try {
      return (await dependencies.engine.store.sessionStatus(id)) === "running";
    } catch {
      return false;
    }
  };
  /** The conversation may start a turn on this host, or `LEASE_HELD`: callers queue the message. */
  const assertHostMayRun = async (id: string) => {
    const holder = await desktopRunHolder(id);
    // Refused before any turn starts: a wait for the queue, never an unknown send.
    if (holder) throw refuseHost(new LeaseHeldError(holder), "LEASE_HELD", "conflict", true);
  };
  /** Whether a conversation waits for the owner to answer a usage limit, read again only when it moved. */
  const usageLimits = new Map<string, { key: string; limited: boolean }>();
  const usageLimited = async (id: string): Promise<Awaited<boolean>> => {
    const key = `${(await dependencies.engine.store.sessionRevision(id)) ?? ""}\0${(await dependencies.desktop.stampAsync(id))?.updatedAt ?? ""}`;
    const known = usageLimits.get(id);
    if (known?.key === key) return known.limited;
    const limited = !!(await dependencies.featureMeta(id)).session.usageLimit;
    usageLimits.delete(id);
    usageLimits.set(id, { key, limited });
    while (usageLimits.size > 256) usageLimits.delete(usageLimits.keys().next().value!);
    return limited;
  };
  /** Sends the head of a queue nobody holds the drain lease for. */
  const queueDrainer = new QueueDrainer(
    dependencies.sessionQueues,
    {
      outsideScope: (action) => dependencies.engine.store.db.outsideScope(action),
      ready: async (id) => {
        try {
          return (
            !(await dependencies.engine.busyReason(id)) &&
            // The host's own turn, including one in an adopted session the desktop
            // copy does not know is running.
            !(await hostRuns(id)) &&
            // The desktop's running state is covered by its run-holder stamp below.
            !(await desktopRunHolder(id)) &&
            (await dependencies.queueSessionKnown(id)) !== "running" &&
            !(await usageLimited(id))
          );
        } catch {
          return false;
        }
      },
      send: async (id, row) => {
        await dependencies.adopt(id);
        for (const command of queueRowCommands(
          id,
          row,
          (await dependencies.engine.store.session(id)).session,
        ))
          await dependencies.engine.command(command);
        await dependencies.touchSessionWorkspace(id);
      },
      // Writer ACKs arrive through another RPC. Await them before taking the
      // store transaction, while keeping queue dispatch and consume atomic.
      transaction: async (action, id) =>
        id
          ? await dependencies.withRetiredDesktopWriters(id, () =>
              dependencies.engine.store.transaction(action, "critical"),
            )
          : await dependencies.engine.store.transaction(action, "critical"),
      wakeAt: () => {
        const times = [
          dependencies.runLeases.nextExpiry(),
          dependencies.desktop.live.nextStoredExpiry(),
        ].filter((time): time is number => time !== undefined);
        return times.length ? Math.min(...times) : undefined;
      },
      expired: () => {
        dependencies.runLeases.takeExpired();
      },
    },
    Date.now,
    false,
  );
  dependencies.engine.onSettled = async (id, outcome) => {
    await dependencies.touchSessionWorkspace(id);
    await queueDrainer.settled(id, outcome);
  };
  // A turn found running at startup was cut short: its queue waits for the owner.
  for (const id of dependencies.engine.recoveredInterrupted)
    await queueDrainer.settled(id, {
      interrupted: true,
      reason: "Host restarted. This turn was interrupted; inspect its work before continuing.",
    });
  dependencies.engine.onUnblocked = () => queueDrainer.kickWaiting();
  return {
    unreadableDesktopCopies,
    refresh,
    desktopWatch,
    desktopRunHolder,
    hostRuns,
    assertHostMayRun,
    usageLimits,
    usageLimited,
    queueDrainer,
  };
}
