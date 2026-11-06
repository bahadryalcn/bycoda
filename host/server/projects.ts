import { homedir } from "node:os";
import { dirname } from "node:path";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { ConversationDelegation } from "../delegation/service";
import { ConversationGoalTools } from "../conversation/conversation-goal-tools";
import { ConversationProjectTools } from "../conversation/conversation-project-tools";
import { ConversationRuntimeReadTools } from "../conversation/conversation-runtime-read-tools";
import { ConversationStewardTools } from "../conversation/conversation-steward-tools";
import { ConversationTaskQueueTools } from "../conversation/conversation-task-queue-tools";
import { branchCache } from "../git/git-actions";
import { GitWatches } from "../git/git-watch";
import { ModelCatalogCache } from "../providers/model-catalog-cache";
import { TranscriptPages } from "../sessions/transcriptPage";
import { RevisionWaits } from "../storage/revisionWait";
import { SyncTransfers } from "../sync/sync-transfer";
import { RemoteChanges } from "../workspaces/remoteChanges";
import { WorkspaceCommands } from "../workspaces/workspace-commands";
import type { ServerBindings } from "./bindings";
import { discoverModels, providerBinaries, WATCH_STAMP_MS } from "./support";
export function createProjectsRuntime(
  dependencies: Pick<
    ServerBindings,
    | "providers"
    | "genericAcp"
    | "engine"
    | "desktop"
    | "queueDrainer"
    | "tasks"
    | "managedWorkspaces"
    | "managed"
    | "startWorkspaceActivity"
    | "goals"
    | "stewards"
    | "automations"
    | "featureSession"
    | "inHost"
    | "conversationDesktop"
  >,
) {
  const catalogs = new ModelCatalogCache(
    [...new Set([...dependencies.providers, "acp" as const])],
    async () => await providerBinaries(dependencies.providers),
    async (provider, cwd) => {
      const discovered =
        provider === "acp"
          ? (await dependencies.genericAcp.list()).map((config) => ({
              id: `acp:${config.id}`,
              nativeId: config.id,
              harness: "acp" as const,
              name: config.name,
              contextWindow: config.contextWindow,
            }))
          : await discoverModels[provider](cwd);
      if (discovered.length || provider === "acp") setHarnessModels(provider, discovered);
      return discovered;
    },
  );
  const transfers = new SyncTransfers();
  const desktopRecheckMs = async (id: string): Promise<Awaited<number>> => {
    const hosted = await dependencies.engine.store.sessionStateMetadata(id);
    return (!hosted || (hosted.desktop && hosted.status !== "running")) &&
      (await dependencies.desktop.stampAsync(id, WATCH_STAMP_MS))?.running
      ? WATCH_STAMP_MS
      : 1000;
  };
  const signal = dependencies.engine.store.changes;
  // Generations of inputs the project list reads besides the store: the desktop
  // heartbeat and watched checkouts. They key the cached list below.
  dependencies.desktop.live.onChange = () => {
    signal.notify();
    dependencies.queueDrainer.kickWaiting();
  };
  dependencies.tasks.onChange = () => signal.notify();
  const revisionWaits = new RevisionWaits(64, signal);
  const transcriptPages = new TranscriptPages();
  const remoteChanges = new RemoteChanges(signal);
  const gitWatches = new GitWatches({
    onChange: (cwd, change) => {
      if (!change || change.refs) branchCache.clear(cwd);
      signal.notify();
    },
  });
  const workspace = new WorkspaceCommands(
    dependencies.engine.store,
    async (projectId, action) => await dependencies.engine.withIdleProject(projectId, action),
    dependencies.engine.checkpoints,
    {
      registry: dependencies.managedWorkspaces,
      service: dependencies.managed.delivery,
      startMutation: async (cwd) =>
        dependencies.startWorkspaceActivity(cwd, "mutation", "workspace-command"),
    },
  );
  const models = async (projectId?: unknown, progressive = false, force = false) =>
    await catalogs.read(
      typeof projectId === "string"
        ? (await dependencies.engine.store.project(projectId)).cwd
        : homedir(),
      progressive,
      force,
    );
  const conversationProject = new ConversationProjectTools(
    dependencies.engine.store,
    dependencies.goals,
    dependencies.engine.checkpoints,
    dependencies.providers,
    models,
    {
      stewards: dependencies.stewards,
      automations: dependencies.automations,
      session: dependencies.featureSession,
      checkpoints: async (sessionId, principal, authorized) =>
        (await dependencies.inHost(sessionId))
          ? dependencies.engine.checkpoints
          : {
              status: async (id, cwd) =>
                (await dependencies.conversationDesktop.call(
                  "checkpoints.status",
                  { sessionId: id },
                  cwd,
                  principal,
                  authorized,
                )) as Awaited<ReturnType<typeof dependencies.engine.checkpoints.status>>,
              fileDiff: async (id, cwd, relative) =>
                (await dependencies.conversationDesktop.call(
                  "checkpoints.diff",
                  { sessionId: id, relative },
                  cwd,
                  principal,
                  authorized,
                )) as Awaited<ReturnType<typeof dependencies.engine.checkpoints.fileDiff>>,
            },
    },
  );
  const conversationGoals = new ConversationGoalTools(
    dependencies.engine.store,
    dependencies.goals,
    dependencies.tasks,
    dependencies.featureSession,
  );
  const conversationTaskQueue = new ConversationTaskQueueTools(dependencies.tasks);
  const conversationDelegation = new ConversationDelegation({
    engine: dependencies.engine,
    directory: dirname(dependencies.engine.store.attachmentDir),
    featureSession: dependencies.featureSession,
    models,
    providers: dependencies.providers,
  });
  dependencies.engine.onParentStopped = async (sessionId) =>
    await conversationDelegation.cancelChildren(sessionId);
  const conversationStewards = new ConversationStewardTools(
    dependencies.engine.store,
    dependencies.stewards,
    dependencies.tasks,
  );
  const conversationRuntimeReads = new ConversationRuntimeReadTools(
    dependencies.engine.store,
    dependencies.tasks.limits,
    undefined,
    undefined,
    dependencies.featureSession,
  );
  return {
    catalogs,
    transfers,
    desktopRecheckMs,
    signal,
    revisionWaits,
    transcriptPages,
    remoteChanges,
    gitWatches,
    workspace,
    models,
    conversationProject,
    conversationGoals,
    conversationTaskQueue,
    conversationDelegation,
    conversationStewards,
    conversationRuntimeReads,
  };
}
