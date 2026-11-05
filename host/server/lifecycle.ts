import { installAssistantObservationProducers } from "../assistant/observations/assistant-observation-producers";
import { perfMetrics } from "../diagnostics/perf-metrics";
import type { ServerBindings } from "./bindings";
import { guardUnhandledRejections } from "./support";
export async function createLifecycleRuntime(
  dependencies: Pick<
    ServerBindings,
    | "server"
    | "closing"
    | "engine"
    | "managed"
    | "queueDrainer"
    | "crews"
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
  let resourceClose: Promise<void> | undefined;
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
  const closeResources = (): Promise<void> => {
    if (resourceClose) return resourceClose;
    dependencies.closing = true;
    releaseRejectionGuard();
    resourceClose = dependencies.engine.store.db.outsideScope(async () => {
      const pending: Promise<unknown>[] = [];
      const drain = (action: () => unknown) => {
        try {
          pending.push(Promise.resolve(action()));
        } catch (error) {
          pending.push(Promise.reject(error));
        }
      };
      drain(() => dependencies.controls?.nativeAuthorityBootstrap?.close());
      drain(async () => await dependencies.websocket.close());
      drain(() => dependencies.nativeBufferUploads.close());
      drain(() => dependencies.nativeServiceUploads.close());
      drain(() => {
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
      drain(() => dependencies.managed.retention.stop());
      drain(() => dependencies.managed.nativeActivity.closeBufferRecoveryCatalog());
      drain(async () => await dependencies.queueDrainer.close());
      drain(() => dependencies.localVoice.close());
      drain(() => dependencies.assistant.close());
      drain(() => dependencies.assistantKeepAwake.close());
      drain(() => dependencies.managedAssistantSessions.close());
      drain(() => dependencies.desktopControl.close());
      drain(() => dependencies.desktopHelper.close());
      dependencies.engine.ownerInstructions = dependencies.previousOwnerInstructions;
      drain(() => dependencies.voiceSetup.close());
      drain(() => dependencies.crews.close());
      drain(() => dependencies.attachmentOwnership.close());
      drain(async () => await dependencies.terminals.close());
      drain(() => dependencies.devServerAccess.close());
      drain(() => dependencies.devServers.close());
      drain(() => dependencies.gitWatches.close());
      drain(() => dependencies.diagnostics.close());
      drain(() => perfMetrics.close());
      drain(async () => await dependencies.devicePreviews.dispose());
      drain(async () => await dependencies.deviceHost.dispose());
      drain(async () => await dependencies.sharedBrowser.close());
      drain(() => dependencies.conversationPreviews.close());
      drain(async () => await dependencies.logMonitors.close());
      drain(async () => await dependencies.tunnels.close());
      drain(async () => await dependencies.desktop.closeAsync());
      drain(() => dependencies.desktopDelete.close());
      drain(() => dependencies.desktop.live.closeWriterTransfers());
      drain(() => dependencies.mobilePairing.close());
      drain(async () => await dependencies.mobileLan.close());
      drain(() => dependencies.conversationDesktop.close());
      drain(async () => await dependencies.hostNotes.close());
      drain(async () => await dependencies.social.stop());
      drain(async () => await dependencies.xBrowser.stop(dependencies.social));
      // Attach rejection handlers immediately while startup is still settling.
      const drained = Promise.allSettled(pending);
      const requested = Promise.allSettled(dependencies.requests);
      await startup.catch(() => {});
      // A start already inside an async phase must not register a late loop.
      dependencies.crews.stop();
      dependencies.attachmentOwnership.close();
      const final = Promise.allSettled([dependencies.social.dispose(), requested]);
      const results = [...(await drained), ...(await final)];
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "Host resources did not all close cleanly.");
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
