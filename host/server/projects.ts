import {
  readProviderAccountStyles,
  providerDefaultAccounts,
} from "../providers/provider-account-styles";
import { readDisabledModels } from "../providers/disabled-models";
import { applyDisabledModels } from "../domains/models/disabled-models";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { readHarnessAuthStatus } from "../../src/integrations/harness/core/authStatus";
import { resolveAntigravityBinary } from "../../src/integrations/harness/core/child";
import { STREAM_MODE_LIMITS } from "../../src/integrations/harness/providers/antigravity/antigravityStreamProtocol";
import type { HostModelCatalog } from "../../src/features/connections/model/protocol";
import { ConversationDelegation } from "../delegation/service";
import { hostWarnDeduped } from "../diagnostics/log-dedupe";
import {
  enqueueAgentParentMessage,
  NOTICE_WATCH_MS,
  noticeUndelivered,
} from "../delegation/message-delivery";
import { ConversationGoalTools } from "../conversation/conversation-goal-tools";
import { ConversationSecretTools } from "../secrets/conversation-secret-tools";
import { SecretStore, osSecretValues } from "../secrets/secret-store";
import { PullRequestWatches } from "../pull-request-watch/pull-request-watch";
import { ghPrReader } from "../pull-request-watch/assistant-pr-reader";
import { PullRequestWatchTools } from "../pull-request-watch/pull-request-watch-tools";
import { ConversationProjectTools } from "../conversation/conversation-project-tools";
import { ConversationRuntimeReadTools } from "../conversation/conversation-runtime-read-tools";
import { ConversationStewardTools } from "../conversation/conversation-steward-tools";
import { ConversationTaskQueueTools } from "../conversation/conversation-task-queue-tools";
import { branchCache } from "../git/git-actions";
import { GitWatches } from "../git/git-watch";
import { ModelCatalogCache } from "../providers/model-catalog-cache";
import { CodexCatalogStore, codexCatalogIdentity } from "../providers/codex-catalog-store";
import { CodexCatalogSignedOut } from "../../src/integrations/harness/providers/codex/codexCatalog";
import { TranscriptPages } from "../sessions/transcriptPage";
import { RevisionWaits } from "../storage/revisionWait";
import { SyncTransfers } from "../sync/sync-transfer";
import { RemoteChanges } from "../workspaces/remoteChanges";
import { AssistantQuotaReader } from "../assistant/models/assistant-quota-reader";
import { readUsageLimits } from "../usage/limits-report";
import { hostUsageLimitsDeps } from "./usage-limits-deps";
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
    | "assistant"
    | "sessionQueues"
  >,
) {
  // Modes a resolved transport refuses (headless agy cannot ask before editing), so remote
  // pickers grey them out as the desktop does. Refreshed with each provider's discovery.
  const runtimeModeLimits: NonNullable<HostModelCatalog["runtimeModeLimits"]> = {};
  const catalogs = new ModelCatalogCache(
    [...new Set([...dependencies.providers, "acp" as const])],
    async () => await providerBinaries(dependencies.providers),
    async (provider, cwd) => {
      if (provider === "antigravity") {
        const binary = await resolveAntigravityBinary().catch(() => undefined);
        if (binary?.transport === "stream-json")
          runtimeModeLimits.antigravity = STREAM_MODE_LIMITS.runtimeModes;
        else delete runtimeModeLimits.antigravity;
      }
      const discovered =
        provider === "acp"
          ? (await dependencies.genericAcp.list()).map((config) => ({
              id: `acp:${config.id}`,
              nativeId: config.id,
              harness: "acp" as const,
              name: config.name,
              contextWindow: config.contextWindow,
            }))
          : await discoverModels[provider](cwd).catch((error: unknown) => {
              if (error instanceof CodexCatalogSignedOut) return [];
              throw error;
            });
      if (discovered.length || provider === "acp") setHarnessModels(provider, discovered);
      return discovered;
    },
    undefined,
    dependencies.providers.includes("codex")
      ? {
          store: new CodexCatalogStore(
            join(dirname(dependencies.engine.store.attachmentDir), "codex-model-catalog.json"),
            dependencies.engine.store.environmentId,
          ),
          identity: codexCatalogIdentity,
        }
      : undefined,
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
  const remoteChanges = new RemoteChanges(signal, WATCH_STAMP_MS);
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
  const models = async (
    projectId?: unknown,
    progressive = false,
    force = false,
  ): Promise<HostModelCatalog> => {
    const catalog = await catalogs.read(
      typeof projectId === "string"
        ? (await dependencies.engine.store.project(projectId)).cwd
        : homedir(),
      progressive,
      force,
    );
    return Object.keys(runtimeModeLimits).length
      ? { ...catalog, runtimeModeLimits: { ...runtimeModeLimits } }
      : catalog;
  };
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
  const secretsDirectory = join(dirname(dependencies.engine.store.attachmentDir), "secrets");
  const conversationSecrets = new ConversationSecretTools(
    dependencies.engine.store,
    dependencies.conversationDesktop,
    new SecretStore({
      directory: secretsDirectory,
      values: osSecretValues(secretsDirectory, dependencies.engine.store.environmentId),
    }),
    dependencies.featureSession,
  );
  const pullRequestWatch = new PullRequestWatches({
    archiveLink: {
      record: (id, url, state) =>
        recordArchivePullRequest(dependencies.engine.store, id, url, state),
      forget: (id, url) => forgetArchivePullRequest(dependencies.engine.store, id, url),
    },
    file: join(dirname(dependencies.engine.store.attachmentDir), "pull-request-watches.json"),
    store: dependencies.engine.store,
    engine: dependencies.engine,
    gh: async (cwd, args) => await workspace.ghCommand(cwd, args),
    branchPullRequest: async (cwd) =>
      (await workspace.run("git_pr_status", { cwd })) as { url: string } | null,
  });
  // Session lists carry each watch as a wake source; a started or ended watch re-reads them.
  pullRequestWatch.onChange = () => signal.notify();
  const pullRequestWatchTools = new PullRequestWatchTools(pullRequestWatch);
  // The Room's Host-level watches read through the same gh, never writing.
  dependencies.assistant.tracked.prWatch.reader = ghPrReader(
    (cwd, args) => workspace.ghCommand(cwd, args),
    async (projectId) => (await dependencies.engine.store.project(projectId)).cwd,
  );
  const conversationTaskQueue = new ConversationTaskQueueTools(dependencies.tasks);
  const conversationDelegation = new ConversationDelegation({
    engine: dependencies.engine,
    directory: dirname(dependencies.engine.store.attachmentDir),
    featureSession: dependencies.featureSession,
    enqueueParent: async (sessionId, id, text, author) => {
      await enqueueAgentParentMessage(dependencies.sessionQueues, sessionId, id, text, author);
      if (!author) return;
      // The trail for a parent that never continues: when the notice was queued, and
      // whether its consumer (the desktop for a Native parent) had taken it minutes later.
      console.info(`Subagent notice queued for ${sessionId} (${author.reason})`);
      setTimeout(() => {
        noticeUndelivered(dependencies.sessionQueues, sessionId).then(
          (waiting) => {
            if (waiting)
              hostWarnDeduped(
                `Subagent notice for ${sessionId} is still undelivered after ${NOTICE_WATCH_MS / 60_000} min`,
              );
          },
          () => {}, // -- a diagnostic read; the Host may be closing.
        );
      }, NOTICE_WATCH_MS).unref();
    },
    models: async (projectId) =>
      applyDisabledModels(
        await models(projectId),
        await readDisabledModels(dependencies.engine.store),
      ),
    providers: dependencies.providers,
    authStatus: readHarnessAuthStatus,
    // The same provider quota samples that skip spent entries in the model order.
    quota: new AssistantQuotaReader({
      readLimits: () =>
        readUsageLimits(hostUsageLimitsDeps(dependencies.engine.store.environmentId)),
    }),
    defaultAccounts: async () =>
      providerDefaultAccounts(await readProviderAccountStyles(dependencies.engine.store)),
  });
  dependencies.tasks.repairDelegation = conversationDelegation;
  dependencies.engine.onParentStopped = async (sessionId, options) =>
    await conversationDelegation.cancelChildren(sessionId, options);
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
    conversationSecrets,
    pullRequestWatch,
    pullRequestWatchTools,
    conversationTaskQueue,
    conversationDelegation,
    conversationStewards,
    conversationRuntimeReads,
  };
}
import {
  recordArchivePullRequest,
  forgetArchivePullRequest,
} from "../settings-defaults/pull-request-links";
