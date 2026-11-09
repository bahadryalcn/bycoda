import { installAssistantObservationProducers } from "../assistant/observations/assistant-observation-producers";
import { perfMetrics } from "../diagnostics/perf-metrics";
import type { ServerBindings } from "./bindings";
import { guardUnhandledRejections } from "./support";
/** Total time a stopping Host may spend draining before it force-exits. */
export const HOST_SHUTDOWN_DEADLINE_MS = 45_000;

type ClosePromise = Promise<void> & { pendingDrains(): string[] };

/**
 * Hard stop for a drain that never settles: a dead listener must not keep the
 * process alive, so the service manager can restart from a clean state.
 * Returns a disarm function.
 */
export function armShutdownDeadline(
  pending: () => string[],
  options: {
    ms?: number;
    exit?: (code: number) => unknown;
    log?: (line: string) => void;
  } = {},
): () => void {
  const ms = options.ms ?? HOST_SHUTDOWN_DEADLINE_MS;
  const timer = setTimeout(() => {
    (options.log ?? console.error)(
      `Host shutdown exceeded ${Math.round(ms / 1000)}s; forcing exit. Pending: ${pending().join(", ") || "unknown"}.`,
    );
    (options.exit ?? process.exit)(1);
  }, ms);
  return () => clearTimeout(timer);
}

export async function createLifecycleRuntime(
  dependencies: Pick<
    ServerBindings,
    | "server"
    | "closing"
    | "engine"
    | "managed"
    | "queueDrainer"
    | "crews"
    | "pullRequestWatch"
    | "conversationSecrets"
    | "assistant"
    | "attachmentOwnership"
    | "mobileLan"
    | "social"
    | "controls"
    | "websocket"
    | "nativeBufferUploads"
    | "nativeServiceUploads"
    | "unsubscribeChanges"
    | "unsubscribeAuthorization"
    | "unsubscribeAuthority"
    | "tasks"
    | "taskDeleted"
    | "previousTaskDelete"
    | "goals"
    | "goalDeleted"
    | "previousGoalDelete"
    | "automations"
    | "automationDeleted"
    | "previousAutomationDelete"
    | "stewards"
    | "stewardDeleted"
    | "previousStewardDelete"
    | "crewDefinitionDeleted"
    | "previousCrewDefinitionDeleted"
    | "crewAgentDeleted"
    | "previousCrewAgentDeleted"
    | "crewRunDeleted"
    | "previousCrewRunDeleted"
    | "subscriptionHub"
    | "bulkTransfers"
    | "localVoice"
    | "assistantKeepAwake"
    | "managedAssistantSessions"
    | "desktopControl"
    | "desktopHelper"
    | "previousOwnerInstructions"
    | "voiceSetup"
    | "pushNotifications"
    | "terminals"
    | "devServerAccess"
    | "devServers"
    | "gitWatches"
    | "diagnostics"
    | "devicePreviews"
    | "deviceHost"
    | "sharedBrowser"
    | "conversationPreviews"
    | "logMonitors"
    | "tunnels"
    | "desktop"
    | "desktopDelete"
    | "mobilePairing"
    | "conversationDesktop"
    | "hostNotes"
    | "xBrowser"
    | "requests"
    | "providerInbox"
    | "socialPeers"
    | "mcpHttp"
    | "observationCoverage"
    | "observationJournal"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createLifecycleRuntime>>) => void,
) {
  publish({
    get releaseRejectionGuard() {
      return releaseRejectionGuard;
    },
    get startup() {
      return startup;
    },
    set startup(value: typeof startup) {
      startup = value;
    },
    get resourceClose() {
      return resourceClose;
    },
    set resourceClose(value: typeof resourceClose) {
      resourceClose = value;
    },
    get closeResources() {
      return closeResources;
    },
  });

  const releaseRejectionGuard = guardUnhandledRejections();
  let startup: Promise<void> = Promise.resolve();
  let resourceClose: ClosePromise | undefined;
  const pendingDrainLabels = new Set<string>();
  dependencies.server.on("listening", () => {
    if (dependencies.closing) return;
    startup = dependencies.engine.store.db.outsideScope(async () => {
      // Keep the actual startup promises owned through shutdown, even after a
      // deadline warning. Independent starts must not wait behind a hung peer.
      const step = async (name: string, action: () => unknown) => {
        if (dependencies.closing) return;
        const timer = setTimeout(() => {
          if (!dependencies.closing)
            console.warn(
              `Host background startup step "${name}" has not settled after 30 seconds.`,
            );
        }, 30_000);
        timer.unref();
        try {
          await action();
        } catch (error) {
          if (!dependencies.closing)
            console.warn(
              `Host background startup step "${name}" failed: ${error instanceof Error ? error.name : "Error"}.`,
            );
        } finally {
          clearTimeout(timer);
        }
      };
      await Promise.all([
        step("retention", () => dependencies.managed.retention.start()),
        step("queue-drainer", () => dependencies.queueDrainer.start()),
        step("crews", () => dependencies.crews.start()),
        step("pull-request-watch", () => dependencies.pullRequestWatch.start()),
        step("conversation-secrets", () => dependencies.conversationSecrets.start()),
        step("assistant", () => dependencies.assistant.start()),
        step("perf-metrics", () => perfMetrics.start()),
        step("attachment-ownership", () => dependencies.attachmentOwnership.start()),
        step("mobile-lan", () => dependencies.mobileLan.start()),
        step("social", () => dependencies.social.start()),
      ]);
    });
    void startup.catch(() => {
      if (!dependencies.closing) console.warn("Host background startup failed.");
    });
  });
  // Node does not await EventEmitter listeners. The CLI and fixtures await this
  // same promise before closing the engine/actor; flags are set before any await.
  const closeResources = (): ClosePromise => {
    if (resourceClose) return resourceClose;
    dependencies.closing = true;
    releaseRejectionGuard();
    const closing = dependencies.engine.store.db.outsideScope(async () => {
      const pending: Promise<unknown>[] = [];
      const drain = (name: string, action: () => unknown) => {
        pendingDrainLabels.add(name);
        let result: Promise<unknown>;
        try {
          result = Promise.resolve(action());
        } catch (error) {
          result = Promise.reject(error);
        }
        pending.push(result.finally(() => pendingDrainLabels.delete(name)));
      };
      drain("nativeAuthorityBootstrap", () =>
        dependencies.controls?.nativeAuthorityBootstrap?.close(),
      );
      drain("websocket", async () => await dependencies.websocket.close());
      drain("nativeBufferUploads", () => dependencies.nativeBufferUploads.close());
      drain("nativeServiceUploads", () => dependencies.nativeServiceUploads.close());
      drain("listeners", () => {
        dependencies.unsubscribeChanges();
        dependencies.unsubscribeAuthorization();
        dependencies.unsubscribeAuthority();
        if (dependencies.tasks.onDelete === dependencies.taskDeleted)
          dependencies.tasks.onDelete = dependencies.previousTaskDelete;
        if (dependencies.goals.onDelete === dependencies.goalDeleted)
          dependencies.goals.onDelete = dependencies.previousGoalDelete;
        if (dependencies.automations.onDelete === dependencies.automationDeleted)
          dependencies.automations.onDelete = dependencies.previousAutomationDelete;
        if (dependencies.stewards.onDelete === dependencies.stewardDeleted)
          dependencies.stewards.onDelete = dependencies.previousStewardDelete;
        if (dependencies.crews.onDefinitionDeleted === dependencies.crewDefinitionDeleted)
          dependencies.crews.onDefinitionDeleted = dependencies.previousCrewDefinitionDeleted;
        if (dependencies.crews.onAgentDeleted === dependencies.crewAgentDeleted)
          dependencies.crews.onAgentDeleted = dependencies.previousCrewAgentDeleted;
        if (dependencies.crews.onRunDeleted === dependencies.crewRunDeleted)
          dependencies.crews.onRunDeleted = dependencies.previousCrewRunDeleted;
        dependencies.subscriptionHub.close();
        dependencies.bulkTransfers.close();
      });
      drain("retention", () => dependencies.managed.retention.stop());
      drain("nativeActivity", () =>
        dependencies.managed.nativeActivity.closeBufferRecoveryCatalog(),
      );
      drain("queueDrainer", async () => await dependencies.queueDrainer.close());
      drain("localVoice", () => dependencies.localVoice.close());
      drain("assistant", () => dependencies.assistant.close());
      drain("assistantKeepAwake", () => dependencies.assistantKeepAwake.close());
      drain("managedAssistantSessions", () => dependencies.managedAssistantSessions.close());
      drain("desktopControl", () => dependencies.desktopControl.close());
      drain("desktopHelper", () => dependencies.desktopHelper.close());
      dependencies.engine.ownerInstructions = dependencies.previousOwnerInstructions;
      drain("voiceSetup", () => dependencies.voiceSetup.close());
      drain("pushNotifications", () => dependencies.pushNotifications.stop());
      drain("crews", () => dependencies.crews.close());
      drain("pullRequestWatch", () => dependencies.pullRequestWatch.close());
      drain("conversationSecrets", () => dependencies.conversationSecrets.close());
      drain("attachmentOwnership", () => dependencies.attachmentOwnership.close());
      drain("terminals", async () => await dependencies.terminals.close());
      drain("devServerAccess", () => dependencies.devServerAccess.close());
      drain("devServers", () => dependencies.devServers.close());
      drain("gitWatches", () => dependencies.gitWatches.close());
      drain("diagnostics", () => dependencies.diagnostics.close());
      drain("perfMetrics", () => perfMetrics.close());
      drain("devicePreviews", async () => await dependencies.devicePreviews.dispose());
      drain("deviceHost", async () => await dependencies.deviceHost.dispose());
      drain("sharedBrowser", async () => await dependencies.sharedBrowser.close());
      drain("conversationPreviews", () => dependencies.conversationPreviews.close());
      drain("logMonitors", async () => await dependencies.logMonitors.close());
      drain("tunnels", async () => await dependencies.tunnels.close());
      drain("desktop", async () => await dependencies.desktop.closeAsync());
      drain("desktopDelete", () => dependencies.desktopDelete.close());
      drain("desktopWriterTransfers", () => dependencies.desktop.live.closeWriterTransfers());
      drain("mobilePairing", () => dependencies.mobilePairing.close());
      drain("mobileLan", async () => await dependencies.mobileLan.close());
      drain("conversationDesktop", () => dependencies.conversationDesktop.close());
      drain("hostNotes", async () => await dependencies.hostNotes.close());
      drain("social", async () => await dependencies.social.stop());
      drain("xBrowser", async () => await dependencies.xBrowser.stop(dependencies.social));
      // Attach rejection handlers immediately while startup is still settling.
      const drained = Promise.allSettled(pending);
      const requested = Promise.allSettled(dependencies.requests).finally(() =>
        pendingDrainLabels.delete("requests"),
      );
      pendingDrainLabels.add("requests");
      pendingDrainLabels.add("startup");
      await startup.catch(() => {});
      pendingDrainLabels.delete("startup");
      // A start already inside an async phase must not register a late loop.
      dependencies.crews.stop();
      dependencies.attachmentOwnership.close();
      pendingDrainLabels.add("socialDispose");
      const final = Promise.allSettled([
        Promise.resolve(dependencies.social.dispose()).finally(() =>
          pendingDrainLabels.delete("socialDispose"),
        ),
        requested,
      ]);
      const results = [...(await drained), ...(await final)];
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "Host resources did not all close cleanly.");
    });
    resourceClose = Object.assign(closing, {
      pendingDrains: () => [...pendingDrainLabels],
    });
    return resourceClose;
  };
  dependencies.server.on("close", () => {
    void closeResources().catch(() => console.warn("Host resources did not all close cleanly."));
  });
  try {
    await dependencies.managed.recover((id) => dependencies.tasks.reconcileDelivery(id));
    await Promise.all([
      dependencies.attachmentOwnership.ready,
      dependencies.providerInbox.ready,
      dependencies.crews.ready,
      dependencies.social.ready,
      dependencies.socialPeers.ready,
      dependencies.mcpHttp.tokens.ready,
      dependencies.queueDrainer.ready,
      dependencies.tasks.ready,
      dependencies.goals.ready,
    ]);
    dependencies.observationCoverage = await installAssistantObservationProducers(
      dependencies.engine.store,
      dependencies.observationJournal,
    );
  } catch (error) {
    await closeResources().catch(() => {});
    throw error;
  }
  return {
    releaseRejectionGuard,
    get startup() {
      return startup;
    },
    set startup(value: typeof startup) {
      startup = value;
    },
    get resourceClose() {
      return resourceClose;
    },
    set resourceClose(value: typeof resourceClose) {
      resourceClose = value;
    },
    closeResources,
  };
}
