import { ModelCatalogCache } from "./model-catalog-cache";
import { createVoiceClientSecret } from "./voice";
import { LocalVoiceService } from "./voice-local";
import { inspectVoiceRuntime } from "./voice-runtime";
import { VoiceSetupService } from "./voice-setup";
import { readSessionUsage } from "./usage-report";
import {
  desktopActorId,
  desktopOperationId,
  desktopReviewSecret,
  openDesktopReview,
  sealDesktopReview,
  openDesktopResource,
  sealDesktopResource,
  type DesktopReviewScope,
} from "./reviewed-desktop-scope";
import { readHostAccess } from "./access-center";
import { inlineSessionSync } from "./inlineSessionSync";
import { HostCrews } from "./crews";
import { ConversationProjectTools, isProjectConversationTool } from "./conversation-project-tools";
import { callFileConversationTool, isFileConversationTool } from "./conversation-file-tools";
import {
  CONVERSATION_TASK_EXECUTION_DEFAULTS,
  TASK_READ_TOOLS,
  callConversationTaskRead,
  normalizeConversationTaskConfiguration,
} from "./conversation-task-tools";
import { ConversationGoalTools, isGoalWriteTool } from "./conversation-goal-tools";
import { ConversationTaskQueueTools, isTaskQueueTool } from "./conversation-task-queue-tools";
import { ConversationStewardTools, isStewardConversationTool } from "./conversation-steward-tools";
import {
  ConversationRuntimeReadTools,
  isRuntimeReadConversationTool,
} from "./conversation-runtime-read-tools";
import { probeNativeCodexImageCapability } from "./social-images";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { sessionConversationPage } from "../src/features/agent-app/model/sessionConversation";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpHttp } from "./mcp-http";
import { readHarnessSkill, searchHarnessSkills } from "./harness-skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { hostname, homedir } from "node:os";
import { RuntimeTerminalLogs } from "./runtime-terminal-logs";
import { HostTerminals } from "./terminals";
import { createManagedWorkspaceRuntime, inManagedWorkspace } from "./managed-workspace-runtime";
import { readHostBuildIdentity } from "./build-identity";
import { WORKSPACE_CAPABILITIES } from "./workspace-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import { createHash, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  HOST_PROTOCOL_VERSION,
  type HostSession,
  type HostSessionSummary,
  type RemoteProvider,
  type SessionSync,
} from "../src/features/connections/model/protocol";
import { HostEngine, parseCommand } from "./engine";
import { isClearSessionCommand } from "../src/features/sessions/model/newSessionCommand";
import { HostAutomations } from "./automations";
import { SocialService, type SocialPrincipal } from "./social";
import { createSessionAuthorityResolver } from "./session-authority";
import { socialAgentGenerator } from "./social-agent";
import { OsSocialCredentials } from "./social-credentials";
import { SocialTransport } from "./social-transport";
import { XBrowserSessions } from "./social-browser";
import { SocialPeers } from "./social-peers";
import { createSocialAdapters } from "../src/integrations/social/platformAdapters";
import { HostTasks } from "./tasks";
import { HostSprints } from "./sprints";
import type {
  SprintCreateInput,
  SprintUpdateInput,
  SprintCommand,
  SprintCompleteInput,
  SprintPlanInput,
  SprintIngestInput,
  SprintGoalContextInput,
} from "../src/features/tasks/model/hostSprints";
import { AttachmentOwnership } from "./attachment-ownership";
import { HostGoals } from "./goals";
import { HostStewards } from "./stewards";
import { basename, dirname, join } from "node:path";
import { DeviceHost } from "./device-host";
import { DevicePreviews } from "./device-preview";
import type { DeviceAction } from "../src/features/devices/types";
import { GenericAcpService, type GenericAcpMetadataPatch } from "./generic-acp";
import { HandoffHistoryStore } from "./handoff-history";
import { ResourceDiagnostics } from "./resource-diagnostics";
import { perfMetrics, mcpMetricName } from "./perf-metrics";
import { snapshotWeight } from "../src/features/connections/model/snapshotWeight";
import { performance } from "node:perf_hooks";
import { BrowserRuntime } from "./browser-runtime";
import { SharedBrowser } from "./shared-browser";
import { RuntimeLogMonitors } from "./runtime-log-monitors";
import { DevServersService } from "./dev-servers";
import { DevServerAccess } from "./dev-server-access";
import { RuntimeLogsService, scrubRuntimeLogText } from "./runtime-logs";
import { RuntimeLogAccess, runtimeLogToolQuery } from "./runtime-log-tools";
import {
  ConversationDesktopRelay,
  conversationToolCatalog,
  validateConversationTool,
} from "./conversation-tools";
import { openDevServerBrowser } from "./dev-server-browser";
import type { DevServerDetails } from "../src/features/host-tools/devServerTypes";
import { WebControl } from "./web-control";
import type { GenericAcpConfig } from "../src/features/providers/model/genericAcp";
import type { HandoffHistory } from "../src/features/sessions/model/handoffBudget";
import { DesktopSessions } from "./desktopSessions";
import { QueueDrainer, queueRowCommands } from "./queue-drainer";
import { SessionQueues } from "./session-queue";
import { RequestAuthorizationError } from "./store-db";
import { RunLeases } from "./run-lease";
import { LeaseHeldError, type RunLease } from "../src/features/sync/model/runLease";
import { AdoptedChanges } from "./adoptedChanges";
import { sameQueuedModelTarget } from "../src/features/sessions/model/messageQueue";
import { parseRemoteAttachments, resolveAttachments } from "./attachments";
import { DesktopDelete } from "./desktopDelete";
import { hostInbox } from "./host-notes";
import { AsyncHostNotes } from "./host-notes-async";
import {
  ConversationWorkspaceTools,
  isWorkspaceConversationTool,
} from "./conversation-workspace-tools";
import { ProviderInboxBridge } from "./provider-inbox";
import { MobilePairing } from "./mobile-pairing";
import { createMobileAccessService } from "./mobile-access";
import { MobileLanAccess } from "./mobile-lan";
import { ExternalTunnels } from "./tunnels";
import {
  parseRemoteInboxOperation,
  inboxOperationWrites,
} from "../src/features/inbox/model/remoteInbox";
import { branchCache } from "./git-actions";
import { withOverlay } from "./desktopLive";
import { writeAttachmentChunk, readAttachmentChunk, attachmentUploadStatus } from "./attachments";
import { sessionWorkCwd, type LinkedWorkItem } from "../src/features/sessions/model/session";
import { parseGithubWorkItemUrl } from "../src/features/sessions/model/sessionWorkItem";
import { SyncTransfers, serializedResponse } from "./sync-transfer";
import { RevisionWaits } from "./revisionWait";
import {
  TranscriptPages,
  transcriptPage,
  partialSessionSync,
  previewRewindHistory,
  previewSession,
  withHead,
} from "./transcriptPage";
import { RemoteChanges } from "./remoteChanges";
import { GitWatches } from "./git-watch";
import { syncPull, syncPush } from "./sync";
import type { SyncOp } from "../src/features/sync/model/syncProtocol";
import { browseHostDirectories, createHostDirectory } from "./browse";
import { createHostBranch, hostBranches, switchHostBranch } from "./git-branches";
import { createHostWorktree, hostWorktrees, resolveHostWorktreeAsync } from "./git-worktrees";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  indexHostFiles,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "./workspace";
import { WorkspaceCommands } from "./workspace-commands";
import { discoverCodexModels } from "../src/integrations/harness/providers/codex/codexCatalog";
import { discoverClaudeModels } from "../src/integrations/harness/providers/claude/claudeCatalog";
import { discoverCursorModels } from "../src/integrations/harness/providers/cursor/cursorCatalog";
import { discoverGrokModels } from "../src/integrations/harness/providers/grok/grokCatalog";
import { discoverOpenCodeModels } from "../src/integrations/harness/providers/opencode/opencodeCatalog";
import {
  discoverPiModels,
  discoverOmpModels,
} from "../src/integrations/harness/providers/pi/piCatalog";
import { discoverFxModels } from "../src/integrations/harness/providers/fx/fxCatalog";
import { discoverHermesModels } from "../src/integrations/harness/providers/hermes/hermesCatalog";
import { discoverAntigravityModels } from "../src/integrations/harness/providers/antigravity/antigravityCatalog";
import { setHarnessModels, type AgentModel } from "../src/features/sessions/model/models";
import { listShellProfiles, setChosenProfile, setReviewedProfile } from "./shellProfiles";
import {
  resolveAntigravityBinary,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveFxBinary,
  resolveGrokBinary,
  resolveHermesBinary,
  resolveOmpBinary,
  resolveOpenCodeBinary,
  resolvePiBinary,
} from "../src/integrations/harness/core/child";

// Providers also add models server-side, without a CLI update.
const resolveBinary: Record<RemoteProvider, () => Promise<{ path: string }>> = {
  codex: () => resolveCodexBinary(),
  claude: () => resolveClaudeBinary(),
  cursor: () => resolveCursorBinary(),
  grok: () => resolveGrokBinary(),
  opencode: () => resolveOpenCodeBinary(),
  pi: () => resolvePiBinary(),
  omp: () => resolveOmpBinary(),
  fx: () => resolveFxBinary(),
  hermes: () => resolveHermesBinary(),
  antigravity: () => resolveAntigravityBinary(),
  acp: async () => ({ path: "configured-acp" }),
};
// A 1 MiB text file can expand to 6 MiB when JSON escapes control characters.
// Existing files.write sends both the original and replacement contents.
const MAX_BODY = 16 * 1024 * 1024;
const discoverModels: Record<RemoteProvider, (cwd: string) => Promise<AgentModel[]>> = {
  codex: discoverCodexModels,
  claude: discoverClaudeModels,
  cursor: discoverCursorModels,
  grok: discoverGrokModels,
  opencode: discoverOpenCodeModels,
  pi: discoverPiModels,
  omp: discoverOmpModels,
  fx: discoverFxModels,
  hermes: discoverHermesModels,
  antigravity: discoverAntigravityModels,
  acp: async () => [],
};

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

/** Identifies each installed provider CLI. An update changes its real path or
 * modification time, which invalidates the catalog the old version reported. */
async function providerBinaries(providers: RemoteProvider[]): Promise<string> {
  const binaries = await Promise.all(
    providers.map(async (provider) => {
      try {
        const file = await realpath((await resolveBinary[provider]()).path);
        return `${file}:${(await stat(file)).mtimeMs}`;
      } catch {
        return "";
      }
    }),
  );
  return binaries.join("\n");
}

/** Run id watchers use for a turn the desktop app is running. */
const DESKTOP_RUN_ID = "desktop";
const MAX_DESKTOP_VIEWS = 32;
const MAX_MEMOIZED_VIEWS = 4;
/** Long-poll ticks may reuse a desktop database read this recent. */
const WATCH_STAMP_MS = 200;

export async function createHostServer(
  engine: HostEngine,
  providers: RemoteProvider[],
  lifecycle?: (request: IncomingMessage, response: ServerResponse) => void,
  automationsOverride?: HostAutomations,
  tasksOverride?: HostTasks,
  desktop = new DesktopSessions(),
  goalsOverride?: HostGoals,
  stewardsOverride?: HostStewards,
  socialOverride?: SocialService,
  tunnelsOverride?: ExternalTunnels,
  terminalsOverride?: HostTerminals,
) {
  await engine.ready;
  const terminals = terminalsOverride ?? new HostTerminals();
  const runLeases = new RunLeases();
  const inWorkspace = inManagedWorkspace;
  const managed = createManagedWorkspaceRuntime(engine.store, engine, {
    probe: async (workspace) => {
      const activities: import("./workspace-contracts").WorkspaceActivity[] = [];
      const add = (
        kind: import("./workspace-contracts").WorkspaceActivity["kind"],
        ownerId: string,
      ) =>
        activities.push({
          id: `probe:${kind}:${ownerId}`,
          workspaceId: workspace.id,
          kind,
          ownerId,
          startedAt: Date.now(),
        });
      if (
        workspace.owner.kind === "session" &&
        (desktop.live.busyClient(workspace.owner.id) || runLeases.holder(workspace.owner.id))
      )
        add("provider", workspace.owner.id);
      for (const project of await engine.store.projects()) {
        for (const terminal of terminals.list(project.id).terminals)
          if (terminal.state === "running" && inWorkspace(terminal.cwd, workspace.path))
            add("shell", terminal.id);
        for (const summary of await engine.store.summaries(project.id)) {
          if (
            summary.workspaceId !== workspace.id &&
            !(summary.worktreeCwd && inWorkspace(summary.worktreeCwd, workspace.path))
          )
            continue;
          if (
            summary.status === "running" ||
            desktop.live.busyClient(summary.id) ||
            runLeases.holder(summary.id)
          )
            add("provider", summary.id);
          const snapshot = await engine.store.session(summary.id);
          if (snapshot.session.blocks.some((block) => block.shell?.running))
            add("shell", summary.id);
        }
      }
      return activities;
    },
    artifactPending: async (workspaceId, completedDeliveryOperationId) =>
      !completedDeliveryOperationId &&
      (await tasks.list()).some(
        (task) =>
          task.workspaceId === workspaceId &&
          (task.artifactDeliveryPending === true || !!task.artifactDeliveryActivityId),
      ),
    canReconcileActivity: async (entry) => {
      if (
        entry.kind !== "provider" ||
        engine.desktopRefreshBlocked(entry.ownerId) ||
        desktop.live.busyClient(entry.ownerId) ||
        runLeases.holder(entry.ownerId)
      )
        return false;
      const summary = (await engine.store.startupStates()).find(
        (value) => value.id === entry.ownerId,
      );
      // Unknown and native writers require their own process-identity proof.
      return (
        !!summary &&
        !!(await engine.store.sessionAuthority(entry.ownerId)) &&
        !summary.running &&
        !summary.shellRunning &&
        summary.workspaceId === entry.workspaceId
      );
    },
  });
  const managedWorkspaces = managed.registry;
  const workspacePolicy = managed.policy;
  const featureClaims = managed.claims;
  const buildIdentity = readHostBuildIdentity();
  const startWorkspaceActivity = async (
    cwd: string,
    kind: import("./workspace-contracts").WorkspaceActivity["kind"],
    ownerId: string,
  ) => {
    const entries: { id: string; workspaceId: string }[] = [];
    try {
      for (const workspace of await managed.list()) {
        if (!inWorkspace(cwd, workspace.path)) continue;
        await managed.assertWritable(workspace.id);
        const entry = await managed.activity.start({ workspaceId: workspace.id, kind, ownerId });
        entries.push({ id: entry.id, workspaceId: workspace.id });
        await recordWorkspaceActivity(() => managedWorkspaces.touchActivity(workspace.id));
      }
      return async () => {
        for (const entry of entries) {
          await managed.activity.stop(entry.id);
          await recordWorkspaceActivity(() => managedWorkspaces.touchActivity(entry.workspaceId));
        }
      };
    } catch (error) {
      for (const entry of entries) await managed.activity.stop(entry.id);
      throw error;
    }
  };
  terminals.setActivityGate((cwd, terminalId) => startWorkspaceActivity(cwd, "shell", terminalId));
  const editorActivities = new Map<string, { workspaceId: string; ownerId: string }>();
  const workspaceOwnerDeviceId = async (token: string) => {
    const current = (await engine.store.pairedDevices(token)).devices.find(
      (device) => device.isCurrent,
    );
    if (!current) throw new Error("Owner device authorization was revoked");
    return current.id;
  };
  const withWorkspaceOwner = async <T>(
    token: string,
    action: (
      owner: import("./workspace-service-contracts").WorkspaceOwnerAuthorization,
    ) => Promise<T>,
  ) => managed.withOwner(await workspaceOwnerDeviceId(token), action);
  const recordWorkspaceActivity = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      console.warn("Managed workspace activity metadata could not be recorded");
    }
  };
  const touchSessionWorkspace = (id: string) =>
    recordWorkspaceActivity(() => managedWorkspaces.touchOwnerActivity({ kind: "session", id }));
  const workspaceForOwnerRpc = async (workspaceId: unknown) => {
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 200)
      throw new Error("Invalid workspace identity");
    const value = await managedWorkspaces.get({ workspaceId });
    if (value) {
      await engine.store.project(value.projectId);
      if (value.environmentId !== engine.store.environmentId)
        throw new Error("Workspace belongs to another execution host");
    }
    return value;
  };
  const automations =
    automationsOverride ??
    new HostAutomations(engine.store, engine, undefined, {
      ...managed.services,
      policy: managed.policy,
    });
  await automations.ready;
  const tasks =
    tasksOverride ??
    new HostTasks(engine.store, engine, undefined, undefined, {
      ...managed.services,
      policy: managed.policy,
    });
  await tasks.ready;
  const sprints = new HostSprints(engine.store);
  await sprints.ready;
  const goals = goalsOverride ?? new HostGoals(engine.store, engine, tasks);
  await goals.ready;
  const stewards =
    stewardsOverride ??
    new HostStewards(engine.store, engine, tasks, undefined, {
      ...managed.services,
      policy: managed.policy,
    });
  await stewards.ready;
  const featureDirectory = dirname(engine.store.attachmentDir);
  const deviceHost = new DeviceHost(featureDirectory);
  const devicePreviews = new DevicePreviews(deviceHost, undefined, (action) =>
    engine.store.db.outsideScope(action),
  );
  const genericAcp = new GenericAcpService(featureDirectory);
  const handoffHistory = new HandoffHistoryStore(featureDirectory);
  const diagnostics = new ResourceDiagnostics(Date.now, () => perfMetrics.snapshot());
  const browserRuntime = new BrowserRuntime(featureDirectory);
  const runtimeLogs = new RuntimeLogsService();
  const terminalLogs = new RuntimeTerminalLogs(runtimeLogs);
  const terminalActivityCursors = new Map<string, number>();
  const terminalActivityStates = new Map<string, string>();
  const touchTerminalWorkspace = (projectId: string, terminalId: unknown, closedCwd?: string) =>
    recordWorkspaceActivity(async () => {
      const terminal = terminals.list(projectId).terminals.find((entry) => entry.id === terminalId);
      const cwd = terminal?.cwd ?? closedCwd;
      if (!cwd) return;
      if (terminal) terminalActivityStates.set(terminal.id, terminal.state);
      const workspaces = await managedWorkspaces.list({
        projectId,
        environmentId: engine.store.environmentId,
      });
      for (const workspace of workspaces)
        if (inWorkspace(cwd, workspace.path)) await managedWorkspaces.touchActivity(workspace.id);
    });
  const logMonitors = new RuntimeLogMonitors(browserRuntime.load, runtimeLogs);
  const sharedBrowser = new SharedBrowser(browserRuntime.load, Date.now, { runtimeLogs });
  const devServers = new DevServersService({
    runtimeLogs,
    startActivity: (cwd, ownerId) => startWorkspaceActivity(cwd, "devServer", ownerId),
    workspaceIdForDirectory: async (cwd) =>
      (await managed.list()).find((value) => inWorkspace(cwd, value.path))?.id,
  });
  const localVoice = new LocalVoiceService();
  const voiceSetup = new VoiceSetupService();
  const devServerAccess = new DevServerAccess(
    async (params) => {
      await engine.store.project(String(params.projectId ?? ""));
      return (await devServers.handle(
        "devServers.details",
        params,
        (await engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )) as DevServerDetails;
    },
    () => {
      const address = server.address();
      return address && typeof address !== "string" ? address.port : undefined;
    },
  );
  const refreshLogSources = async () => {
    void devServers
      .refreshLogSources(
        (await engine.store.projects()).map((project) => ({
          id: project.id,
          name: project.name,
          path: project.cwd,
        })),
      )
      .catch(() => {});
  };
  const webControl = process.env.BYCODA_WEB_CONTROL_ORIGIN
    ? new WebControl(process.env.BYCODA_WEB_CONTROL_ORIGIN)
    : undefined;
  const inHost = async (id: string) => {
    return !!(await engine.store.sessionAuthority(id));
  };
  const desktopDelete = new DesktopDelete();
  const sessionQueues = new SessionQueues(engine.store.db);
  const writerTransfers = new Set<string>();
  const withRetiredDesktopWriters = async <T>(id: string, run: () => Promise<T>): Promise<T> => {
    if (writerTransfers.has(id)) throw new LeaseHeldError("host");
    writerTransfers.add(id);
    try {
      await desktop.live.retireWriters(id);
      await assertHostMayRun(id);
      return await run();
    } finally {
      writerTransfers.delete(id);
    }
  };
  await sessionQueues.ready;
  /** Which desktop window runs a turn of which conversation (the host's own are the engine's). */
  const adoptedChanges = new AdoptedChanges(
    async () => await engine.store.adopted(),
    () => engine.store.changes.version,
  );
  const attachmentOwnership = new AttachmentOwnership(engine.store);
  void attachmentOwnership.ready.catch(() => {});
  /** A desktop-only session on this machine, matched to a registered project. */
  const desktopSnapshot = async (id: string) => {
    if (!id || (await inHost(id))) return undefined;
    const cwd = await desktop.projectCwdAsync(id);
    const project = cwd
      ? (await engine.store.projects()).find((p) => desktop.samePath(p.cwd, cwd))
      : undefined;
    const snapshot = project && (await desktop.snapshotAsync(id, project.id, project.cwd));
    return snapshot &&
      (snapshot.session.harness === "acp" ||
        providers.includes(snapshot.session.harness as RemoteProvider))
      ? snapshot
      : undefined;
  };
  const adopt = async (id: string) => {
    const snapshot = await desktopSnapshot(id);
    if (snapshot) await engine.adoptSession(snapshot);
    else await refresh(id);
  };
  const featureSession = async (id: string) => {
    const snapshot = await desktopSnapshot(id);
    if (snapshot) return snapshot;
    return await engine.store.session(id);
  };
  const queueSessionStatus = async (id: string) => {
    const metadata = await desktop.metadataAsync(id);
    if (
      metadata &&
      (metadata.harness === "acp" || providers.includes(metadata.harness as RemoteProvider)) &&
      (await engine.store.projects()).some((project) => desktop.samePath(project.cwd, metadata.cwd))
    )
      return metadata.running ? "running" : "idle";
    return await engine.store.sessionStatus(id);
  };
  const explicitSkillNames = async (id: string) =>
    skillInvocationTokens(
      (await featureSession(id)).session.blocks.filter((block) => block.role === "user").at(-1)
        ?.text ?? "",
    ).map((token) => token.name.replace(/^skill:/, ""));
  const xBrowser = new XBrowserSessions(join(featureDirectory, "social"));
  const social =
    socialOverride ??
    new SocialService(
      engine.store,
      new OsSocialCredentials(
        join(featureDirectory, "social", "credentials"),
        engine.store.environmentId,
      ),
      createSocialAdapters(
        undefined,
        process.env.BYCODA_SOCIAL_GRAPH_VERSION,
        process.env.BYCODA_SOCIAL_LINKEDIN_VERSION,
      ),
      join(featureDirectory, "social"),
      featureSession,
      Date.now,
      socialAgentGenerator(join(featureDirectory, "social")),
      xBrowser.adapter(),
    );
  await social.ready;
  social.setSessionAuthorityResolver(
    createSessionAuthorityResolver(engine.store, desktop, providers),
  );
  social.forgetBrowserSession ??= async (accountId) => {
    await xBrowser.workflows.cancelAccount(social, accountId);
    await xBrowser.forget(accountId);
  };
  social.cancelBrowserWorkflow ??= async (accountId) =>
    await xBrowser.workflows.cancelAccount(social, accountId);
  const runtimeLogAccess = new RuntimeLogAccess(social);
  const conversationAccess = new RuntimeLogAccess(social);
  const conversationDesktop = new ConversationDesktopRelay(engine.store.environmentId);
  let desktopSigningKey: string | undefined;
  const desktopSigningSecret = async () =>
    (desktopSigningKey ??= await desktopReviewSecret(engine.store));
  const scopedDesktopCall = async (
    token: string,
    action: string,
    params: Record<string, unknown>,
    fields: readonly string[],
    trusted: Readonly<Record<string, unknown>> = {},
  ) => {
    const allowed = ["projectId", "sessionId", ...fields];
    if (
      Object.keys(params).some((key) => !allowed.includes(key)) ||
      typeof params.sessionId !== "string" ||
      typeof params.projectId !== "string"
    )
      throw new Error("Invalid desktop feature identity");
    const target = await featureSession(params.sessionId);
    const project = await engine.store.project(params.projectId);
    if (target.projectId !== project.id)
      throw new Error("Desktop feature belongs to another project");
    const sourceCwd = sessionWorkCwd(target.session);
    const cwd = await resolveHostWorktreeAsync(project.cwd, sourceCwd);
    const { projectId: _projectId, ...request } = params;
    return await conversationDesktop.call(
      action,
      { ...request, ...trusted },
      cwd,
      {
        kind: "session",
        sessionId: target.session.id,
        projectId: project.id,
        provider: target.session.harness,
      },
      async () => {
        try {
          const current = await featureSession(target.session.id);
          return (
            (await engine.store.authenticated(token)) &&
            current.projectId === project.id &&
            desktop.samePath(sessionWorkCwd(current.session), sourceCwd)
          );
        } catch {
          return false;
        }
      },
    );
  };
  const socialTransport = new SocialTransport(social, xBrowser);
  const socialPeers = new SocialPeers(
    social,
    new OsSocialCredentials(
      join(featureDirectory, "social", "peer-credentials"),
      engine.store.environmentId,
    ),
  );
  /** Pulls turns the desktop app ran in an adopted session since. */
  /** Desktop copies that could not be read, by the stamp they had then. */
  const unreadableDesktopCopies = new Map<string, number>();
  const refresh = async (id: string, known?: { updatedAt: number; running: boolean }) => {
    let current;
    try {
      current = await engine.store.session(id);
    } catch {
      return;
    }
    if (!current.desktop) return;
    const stamp = known ?? (await desktop.stampAsync(id));
    if (!stamp) return;
    if (stamp.running) throw new LeaseHeldError(runLeases.holder(id)?.holder ?? "desktop");
    if (stamp.updatedAt <= current.desktop.updatedAt) return;
    // Cheap guards first: a session the host is running or rewinding is left
    // alone anyway, and an unreadable copy stays unreadable until it changes.
    if (current.status === "running" || engine.desktopRefreshBlocked(id)) return;
    if (unreadableDesktopCopies.get(id) === stamp.updatedAt) return;
    const project = await engine.store.project(current.projectId);
    const snapshot = await desktop.snapshotAsync(id, project.id, project.cwd);
    if (snapshot) {
      unreadableDesktopCopies.delete(id);
      await engine.refreshFromDesktop(snapshot);
    } else {
      unreadableDesktopCopies.set(id, stamp.updatedAt);
      while (unreadableDesktopCopies.size > 256)
        unreadableDesktopCopies.delete(unreadableDesktopCopies.keys().next().value!);
    }
  };
  /** Where watchers of `id` should look: the desktop app's copy for a
   * desktop-only session, or for an adopted one the app is running a turn in. */
  const desktopWatch = async (id: string, polling = false) => {
    if (!id) return undefined;
    let hosted: HostSession | undefined;
    try {
      hosted = await engine.store.session(id);
    } catch {
      /* desktop-only */
    }
    if (hosted && (!hosted.desktop || hosted.status === "running")) return undefined;
    const stamp = await desktop.stampAsync(id, polling ? WATCH_STAMP_MS : 0);
    if (!stamp) return undefined;
    if (hosted && !stamp.running) return undefined;
    const overlay = desktop.live.overlay(id);
    return {
      projectId: hosted?.projectId,
      running: stamp.running,
      revision: Math.max(stamp.updatedAt, overlay?.changedAt ?? 0),
    };
  };
  /** Who runs a turn of `id` outside the host: a desktop window holding the run
   * lease, or an app that reports it busy without having asked for one. */
  const desktopRunHolder = async (id: string): Promise<Awaited<string | undefined>> =>
    runLeases.holder(id)?.holder ?? ((await desktopWatch(id))?.running ? "desktop" : undefined);
  const hostRuns = async (id: string) => {
    try {
      return (await engine.store.sessionStatus(id)) === "running";
    } catch {
      return false;
    }
  };
  /** The conversation may start a turn on this host, or `LEASE_HELD`: callers queue the message. */
  const assertHostMayRun = async (id: string) => {
    const holder = await desktopRunHolder(id);
    if (holder) throw new LeaseHeldError(holder);
  };
  /** Whether a conversation waits for the owner to answer a usage limit, read again only when it moved. */
  const usageLimits = new Map<string, { key: string; limited: boolean }>();
  const usageLimited = async (id: string): Promise<Awaited<boolean>> => {
    const key = `${(await engine.store.sessionRevision(id)) ?? ""}\0${(await desktop.stampAsync(id))?.updatedAt ?? ""}`;
    const known = usageLimits.get(id);
    if (known?.key === key) return known.limited;
    const limited = !!(await featureSession(id)).session.usageLimit;
    usageLimits.delete(id);
    usageLimits.set(id, { key, limited });
    while (usageLimits.size > 256) usageLimits.delete(usageLimits.keys().next().value!);
    return limited;
  };
  /** Sends the head of a queue nobody holds the drain lease for. */
  const queueDrainer = new QueueDrainer(
    sessionQueues,
    {
      outsideScope: (action) => engine.store.db.outsideScope(action),
      ready: async (id) => {
        try {
          return (
            !(await engine.busyReason(id)) &&
            // The host's own turn, including one in an adopted session the desktop
            // copy does not know is running.
            !(await hostRuns(id)) &&
            (await queueSessionStatus(id)) !== "running" &&
            !(await desktopRunHolder(id)) &&
            !(await usageLimited(id))
          );
        } catch {
          return false;
        }
      },
      send: async (id, row) => {
        await adopt(id);
        for (const command of queueRowCommands(id, row, (await engine.store.session(id)).session))
          await engine.command(command);
        await touchSessionWorkspace(id);
      },
      // Writer ACKs arrive through another RPC. Await them before taking the
      // store transaction, while keeping queue dispatch and consume atomic.
      transaction: async (action, id) =>
        id
          ? await withRetiredDesktopWriters(id, () => engine.store.transaction(action))
          : await engine.store.transaction(action),
      wakeAt: () => {
        const times = [runLeases.nextExpiry(), desktop.live.nextStoredExpiry()].filter(
          (time): time is number => time !== undefined,
        );
        return times.length ? Math.min(...times) : undefined;
      },
      expired: () => {
        runLeases.takeExpired();
      },
    },
    Date.now,
    false,
  );
  engine.onSettled = async (id, outcome) => {
    await touchSessionWorkspace(id);
    await queueDrainer.settled(id, outcome);
  };
  // A turn found running at startup was cut short: its queue waits for the owner.
  for (const id of engine.recoveredInterrupted)
    await queueDrainer.settled(id, {
      interrupted: true,
      reason: "Host restarted. This turn was interrupted; inspect its work before continuing.",
    });
  engine.onUnblocked = () => queueDrainer.kickWaiting();
  // A window's heartbeat keeps its lease alive while the conversation is busy
  // there; the beat that reports it idle (or its silence) ends the lease.
  /** When each window last reported a conversation busy: a lease granted after that is a newer turn's. */
  const lastBusy = new Map<string, number>();
  let heartbeatEffects = Promise.resolve();
  desktop.live.onBusy = (id, clientId) => {
    const acceptedAt = Date.now();
    heartbeatEffects = heartbeatEffects
      .then(
        async () =>
          await engine.store.db.scope(async () => {
            // A later heartbeat may already have released or replaced this owner.
            if (desktop.live.busyClient(id) !== clientId) return;
            await touchSessionWorkspace(id);
            const holder = `desktop:${clientId}`;
            let heldBefore = acceptedAt;
            // A window running a turn holds the conversation whether or not it asked first
            // (an older app, or a release that raced with its next turn).
            if (!runLeases.renew(id, holder)) {
              try {
                const running = await hostRuns(id);
                if (desktop.live.busyClient(id) !== clientId) return;
                const existing = runLeases.holder(id);
                runLeases.acquire(id, holder, () => (running ? "host" : undefined));
                // An implicit grant can happen after this beat was accepted.
                // Include that grant in its idle cutoff, but never a newer
                // explicit grant that appeared while the database was read.
                if (!existing) heldBefore = Date.now();
              } catch {
                /* another side holds it: that one stays */
              }
            }
            // After the grant, so the lease of this very turn counts as held by now.
            const key = `${id}\0${clientId}`;
            lastBusy.delete(key);
            lastBusy.set(key, heldBefore);
            while (lastBusy.size > 1024) lastBusy.delete(lastBusy.keys().next().value!);
          }),
      )
      .catch((error) => console.warn("Desktop heartbeat lease update failed", error));
  };
  desktop.live.onIdle = (id, clientId, reason) => {
    // A window that went quiet may be a hidden, throttled one that still writes:
    // its lease runs out on its own (longer than the longest beat gap).
    if (reason !== "gone")
      runLeases.drop(id, `desktop:${clientId}`, lastBusy.get(`${id}\0${clientId}`) ?? 0);
    if (reason !== "gone")
      heartbeatEffects = heartbeatEffects.then(() => touchSessionWorkspace(id));
  };
  /**
   * The run leases a desktop window says it holds (for the conversations it runs
   * a turn of), answered with the lease kept or `null` when it was lost: another
   * side runs a turn now, so the window must stop writing to the conversation.
   * A lease that merely ran out (a long gap, a host restart) is granted again
   * when nobody took the conversation meanwhile.
   */
  const renewRunLeases = async (params: Record<string, unknown>) => {
    if (!Array.isArray(params.runLeases) || typeof params.clientId !== "string") return undefined;
    const holder = `desktop:${params.clientId}`;
    const answers: Record<string, RunLease | null> = {};
    for (const entry of params.runLeases.slice(0, 256)) {
      const { sessionId, epoch } = (entry ?? {}) as { sessionId?: unknown; epoch?: unknown };
      if (typeof sessionId !== "string" || sessionId.length > 200 || !Number.isSafeInteger(epoch))
        continue;
      const current = runLeases.holder(sessionId);
      if (current && current.holder !== holder) answers[sessionId] = null;
      else if (current) answers[sessionId] = runLeases.renew(sessionId, holder) ?? null;
      else {
        try {
          answers[sessionId] = await engine.store.db.scope(async () => {
            const hostRunning = await hostRuns(sessionId);
            return runLeases.acquire(sessionId, holder, () => {
              if (hostRunning) return "host";
              const busy = desktop.live.busyClient(sessionId);
              return busy && `desktop:${busy}` !== holder ? `desktop:${busy}` : undefined;
            });
          });
        } catch {
          answers[sessionId] = null;
        }
      }
    }
    return answers;
  };
  /** Renews the drain leases a desktop reports on its heartbeat. */
  const renewQueueLeases = async (params: Record<string, unknown>) => {
    if (!Array.isArray(params.queueLeases) || typeof params.clientId !== "string") return undefined;
    const holder = `desktop:${params.clientId}`;
    const leases: Record<
      string,
      import("../src/features/connections/model/sharedQueue").DrainLease | null
    > = {};
    for (const entry of params.queueLeases.slice(0, 256)) {
      const { sessionId, epoch, blocked } = (entry ?? {}) as {
        sessionId?: unknown;
        epoch?: unknown;
        blocked?: unknown;
      };
      if (typeof sessionId !== "string" || !Number.isSafeInteger(epoch)) continue;
      // A holder that cannot send for a reason of its own (a sync conflict on its
      // copy) is neither stalled nor replaced by the host sending on its own copy.
      queueDrainer.noteBlocked(sessionId, holder, blocked === true);
      // A holder that could send but does not is not renewed: its lease ends
      // and the host sends the row.
      leases[sessionId] = (await queueDrainer.holderStalled(sessionId))
        ? await sessionQueues.release(sessionId, holder, Number(epoch))
        : await sessionQueues.renew(sessionId, holder, Number(epoch));
    }
    return leases;
  };
  /** The desktop copy with its live prompts; a running one carries a run id
   * so watchers can stop it and answer its prompts. */
  const desktopView = async (
    id: string,
    projectId?: string,
  ): Promise<Awaited<HostSession | undefined>> => {
    // Watchers re-request the same unchanged transcript many times (pages,
    // block fetches, polls); parsing it again is only needed once it moves.
    const stamp = await desktop.stampAsync(id);
    const key =
      stamp && (projectId || !(await inHost(id)))
        ? `${id}\0${projectId ?? ""}\0${stamp.updatedAt}\0${stamp.running}\0${desktop.live.overlay(id)?.changedAt ?? 0}`
        : undefined;
    const known = key ? viewMemo.get(key) : undefined;
    if (known) return known;
    const view = await buildDesktopView(id, projectId);
    if (key && view) {
      for (const old of viewMemo.keys()) if (old.startsWith(`${id}\0`)) viewMemo.delete(old);
      viewMemo.set(key, view);
      while (viewMemo.size > MAX_MEMOIZED_VIEWS) viewMemo.delete(viewMemo.keys().next().value!);
    }
    return view;
  };
  /** The same authoritative read owner used for transcript and context previews. */
  const readSessionView = async (id: string) => {
    const watch = await desktopWatch(id);
    const value =
      (watch && (await desktopView(id, watch.projectId))) ?? (await engine.store.session(id));
    return {
      ...value,
      executionOwner:
        value.status === "running" ? (watch ? ("desktop" as const) : ("host" as const)) : undefined,
    };
  };
  const viewMemo = new Map<string, HostSession>();
  const buildDesktopView = async (
    id: string,
    projectId?: string,
  ): Promise<Awaited<HostSession | undefined>> => {
    const project = projectId ? await engine.store.project(projectId) : undefined;
    const snapshot = project
      ? await desktop.snapshotAsync(id, project.id, project.cwd)
      : await desktopSnapshot(id);
    if (!snapshot) return undefined;
    const overlay = desktop.live.overlay(id);
    return {
      ...snapshot,
      revision: Math.max(snapshot.revision, overlay?.changedAt ?? 0),
      ...(snapshot.status === "running" ? { runId: DESKTOP_RUN_ID } : {}),
      ...(snapshot.blockRevisions
        ? {
            blockRevisions: {
              ...snapshot.blockRevisions,
              ...Object.fromEntries(
                (overlay?.pending ?? []).map((block) => [
                  block.id,
                  overlay?.changedAt ?? snapshot.revision,
                ]),
              ),
            },
          }
        : {}),
      // The desktop's own bookkeeping about its host copy is not part of the view.
      session: (({ adoptedBase: _base, ...session }) => session)(
        withOverlay(snapshot.session, overlay),
      ),
    };
  };
  /** Per-block change revisions of watched desktop copies, so a watcher
   * fetches only what changed, as for the host's own sessions. */
  const views = new Map<
    string,
    {
      revision: number;
      first: number;
      revs: Map<string, number>;
      json: Map<string, string>;
      bytes: number;
    }
  >();
  const desktopSync = (view: HostSession, client?: number): SessionSync => {
    const id = view.session.id;
    let entry = views.get(id);
    if (!entry || entry.revision !== view.revision) {
      const revs = new Map<string, number>();
      const json = new Map<string, string>();
      for (const block of view.session.blocks) {
        const persisted = view.blockRevisions?.[block.id];
        const text = persisted !== undefined ? `revision:${persisted}` : JSON.stringify(block);
        json.set(block.id, text);
        revs.set(
          block.id,
          entry && entry.json.get(block.id) === text ? entry.revs.get(block.id)! : view.revision,
        );
      }
      entry = {
        revision: view.revision,
        first: entry?.first ?? view.revision,
        revs,
        json,
        bytes: [...json].reduce(
          (sum, [blockId, text]) => sum + (blockId.length + text.length) * 2 + 64,
          0,
        ),
      };
      views.delete(id);
      views.set(id, entry);
      if (views.size > MAX_DESKTOP_VIEWS) views.delete(views.keys().next().value!);
      let bytes = [...views.values()].reduce((sum, view) => sum + view.bytes, 0);
      while (bytes > 64 * 1024 * 1024 && views.size) {
        const key = views.keys().next().value!;
        bytes -= views.get(key)!.bytes;
        views.delete(key);
      }
    }
    if (client === view.revision) return { kind: "unchanged", revision: client };
    if (client === undefined || client < entry.first || client > view.revision)
      return { kind: "snapshot", value: view };
    const {
      session: { blocks, ...session },
      ...rest
    } = view;
    const revs = entry.revs;
    return {
      kind: "delta",
      base: client,
      value: { ...rest, session },
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.filter((block) => (revs.get(block.id) ?? view.revision) > client),
    };
  };
  /** Like `refresh`, for reads: a running desktop turn just isn't pulled yet. */
  const catchUp = async (id: string, known?: { updatedAt: number; running: boolean }) => {
    try {
      await refresh(id, known);
    } catch {
      /* the desktop is mid-turn; serve the host copy */
    }
  };
  const catalogs = new ModelCatalogCache(
    [...new Set([...providers, "acp" as const])],
    async () => await providerBinaries(providers),
    async (provider, cwd) => {
      const discovered =
        provider === "acp"
          ? (await genericAcp.list()).map((config) => ({
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
    const hosted = await engine.store.sessionStateMetadata(id);
    return (!hosted || (hosted.desktop && hosted.status !== "running")) &&
      (await desktop.stampAsync(id, WATCH_STAMP_MS))?.running
      ? WATCH_STAMP_MS
      : 1000;
  };
  const signal = engine.store.changes;
  // Generations of inputs the project list reads besides the store: the desktop
  // heartbeat and watched checkouts. They key the cached list below.
  desktop.live.onChange = () => {
    signal.notify();
    queueDrainer.kickWaiting();
  };
  tasks.onChange = () => signal.notify();
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
    engine.store,
    async (projectId, action) => await engine.withIdleProject(projectId, action),
    engine.checkpoints,
    {
      registry: managedWorkspaces,
      service: managed.delivery,
      startMutation: async (cwd) => startWorkspaceActivity(cwd, "mutation", "workspace-command"),
    },
  );
  const models = async (projectId?: unknown, progressive = false, force = false) =>
    await catalogs.read(
      typeof projectId === "string" ? (await engine.store.project(projectId)).cwd : homedir(),
      progressive,
      force,
    );
  const conversationProject = new ConversationProjectTools(
    engine.store,
    goals,
    engine.checkpoints,
    providers,
    models,
    {
      stewards,
      automations,
      session: featureSession,
      checkpoints: async (sessionId, principal, authorized) =>
        (await inHost(sessionId))
          ? engine.checkpoints
          : {
              status: async (id, cwd) =>
                (await conversationDesktop.call(
                  "checkpoints.status",
                  { sessionId: id },
                  cwd,
                  principal,
                  authorized,
                )) as Awaited<ReturnType<typeof engine.checkpoints.status>>,
              fileDiff: async (id, cwd, relative) =>
                (await conversationDesktop.call(
                  "checkpoints.diff",
                  { sessionId: id, relative },
                  cwd,
                  principal,
                  authorized,
                )) as Awaited<ReturnType<typeof engine.checkpoints.fileDiff>>,
            },
    },
  );
  const conversationGoals = new ConversationGoalTools(engine.store, goals, tasks, featureSession);
  const conversationTaskQueue = new ConversationTaskQueueTools(tasks);
  const conversationStewards = new ConversationStewardTools(engine.store, stewards, tasks);
  const conversationRuntimeReads = new ConversationRuntimeReadTools(
    engine.store,
    tasks.limits,
    undefined,
    undefined,
    featureSession,
  );
  let imageCapability: { at: number; value: Promise<boolean> } | undefined;
  const crews = new HostCrews(
    engine.store,
    engine,
    tasks,
    async (projectId) => await models(projectId),
    Date.now,
    async (candidate, capability) => {
      if (candidate.harness === "codex" && capability === "image-generation") {
        if (!imageCapability || Date.now() - imageCapability.at > 60_000)
          imageCapability = {
            at: Date.now(),
            value: probeNativeCodexImageCapability(join(featureDirectory, "crews")).then(
              (result) => result.available,
            ),
          };
        return imageCapability.value;
      }
      return undefined;
    },
  );
  const sessionListEpoch = randomUUID();
  const decoratedSummaries = new WeakMap<
    HostSessionSummary,
    { key: string; value: HostSessionSummary }
  >();
  const buildProjectSessionList = async (
    projectId: string,
    local: HostSessionSummary[],
    etagPrefix: string,
  ) => {
    const project = await engine.store.project(projectId);
    const stamps = new Map(local.map((session) => [session.id, session]));
    for (const adopted of await engine.store.adopted(projectId)) {
      const stamp = stamps.get(adopted.id);
      // Only a desktop copy newer than the one the host caught up with needs
      // the session loaded; a running one is not pulled yet.
      if (
        adopted.projectId === projectId &&
        stamp &&
        stamp.status !== "running" &&
        stamp.updatedAt > adopted.desktopUpdatedAt
      )
        await catchUp(adopted.id, {
          updatedAt: stamp.updatedAt,
          running: false,
        });
    }
    const own = (await engine.store.summaries(projectId)).map((session) =>
      session.status !== "running" && stamps.get(session.id)?.status === "running"
        ? { ...session, status: "running" as const }
        : session,
    );
    const known = new Set(own.map((session) => session.id));
    const summaries = [...own, ...local.filter((session) => !known.has(session.id))].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const paths = [...new Set(summaries.map((session) => session.cwd ?? project.cwd))];
    const branches = new Map(
      await Promise.all(paths.map(async (cwd) => [cwd, await branchCache.get(cwd)] as const)),
    );
    const list = summaries.map((session) => {
      const decorationKey = JSON.stringify([
        project.name,
        project.cwd,
        branches.get(session.cwd ?? project.cwd),
      ]);
      const cached = decoratedSummaries.get(session);
      if (cached?.key === decorationKey) return cached.value;
      const value = {
        ...session,
        repo: project.name,
        branch: branches.get(session.cwd ?? project.cwd) || undefined,
        // Desktop rows keep the desktop's path spelling; compare normalized paths.
        worktreeCwd:
          session.cwd && !desktop.samePath(session.cwd, project.cwd) ? session.cwd : undefined,
      };
      decoratedSummaries.set(session, { key: decorationKey, value });
      return value;
    });
    const branchKey = JSON.stringify(paths.map((cwd) => [cwd, branches.get(cwd)]));
    return {
      list,
      // A process epoch prevents version reuse after restart; each input revision
      // already participates in the key. Do not serialize a full history to hash it.
      etag: createHash("sha256")
        .update(sessionListEpoch)
        .update(etagPrefix)
        .update("\0")
        .update(branchKey)
        .digest("base64url"),
      bytes: snapshotWeight(list),
      paths,
      branchKey,
    };
  };
  const projectChangeCache = new Map<
    string,
    {
      key: string;
      refreshed: number;
      paths: string[];
      bytes: number;
      promise: Promise<{ etag: string; list: HostSessionSummary[]; bytes: number }>;
    }
  >();
  /** A rebuild is only needed when an input moved; the safety TTL bounds what no
   * signal reports (an unwatched checkout switching branch). */
  const PROJECT_LIST_SAFETY_MS = 30_000;
  const taskChangeEtag = async () => await tasks.changeEtag();
  const projectSessionList = async (projectId: string) => {
    const now = Date.now();
    const project = await engine.store.project(projectId);
    const currentProject = async () => {
      if ((await engine.store.project(projectId)).cwd !== project.cwd)
        throw new Error("Project changed while reading its sessions.");
    };
    const local = await desktop.listSnapshotAsync(project.cwd, projectId, providers);
    await currentProject();
    const cached = projectChangeCache.get(projectId);
    const paths = cached?.paths ?? [];
    // Reuse the lightweight branch TTL/singleflight even when this checkout
    // is not watched. Caching a full list must not extend branch staleness
    // from the branch cache's 4s contract to the 30s safety fallback.
    const branches = await Promise.all(paths.map(async (cwd) => await branchCache.get(cwd)));
    await currentProject();
    const prefix = [
      engine.store.projectVersion(projectId),
      project.cwd,
      project.name,
      local.fingerprint,
    ].join("\0");
    // Desktop metadata/live state and watched Git revisions are scoped to the
    // actual rows/paths of this project, not global activity on the machine.
    const key = `${prefix}\0${JSON.stringify(paths.map((cwd, index) => [cwd, branches[index]]))}`;
    const current = projectChangeCache.get(projectId);
    if (current && current.key === key && now - current.refreshed < PROJECT_LIST_SAFETY_MS) {
      const result = await current.promise;
      await currentProject();
      return result;
    }
    const promise = buildProjectSessionList(projectId, local.sessions, prefix);
    const entry = { key, refreshed: now, paths, bytes: 0, promise };
    projectChangeCache.set(projectId, entry);
    void promise.then(
      ({ bytes, paths, branchKey }) => {
        if (projectChangeCache.get(projectId) !== entry) return;
        entry.paths = paths;
        entry.key = `${prefix}\0${branchKey}`;
        entry.bytes = bytes;
        let total = 0;
        for (const value of projectChangeCache.values()) total += value.bytes;
        while (total > 16 * 1024 * 1024) {
          const first = projectChangeCache.keys().next().value;
          if (first === undefined) break;
          total -= projectChangeCache.get(first)!.bytes;
          projectChangeCache.delete(first);
        }
      },
      () => {
        // A failed read is never cached as an empty project.
        if (projectChangeCache.get(projectId) === entry) projectChangeCache.delete(projectId);
      },
    );
    while (projectChangeCache.size > 32)
      projectChangeCache.delete(projectChangeCache.keys().next().value!);
    const result = await promise;
    await currentProject();
    return result;
  };
  const projectChangeSnapshot = async (projectId: string) => {
    const { list, etag } = await projectSessionList(projectId);
    return { etag, sessions: list };
  };
  const hostNotes = new AsyncHostNotes();
  const providerInbox = new ProviderInboxBridge(engine.store.db);
  const conversationWorkspace = new ConversationWorkspaceTools(
    engine.store,
    hostNotes,
    automations,
    providerInbox,
    async (projectId, principal) =>
      hostInbox(
        {
          sessions: (await projectSessionList(projectId)).list,
          tasks: await tasks.list(),
          goals: await goals.list(),
          automations: await automations.list(),
          threads: (
            await social.snapshot({ ...principal, actorId: `session:${principal.sessionId}` })
          ).threads,
        },
        projectId,
      ).items,
    async (operation, cwd, principal, authorized) =>
      await conversationDesktop.call(
        "inbox.write.authorize",
        { operation },
        cwd,
        principal,
        authorized,
      ),
  );
  const mobilePairing = new MobilePairing({
    environmentId: engine.store.environmentId,
    hasDeviceHash: async (hash) =>
      !!(await engine.store.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash)),
    issueDevice: async (name) => await engine.store.issueDevice(name),
    transaction: async (action) => await engine.store.transaction(action),
  });
  const mobileAccess = createMobileAccessService((): number => {
    const address = server.address();
    if (!address || typeof address === "string" || address.port <= 0)
      throw new Error("Host is not listening.");
    return address.port;
  });
  const mobileLan = new MobileLanAccess(
    join(featureDirectory, "mobile-lan.json"),
    engine.store.environmentId,
    () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return address.port;
    },
  );
  const tunnels =
    tunnelsOverride ??
    new ExternalTunnels(join(featureDirectory, "tunnels"), engine.store.environmentId, () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return `http://127.0.0.1:${address.port}`;
    });
  async function mcpBridgeMetadata(scope: "conversation" | "runtime-logs" | "social") {
    const address = server.address();
    const local = address && typeof address !== "string" && address.address === "127.0.0.1";
    return {
      command: process.execPath,
      args: [process.argv[1]],
      ...(local && !(scope === "social" && (await social.isDelegated?.()))
        ? { mcpUrl: `http://127.0.0.1:${address.port}/mcp/${scope}` }
        : {}),
    };
  }
  const mcpHttp = new McpHttp({
    store: engine.store,
    social,
    conversationAccess,
    runtimeLogAccess,
    runtimeLogs,
    refreshLogSources,
    conversationWorkspace,
    projectSessions: projectSessionList,
  });
  let closing = false;
  const requests = new Set<Promise<void>>();
  const server = createServer(
    { requestTimeout: 20_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
    (request, response) => {
      if (closing) {
        response.writeHead(503).end(JSON.stringify({ error: "Host is stopping." }));
        return;
      }
      const accepted = engine.store.db.outsideScope(async () => {
        const mcpMetric = mcpMetricName(request.url ?? "");
        if (mcpMetric) {
          await perfMetrics.measure(
            mcpMetric,
            async () => await mcpHttp.handle(request, response, server),
          );
          return;
        }
        if (await mcpHttp.handle(request, response, server)) return;
        if (await socialTransport.http(request, response)) return;
        if (webControl?.handle(request, response)) return;
        if (request.url === "/lifecycle" && lifecycle) {
          lifecycle(request, response);
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        let dispatchStarted: number | undefined;
        let dispatchMethod: unknown;
        try {
          if (await mobilePairing.handle(request, response)) return;
          // Desktop native HTTP supplies credentials. This endpoint intentionally
          // accepts no browser origin and provides no permissive CORS escape hatch.
          if (
            !(
              webControl?.acceptsRpc(request) ||
              (!request.headers.origin && request.method === "POST" && request.url === "/rpc")
            )
          ) {
            response
              .writeHead(403)
              .end(JSON.stringify({ error: "Unsupported request origin or route" }));
            return;
          }
          const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
          let socialPrincipal = token ? await social.principalForToken(token) : undefined;
          let runtimePrincipal = token
            ? await runtimeLogAccess.principalForToken(token)
            : undefined;
          let conversationPrincipal = token
            ? await conversationAccess.principalForToken(token)
            : undefined;
          let peerIdentity = token ? await socialPeers.authenticated(token) : undefined;
          if (
            !token ||
            (!socialPrincipal &&
              !runtimePrincipal &&
              !conversationPrincipal &&
              !peerIdentity &&
              !(await engine.store.authenticated(token)))
          ) {
            response.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" }).end(
              JSON.stringify({
                error: "Device credential is invalid or revoked",
              }),
            );
            return;
          }
          const input = await body(request);
          // Reading a request body yields: a device may have been revoked since
          // the headers arrived. Reject it before dispatching any operation.
          socialPrincipal = socialPrincipal ? await social.principalForToken(token) : undefined;
          runtimePrincipal = runtimePrincipal
            ? await runtimeLogAccess.principalForToken(token)
            : undefined;
          conversationPrincipal = conversationPrincipal
            ? await conversationAccess.principalForToken(token)
            : undefined;
          peerIdentity = peerIdentity ? await socialPeers.authenticated(token) : undefined;
          if (
            !socialPrincipal &&
            !runtimePrincipal &&
            !conversationPrincipal &&
            !peerIdentity &&
            !(await engine.store.authenticated(token))
          ) {
            response.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" }).end(
              JSON.stringify({
                error: "Device credential is invalid or revoked",
              }),
            );
            return;
          }
          if (input.version !== HOST_PROTOCOL_VERSION)
            throw new Error("Incompatible protocol version");
          if (
            input.method !== "environment.describe" &&
            input.environmentId !== engine.store.environmentId
          )
            throw new Error("Host identity changed; reconnect this machine explicitly");
          const params =
            input.params && typeof input.params === "object" && !Array.isArray(input.params)
              ? (input.params as Record<string, unknown>)
              : {};
          // Scope the timer to dispatch, including all early returns and failures.
          // Never retain input/params or error contents in the metrics collector.
          dispatchStarted = performance.now();
          dispatchMethod = input.method;
          let result: unknown;
          if (await mcpHttp.rpc(input.method, params, token, response)) return;
          if (peerIdentity) {
            result = await engine.store.db.withAuthorization(
              async () => !!(await socialPeers.authenticated(token)),
              () => socialPeers.peerRpc(peerIdentity, String(input.method), params),
            );
            if (!(await socialPeers.authenticated(token)))
              throw new Error("Peer authority revoked.");
            response.end(JSON.stringify({ result }));
            return;
          }
          if (socialPrincipal && input.method !== "social.tools.call")
            throw new Error("Session social credentials cannot access other host operations.");
          if (runtimePrincipal && input.method !== "runtimeLogs.tools.call")
            throw new Error("Session log credentials only permit reading runtime logs.");
          if (conversationPrincipal && input.method !== "conversation.tools.call")
            throw new Error("Session conversation credentials only permit Conversation Tools.");
          if (input.method === "conversation.tools.call") {
            if (!conversationPrincipal)
              throw new Error("A scoped conversation credential is required.");
            const boundPrincipal = conversationPrincipal;
            return await engine.store.db.withAuthorization(
              conversationAccess.authorization(token),
              async () => {
                const action = String(params.action ?? "");
                const args = params.input as Record<string, unknown>;
                validateConversationTool(action, args);
                const projectId = boundPrincipal.projectId;
                const project = await engine.store.project(projectId);
                if (action === "sessions.list" || action === "sessions.read") {
                  if (!(await inHost(boundPrincipal.sessionId)))
                    result = await conversationDesktop.call(
                      action,
                      args,
                      project.cwd,
                      boundPrincipal,
                      async () => !!(await conversationAccess.principalForToken(token)),
                    );
                  else if (action === "sessions.list") {
                    const { list } = await projectSessionList(projectId);
                    if (!(await conversationAccess.principalForToken(token)))
                      throw new Error("Session authority revoked.");
                    result = {
                      cwd: project.cwd,
                      sessions: list.map((session) => ({
                        id: session.id,
                        title: session.title,
                        harness: session.harness,
                        model: session.model,
                        busy: session.status === "running",
                        hasDraft: !!session.draft,
                      })),
                    };
                  } else {
                    const target = await featureSession(String(args.sessionId));
                    if (target.projectId !== projectId)
                      throw new Error("Conversation belongs to another project");
                    result = sessionConversationPage(
                      { ...target.session, busy: target.status === "running" },
                      args,
                    );
                  }
                } else if (action === "skills.search")
                  result = searchHarnessSkills(
                    sessionWorkCwd((await featureSession(boundPrincipal.sessionId)).session),
                    args,
                    undefined,
                    boundPrincipal.sessionId,
                    await explicitSkillNames(boundPrincipal.sessionId),
                  );
                else if (action === "skills.read")
                  result = await readHarnessSkill(
                    sessionWorkCwd((await featureSession(boundPrincipal.sessionId)).session),
                    {
                      name: String(args.name),
                      source: typeof args.source === "string" ? args.source : undefined,
                      scope: typeof args.scope === "string" ? args.scope : undefined,
                      offset: args.offset as number | undefined,
                      maxChars: args.maxChars as number | undefined,
                    },
                    undefined,
                    boundPrincipal.sessionId,
                    await explicitSkillNames(boundPrincipal.sessionId),
                  );
                else if (action.startsWith("crews."))
                  result = await crews.call(action, args, projectId, boundPrincipal);
                else if (isRuntimeReadConversationTool(action))
                  result = await conversationRuntimeReads.call(
                    action,
                    args,
                    boundPrincipal,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (isStewardConversationTool(action))
                  result = await conversationStewards.call(
                    action,
                    args,
                    boundPrincipal,
                    (await featureSession(boundPrincipal.sessionId)).session,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (isTaskQueueTool(action))
                  result = await conversationTaskQueue.call(
                    action,
                    args,
                    boundPrincipal,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (isGoalWriteTool(action))
                  result = await conversationGoals.call(
                    action,
                    args,
                    boundPrincipal,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (isProjectConversationTool(action))
                  result = await conversationProject.call(
                    action,
                    args,
                    boundPrincipal,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (isFileConversationTool(action)) {
                  const own = await featureSession(boundPrincipal.sessionId);
                  if (own.projectId !== projectId)
                    throw new Error("Conversation belongs to another project.");
                  const root = await resolveHostWorktreeAsync(
                    project.cwd,
                    sessionWorkCwd(own.session),
                  );
                  result = await callFileConversationTool(
                    root,
                    action,
                    args,
                    async (command, input) => {
                      if (!(await conversationAccess.principalForToken(token)))
                        throw new Error("Session authority revoked.");
                      return await workspace.run(
                        command,
                        input,
                        createHash("sha256").update(token).digest("hex"),
                      );
                    },
                  );
                  if (!(await conversationAccess.principalForToken(token)))
                    throw new Error("Session authority revoked.");
                } else if (isWorkspaceConversationTool(action))
                  result = await conversationWorkspace.call(
                    action,
                    args,
                    boundPrincipal,
                    (await featureSession(boundPrincipal.sessionId)).session,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (action === "tools.list")
                  result = {
                    environmentId: engine.store.environmentId,
                    projectId,
                    tools: conversationToolCatalog(),
                  };
                else if (
                  action.startsWith("ui.") ||
                  action.startsWith("servers.") ||
                  action === "machines.list" ||
                  action === "terminals.list" ||
                  action === "terminals.create" ||
                  action === "terminals.close" ||
                  action === "terminals.interrupt" ||
                  action === "terminals.write" ||
                  (action.startsWith("devices.") && args.machineId !== undefined)
                )
                  result = await conversationDesktop.call(
                    action,
                    args,
                    project.cwd,
                    boundPrincipal,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (action === "terminals.read")
                  result = runtimeLogs.read({
                    projectId,
                    source: "server",
                    sourceId: `server:terminal:${args.terminalId}`,
                    after: args.after as number | undefined,
                    limit: args.limit as number | undefined,
                  });
                else if (action === "logs.sources" || action === "logs.read") {
                  await refreshLogSources();
                  const query = runtimeLogToolQuery(
                    action === "logs.read" ? "read" : "sources",
                    args,
                    boundPrincipal,
                  );
                  result =
                    action === "logs.read" ? runtimeLogs.read(query) : runtimeLogs.sources(query);
                } else if (action === "logs.monitors.list") result = logMonitors.list(projectId);
                else if (action === "logs.monitors.start")
                  result = await logMonitors.start(projectId, args.url);
                else if (action === "logs.monitors.stop") {
                  await logMonitors.stop(projectId, String(args.id));
                  result = { stopped: true };
                } else if (action === "devices.preflight")
                  result = await deviceHost.preflight(args.deviceId as string | undefined);
                else if (action === "devices.preview")
                  result = devicePreviews.start(
                    args as any,
                    `${projectId}:${boundPrincipal.sessionId}`,
                    async () => !!(await conversationAccess.principalForToken(token)),
                  );
                else if (action === "devices.preview.status")
                  result = devicePreviews.status(
                    String(args.id),
                    `${projectId}:${boundPrincipal.sessionId}`,
                    args.includeFrame === true,
                  );
                else if (action === "devices.status") result = await deviceHost.status();
                else if (action === "devices.list") result = await deviceHost.list();
                else if (action === "devices.start") result = await deviceHost.start();
                else if (action === "devices.boot")
                  result = await deviceHost.boot(String(args.deviceId));
                else if (action === "devices.capture")
                  result = await deviceHost.capture(String(args.deviceId));
                else if (action === "devices.action")
                  result = await deviceHost.action(
                    String(args.deviceId),
                    args.action as DeviceAction,
                  );
                else if (action.startsWith("browser."))
                  result = await sharedBrowser.dispatchForSession(
                    action,
                    { ...args, projectId, sessionId: boundPrincipal.sessionId },
                    token,
                  );
                else if (action.startsWith("tasks.")) {
                  const list = (await tasks.list()).filter((task) => task.projectId === projectId);
                  if (action === "tasks.create") {
                    const own = (await featureSession(boundPrincipal.sessionId)).session;
                    const input = {
                      ...normalizeConversationTaskConfiguration(
                        args,
                        String(args.taskId),
                        projectId,
                        await tasks.list(),
                      ),
                      id: String(args.taskId),
                      projectId,
                      title: String(args.title),
                      prompt: String(args.prompt),
                      harness: own.harness,
                      providerAccountId: own.providerAccountId,
                      model: own.model,
                      modelSettings: own.modelSettings,
                      runtimeMode: own.runtimeMode,
                      maxRunMinutes: 0,
                      ...CONVERSATION_TASK_EXECUTION_DEFAULTS,
                      review: !args.crewDefinitionId,
                      autoMerge: false,
                      continueUntilDone: false,
                      ...(args.crewDefinitionId
                        ? { crewDefinitionId: String(args.crewDefinitionId) }
                        : {}),
                      status: args.status === "queued" ? "queued" : "todo",
                    };
                    const key = `task-create:${projectId}:${input.id}`;
                    const fingerprint = createHash("sha256")
                      .update(JSON.stringify([boundPrincipal.sessionId, input]))
                      .digest("hex");
                    result = await engine.store.transaction(async () => {
                      const receipt = (await engine.store.db
                        .prepare("SELECT value FROM metadata WHERE key=?")
                        .get(key)) as { value: string } | undefined;
                      const existing = await tasks.get(input.id);
                      if (receipt || existing) {
                        if (
                          receipt?.value !== fingerprint ||
                          !existing ||
                          existing.projectId !== projectId
                        )
                          throw new Error("Task ID was reused or its task no longer exists.");
                        return existing;
                      }
                      const created = await tasks.save(input);
                      await engine.store.db
                        .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
                        .run(key, fingerprint);
                      return created;
                    });
                  } else if (action === "tasks.list") result = list;
                  else {
                    const task = list.find((task) => task.id === args.taskId);
                    if (!task) throw new Error("Task is not in this project.");
                    if (
                      ![
                        "tasks.get",
                        "tasks.notes.read",
                        "tasks.session.read",
                        ...Object.keys(TASK_READ_TOOLS),
                      ].includes(action) &&
                      (task.sessionId === boundPrincipal.sessionId ||
                        task.reviewer?.sessionId === boundPrincipal.sessionId)
                    )
                      throw new Error("An agent cannot change its own active task.");
                    if (
                      ["tasks.delete", "tasks.transfer", "tasks.notes.resolve"].includes(action)
                    ) {
                      if (task.updatedAt !== args.expectedUpdatedAt)
                        throw new Error("Task changed; read it before changing it.");
                      const destination =
                        action === "tasks.transfer"
                          ? await engine.store.project(String(args.targetProjectId))
                          : undefined;
                      if (destination)
                        await tasks.validateTransfer(task.id, destination.id, task.updatedAt);
                      if (
                        action === "tasks.notes.resolve" &&
                        !task.reviewNotes?.some((note) => note.id === args.noteId)
                      )
                        throw new Error("Review note not found.");
                      const approvedTaskHash = createHash("sha256")
                        .update(JSON.stringify(task))
                        .digest("hex");
                      const approved = (await conversationDesktop.call(
                        "tasks.write.authorize",
                        {
                          operation: {
                            action,
                            taskId: task.id,
                            title: scrubRuntimeLogText(task.title, 1000),
                            expectedUpdatedAt: task.updatedAt,
                            ...(destination
                              ? {
                                  targetProjectId: destination.id,
                                  targetProjectName: destination.name,
                                }
                              : {}),
                            ...(action === "tasks.notes.resolve"
                              ? {
                                  noteId: args.noteId,
                                  resolved: args.resolved,
                                  note: scrubRuntimeLogText(
                                    JSON.stringify(
                                      task.reviewNotes?.find((note) => note.id === args.noteId) ??
                                        null,
                                    ),
                                    4000,
                                  ),
                                }
                              : {}),
                          },
                        },
                        project.cwd,
                        boundPrincipal,
                        async () => !!(await conversationAccess.principalForToken(token)),
                      )) as { approved?: boolean };
                      if (
                        !approved.approved ||
                        !(await conversationAccess.principalForToken(token))
                      )
                        throw new Error("Native owner approval required.");
                      const latest = await tasks.get(task.id);
                      if (
                        !latest ||
                        latest.projectId !== projectId ||
                        latest.updatedAt !== args.expectedUpdatedAt ||
                        createHash("sha256").update(JSON.stringify(latest)).digest("hex") !==
                          approvedTaskHash
                      )
                        throw new Error("Task changed during approval; read it again.");
                      if (action === "tasks.delete") {
                        await tasks.delete(task.id, false, latest.updatedAt);
                        result = { deleted: true };
                      } else if (action === "tasks.transfer")
                        result = await tasks.transfer(
                          task.id,
                          String(args.targetProjectId),
                          latest.updatedAt,
                        );
                      else result = await tasks.resolveNote(task.id, args.noteId, args.resolved);
                    } else if (action === "tasks.get") result = task;
                    else if (Object.hasOwn(TASK_READ_TOOLS, action))
                      result = callConversationTaskRead(action, args, task, list);
                    else if (action === "tasks.session.read") {
                      const sessionId =
                        args.role === "reviewer" ? task.reviewer?.sessionId : task.sessionId;
                      if (!sessionId)
                        throw new Error("This task has no session for the selected role.");
                      const snapshot = await featureSession(sessionId);
                      if (snapshot.projectId !== projectId)
                        throw new Error("Task session belongs to another project.");
                      const limit = Number(args.limit ?? 20),
                        after = Number(
                          args.after ?? Math.max(0, snapshot.session.blocks.length - limit),
                        );
                      const blocks = snapshot.session.blocks
                        .slice(after, after + limit)
                        .map((block) => scrubRuntimeLogText(JSON.stringify(block), 8192));
                      result = {
                        sessionId,
                        status: snapshot.status,
                        revision: snapshot.revision,
                        totalBlocks: snapshot.session.blocks.length,
                        blocks,
                        next: after + blocks.length,
                      };
                    } else if (action === "tasks.start") result = await tasks.startTask(task.id);
                    else if (action === "tasks.retry") {
                      if (task.status !== "blocked")
                        throw new Error("Only blocked tasks can be retried.");
                      result = await tasks.move(task.id, "queued");
                    } else if (action === "tasks.stop") {
                      if (!["running", "verifying"].includes(task.status))
                        throw new Error("Task is not running.");
                      result = await tasks.move(task.id, "blocked");
                    } else if (action === "tasks.update") {
                      if (
                        args.title === undefined &&
                        args.prompt === undefined &&
                        args.dependsOn === undefined &&
                        args.verifyCommand === undefined
                      )
                        throw new Error("Supply a title, prompt, dependencies or check command.");
                      const { status: _status, ...input } = task;
                      result = await tasks.save({
                        ...input,
                        ...normalizeConversationTaskConfiguration(
                          args,
                          task.id,
                          projectId,
                          await tasks.list(),
                        ),
                        ...(args.title !== undefined ? { title: args.title } : {}),
                        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
                      });
                    } else if (action === "tasks.review.recheck")
                      result = await tasks.recheckReview(task.id);
                    else result = await tasks.readNotes(task.id, args.noteIds);
                  }
                } else if (action.startsWith("devServers.")) {
                  const projects = [{ id: project.id, name: project.name, path: project.cwd }];
                  if (action === "devServers.list") {
                    const list = (await devServers.handle(
                      action,
                      { projectId, refresh: args.refresh },
                      projects,
                    )) as {
                      servers: { projectId?: string }[];
                    };
                    result = {
                      ...list,
                      servers: list.servers.filter((server) => server.projectId === projectId),
                    };
                  } else {
                    let details: DevServerDetails | undefined;
                    if (action !== "devServers.start") {
                      details = (await devServers.handle(
                        "devServers.details",
                        { ...args, projectId },
                        projects,
                      )) as DevServerDetails;
                      if (details.server.projectId !== projectId)
                        throw new Error(
                          "Dev server belongs to another project or has no verified project association.",
                        );
                    }
                    if (action === "devServers.openExternal") {
                      const endpoint = details!.server.endpoints.find(
                        (value) =>
                          value.port === args.port &&
                          (args.address === undefined || value.address === args.address),
                      );
                      if (!endpoint)
                        throw new Error("The selected server is no longer listening on this port");
                      result = await openDevServerBrowser(endpoint.url);
                    } else {
                      result = await devServers.handle(
                        action,
                        { ...args, projectId, cwd: project.cwd },
                        projects,
                      );
                      if (action === "devServers.logs") {
                        const logs = result as { available: boolean; output: string };
                        const clean = scrubRuntimeLogText(logs.output, Number.MAX_SAFE_INTEGER);
                        const limit = Number(args.maxBytes ?? 32000);
                        const bytes = Buffer.from(clean);
                        result = {
                          available: logs.available,
                          output: bytes
                            .subarray(Math.max(0, bytes.length - limit))
                            .toString("utf8"),
                          truncated: bytes.length > limit,
                        };
                      }
                    }
                  }
                } else if (action === "resources.read")
                  result = diagnostics.read(`session:${boundPrincipal.sessionId}`);
                response.end(JSON.stringify({ result }));
                return;
              },
            );
          }
          if (input.method === "runtimeLogs.tools.call") {
            if (!runtimePrincipal) throw new Error("A scoped session log credential is required.");
            await refreshLogSources();
            if (!(await runtimeLogAccess.principalForToken(token)))
              throw new Error("Session authority revoked.");
            const action = String(params.action ?? "");
            const query = runtimeLogToolQuery(
              action,
              params.input && typeof params.input === "object" && !Array.isArray(params.input)
                ? (params.input as Record<string, unknown>)
                : {},
              runtimePrincipal,
            );
            result =
              action === "sources" || action === "runtimeLogs.sources"
                ? runtimeLogs.sources(query)
                : runtimeLogs.read(query);
            response.end(JSON.stringify({ result }));
            return;
          }
          if (typeof input.method === "string" && input.method.startsWith("social.")) {
            return await engine.store.db.withAuthorization(
              socialPrincipal
                ? social.authorization(token)
                : async () => await engine.store.authenticated(token),
              async () => {
                const principal: SocialPrincipal = socialPrincipal ?? {
                  kind: "owner",
                  actorId: `device:${createHash("sha256").update(token).digest("hex")}`,
                  provider: "owner",
                };
                if (input.method === "social.bridge.describe") {
                  if (principal.kind !== "owner") throw new Error("Native owner device required.");
                  result = await mcpBridgeMetadata("social");
                } else if (input.method === "social.access.issue") {
                  if (principal.kind !== "owner")
                    throw new Error("Only a native owner device can issue social access.");
                  if (params.expectedScope !== undefined && (await social.isDelegated?.()))
                    throw new Error("Delegated social grants require an explicit reconnect.");
                  const sessionId = String(params.sessionId ?? "");
                  // The desktop database supplies the cwd; a tool cannot register a
                  // project by claiming a path in its request.
                  if (!(await inHost(sessionId))) {
                    const cwd = await desktop.projectCwdAsync(sessionId);
                    if (cwd) await engine.store.addProject(cwd, basename(cwd));
                  }
                  const grant = (await social.remoteAccess?.(sessionId)) ?? {
                    ...(await social.issueSessionGrant(
                      sessionId,
                      createHash("sha256").update(token).digest("hex"),
                      params.expectedScope,
                    )),
                    environmentId: engine.store.environmentId,
                  };
                  result = { ...grant, command: process.execPath, args: [process.argv[1]] };
                } else if (String(input.method).startsWith("social.native.")) {
                  if (principal.kind !== "owner") throw new Error("Native owner device required.");
                  const deviceHash = createHash("sha256").update(token).digest("hex");
                  switch (input.method) {
                    case "social.native.status":
                      result = await socialPeers.status();
                      break;
                    case "social.native.enroll":
                      result = await socialPeers.enroll(
                        String(params.environmentId ?? ""),
                        deviceHash,
                      );
                      break;
                    case "social.native.register":
                      result = await socialPeers.register(params, deviceHash);
                      break;
                    case "social.native.authority":
                      result = await socialPeers.useAuthority(params);
                      break;
                    case "social.native.reset":
                      result = await socialPeers.resetAuthority();
                      break;
                    default:
                      throw new Error("Unsupported native social operation.");
                  }
                } else result = await socialTransport.rpc(principal, String(input.method), params);
                response.end(JSON.stringify({ result }));
                return;
              },
            );
          }
          await engine.store.db.withAuthorization(
            () => engine.store.authenticated(token),
            async () => {
              switch (input.method) {
                // These routes are owner transport only. Scoped agent credentials are
                // rejected above, so they cannot manufacture project-policy exceptions.
                case "workspaces.prepare": {
                  await engine.store.project(String(params.projectId ?? ""));
                  if (params.environmentId !== engine.store.environmentId)
                    throw new Error("Workspace belongs to another execution host");
                  result = await managedWorkspaces.prepare(
                    params as unknown as WorkspaceRpcRequest<"workspaces.prepare">,
                  );
                  break;
                }
                case "workspaces.list": {
                  await engine.store.project(String(params.projectId ?? ""));
                  if (
                    params.environmentId !== undefined &&
                    params.environmentId !== engine.store.environmentId
                  )
                    throw new Error("Workspace belongs to another execution host");
                  result = await managedWorkspaces.list({
                    ...(params as unknown as WorkspaceRpcRequest<"workspaces.list">),
                    environmentId: engine.store.environmentId,
                  });
                  break;
                }
                case "workspaces.get":
                  result = await workspaceForOwnerRpc(params.workspaceId);
                  break;
                case "workspaces.exactGitRewind.get":
                case "workspaces.exactGitRewind.set": {
                  result = await withWorkspaceOwner(token, async () => {
                    if (input.method === "workspaces.exactGitRewind.set") {
                      if (typeof params.enabled !== "boolean")
                        throw new Error("Exact Git rewind must be a boolean");
                      if (
                        params.enabled &&
                        (await engine.store.startupStates()).some(
                          (state) => state.workspaceId && (state.running || state.shellRunning),
                        )
                      )
                        throw new Error(
                          "Wait for running worktree turns before enabling exact Git rewind",
                        );
                      await managed.exactGitRewind.save(params.enabled);
                    }
                    return { enabled: await managed.exactGitRewind.read() };
                  });
                  break;
                }
                case "native.activity.start":
                case "native.activity.end":
                case "native.buffers.retire":
                case "native.buffers.reconcile":
                case "native.buffers.update": {
                  const action =
                    input.method === "native.buffers.retire"
                      ? "retireBuffers"
                      : input.method === "native.buffers.reconcile"
                        ? "reconcileBuffers"
                        : input.method === "native.buffers.update"
                          ? "updateBuffers"
                          : input.method === "native.activity.start"
                            ? "start"
                            : "end";
                  result = await withWorkspaceOwner<unknown>(token, (owner) =>
                    managed.nativeActivity[action](params as never, owner),
                  );
                  break;
                }
                case "native.rewind.plan":
                case "native.rewind.prepare":
                case "native.rewind.lookup":
                case "native.rewind.cancelPreparation":
                case "native.rewind.apply":
                case "native.rewind.status":
                case "native.rewind.ack": {
                  if (!(await managed.exactGitRewind.enabled()))
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  const action = String(input.method).slice("native.rewind.".length) as
                    | "plan"
                    | "prepare"
                    | "lookup"
                    | "cancelPreparation"
                    | "apply"
                    | "status"
                    | "ack";
                  result = await withWorkspaceOwner<unknown>(token, (owner) =>
                    managed.nativeRewind[action](params as never, owner),
                  );
                  break;
                }
                case "native.turn.begin":
                case "native.turn.end":
                case "sessions.managedTurn.begin":
                case "sessions.managedTurn.end":
                case "sessions.managedTurn.status": {
                  if (!(await managed.exactGitRewind.enabled()))
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (
                    !value ||
                    value.owner.kind !== "session" ||
                    value.owner.id !== params.sessionId
                  )
                    throw new Error("Session does not own this workspace");
                  result = await withWorkspaceOwner<unknown>(token, async (owner) => {
                    if (input.method === "native.turn.begin")
                      await managed.nativeRewind.bindTurn(
                        params as unknown as Parameters<typeof managed.nativeRewind.bindTurn>[0],
                        owner,
                      );
                    if (
                      input.method === "sessions.managedTurn.begin" ||
                      input.method === "native.turn.begin"
                    )
                      return managed.nativeTurns.begin(
                        params as unknown as Parameters<typeof managed.nativeTurns.begin>[0],
                        owner,
                      );
                    return managed.nativeTurns[
                      input.method === "sessions.managedTurn.end" ||
                      input.method === "native.turn.end"
                        ? "end"
                        : "status"
                    ](params as unknown as Parameters<typeof managed.nativeTurns.end>[0], owner);
                  });
                  if (input.method !== "sessions.managedTurn.status")
                    await managedWorkspaces.touchActivity(value.id);
                  break;
                }
                case "sessions.files.revertPlan":
                case "sessions.files.revert": {
                  const sessionId = String(params.sessionId ?? "");
                  const userBlockId = String(params.userBlockId ?? "");
                  if (!(await inHost(sessionId)))
                    throw new Error("File revert requires a host-executed session");
                  const value = await engine.store.session(sessionId);
                  if (value.status === "running")
                    throw new Error("Stop the session before reverting files");
                  if (
                    !value.session.blocks.some(
                      (block) => block.id === userBlockId && block.role === "user",
                    )
                  )
                    throw new Error("User message not found in this session");
                  if (params.planToken !== undefined && typeof params.planToken !== "string")
                    throw new Error("Invalid file revert plan token");
                  const cwd = sessionWorkCwd(value.session);
                  result =
                    input.method === "sessions.files.revertPlan"
                      ? await engine.checkpoints.filesRevertPlan(sessionId, cwd, userBlockId)
                      : await engine.checkpoints.filesRevert(
                          sessionId,
                          cwd,
                          userBlockId,
                          params.planToken as string | undefined,
                        );
                  break;
                }
                case "sessions.rewind.status": {
                  if (!(await managed.exactGitRewind.enabled()))
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (
                    !value ||
                    value.owner.kind !== "session" ||
                    value.owner.id !== params.sessionId ||
                    !(await inHost(String(params.sessionId)))
                  )
                    throw new Error("Git rewind status requires the owning host-executed session");
                  result = {
                    workspace: value,
                    conversationRevision: (await engine.store.session(value.owner.id)).revision,
                    operations: (await managedWorkspaces.listOperations(value.id)).filter(
                      (operation) => operation.kind === "rewind",
                    ),
                  };
                  break;
                }
                case "workspaces.pin": {
                  if (!(await workspaceForOwnerRpc(params.workspaceId)))
                    throw new Error("Managed workspace not found");
                  result = await withWorkspaceOwner(token, (owner) =>
                    managedWorkspaces.pin(
                      params as unknown as Parameters<typeof managedWorkspaces.pin>[0],
                      owner,
                    ),
                  );
                  break;
                }
                case "sessions.rewind.plan":
                case "sessions.rewind.apply":
                case "sessions.rewind.undo": {
                  if (!(await managed.exactGitRewind.enabled()))
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (
                    !value ||
                    value.owner.kind !== "session" ||
                    value.owner.id !== params.sessionId
                  )
                    throw new Error("Session does not own this workspace");
                  if (!(await inHost(String(params.sessionId))))
                    throw new Error(
                      "Git rewind requires a host-executed session; native protocol is unavailable",
                    );
                  const action =
                    input.method === "sessions.rewind.plan"
                      ? "plan"
                      : input.method === "sessions.rewind.undo"
                        ? "undo"
                        : "apply";
                  result =
                    action === "plan"
                      ? await managed.rewind.plan(
                          params as unknown as WorkspaceRpcRequest<"sessions.rewind.plan">,
                        )
                      : await managed.rewind[action](
                          params as unknown as WorkspaceRpcRequest<"sessions.rewind.apply">,
                        );
                  break;
                }
                case "workspaces.delivery.review":
                case "workspaces.delivery.merge":
                case "workspaces.delivery.publish": {
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (!value) throw new Error("Managed workspace not found");
                  const existing =
                    input.method !== "workspaces.delivery.review" &&
                    typeof params.idempotencyKey === "string"
                      ? await managedWorkspaces.findOperation({
                          workspaceId: value.id,
                          kind: "delivery",
                          idempotencyKey: params.idempotencyKey,
                        })
                      : null;
                  if (
                    existing &&
                    (existing.kind !== "delivery" ||
                      existing.plan.token !== params.planToken ||
                      existing.expectedRevision !== params.expectedRevision ||
                      existing.plan.action !==
                        (input.method === "workspaces.delivery.merge" ? "merge" : "publish"))
                  )
                    throw new Error("Idempotency key was used for a different delivery");
                  await managed.assertWritable(value.id, existing?.id);
                  if (input.method === "workspaces.delivery.review")
                    result =
                      value.owner.kind === "task" && params.action === "merge"
                        ? await tasks.reviewDelivery(value.owner.id)
                        : await managed.delivery.review(
                            params as unknown as WorkspaceRpcRequest<"workspaces.delivery.review">,
                          );
                  else
                    result = await withWorkspaceOwner(token, async (owner) => {
                      if (
                        existing?.kind === "delivery" &&
                        existing.plan.action === "merge" &&
                        existing.phase !== "complete"
                      ) {
                        const recovered = await managed.delivery.recover(existing.id);
                        if (recovered.phase !== "complete")
                          throw new Error(
                            "Delivery still requires reconciliation; inspect its recorded operation before retrying",
                          );
                      }
                      if (input.method === "workspaces.delivery.publish") {
                        const receipt = await managed.delivery.publish(
                          params as unknown as WorkspaceRpcRequest<"workspaces.delivery.publish">,
                          owner,
                        );
                        await tasks.reconcileDelivery(value.id);
                        return receipt;
                      }
                      if (value.owner.kind === "task") {
                        await tasks.mergeDelivery(
                          value.owner.id,
                          params as unknown as WorkspaceRpcRequest<"workspaces.delivery.merge">,
                          owner,
                        );
                        const operation = await managedWorkspaces.findOperation({
                          workspaceId: value.id,
                          kind: "delivery",
                          idempotencyKey: String(params.idempotencyKey),
                        });
                        if (operation?.kind !== "delivery" || !operation.merge)
                          throw new Error("Task delivery receipt is unavailable");
                        await managed.retention.onLifecycle(value.id);
                        return operation.merge;
                      }
                      const receipt = await managed.delivery.merge(
                        params as unknown as WorkspaceRpcRequest<"workspaces.delivery.merge">,
                        owner,
                      );
                      await tasks.reconcileDelivery(value.id);
                      await managed.retention.onLifecycle(value.id);
                      return receipt;
                    });
                  break;
                }
                case "workspaces.cleanup.plan":
                case "workspaces.cleanup.apply":
                case "workspaces.cleanup.status": {
                  if (!(await workspaceForOwnerRpc(params.workspaceId)))
                    throw new Error("Managed workspace not found");
                  if (input.method === "workspaces.cleanup.status")
                    result = await managed.removal.status(
                      params as unknown as WorkspaceRpcRequest<"workspaces.cleanup.status">,
                    );
                  else if (input.method === "workspaces.cleanup.plan") {
                    await managed.assertWritable(String(params.workspaceId));
                    result = await managed.removal.plan(
                      params as unknown as WorkspaceRpcRequest<"workspaces.cleanup.plan">,
                    );
                  } else
                    result = await withWorkspaceOwner(token, (owner) =>
                      managed.removal.apply(
                        params as unknown as WorkspaceRpcRequest<"workspaces.cleanup.apply">,
                        owner,
                      ),
                    );
                  break;
                }
                case "workspaces.storage.status":
                  await engine.store.project(String(params.projectId ?? ""));
                  result = await managed.storageStatus(
                    params as unknown as WorkspaceRpcRequest<"workspaces.storage.status">,
                  );
                  break;
                case "workspaces.bootstrap.prepare":
                  if (!(await workspaceForOwnerRpc(params.workspaceId)))
                    throw new Error("Managed workspace not found");
                  result = await managed.prepareBootstrap(
                    params as unknown as Parameters<typeof managed.prepareBootstrap>[0],
                  );
                  break;
                case "workspaces.bootstrap.status":
                case "workspaces.bootstrap.cancel": {
                  const id = String(params.bootstrapId ?? "");
                  const status = await managed.bootstrap.status(id);
                  if (!(await workspaceForOwnerRpc(status.workspaceId)))
                    throw new Error("Managed workspace not found");
                  result =
                    input.method === "workspaces.bootstrap.cancel"
                      ? await managed.bootstrap.cancel(id)
                      : status;
                  break;
                }
                case "workspaces.activities.start": {
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (!value || params.kind !== "editor")
                    throw new Error("Only owner editor activities may be registered");
                  await managed.assertWritable(value.id);
                  const ownerId = createHash("sha256")
                    .update(await workspaceOwnerDeviceId(token))
                    .digest("hex");
                  result = await managed.activity.start({
                    workspaceId: value.id,
                    kind: "editor",
                    ownerId,
                    dirtyBuffer: params.dirtyBuffer === true,
                  });
                  editorActivities.set((result as { id: string }).id, {
                    workspaceId: value.id,
                    ownerId,
                  });
                  break;
                }
                case "workspaces.activities.stop": {
                  const id = String(params.activityId ?? "");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (!value) throw new Error("Managed workspace not found");
                  const entry =
                    editorActivities.get(id) ??
                    (await managed.activity.list(value.id)).find(
                      (activity) => activity.id === id && activity.kind === "editor",
                    );
                  if (
                    !entry ||
                    entry.ownerId !==
                      createHash("sha256")
                        .update(await workspaceOwnerDeviceId(token))
                        .digest("hex")
                  )
                    throw new Error("Editor activity is not owned by this device");
                  await workspaceForOwnerRpc(entry.workspaceId);
                  await managed.activity.stop(id);
                  editorActivities.delete(id);
                  result = { stopped: true };
                  break;
                }
                case "workspaces.activities.list": {
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (!value) throw new Error("Managed workspace not found");
                  result = await managed.activity.list(value.id);
                  break;
                }
                case "workspaces.resume":
                case "workspaces.finish":
                case "workspaces.close": {
                  if (!(await workspaceForOwnerRpc(params.workspaceId)))
                    throw new Error("Managed workspace not found");
                  const action =
                    input.method === "workspaces.resume"
                      ? "resume"
                      : input.method === "workspaces.finish"
                        ? "finish"
                        : "close";
                  result = await managedWorkspaces[action](
                    params as unknown as WorkspaceRpcRequest<"workspaces.resume">,
                  );
                  await managed.retention.onLifecycle(String(params.workspaceId));
                  break;
                }
                case "projects.workspacePolicy.get":
                case "projects.workspacePolicy.update": {
                  await engine.store.project(String(params.projectId ?? ""));
                  if (params.environmentId !== engine.store.environmentId)
                    throw new Error("Workspace policy belongs to another execution host");
                  result =
                    input.method === "projects.workspacePolicy.get"
                      ? await workspacePolicy.get(
                          params as unknown as WorkspaceRpcRequest<"projects.workspacePolicy.get">,
                        )
                      : await workspacePolicy.update(
                          params as unknown as WorkspaceRpcRequest<"projects.workspacePolicy.update">,
                          {
                            ownerId: createHash("sha256").update(token).digest("hex"),
                            authorizationId: randomUUID(),
                          },
                        );
                  break;
                }
                case "workspaces.featureClaims.list":
                  await engine.store.project(String(params.projectId ?? ""));
                  result = await featureClaims.list(
                    params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.list">,
                  );
                  break;
                case "workspaces.featureClaims.acquire":
                case "workspaces.featureClaims.release": {
                  if (!(await workspaceForOwnerRpc(params.workspaceId)))
                    throw new Error("Managed workspace not found");
                  await managed.assertWritable(String(params.workspaceId));
                  result =
                    input.method === "workspaces.featureClaims.acquire"
                      ? await featureClaims.acquire(
                          params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.acquire">,
                        )
                      : await featureClaims.release(
                          params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.release">,
                        );
                  break;
                }
                case "terminals.list":
                case "terminals.create":
                case "terminals.read":
                case "terminals.write":
                case "terminals.interrupt":
                case "terminals.close": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const closedCwd =
                    input.method === "terminals.close"
                      ? terminals
                          .list(project.id)
                          .terminals.find((terminal) => terminal.id === params.id)?.cwd
                      : undefined;
                  if (input.method === "terminals.list") result = terminals.list(project.id);
                  else if (input.method === "terminals.create")
                    result = await terminals.create(
                      project,
                      params,
                      createHash("sha256").update(token).digest("hex"),
                      async () => await engine.store.authenticated(token),
                    );
                  else if (input.method === "terminals.read")
                    result = terminals.read(project.id, params);
                  else if (input.method === "terminals.write")
                    result = await terminals.write(project.id, params);
                  else if (input.method === "terminals.interrupt")
                    result = await terminals.interrupt(project.id, params.id);
                  else result = await terminals.remove(project.id, params.id);
                  if (input.method === "terminals.create")
                    await touchTerminalWorkspace(project.id, (result as { id: string }).id);
                  else if (input.method === "terminals.write")
                    await touchTerminalWorkspace(project.id, params.id);
                  else if (input.method === "terminals.read") {
                    const read = result as {
                      cursor: number;
                      terminal: { id: string; state: string };
                    };
                    const previous = terminalActivityCursors.get(read.terminal.id) ?? 0;
                    if (
                      read.cursor > previous ||
                      terminalActivityStates.get(read.terminal.id) !== read.terminal.state
                    ) {
                      terminalActivityCursors.set(read.terminal.id, read.cursor);
                      await touchTerminalWorkspace(project.id, read.terminal.id);
                    }
                  } else if (input.method === "terminals.close" && typeof params.id === "string") {
                    terminalActivityCursors.delete(params.id);
                    terminalActivityStates.delete(params.id);
                    await touchTerminalWorkspace(project.id, params.id, closedCwd);
                  }
                  break;
                }
                case "conversation.desktop.take":
                  result = await conversationDesktop.take(
                    createHash("sha256").update(token).digest("hex"),
                  );
                  break;
                case "conversation.desktop.finish":
                  result = await conversationDesktop.finish(
                    String(params.id ?? ""),
                    params.result,
                    typeof params.error === "string" ? params.error : undefined,
                    createHash("sha256").update(token).digest("hex"),
                  );
                  break;
                case "conversation.desktop.authorize":
                  if (
                    Object.keys(params).some((key) => key !== "id" && key !== "action") ||
                    typeof params.id !== "string" ||
                    typeof params.action !== "string" ||
                    ![
                      "ssh.workspace.approve",
                      "ssh.workspace.close.approve",
                      "ptyMobile.create",
                      "ptyMobile.attach",
                      "ptyMobile.write",
                      "ptyMobile.resize",
                      "ptyMobile.detach",
                      "ptyMobile.close",
                    ].includes(params.action)
                  )
                    throw new Error("Invalid desktop authority check");
                  result = await conversationDesktop.authorize(
                    params.id,
                    params.action,
                    createHash("sha256").update(token).digest("hex"),
                  );
                  break;
                case "conversation.bridge.describe":
                  result = await mcpBridgeMetadata("conversation");
                  break;
                case "conversation.access.issue": {
                  const sessionId = String(params.sessionId ?? "");
                  if (!(await inHost(sessionId))) {
                    const cwd = await desktop.projectCwdAsync(sessionId);
                    if (cwd) await engine.store.addProject(cwd, basename(cwd));
                  }
                  result = {
                    ...(await conversationAccess.issueSessionGrant(
                      sessionId,
                      createHash("sha256").update(token).digest("hex"),
                      params.expectedScope,
                    )),
                    environmentId: engine.store.environmentId,
                    command: process.execPath,
                    args: [process.argv[1]],
                  };
                  break;
                }
                case "runtimeLogs.terminals.append": {
                  const cwd = String(params.cwd ?? "");
                  if (!cwd || cwd.length > 4096)
                    throw new Error("Terminal project directory is required");
                  const project =
                    (await engine.store.projects()).find((project) => project.cwd === cwd) ??
                    (await engine.store.addProject(cwd, basename(cwd)));
                  result = terminalLogs.append(project.id, params);
                  break;
                }
                case "runtimeLogs.bridge.describe":
                  result = await mcpBridgeMetadata("runtime-logs");
                  break;
                case "runtimeLogs.access.issue": {
                  const sessionId = String(params.sessionId ?? "");
                  if (!(await inHost(sessionId))) {
                    const cwd = await desktop.projectCwdAsync(sessionId);
                    if (cwd) await engine.store.addProject(cwd, basename(cwd));
                  }
                  result = {
                    ...(await runtimeLogAccess.issueSessionGrant(
                      sessionId,
                      createHash("sha256").update(token).digest("hex"),
                      params.expectedScope,
                    )),
                    environmentId: engine.store.environmentId,
                    command: process.execPath,
                    args: [process.argv[1]],
                  };
                  break;
                }
                case "runtimeLogs.monitors.list":
                case "runtimeLogs.monitors.start":
                case "runtimeLogs.monitors.stop": {
                  const projectId = String(params.projectId ?? "");
                  await engine.store.project(projectId);
                  if (input.method === "runtimeLogs.monitors.start")
                    result = await logMonitors.start(projectId, params.url);
                  else if (input.method === "runtimeLogs.monitors.stop") {
                    await logMonitors.stop(projectId, String(params.id ?? ""));
                    result = { stopped: true };
                  } else result = logMonitors.list(projectId);
                  break;
                }
                case "runtimeLogs.read":
                case "runtimeLogs.sources": {
                  await refreshLogSources();
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId));
                  if (params.sessionId !== undefined) {
                    const session = await featureSession(String(params.sessionId));
                    if (params.projectId !== undefined && session.projectId !== params.projectId)
                      throw new Error("Runtime logs belong to another project");
                  }
                  result =
                    input.method === "runtimeLogs.sources"
                      ? runtimeLogs.sources(params)
                      : runtimeLogs.read(params);
                  break;
                }
                case "devServers.bridgeCheck":
                case "devServers.bridgeOpen":
                case "devServers.bridgeRead":
                case "devServers.bridgeWrite":
                case "devServers.bridgeClose":
                  await engine.store.project(String(params.projectId ?? ""));
                  result = await devServerAccess.handle(input.method, params, token);
                  break;
                case "devServers.list":
                case "devServers.details":
                case "devServers.start":
                case "devServers.stop":
                case "devServers.kill":
                case "devServers.restart":
                case "devServers.logs":
                case "devServers.openExternal": {
                  await engine.store.project(String(params.projectId ?? ""));
                  const projects = (await engine.store.projects()).map((project) => ({
                    id: project.id,
                    name: project.name,
                    path: project.cwd,
                  }));
                  if (input.method === "devServers.openExternal") {
                    const details = (await devServers.handle(
                      "devServers.details",
                      params,
                      projects,
                    )) as DevServerDetails;
                    const endpoint = details.server.endpoints.find(
                      (value) =>
                        value.port === params.port &&
                        (params.address === undefined || value.address === params.address),
                    );
                    if (!endpoint)
                      throw new Error("The selected server is no longer listening on this port");
                    result = await openDevServerBrowser(endpoint.url);
                  } else if (
                    input.method === "devServers.start" &&
                    params.workspaceId !== undefined
                  ) {
                    const value = await workspaceForOwnerRpc(params.workspaceId);
                    if (!value || value.projectId !== params.projectId)
                      throw new Error("Managed workspace belongs to another project");
                    await managed.assertWritable(value.id);
                    result = await devServers.startWorkspace(
                      {
                        workspaceId: value.id,
                        runId: String(params.runId ?? ""),
                        kinds: ["vite", "hmr", "host", "cdp"],
                        command: String(params.command ?? ""),
                        cwd: value.path,
                        projectId: value.projectId,
                        ...(typeof params.name === "string" ? { name: params.name } : {}),
                      },
                      projects,
                    );
                  } else result = await devServers.handle(input.method, params, projects);
                  break;
                }
                case "resources.read":
                  result = diagnostics.read(token);
                  break;
                case "browser.setup":
                  // Explicit machine tools are authorized by the paired host credential.
                  // When a conversation project is supplied, retain its validation.
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId ?? ""));
                  await browserRuntime.setup();
                  result = {
                    ...(await sharedBrowser.dispatch("browser.status", params, token)),
                    runtime: await browserRuntime.status(),
                  };
                  break;
                case "browser.status":
                case "browser.claim":
                case "browser.release":
                case "browser.open":
                case "browser.frame":
                case "browser.input":
                case "browser.close":
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId));
                  if (params.sessionId !== undefined) {
                    const session = await featureSession(String(params.sessionId));
                    if (params.projectId !== undefined && session.projectId !== params.projectId)
                      throw new Error("Browser belongs to another project");
                  }
                  result = {
                    // Only paired owner RPCs may explicitly take control. Conversation
                    // tools use dispatchForSession and cannot enable this option.
                    ...(await sharedBrowser.dispatch(input.method, params, token, {
                      takeover: input.method === "browser.claim" && params.takeover === true,
                    })),
                    runtime: await browserRuntime.status(),
                  };
                  break;
                case "browser.annotation.start":
                case "browser.annotation.hover":
                case "browser.annotation.select":
                case "browser.annotation.clear":
                case "browser.annotation.read":
                case "browser.annotation.cancel": {
                  const projectId = String(params.projectId ?? "");
                  await engine.store.project(projectId);
                  if (
                    (await featureSession(String(params.sessionId ?? ""))).projectId !== projectId
                  )
                    throw new Error("Conversation belongs to another project");
                  result = await sharedBrowser.dispatch(input.method, params, token);
                  break;
                }
                case "environment.describe":
                  result = {
                    protocolVersion: HOST_PROTOCOL_VERSION,
                    environmentId: engine.store.environmentId,
                    name: hostname(),
                    webControl: webControl
                      ? { origin: webControl.origin, url: `${webControl.origin}/control` }
                      : undefined,
                    platform: process.platform,
                    gitRewindExecution: "host",
                    ...(buildIdentity ? { buildIdentity } : {}),
                    // Older clients validate this list against Codex and Claude only.
                    providers: [
                      ...new Set([
                        ...providers,
                        ...((await genericAcp.list()).length ? ["acp" as const] : []),
                      ]),
                    ].filter((provider) =>
                      Array.isArray(params.supportedProviders)
                        ? params.supportedProviders.includes(provider)
                        : provider === "codex" || provider === "claude",
                    ),
                    capabilities: [
                      WORKSPACE_CAPABILITIES.managed,
                      WORKSPACE_CAPABILITIES.policy,
                      "workspaces.delivery.v1",
                      "workspaces.pr-publication.v1",
                      "workspaces.lifecycle.v1",
                      "workspaces.pinning.v1",
                      ...((await managed.exactGitRewind.enabled())
                        ? [
                            "sessions.git-rewind.experimental.v1",
                            "sessions.git-rewind.v1",
                            "sessions.git-rewind-undo.v1",
                            "sessions.native-execution.v1",
                            "sessions.native-rewind.v1",
                          ]
                        : []),
                      "sessions.managedCreation.v1",
                      "workspaces.native-activity.v1",
                      ...(buildIdentity ? ["build.identity.v1"] : []),
                      "terminals.v1",
                      "mobile.pairing",
                      "mobile.access",
                      "tunnels.manage",
                      "sessions",
                      "sessions.createFirstTurn",
                      "sessions.pages",
                      "sessions.longPoll",
                      "sessions.lazyHistory",
                      "sessions.block",
                      "sessions.digests",
                      "machine.changes",
                      "machine.changes.inlineSync",
                      "git.watch",
                      "commands.status",
                      "sessions.harnessSwitch",
                      "sessions.steer",
                      "sessions.executionOwner",
                      "sessions.rewind",
                      "sessions.checkpoint-review",
                      "sessions.edit-from-here.v1",
                      "sessions.plan.review",
                      "sessions.contextual",
                      ...(providers.includes("claude") && engine.supportsItemStop("claude")
                        ? ["sessions.stopItem.claude"]
                        : []),
                      "projects.browse",
                      "projects.directory.v1",
                      "projects.createDirectory",
                      "models.list",
                      "crews.v1",
                      "crews.tasks.v1",
                      "crews.delete.v1",
                      "crews.run-delete.v1",
                      "crews.agent-groups.v1",
                      "approvals",
                      "questions",
                      "diff",
                      "git.branches",
                      "git.switch",
                      "git.createBranch",
                      "git.worktrees",
                      "git.worktreeCreate",
                      "files.read",
                      "files.list",
                      "files.index",
                      "workspace.run",
                      "workspace.browseDir",
                      "files.search",
                      "files.searchContent",
                      "files.create",
                      "files.write",
                      "git.index",
                      "git.fileDiff",
                      "git.action",
                      "git.actions",
                      "git.stash.clearSnapshot",
                      "git.management.snapshot.v1",
                      "git.conflicts",
                      "attachments.upload",
                      "attachments.resume",
                      "attachments.ownership.v1",
                      "attachments.read",
                      "sessions.draft",
                      "sessions.plan",
                      "sessions.shell",
                      "shell.profiles",
                      "shell.profile.compare.v1",
                      "sessions.desktop",
                      "sessions.desktopLive",
                      "sessions.desktop-writer-retirement.v1",
                      "sessions.queue",
                      "sessions.queue.lease",
                      "sessions.runLease",
                      "sync",
                      "automations",
                      "tasks",
                      "tasks.todo",
                      "tasks.history.v1",
                      "tasks.sprints.v1",
                      "tasks.workspaces",
                      "tasks.provider-accounts",
                      "goals.direct-checkout",
                      "goals.settings",
                      "goals.final-review",
                      "tasks.run-budget",
                      "tasks.preflight",
                      "tasks.evaluation",
                      "tasks.reviewer-profile",
                      "tasks.notes",
                      "tasks.review-recheck",
                      "tasks.blocked-takeover",
                      "tasks.continue-until-done",
                      "goals",
                      "stewards",
                      "host.settings",
                      "notes",
                      "notes.sessionFilter.v1",
                      "sessions.noteContext.v1",
                      "history.import.desktop.v1",
                      "projects.organization.desktop.v1",
                      "preferences.desktop.v1",
                      "worktrees.removal.desktop.v1",
                      "git.selective.review",
                      "usage.sessions.read",
                      "providers.center.read",
                      "providers.desktop.v1",
                      "providers.desktop.metadata.v1",
                      "ssh.workspace.desktop.v1",
                      "terminals.pty.desktop.v1",
                      "providers.desktop.quotaRefresh.v1",
                      "providers.acp.patchMetadata",
                      "host.access.read",
                      "devices.revokeOther",
                      "dev.servers.reviewed-impact",
                      "inbox.attention",
                      "inbox.providers.desktop",
                      "inbox.review.v1",
                      "inbox.jiraBoard.v1",
                      "device.host",
                      "devices.preview.mobile.v1",
                      "host.tools.machine-targets",
                      "generic-acp-v1",
                      "handoff-history-v1",
                      "resources.diagnostics",
                      "browser.shared.setup",
                      "browser.shared",
                      "runtime.logs",
                      "conversation.tools",
                      "runtime.logs.monitors",
                      "browser.annotation",
                      "dev.servers",
                      "dev.servers.private-access",
                      "voice.realtime.v1",
                      "voice.local.v1",
                      "voice.local.setup.v1",
                      "social.v1",
                      "social.policy.reviewed.v1",
                      "social.programs.v2",
                    ],
                  };
                  break;
                case "voice.clientSecret":
                  await engine.store.project(String(params.projectId ?? ""));
                  result = await createVoiceClientSecret();
                  break;
                case "voice.local.inspect":
                  result = await inspectVoiceRuntime(params.config);
                  break;
                case "voice.local.setup":
                case "voice.local.setupStatus":
                  if (
                    request.headers.origin ||
                    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
                      request.socket.remoteAddress ?? "",
                    )
                  )
                    throw new Error("Voice installation is available only on this computer.");
                  if (input.method === "voice.local.setup" && localVoice.isActive)
                    throw new Error("Disconnect voice before installing.");
                  result =
                    input.method === "voice.local.setup"
                      ? voiceSetup.start(params.config)
                      : voiceSetup.status();
                  break;
                case "voice.local.speak":
                  result = localVoice.speak(params.lease, params.text);
                  break;
                case "voice.local.speechNext":
                  result = await localVoice.nextSpeech(params.lease, params.id);
                  break;
                case "voice.local.speechCancel":
                  result = localVoice.cancelSpeech(params.lease, params.id);
                  break;
                case "voice.local.start":
                  if (voiceSetup.status().state === "installing")
                    throw new Error("Voice setup is still running.");
                  result = await localVoice.start(params.config);
                  break;
                case "voice.local.transcribe":
                  result = await localVoice.transcribe(params.lease, params.audio, params.language);
                  break;
                case "voice.local.keepAlive":
                  result = localVoice.keepAlive(params.lease);
                  break;
                case "voice.local.release":
                  result = localVoice.release(params.lease);
                  break;
                case "providers.center.read": {
                  const entries = await Promise.all(
                    [...new Set(providers)]
                      .filter((id) => id !== "acp")
                      .map(async (id) => {
                        let timer: ReturnType<typeof setTimeout> | undefined;
                        const launcher = await Promise.race([
                          resolveBinary[id]().then(
                            () => "resolved" as const,
                            () => "unavailable" as const,
                          ),
                          new Promise<"unknown">((resolve) => {
                            timer = setTimeout(() => resolve("unknown"), 1500);
                          }),
                        ]).finally(() => {
                          if (timer) clearTimeout(timer);
                        });
                        return { id, label: id, launcher, accountState: "desktop-only" as const };
                      }),
                  );
                  result = {
                    environmentId: engine.store.environmentId,
                    sampledAt: Date.now(),
                    providers: entries,
                    acp: await genericAcp.center(),
                  };
                  break;
                }
                case "providers.acp.patchMetadata":
                  await genericAcp.patchMetadata(params as GenericAcpMetadataPatch);
                  catalogs.clear();
                  result = null;
                  break;
                case "generic_acp_list":
                  result = await genericAcp.list();
                  break;
                case "generic_acp_save":
                  await genericAcp.save(params.config as GenericAcpConfig);
                  catalogs.clear();
                  result = null;
                  break;
                case "generic_acp_remove":
                  await genericAcp.remove(String(params.id ?? ""));
                  catalogs.clear();
                  result = null;
                  break;
                case "generic_acp_registry":
                  result = await genericAcp.registry(params.refresh === true);
                  break;
                case "generic_acp_install":
                  await genericAcp.install(String(params.id ?? ""), String(params.version ?? ""));
                  catalogs.clear();
                  result = null;
                  break;
                case "generic_acp_cancel_install":
                  genericAcp.cancelInstall(String(params.id ?? ""));
                  result = null;
                  break;
                case "handoff_history_save":
                case "handoff_history_read": {
                  const projectId = String(params.projectId ?? "");
                  await engine.store.project(projectId);
                  const sessionId =
                    input.method === "handoff_history_save"
                      ? (params.history as HandoffHistory)?.sessionId
                      : String(params.sessionId ?? "");
                  if (!sessionId) throw new Error("Invalid conversation");
                  if ((await featureSession(sessionId)).projectId !== projectId)
                    throw new Error("Conversation belongs to another project");
                  result =
                    input.method === "handoff_history_save"
                      ? await handoffHistory.save(params.history as HandoffHistory)
                      : await handoffHistory.read(
                          sessionId,
                          Number(params.cursor ?? 0),
                          Number(params.limit ?? 20),
                        );
                  break;
                }
                case "devices.preview.mobile.start":
                case "devices.preview.mobile.status":
                case "devices.preview.impact": {
                  const starting = input.method === "devices.preview.mobile.start";
                  const impact = input.method === "devices.preview.impact";
                  const allowed = [
                    "projectId",
                    ...(starting
                      ? ["requestId", "deviceId", "url", "installExpoGo", "expectedText"]
                      : impact
                        ? []
                        : ["id", "requestId", "includeFrame"]),
                  ];
                  if (
                    Object.keys(params).some((key) => !allowed.includes(key)) ||
                    typeof params.projectId !== "string"
                  )
                    throw new Error("Invalid mobile device preview scope");
                  const project = await engine.store.project(params.projectId);
                  const owner = `mobile:${createHash("sha256").update(token).digest("hex")}:${project.id}`;
                  const { projectId: _projectId, ...args } = params;
                  if (impact) result = devicePreviews.stopImpact(owner);
                  else if (starting) {
                    validateConversationTool("devices.preview", args);
                    result = devicePreviews.start(
                      args as Parameters<DevicePreviews["start"]>[0],
                      owner,
                      async () => {
                        try {
                          return (
                            (await engine.store.authenticated(token)) &&
                            (await engine.store.project(project.id)).cwd === project.cwd
                          );
                        } catch {
                          return false;
                        }
                      },
                    );
                  } else {
                    const id = (value: unknown) =>
                      typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
                    if (
                      (!id(args.id) && !id(args.requestId)) ||
                      (args.id !== undefined && !id(args.id)) ||
                      (args.requestId !== undefined && !id(args.requestId)) ||
                      (args.includeFrame !== undefined && typeof args.includeFrame !== "boolean")
                    )
                      throw new Error("Invalid mobile device preview identity");
                    result = devicePreviews.mobileStatus(
                      owner,
                      {
                        ...(args.id === undefined ? {} : { id: args.id as string }),
                        ...(args.requestId === undefined
                          ? {}
                          : { requestId: args.requestId as string }),
                      },
                      args.includeFrame === true,
                    );
                  }
                  break;
                }
                case "devices.status":
                case "devices.preflight":
                case "devices.preview":
                case "devices.preview.status":
                case "devices.setup":
                case "devices.start":
                case "devices.stop":
                case "devices.list":
                case "devices.boot":
                case "devices.capture":
                case "devices.action": {
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId ?? ""));
                  if (input.method === "devices.preflight")
                    result = await deviceHost.preflight(params.deviceId as string | undefined);
                  else if (
                    input.method === "devices.preview" ||
                    input.method === "devices.preview.status"
                  ) {
                    const {
                      previewOwner,
                      previewExpiresAt,
                      projectId: _projectId,
                      ...args
                    } = params;
                    validateConversationTool(input.method, args);
                    const owner = typeof previewOwner === "string" ? previewOwner : "native-owner";
                    result =
                      input.method === "devices.preview"
                        ? devicePreviews.start(
                            args as any,
                            owner,
                            () =>
                              previewExpiresAt === undefined ||
                              Date.now() < Number(previewExpiresAt),
                          )
                        : devicePreviews.status(String(args.id), owner, args.includeFrame === true);
                  } else if (input.method === "devices.status") result = await deviceHost.status();
                  else if (input.method === "devices.setup") {
                    if (typeof params.agentAccess !== "boolean")
                      throw new Error("Choose whether agents may control devices");
                    result = await deviceHost.setup(params.agentAccess);
                  } else if (input.method === "devices.start") result = await deviceHost.start();
                  else if (input.method === "devices.stop")
                    result = await devicePreviews.stopIdle(async () => await deviceHost.stop());
                  else if (input.method === "devices.list") result = await deviceHost.list();
                  else if (input.method === "devices.boot")
                    result = await deviceHost.boot(String(params.deviceId ?? ""));
                  else if (input.method === "devices.capture")
                    result = await deviceHost.capture(String(params.deviceId ?? ""));
                  else
                    result = await deviceHost.action(
                      String(params.deviceId ?? ""),
                      params.action as DeviceAction,
                    );
                  break;
                }
                case "projects.list":
                  result = await engine.store.projects();
                  break;
                case "projects.directory":
                  result = desktop.live.projectDirectory(
                    await engine.store.projects(),
                    engine.store.environmentId,
                  );
                  break;
                case "projects.browse":
                  result = await browseHostDirectories(params.path);
                  break;
                case "projects.createDirectory":
                  result = await createHostDirectory(params.path, params.name);
                  break;
                case "projects.open":
                  result = await engine.openProject(String(params.cwd ?? ""));
                  break;
                case "shell.profiles":
                  result = listShellProfiles();
                  break;
                case "shell.setProfile":
                  setChosenProfile(
                    typeof params.profile === "string" && params.profile.trim()
                      ? params.profile.trim()
                      : null,
                  );
                  result = listShellProfiles();
                  break;
                case "shell.setProfileReviewed":
                  result = setReviewedProfile(params);
                  break;
                case "models.list":
                  result = await models(
                    params.projectId,
                    params.progressive === true,
                    params.refresh === true,
                  );
                  break;
                case "sessions.list": {
                  const projectId = String(params.projectId ?? "");
                  const { list, etag } = await projectSessionList(projectId);
                  if (!(await engine.store.authenticated(token)))
                    throw new Error("Session authority revoked.");
                  // A client that sends `known` can take "unchanged" instead of the
                  // array. Clients that omit it keep getting the plain array.
                  if (typeof params.known === "string") {
                    result =
                      params.known === etag ? { unchanged: true, etag } : { etag, sessions: list };
                  } else result = list;
                  break;
                }
                case "machine.changes": {
                  const inlineSessionIds = params.inlineSessionIds;
                  if (
                    inlineSessionIds !== undefined &&
                    (!Array.isArray(inlineSessionIds) ||
                      inlineSessionIds.length > 64 ||
                      inlineSessionIds.some(
                        (id) => typeof id !== "string" || id.length === 0 || id.length > 1024,
                      ))
                  )
                    throw new Error("Invalid inline session selection");
                  result = await remoteChanges.read(
                    {
                      inlineSync: params.inlineSync === true,
                      instanceId:
                        typeof params.instanceId === "string" ? params.instanceId : undefined,
                      sessions: Array.isArray(params.sessions)
                        ? (params.sessions as {
                            sessionId: string;
                            revision: number;
                          }[])
                        : [],
                      projects: Array.isArray(params.projects)
                        ? (params.projects as { projectId: string; known?: string }[])
                        : [],
                      tasksKnown:
                        typeof params.tasksKnown === "string" ? params.tasksKnown : undefined,
                      git: Array.isArray(params.git)
                        ? (params.git as { cwd: string; known?: string }[])
                        : undefined,
                      waitMs: Number(params.waitMs),
                      demandChanged: params.demandChanged === true,
                    },
                    async (sessionId) => {
                      const host = await engine.store.sessionStateMetadata(sessionId);
                      if (host && (!host.desktop || host.status === "running"))
                        return host.revision;
                      // A change-poll tick: a fraction-of-a-second old read is fine.
                      const stamp = await desktop.stampAsync(sessionId, WATCH_STAMP_MS);
                      if (host && (!stamp || !stamp.running)) return host.revision;
                      if (!host && !stamp) return undefined;
                      const overlay = desktop.live.overlay(sessionId);
                      return Math.max(
                        stamp?.updatedAt ?? host?.revision ?? 0,
                        overlay?.changedAt ?? 0,
                      );
                    },
                    projectChangeSnapshot,
                    async () =>
                      closing || response.destroyed || !(await engine.store.authenticated(token)),
                    taskChangeEtag,
                    async (cwd) => await gitWatches.read(cwd),
                    async () =>
                      Array.isArray(params.sessions) &&
                      (
                        await Promise.all(
                          params.sessions.map(
                            async (entry: { sessionId: string }) =>
                              await desktopRecheckMs(entry.sessionId),
                          ),
                        )
                      ).some((duration) => duration === WATCH_STAMP_MS)
                        ? WATCH_STAMP_MS
                        : 1000,
                    createHash("sha256").update(token).digest("hex"),
                  );
                  result = await inlineSessionSync(
                    {
                      inlineSync: params.inlineSync === true,
                      inlineSessionIds: inlineSessionIds as string[] | undefined,
                      sessions: params.sessions as { sessionId: string; revision: number }[],
                      projects: [],
                    },
                    result as Awaited<ReturnType<RemoteChanges["read"]>>,
                    async (id, revision) => {
                      // Desktop rows may require transcript IO. Keep those on sessions.sync.
                      const metadata = await engine.store.sessionStateMetadata(id);
                      if (!metadata || (await desktopWatch(id, true))) return undefined;
                      const sync = await engine.store.sync(id, revision);
                      return sync.kind === "delta"
                        ? {
                            ...sync,
                            value: {
                              ...sync.value,
                              session: {
                                ...sync.value.session,
                                ...previewRewindHistory(sync.value.session),
                              },
                            },
                          }
                        : undefined;
                    },
                  );
                  if (!(await engine.store.authenticated(token)))
                    throw new Error("Device authorization was revoked");
                  break;
                }
                case "sessions.update": {
                  const sessionId = String(params.sessionId ?? "");
                  await adopt(sessionId);
                  const current = await engine.store.session(sessionId);
                  if (current.projectId !== params.projectId)
                    throw new Error("Session does not belong to this project");
                  const patch: {
                    title?: string;
                    archived?: boolean;
                    pinned?: boolean;
                    linkedWorkItem?: LinkedWorkItem | null;
                  } = {};
                  if (params.title !== undefined) {
                    if (typeof params.title !== "string") throw new Error("Invalid session title");
                    patch.title = params.title;
                  }
                  if (params.archived !== undefined) {
                    if (typeof params.archived !== "boolean")
                      throw new Error("Invalid archive value");
                    patch.archived = params.archived;
                  }
                  if (params.pinned !== undefined) {
                    if (typeof params.pinned !== "boolean") throw new Error("Invalid pin value");
                    patch.pinned = params.pinned;
                  }
                  if (params.linkedWorkItem !== undefined) {
                    const item = params.linkedWorkItem;
                    const parsed =
                      item && typeof item === "object" && !Array.isArray(item)
                        ? parseGithubWorkItemUrl(String((item as LinkedWorkItem).url ?? ""))
                        : null;
                    if (
                      item !== null &&
                      (typeof item !== "object" ||
                        Array.isArray(item) ||
                        !parsed ||
                        parsed.kind !== (item as LinkedWorkItem).kind ||
                        parsed.repo !== (item as LinkedWorkItem).repo ||
                        parsed.number !== (item as LinkedWorkItem).number ||
                        parsed.url !== (item as LinkedWorkItem).url)
                    )
                      throw new Error("Invalid linked work item");
                    patch.linkedWorkItem = item as LinkedWorkItem | null;
                  }
                  if (Object.keys(patch).length === 0)
                    throw new Error("No session changes supplied");
                  result = await engine.updateSession(sessionId, patch);
                  break;
                }
                case "sessions.delete": {
                  const sessionId = String(params.sessionId ?? "");
                  const host = await engine.store.sessionAuthority(sessionId);
                  const workspaceId = host
                    ? (await engine.store.session(sessionId)).session.workspaceId
                    : (await managed.list()).find(
                        (value) => value.owner.kind === "session" && value.owner.id === sessionId,
                      )?.id;
                  const managedSession = workspaceId ? await managed.get(workspaceId) : undefined;
                  if (managedSession) await managed.assertWritable(managedSession.id);
                  const release =
                    managedSession?.directoryState === "present"
                      ? await startWorkspaceActivity(
                          managedSession.path,
                          "mutation",
                          "session-delete",
                        )
                      : undefined;
                  try {
                    const cwd = await desktop.projectCwdAsync(sessionId);
                    if (cwd) {
                      const project = (await engine.store.projects()).find((p) =>
                        desktop.samePath(p.cwd, cwd),
                      );
                      if (!project || project.id !== params.projectId)
                        throw new Error("Session does not belong to this project");
                      if (
                        (await inHost(sessionId)) &&
                        (await engine.store.session(sessionId)).projectId !== project.id
                      )
                        throw new Error("Session does not belong to this project");
                      if (
                        (await desktop.stampAsync(sessionId))?.running ||
                        (await engine.store.sessionStateMetadata(sessionId))?.status === "running"
                      )
                        throw new Error("Stop this session before deleting it");
                      await desktopDelete.request(
                        sessionId,
                        cwd,
                        async () => await engine.store.authenticated(token),
                      );
                      if (await desktop.projectCwdAsync(sessionId))
                        throw new Error(
                          "The desktop did not remove this conversation. Refresh the list before retrying.",
                        );
                      // An adopted transcript must go too, or it would reappear in the list.
                      if (await inHost(sessionId)) await engine.store.deleteSession(sessionId);
                      await sessionQueues.delete(sessionId);
                      result = { deleted: true };
                      break;
                    }
                    const current = await engine.store.session(sessionId);
                    if (current.projectId !== params.projectId)
                      throw new Error("Session does not belong to this project");
                    await engine.store.deleteSession(sessionId);
                    await sessionQueues.delete(sessionId);
                    result = { deleted: true };
                    break;
                  } finally {
                    await release?.();
                  }
                }
                case "sessions.page": {
                  const sessionId = String(params.sessionId ?? "");
                  const watch = await desktopWatch(sessionId);
                  const page = await transcriptPages.page(
                    async () =>
                      (watch && (await desktopView(sessionId, watch.projectId))) ??
                      (await engine.store.session(sessionId)),
                    sessionId,
                    params.before === undefined ? undefined : Number(params.before),
                    params.revision === undefined ? undefined : Number(params.revision),
                    params.preview === true,
                    params.digests === true,
                  );
                  result = {
                    ...page,
                    value: undefined,
                    sync: transfers.respond(sessionId, {
                      kind: "snapshot",
                      value: {
                        ...page.value,
                        executionOwner:
                          page.value.status === "running"
                            ? watch
                              ? "desktop"
                              : "host"
                            : undefined,
                      },
                    }),
                  };
                  break;
                }
                case "sessions.sync": {
                  const sessionId = String(params.sessionId ?? "");
                  const revision = Number.isSafeInteger(params.revision)
                    ? Number(params.revision)
                    : undefined;
                  if (
                    revision !== undefined &&
                    Number.isFinite(params.waitMs) &&
                    Number(params.waitMs) > 0
                  ) {
                    await revisionWaits.wait(
                      async () =>
                        (await desktopWatch(sessionId, true))?.revision ??
                        (await engine.store.session(sessionId)).revision,
                      revision,
                      Number(params.waitMs),
                      async () =>
                        closing || response.destroyed || !(await engine.store.authenticated(token)),
                      async () => await desktopRecheckMs(sessionId),
                    );
                    if (!(await engine.store.authenticated(token)))
                      throw new Error("Device authorization was revoked");
                  }
                  const watch = await desktopWatch(sessionId);
                  let current: HostSession | undefined;
                  let sync: SessionSync;
                  if (watch) {
                    // Watching a desktop turn polls fast; skip the transcript read
                    // while the desktop copy hasn't changed.
                    if (revision === watch.revision) {
                      result = { kind: "unchanged", revision };
                      break;
                    }
                    const view = await desktopView(sessionId, watch.projectId);
                    if (view) {
                      current = view;
                      sync = desktopSync(view, revision);
                    } else {
                      await catchUp(sessionId);
                      current = await engine.store.session(sessionId);
                      sync = await engine.store.sync(sessionId, revision);
                    }
                  } else {
                    await catchUp(sessionId);
                    current = await engine.store.session(sessionId);
                    sync = await engine.store.sync(sessionId, revision);
                  }
                  if (params.partial === true) {
                    const rawIds = params.loadedBlockIds ?? [];
                    if (
                      !Array.isArray(rawIds) ||
                      rawIds.length > 32768 ||
                      rawIds.some((id) => typeof id !== "string" || !id || id.length > 512)
                    )
                      throw new Error("Invalid loaded block IDs");
                    if (sync.kind !== "unchanged") {
                      const partial = partialSessionSync(
                        sync,
                        current!,
                        rawIds as string[],
                        params.digests === true,
                      );
                      if (partial) sync = partial;
                      else {
                        const page = await transcriptPages.page(
                          () => current!,
                          sessionId,
                          undefined,
                          undefined,
                          true,
                          params.digests === true,
                        );
                        sync = { kind: "snapshot", value: page.value };
                      }
                    }
                  }
                  if (sync.kind === "snapshot") {
                    sync = { ...sync, value: previewSession(sync.value, params.digests === true) };
                  } else if (sync.kind === "delta") {
                    sync = {
                      ...sync,
                      value: {
                        ...sync.value,
                        // A partial window already carries the head of the whole transcript.
                        ...(params.digests === true && !sync.value.head ? withHead(current!) : {}),
                        session: {
                          ...sync.value.session,
                          ...previewRewindHistory(sync.value.session),
                        },
                      },
                    };
                  }
                  if (sync.kind === "snapshot") {
                    sync = {
                      ...sync,
                      value: {
                        ...sync.value,
                        executionOwner:
                          sync.value.status === "running"
                            ? watch
                              ? "desktop"
                              : "host"
                            : undefined,
                      },
                    };
                  } else if (sync.kind === "delta") {
                    sync = {
                      ...sync,
                      value: {
                        ...sync.value,
                        executionOwner:
                          sync.value.status === "running"
                            ? watch
                              ? "desktop"
                              : "host"
                            : undefined,
                      },
                    };
                  }
                  result = transfers.respond(sessionId, sync!);
                  break;
                }
                case "commands.status": {
                  const commandId = params.commandId;
                  if (typeof commandId !== "string" || !commandId || commandId.length > 200)
                    throw new Error("Invalid command ID");
                  result = (await engine.store.receiptStatus(commandId)) ?? null;
                  break;
                }
                case "sessions.desktopLive": {
                  const beat = desktop.live.beat(params);
                  await heartbeatEffects;
                  result = {
                    ...beat,
                    deletions: await desktopDelete.beat(
                      `${createHash("sha256").update(token).digest("hex")}:${String(params.clientId ?? "")}`,
                      params.deletions,
                    ),
                    inbox: await providerInbox.beat(
                      createHash("sha256").update(token).digest("hex"),
                      params.clientId,
                      params.inbox,
                    ),
                    notesRevision: hostNotes.revision,
                    // Lets the desktop re-read only the shared queues another computer
                    // changed, instead of polling every idle one on a timer.
                    queues: sessionQueues.changesSince(params.queueSeq),
                    // Likewise the adopted conversations whose host copy moved, so the
                    // desktop mirrors them at once instead of polling `sessions.adopted`.
                    adopted: await adoptedChanges.changesSince(params.adoptedSeq),
                    // The same beat keeps this desktop's drain leases alive. A lease it
                    // no longer holds is `null`: the host drains that queue itself.
                    queueLeases: await renewQueueLeases(params),
                    // And its run leases: `null` is a conversation it must stop writing to.
                    runLeases: await renewRunLeases(params),
                  };
                  break;
                }
                case "sessions.adopted":
                  result = await engine.store.adopted();
                  break;
                case "sessions.runLease": {
                  // A desktop window takes the conversation's run lease just before it
                  // starts a turn, and gives it back when the turn ends.
                  const id = String(params.sessionId ?? "");
                  const holder = params.clientId;
                  if (
                    !id ||
                    id.length > 200 ||
                    typeof holder !== "string" ||
                    !holder.startsWith("desktop:") ||
                    holder.length > 200
                  )
                    throw new Error("Invalid run lease request");
                  if (params.action === "release") {
                    const released = runLeases.release(
                      id,
                      holder,
                      Number.isSafeInteger(params.epoch) ? Number(params.epoch) : undefined,
                    );
                    if (released) queueDrainer.kickWaiting();
                    result = { released };
                    break;
                  }
                  if (params.action !== "acquire") throw new Error("Invalid run lease request");
                  await queueSessionStatus(id); // The same authorized existence check as the queue calls.
                  result = await engine.store.db.scope(async () => {
                    const hostRunning = writerTransfers.has(id) || (await hostRuns(id));
                    return {
                      lease: runLeases.acquire(id, holder, () => {
                        // The host's own turn, or another window's, keeps it from being granted.
                        if (hostRunning) return "host";
                        const busy = desktop.live.busyClient(id);
                        return busy && `desktop:${busy}` !== holder ? `desktop:${busy}` : undefined;
                      }),
                    };
                  });
                  break;
                }
                case "sessions.queue.get":
                case "sessions.queue.change":
                case "sessions.queue.claim":
                case "sessions.queue.finish":
                case "sessions.queue.release":
                case "sessions.queue.lease": {
                  const id = String(params.sessionId ?? "");
                  await attachmentOwnership.validateExposure(params);
                  const queueStatus = await queueSessionStatus(id); // Lightweight authorized session existence check.
                  const clientId = params.clientId;
                  if (typeof clientId !== "string" || !clientId || clientId.length > 200)
                    throw new Error("Invalid queue client");
                  const action = input.method.slice("sessions.queue.".length) as
                    | "get"
                    | "change"
                    | "claim"
                    | "finish"
                    | "lease"
                    | "release";
                  const normalize = (raw: unknown) => {
                    if (
                      !raw ||
                      typeof raw !== "object" ||
                      !Array.isArray((raw as { messages?: unknown }).messages)
                    )
                      throw new Error("Invalid queue");
                    const value =
                      raw as import("../src/features/connections/model/remoteQueue").RemoteQueue;
                    return {
                      ...value,
                      messages: value.messages.map((message) => ({
                        ...message,
                        attachments: resolveAttachments(
                          engine.store,
                          parseRemoteAttachments(message.attachments),
                        ).map((file) => ({
                          ...file,
                          hostEnvironmentId: engine.store.environmentId,
                        })),
                      })),
                    };
                  };
                  if (action === "finish") {
                    const currentQueue = await sessionQueues.get(id);
                    if (
                      currentQueue.claim?.clientId !== clientId &&
                      currentQueue.settled?.clientId !== clientId
                    )
                      throw new Error("Queued send belongs to another client.");
                    if (typeof params.accepted !== "boolean")
                      throw new Error("Invalid queue acknowledgement");
                    if (
                      params.accepted === false &&
                      ((await desktopWatch(id))?.running || queueStatus === "running")
                    )
                      throw new Error(
                        "Wait for the running turn before recovering its queued message.",
                      );
                  }
                  const change =
                    action === "change"
                      ? { before: normalize(params.before), after: normalize(params.after) }
                      : undefined;
                  result = await engine.store.transaction(
                    async () => await sessionQueues.serve(action, id, clientId, params, change),
                  );
                  const exposed =
                    result as import("../src/features/connections/model/sharedQueue").SharedQueue;
                  await attachmentOwnership.expose(
                    token,
                    exposed.messages.flatMap((message) =>
                      message.attachments.map((file) => file.id),
                    ),
                    params,
                  );
                  break;
                }
                case "sessions.syncChunk":
                  result = transfers.chunk(
                    String(params.sessionId ?? ""),
                    String(params.transfer ?? ""),
                    Number(params.offset),
                  );
                  break;
                case "sessions.block": {
                  const sessionId = String(params.sessionId ?? "");
                  const blockId = String(params.blockId ?? "");
                  if (!blockId || blockId.length > 512 || !Number.isSafeInteger(params.revision))
                    throw new Error("Invalid transcript block request");
                  const watch = await desktopWatch(sessionId);
                  const value =
                    (watch && (await desktopView(sessionId, watch.projectId))) ??
                    (await engine.store.session(sessionId));
                  if (value.revision !== params.revision)
                    throw new Error("Transcript changed; reload history");
                  const block = value.session.blocks.find((entry) => entry.id === blockId);
                  if (!block) throw new Error("Transcript block no longer exists");
                  result = transfers.respond(sessionId, {
                    kind: "snapshot",
                    value: {
                      ...value,
                      session: { ...value.session, blocks: [block] },
                      history: {
                        revision: value.revision,
                        totalBlocks: value.session.blocks.length,
                      },
                    },
                  });
                  break;
                }
                case "sessions.get": {
                  const id = String(params.sessionId ?? "");
                  const value = await readSessionView(id);
                  result =
                    value.revision === params.revision
                      ? null
                      : params.preview === true
                        ? transcriptPage(
                            params.summary === true
                              ? {
                                  ...value,
                                  session: {
                                    ...value.session,
                                    blocks: [
                                      value.session.blocks.findLast(
                                        (block) => block.role === "assistant" && block.text.trim(),
                                      ),
                                      value.session.blocks.findLast(
                                        (block) => block.role === "system" && block.text.trim(),
                                      ),
                                      value.session.blocks.findLast(
                                        (block) => block.approval && !block.approval.decided,
                                      ),
                                    ].filter(
                                      (block): block is NonNullable<typeof block> => !!block,
                                    ),
                                  },
                                }
                              : value,
                            undefined,
                            undefined,
                            true,
                          ).value
                        : value;
                  break;
                }
                case "events.read": {
                  if (!Number.isSafeInteger(params.after) || Number(params.after) < 0)
                    throw new Error("Invalid event cursor");
                  result = await engine.store.events(
                    String(params.sessionId ?? ""),
                    Number(params.after),
                  );
                  break;
                }
                case "history.import.preview":
                case "history.import.commit":
                case "history.import.status":
                case "history.import.cancel": {
                  const mode = input.method.slice("history.import.".length);
                  const action = mode === "preview" ? "discover" : mode;
                  result = await scopedDesktopCall(
                    token,
                    `historyImport.${action}`,
                    params,
                    mode === "commit"
                      ? ["reviewId", "digest", "candidateIds", "operationId"]
                      : mode === "preview"
                        ? []
                        : ["operationId"],
                  );
                  break;
                }
                case "projects.organization.read":
                case "projects.organization.patch":
                case "projects.organization.status": {
                  const mode = input.method.slice("projects.organization.".length);
                  result = await scopedDesktopCall(
                    token,
                    `organization.${mode}`,
                    params,
                    mode === "patch"
                      ? ["expectedRevision", "operationId", "change"]
                      : mode === "status"
                        ? ["operationId"]
                        : [],
                  );
                  break;
                }
                case "worktrees.removal.review":
                case "worktrees.removal.approve":
                case "worktrees.removal.status": {
                  const mode = input.method.slice("worktrees.removal.".length);
                  const reviewSecret = await desktopSigningSecret();
                  const reviewScope = {
                    environmentId: engine.store.environmentId,
                    projectId: String(params.projectId ?? ""),
                    sessionId: String(params.sessionId ?? ""),
                  };
                  const bound =
                    mode === "review"
                      ? params
                      : {
                          ...params,
                          requestId: desktopOperationId(
                            reviewSecret,
                            token,
                            reviewScope,
                            params.requestId,
                          ),
                          ...(mode === "approve"
                            ? {
                                reviewId: openDesktopReview(
                                  reviewSecret,
                                  token,
                                  reviewScope,
                                  params.reviewId,
                                ),
                              }
                            : {}),
                        };
                  result = await scopedDesktopCall(
                    token,
                    input.method,
                    bound,
                    mode === "review"
                      ? ["path"]
                      : mode === "approve"
                        ? ["reviewId", "requestId"]
                        : ["requestId"],
                  );
                  if (mode === "review") {
                    if (!result || typeof result !== "object" || Array.isArray(result))
                      throw new Error("Invalid worktree review");
                    const review = result as Record<string, unknown>;
                    result = {
                      ...review,
                      reviewId: sealDesktopReview(
                        reviewSecret,
                        token,
                        reviewScope,
                        review.reviewId,
                        review.expiresAt,
                      ),
                    };
                  }
                  break;
                }
                case "ssh.workspace.catalog.read":
                case "ssh.workspace.review":
                case "ssh.workspace.approve":
                case "ssh.workspace.status":
                case "ssh.workspace.close.review":
                case "ssh.workspace.close.approve": {
                  const mode = input.method.slice("ssh.workspace.".length);
                  const secret = await desktopSigningSecret();
                  const scope: DesktopReviewScope = {
                    environmentId: engine.store.environmentId,
                    projectId: String(params.projectId ?? ""),
                    sessionId: String(params.sessionId ?? ""),
                    feature: "ssh-workspace",
                  };
                  const fields =
                    mode === "catalog.read"
                      ? []
                      : mode === "review"
                        ? ["connectionId"]
                        : mode === "close.review"
                          ? ["workspaceId"]
                          : mode === "status"
                            ? ["requestId", "workspaceId"]
                            : ["reviewId", "requestId"];
                  if (
                    mode === "status" &&
                    Object.hasOwn(params, "requestId") === Object.hasOwn(params, "workspaceId")
                  )
                    throw new Error("SSH status requires exactly one owned identity");
                  const bound = { ...params };
                  if (Object.hasOwn(params, "requestId"))
                    bound.requestId = desktopOperationId(secret, token, scope, params.requestId);
                  if (Object.hasOwn(params, "reviewId"))
                    bound.reviewId = openDesktopReview(secret, token, scope, params.reviewId);
                  if (Object.hasOwn(params, "workspaceId"))
                    bound.workspaceId = openDesktopResource(
                      secret,
                      token,
                      scope,
                      "workspace",
                      params.workspaceId,
                    );
                  result = await scopedDesktopCall(token, input.method, bound, fields, {
                    actorId: desktopActorId(secret, token, scope),
                  });
                  if (!result || typeof result !== "object" || Array.isArray(result))
                    throw new Error("Invalid SSH workspace response");
                  const response = { ...(result as Record<string, unknown>) };
                  if (mode === "review" || mode === "close.review")
                    response.reviewId = sealDesktopReview(
                      secret,
                      token,
                      scope,
                      response.reviewId,
                      response.expiresAt,
                    );
                  if (Object.hasOwn(response, "workspaceId"))
                    response.workspaceId = sealDesktopResource(
                      secret,
                      token,
                      scope,
                      "workspace",
                      response.workspaceId,
                    );
                  result = response;
                  break;
                }
                case "preferences.desktop.read":
                case "preferences.desktop.template.read":
                case "preferences.desktop.patch":
                case "preferences.desktop.status": {
                  const mode = input.method.slice("preferences.desktop.".length);
                  const action = mode === "template.read" ? "templateRead" : mode;
                  result = await scopedDesktopCall(
                    token,
                    `preferences.${action}`,
                    params,
                    mode === "template.read"
                      ? ["templateId", "expectedRevision"]
                      : mode === "patch"
                        ? ["operationId", "expectedRevision", "change"]
                        : mode === "status"
                          ? ["operationId"]
                          : [],
                  );
                  break;
                }
                case "providers.desktop.read":
                  result = await scopedDesktopCall(token, "providerManagement.read", params, []);
                  break;
                case "providers.desktop.patch":
                case "providers.desktop.status":
                case "providers.desktop.quota.refresh": {
                  const mode = input.method.slice("providers.desktop.".length);
                  const scope: DesktopReviewScope = {
                    environmentId: engine.store.environmentId,
                    projectId: String(params.projectId ?? ""),
                    sessionId: String(params.sessionId ?? ""),
                    feature: "provider-management",
                  };
                  const operationId = desktopOperationId(
                    await desktopSigningSecret(),
                    token,
                    scope,
                    params.operationId,
                  );
                  result = await scopedDesktopCall(
                    token,
                    `providerManagement.${mode === "quota.refresh" ? "quotaRefresh" : mode}`,
                    { ...params, operationId },
                    mode === "patch"
                      ? [
                          "operationId",
                          "expectedAccountRevision",
                          "provider",
                          "accountId",
                          "change",
                        ]
                      : mode === "quota.refresh"
                        ? [
                            "operationId",
                            "expectedAccountRevision",
                            "provider",
                            "accountId",
                            "confirm",
                          ]
                        : ["operationId"],
                  );
                  if (
                    !result ||
                    typeof result !== "object" ||
                    Array.isArray(result) ||
                    (result as Record<string, unknown>).operationId !== operationId
                  )
                    throw new Error("Invalid provider operation response");
                  result = {
                    ...(result as Record<string, unknown>),
                    operationId: params.operationId,
                  };
                  break;
                }
                case "terminals.pty.desktop.list":
                case "terminals.pty.desktop.create":
                case "terminals.pty.desktop.attach":
                case "terminals.pty.desktop.read":
                case "terminals.pty.desktop.write":
                case "terminals.pty.desktop.status":
                case "terminals.pty.desktop.resize":
                case "terminals.pty.desktop.detach":
                case "terminals.pty.desktop.close": {
                  const mode = input.method.slice("terminals.pty.desktop.".length);
                  const secret = await desktopSigningSecret();
                  const scope: DesktopReviewScope = {
                    environmentId: engine.store.environmentId,
                    projectId: String(params.projectId ?? ""),
                    sessionId: String(params.sessionId ?? ""),
                    feature: "pty-mobile",
                  };
                  const leaseFields = ["terminalId", "epoch", "leaseId"];
                  const fields =
                    mode === "list"
                      ? []
                      : mode === "create"
                        ? ["requestId", "profileId", "cols", "rows"]
                        : mode === "attach"
                          ? ["terminalId", "epoch", "requestId", "after", "freshRenderer"]
                          : mode === "read"
                            ? ["terminalId", "epoch", "after", "limit"]
                            : mode === "close"
                              ? ["terminalId", "epoch", "requestId"]
                              : mode === "write"
                                ? [...leaseFields, "inputSequence", "dataBase64"]
                                : mode === "resize"
                                  ? [...leaseFields, "cols", "rows"]
                                  : mode === "status" && Object.hasOwn(params, "requestId")
                                    ? ["requestId"]
                                    : leaseFields;
                  if (
                    mode === "status" &&
                    !Object.hasOwn(params, "requestId") &&
                    leaseFields.some((key) => !Object.hasOwn(params, key))
                  )
                    throw new Error(
                      "PTY status requires an exact owned lease or create request identity",
                    );
                  const bound = { ...params };
                  for (const [key, role] of [
                    ["terminalId", "terminal"],
                    ["epoch", "epoch"],
                    ["leaseId", "lease"],
                  ] as const)
                    if (Object.hasOwn(params, key))
                      bound[key] = openDesktopResource(secret, token, scope, role, params[key]);
                  if (Object.hasOwn(params, "requestId"))
                    bound.requestId = desktopOperationId(secret, token, scope, params.requestId);
                  result = await scopedDesktopCall(token, `ptyMobile.${mode}`, bound, fields, {
                    actorId: desktopActorId(secret, token, scope),
                  });
                  const seal = (value: unknown): Record<string, unknown> => {
                    if (!value || typeof value !== "object" || Array.isArray(value))
                      throw new Error("Invalid owned PTY response");
                    const object = { ...(value as Record<string, unknown>) };
                    for (const [key, role] of [
                      ["terminalId", "terminal"],
                      ["epoch", "epoch"],
                      ["leaseId", "lease"],
                    ] as const)
                      if (Object.hasOwn(object, key))
                        object[key] = sealDesktopResource(secret, token, scope, role, object[key]);
                    return object;
                  };
                  const response = seal(result);
                  if (Object.hasOwn(response, "terminal"))
                    response.terminal = seal(response.terminal);
                  if (Object.hasOwn(response, "terminals")) {
                    if (!Array.isArray(response.terminals) || response.terminals.length > 128)
                      throw new Error("Invalid owned PTY catalog");
                    response.terminals = response.terminals.map(seal);
                  }
                  result = response;
                  break;
                }
                case "sessions.contextual.preview": {
                  result = await engine.previewContextual(
                    params,
                    await readSessionView(String(params.sessionId ?? "")),
                  );
                  break;
                }
                case "commands.dispatch": {
                  const sessionId = String(params.sessionId ?? "");
                  // Validate context before adoption or special slash-command handling.
                  if (params.noteCard !== undefined) parseCommand(params);
                  if (params.type === "contextual") {
                    if (await engine.store.receiptStatus(String(params.commandId ?? ""))) {
                      // Reconcile the original receipt even if the source moved after acceptance.
                      result = await engine.command(params);
                      break;
                    }
                    const parsed = parseCommand(params);
                    if (parsed.type !== "contextual") throw new Error("Invalid contextual command");
                    const reviewed = await engine.previewContextual(
                      params,
                      await readSessionView(sessionId),
                    );
                    if (reviewed.digest !== parsed.previewDigest)
                      throw new Error(
                        "The reviewed context changed. Review it again before continuing.",
                      );
                  }
                  if (
                    ["send", "steer", "compact", "configure", "plan", "rewind"].includes(
                      String(params.type),
                    ) &&
                    // A claim whose sender is gone is given up on here too: it must not
                    // make every send from this computer wait for good.
                    (await sessionQueues.reapStale(sessionId)).claim &&
                    !(await engine.store.receiptStatus(String(params.commandId ?? "")))
                  )
                    throw new LeaseHeldError(
                      String((await sessionQueues.get(sessionId)).claim?.clientId ?? "desktop"),
                      "The owning desktop is preparing a queued send. Wait for its acknowledgement.",
                    );
                  const queued = params.queued as
                    | { id?: unknown; clientId?: unknown; revision?: unknown; selected?: unknown }
                    | undefined;
                  if (
                    queued &&
                    !(await engine.store.receiptStatus(String(params.commandId ?? "")))
                  ) {
                    if (!["send", "steer", "compact"].includes(String(params.type)))
                      throw new Error("Invalid queued command");
                    if (
                      typeof queued.id !== "string" ||
                      typeof queued.clientId !== "string" ||
                      !Number.isSafeInteger(queued.revision)
                    )
                      throw new Error("Invalid queued send");
                    await assertHostMayRun(sessionId);
                    const aware = (queued as { leaseAware?: unknown }).leaseAware === true;
                    const queuedEpoch = (queued as { epoch?: unknown }).epoch;
                    if (!aware) await sessionQueues.renew(sessionId, String(queued.clientId));
                    const currentQueue = await sessionQueues.assertSend(
                      sessionId,
                      String(queued.id),
                      String(queued.clientId),
                      Number(queued.revision),
                      params.type === "steer" || queued.selected === true,
                      {
                        epoch: Number.isSafeInteger(queuedEpoch) ? Number(queuedEpoch) : undefined,
                        legacy: !aware,
                      },
                    );
                    const row = currentQueue.messages.find((entry) => entry.id === queued.id)!;
                    if (
                      params.type === "compact"
                        ? row.text.trim().toLowerCase() !== "/compact"
                        : params.text !== row.text
                    )
                      throw new Error("Queued message content changed.");
                    if (row.modelTarget) {
                      const session = (await featureSession(sessionId)).session;
                      if (
                        !sameQueuedModelTarget(row.modelTarget, {
                          harness: session.harness,
                          model: session.model,
                          modelSettings: session.modelSettings,
                        })
                      )
                        throw new Error("Queued message model settings changed.");
                    }
                    const refs = parseRemoteAttachments(params.attachments);
                    const queuedIntent =
                      row.intent === "plan" || row.intent === "build" ? row.intent : "default";
                    if (
                      JSON.stringify(refs.map((file) => [file.id, file.size])) !==
                        JSON.stringify(row.attachments.map((file) => [file.id, file.size])) ||
                      (params.type !== "compact" && (params.intent ?? "default") !== queuedIntent)
                    )
                      throw new Error("Queued message attachments or intent changed.");
                  }
                  if (
                    (params.type === "steer" || params.type === "rewind") &&
                    (await desktopWatch(sessionId))?.running
                  )
                    throw new Error(
                      params.type === "rewind"
                        ? "This desktop-owned turn must finish before its conversation can be rewound."
                        : "This desktop-owned turn cannot be redirected through the host. Queue the message or stop it first.",
                    );
                  if (
                    params.type === "rewind" &&
                    (await sessionQueues.get(sessionId)).messages.length
                  )
                    throw new Error("Clear the queued messages before rewinding the conversation.");
                  // Stopping or answering a turn the desktop app runs: leave it for
                  // the app, which picks it up with its next heartbeat.
                  if (
                    params.type === "cancel" ||
                    params.type === "approve" ||
                    params.type === "answer"
                  ) {
                    const watch = await desktopWatch(sessionId);
                    if (watch?.running) {
                      if (!desktop.live.alive())
                        throw new Error(
                          "The bycoda app on that computer isn't responding. Try again when it's open.",
                        );
                      const command = parseCommand(params);
                      if (
                        command.type === "cancel" ||
                        command.type === "approve" ||
                        command.type === "answer"
                      )
                        desktop.live.enqueue(command);
                      result = {
                        commandId: command.commandId,
                        sessionId,
                        revision: watch.revision,
                      };
                      break;
                    }
                  }
                  // A turn starts only where the run lease allows it: a desktop window
                  // running one makes this a wait (`LEASE_HELD`), never a failure.
                  if (
                    ["send", "compact", "contextual"].includes(String(params.type)) &&
                    !(await engine.store.receiptStatus(String(params.commandId ?? "")))
                  )
                    await assertHostMayRun(sessionId);
                  if (params.type !== "create") await adopt(sessionId);
                  if (
                    params.type === "send" &&
                    typeof params.text === "string" &&
                    isClearSessionCommand(params.text)
                  ) {
                    if (
                      (await desktopWatch(sessionId))?.running ||
                      (await sessionQueues.get(sessionId)).messages.length
                    )
                      throw new Error(
                        "Stop the current turn and clear queued messages before clearing the conversation.",
                      );
                    result = await engine.clearConversation(params);
                    break;
                  }
                  if (params.type === "rewind") {
                    result = await engine.rewind(params);
                    break;
                  }
                  const dispatch = () =>
                    engine.store.transaction(async () => {
                      if (!(await engine.store.authenticated(token)))
                        throw new Error("Device authorization was revoked");
                      const receipt = await engine.command(params);
                      if (
                        queued &&
                        (await sessionQueues.get(sessionId)).messages.some(
                          (row) => row.id === queued.id,
                        )
                      )
                        await sessionQueues.consumed(sessionId, String(queued.id));
                      await crews.ownerDirective(params);
                      return receipt;
                    });
                  result = ["send", "compact", "contextual"].includes(String(params.type))
                    ? await withRetiredDesktopWriters(sessionId, dispatch)
                    : await dispatch();
                  if (
                    ["send", "steer", "compact", "contextual", "shell"].includes(
                      String(params.type),
                    )
                  )
                    await touchSessionWorkspace(sessionId);
                  // A usage limit that was dismissed lets a queue that waited on it go on.
                  if (params.type === "usageLimit") queueDrainer.kick(sessionId);
                  break;
                }
                case "sync.pull": {
                  const sinceRev = Number.isSafeInteger(params.sinceRev)
                    ? Number(params.sinceRev)
                    : 0;
                  result = await syncPull(
                    engine.store.db,
                    sinceRev,
                    params.paginated === true
                      ? {
                          untilRev:
                            Number.isSafeInteger(params.untilRev) &&
                            Number(params.untilRev) >= sinceRev
                              ? Number(params.untilRev)
                              : undefined,
                        }
                      : undefined,
                  );
                  break;
                }
                case "sync.push": {
                  if (!Array.isArray(params.ops)) throw new Error("Invalid sync ops");
                  result = await engine.store.transaction(
                    async () => await syncPush(engine.store.db, params.ops as SyncOp[]),
                  );
                  break;
                }
                case "usage.sessions.read":
                  result = await readSessionUsage(engine.store, params);
                  break;
                case "notes.list":
                  if (params.sessionId !== undefined) {
                    const session = await featureSession(String(params.sessionId));
                    if (
                      params.projectId !== undefined &&
                      session.projectId !== String(params.projectId)
                    )
                      throw new Error("Session belongs to another project.");
                    result = await hostNotes.list(undefined, session.session.id);
                    if (!(await engine.store.authenticated(token)))
                      throw new Error("Session authority revoked.");
                    break;
                  }
                  result = await hostNotes.list(
                    params.projectId === undefined
                      ? undefined
                      : (await engine.store.project(String(params.projectId))).cwd,
                  );
                  if (!(await engine.store.authenticated(token)))
                    throw new Error("Session authority revoked.");
                  break;
                case "notes.get": {
                  const session =
                    params.sessionId !== undefined
                      ? await featureSession(String(params.sessionId))
                      : undefined;
                  if (
                    session &&
                    params.projectId !== undefined &&
                    session.projectId !== String(params.projectId)
                  )
                    throw new Error("Session belongs to another project.");
                  const note = await hostNotes.get(params.id);
                  if (!(await engine.store.authenticated(token)))
                    throw new Error("Session authority revoked.");
                  if (params.sessionId !== undefined) {
                    if (note && note.sourceSessionId !== session!.session.id)
                      throw new Error("Note belongs to another session.");
                  }
                  result = note;
                  break;
                }
                case "notes.upsert":
                  result = await hostNotes.save(
                    params.note,
                    params.expectedUpdatedAt,
                    undefined,
                    async () => await engine.store.authenticated(token),
                  );
                  break;
                case "notes.delete":
                  result = await hostNotes.delete(
                    params.id,
                    params.expectedUpdatedAt,
                    undefined,
                    async () => await engine.store.authenticated(token),
                  );
                  break;
                case "inbox.provider.status":
                  result = await providerInbox.availability();
                  break;
                case "inbox.provider.request": {
                  const operation = parseRemoteInboxOperation(
                    params,
                    await engine.store.projects(),
                  );
                  if (
                    inboxOperationWrites(operation) &&
                    params.confirm !==
                      (operation.action === "comment"
                        ? "SEND_COMMENT"
                        : operation.action === "review"
                          ? "SUBMIT_PR_REVIEW"
                          : operation.action === "jira-board-transition" ||
                              operation.action === "jira-board-move"
                            ? "CHANGE_JIRA_BOARD"
                            : "CHANGE_PR_STATE")
                  )
                    throw new Error("This inbox write requires an explicit owner action.");
                  result = await providerInbox.request(
                    createHash("sha256").update(token).digest("hex"),
                    params.requestId,
                    operation,
                  );
                  break;
                }
                case "inbox.provider.result":
                  result = await providerInbox.result(
                    createHash("sha256").update(token).digest("hex"),
                    params.requestId,
                  );
                  break;
                case "inbox.list": {
                  const projectId =
                    params.projectId === undefined ? undefined : String(params.projectId);
                  const projects = projectId
                    ? [await engine.store.project(projectId)]
                    : await engine.store.projects();
                  const sessions = (
                    await Promise.all(
                      projects.map(async (project) => await projectSessionList(project.id)),
                    )
                  ).flatMap((entry) => entry.list);
                  if (!(await engine.store.authenticated(token)))
                    throw new Error("Session authority revoked.");
                  result = hostInbox(
                    {
                      sessions,
                      tasks: await tasks.list(),
                      goals: await goals.list(),
                      automations: await automations.list(),
                      threads: (
                        await social.snapshot({
                          kind: "owner",
                          actorId: "device",
                          provider: "owner",
                        })
                      ).threads,
                    },
                    projectId,
                  );
                  break;
                }
                case "automations.list":
                  result = await automations.list();
                  break;
                case "automations.preview":
                  result = automations.preview(params.schedule);
                  break;
                case "automations.save":
                  result = await automations.save(params.automation);
                  break;
                case "automations.delete":
                  await automations.delete(String(params.automationId ?? ""));
                  result = { deleted: true };
                  break;
                case "automations.runs":
                  result = await automations.runs(String(params.automationId ?? ""));
                  break;
                case "automations.runNow":
                  result = await automations.runNow(String(params.automationId ?? ""));
                  break;
                case "crews.list":
                case "crews.schema":
                case "crews.inspect":
                case "crews.save":
                case "crews.delete":
                case "crews.deleteRun":
                case "crews.agent.save":
                case "crews.agent.delete":
                case "crews.start":
                case "crews.get":
                case "crews.assign":
                case "crews.request":
                case "crews.resolve":
                case "crews.respond":
                case "crews.answer":
                case "crews.pause":
                case "crews.stop":
                case "crews.resume":
                case "crews.accept":
                case "crews.finish":
                  result = await crews.call(input.method, params, String(params.projectId ?? ""));
                  break;
                // These cross-project planning routes belong only to paired owner
                // dispatch. Project-scoped conversation tools have their own allowlist.
                case "sprints.list":
                  result = await sprints.list();
                  break;
                case "sprints.get":
                  result = await sprints.get(String(params.id ?? ""));
                  break;
                case "sprints.create":
                  result = await sprints.create(params.input as SprintCreateInput);
                  break;
                case "sprints.update":
                  result = await sprints.update(
                    String(params.id ?? ""),
                    params.input as SprintUpdateInput,
                  );
                  break;
                case "sprints.start":
                  result = await sprints.start(
                    String(params.id ?? ""),
                    params.input as SprintCommand,
                  );
                  break;
                case "sprints.complete":
                  result = await sprints.complete(
                    String(params.id ?? ""),
                    params.input as SprintCompleteInput,
                  );
                  break;
                case "sprints.archive":
                  result = await sprints.archive(
                    String(params.id ?? ""),
                    params.input as SprintCommand,
                  );
                  break;
                case "sprints.plan":
                  result = await sprints.plan(params.input as SprintPlanInput);
                  break;
                case "sprints.report":
                  result = await sprints.report(String(params.id ?? ""));
                  break;
                case "sprints.ingest":
                  result = await sprints.ingest(params.input as SprintIngestInput);
                  break;
                case "sprints.goalContext":
                  result = await sprints.setGoalContext(params.input as SprintGoalContextInput);
                  break;
                case "tasks.snapshotWithCursor":
                  result = await tasks.snapshotWithCursor();
                  break;
                case "tasks.events":
                  result = await tasks.events(
                    params.after as number,
                    params.limit as number | undefined,
                  );
                  break;
                case "tasks.list":
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId));
                  result = await tasks.list(
                    params.projectId === undefined ? undefined : String(params.projectId),
                  );
                  break;
                case "tasks.save":
                  result = await tasks.save(params.task);
                  break;
                case "tasks.move":
                  result = await tasks.move(String(params.taskId ?? ""), params.to);
                  break;
                case "tasks.start":
                  result = await tasks.startTask(String(params.taskId ?? ""));
                  break;
                case "tasks.reorder":
                  result = await tasks.reorder(params.taskIds);
                  break;
                case "tasks.retarget":
                  result = await withWorkspaceOwner(token, (owner) =>
                    tasks.retarget(
                      String(params.taskId ?? ""),
                      params.workspace,
                      params.autoMerge,
                      owner,
                    ),
                  );
                  break;
                case "tasks.review.recheck":
                  result = await tasks.recheckReview(String(params.taskId ?? ""));
                  break;
                case "tasks.notes.read":
                  result = await tasks.readNotes(String(params.taskId ?? ""), params.noteIds);
                  break;
                case "tasks.notes.resolve":
                  result = await tasks.resolveNote(
                    String(params.taskId ?? ""),
                    params.noteId,
                    params.resolved,
                  );
                  break;
                case "tasks.delete":
                  await tasks.delete(
                    String(params.taskId ?? ""),
                    params.discard === true,
                    params.expectedUpdatedAt as number | undefined,
                  );
                  result = { deleted: true };
                  break;
                case "goals.list":
                  result = await goals.list();
                  break;
                case "goals.create":
                  result = await goals.create(params.goal);
                  break;
                case "goals.final-review.recheck":
                  result = await goals.recheckFinalReview(
                    String(params.goalId ?? ""),
                    params.expectedUpdatedAt,
                  );
                  break;
                case "tasks.preflight":
                  result = await tasks.preflight(params.task);
                  break;
                case "tasks.evaluation.save":
                  result = await tasks.recordEvaluation(
                    String(params.taskId ?? ""),
                    params.evaluation,
                    params.expectedUpdatedAt,
                  );
                  break;
                case "goals.approve":
                  result = await goals.approve(String(params.goalId ?? ""));
                  break;
                case "goals.update":
                  result = await goals.update(
                    String(params.goalId ?? ""),
                    params.settings,
                    params.expectedUpdatedAt,
                  );
                  break;
                case "goals.replan":
                  result = await goals.replan(String(params.goalId ?? ""), params.feedback);
                  break;
                case "goals.cancel":
                  result = await goals.cancel(String(params.goalId ?? ""));
                  break;
                case "goals.delete":
                  await goals.delete(String(params.goalId ?? ""), params.withTasks === true);
                  result = { deleted: true };
                  break;
                case "host.settings.get":
                  result = await tasks.limits.state();
                  break;
                case "host.settings.save":
                  await tasks.limits.save(params.settings);
                  result = await tasks.limits.state();
                  void tasks.tick();
                  break;
                case "stewards.list":
                  result = await stewards.list();
                  break;
                case "stewards.save":
                  result = await stewards.save(params.steward);
                  break;
                case "stewards.delete":
                  await stewards.delete(String(params.stewardId ?? ""));
                  result = { deleted: true };
                  break;
                case "stewards.runNow":
                  result = await stewards.runNow(String(params.stewardId ?? ""));
                  break;
                case "stewards.decline":
                  await stewards.decline(String(params.taskId ?? ""));
                  result = { declined: true };
                  break;
                case "attachments.claim":
                  await attachmentOwnership.claim(token, params);
                  result = { claimed: true };
                  break;
                case "attachments.release":
                  await attachmentOwnership.release(token, params);
                  result = { released: true };
                  break;
                case "attachments.claims":
                  result = await attachmentOwnership.claims(token, params);
                  break;
                case "attachments.status": {
                  await attachmentOwnership.touch(token, params);
                  const status = await attachmentUploadStatus(engine.store, params);
                  await attachmentOwnership.uploaded(params, status.offset);
                  result = status;
                  break;
                }
                case "attachments.upload": {
                  await attachmentOwnership.touch(token, params);
                  const uploaded = await writeAttachmentChunk(engine.store, params);
                  await attachmentOwnership.uploaded(params, uploaded.offset);
                  result = uploaded;
                  break;
                }
                case "attachments.read":
                  result = await readAttachmentChunk(engine.store, params);
                  break;
                case "mobile.pairing.create":
                  result = await mobilePairing.create(token, params);
                  break;
                case "mobile.pairing.status":
                  result = await mobilePairing.status(token, params.pairingId);
                  break;
                case "mobile.pairing.cancel":
                  result = await mobilePairing.cancel(token, params.pairingId);
                  break;
                case "host.access.read":
                  result = await readHostAccess(engine.store.environmentId, {
                    devices: async () => await engine.store.pairedDevices(token),
                    lan: async () => await mobileLan.status(),
                    privateNetwork: async () => await mobileAccess.status(),
                    tunnels: async () => await tunnels.status(),
                  });
                  break;
                case "devices.revokeOther":
                  if (
                    Object.keys(params).some((key) => key !== "id") ||
                    typeof params.id !== "string" ||
                    !/^[a-zA-Z0-9_-]{1,128}$/.test(params.id)
                  )
                    throw new Error("Invalid paired device identity");
                  result = {
                    revoked: await engine.store.revokeOtherDevice(String(params.id), token),
                  };
                  break;
                case "mobile.access.status":
                  if (
                    params.mode !== undefined &&
                    !["lan", "tailscale"].includes(String(params.mode))
                  )
                    throw new Error("Invalid phone connection mode.");
                  result =
                    params.mode === "lan" ? await mobileLan.status() : await mobileAccess.status();
                  break;
                case "mobile.access.enable":
                  if (
                    params.mode !== undefined &&
                    !["lan", "tailscale"].includes(String(params.mode))
                  )
                    throw new Error("Invalid phone connection mode.");
                  result =
                    params.mode === "lan"
                      ? await mobileLan.enable(params.address)
                      : await mobileAccess.enable();
                  break;
                case "mobile.access.disable":
                  if (params.mode !== "lan")
                    throw new Error("Only local network access can be disabled here.");
                  result = await mobileLan.disable();
                  break;
                case "tunnels.status":
                  result = await tunnels.status();
                  break;
                case "tunnels.start":
                  result = await tunnels.start(params);
                  break;
                case "tunnels.stop":
                  result = await tunnels.stop(params);
                  break;
                case "tunnels.credential":
                  result = await tunnels.credential(params);
                  break;
                case "devices.revokeSelf":
                  workspace.cancelSearches(createHash("sha256").update(token).digest("hex"));
                  diagnostics.revoke(token);
                  sharedBrowser.revoke(token);
                  // Only the caller's own credential. Sessions and other devices
                  // are unaffected; the host keeps running.
                  result = {
                    revoked: await engine.store.revokeToken(token),
                  };
                  break;
                case "git.diff": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const diff = await exec(
                    "git",
                    [
                      "-c",
                      "core.pager=cat",
                      "diff",
                      "--no-ext-diff",
                      "--no-textconv",
                      "HEAD",
                      "--",
                    ],
                    {
                      cwd: await resolveHostWorktreeAsync(project.cwd, params.cwd),
                      timeout: 10_000,
                      maxBuffer: 2 * 1024 * 1024,
                    },
                  );
                  result = diff.stdout;
                  break;
                }
                case "git.branches": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await hostBranches(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                  );
                  break;
                }
                case "git.switch": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  result = await engine.withIdleProject(
                    project.id,
                    async () => await switchHostBranch(cwd, params.branch, params.remote),
                  );
                  break;
                }
                case "git.createBranch": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  result = await engine.withIdleProject(
                    project.id,
                    async () => await createHostBranch(cwd, params.branch),
                  );
                  break;
                }
                case "git.worktrees": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await hostWorktrees(project.cwd);
                  break;
                }
                case "git.worktreeCreate": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  result = await engine.withIdleProject(
                    project.id,
                    async () =>
                      await createHostWorktree(
                        project.cwd,
                        params.branch,
                        params.base,
                        params.existing,
                        cwd,
                      ),
                  );
                  workspace.invalidateRoots();
                  break;
                }
                case "files.read": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await readHostFile(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                    params.path,
                  );
                  break;
                }
                case "files.list": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await listHostFiles(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                    params.path,
                  );
                  break;
                }
                case "files.index": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await indexHostFiles(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                  );
                  break;
                }
                case "workspace.run":
                  result =
                    (await workspace.run(
                      params.command,
                      params.args,
                      createHash("sha256").update(token).digest("hex"),
                    )) ?? null;
                  break;
                case "files.search": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await searchHostFiles(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                    params.query,
                  );
                  break;
                }
                case "files.searchContent": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await searchHostContent(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                    params,
                  );
                  break;
                }
                case "files.create": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  const release = await startWorkspaceActivity(cwd, "editor", "files.create");
                  try {
                    result = await createHostPath(cwd, params.parent, params.name, params.isDir);
                  } finally {
                    await release();
                  }
                  break;
                }
                case "files.write": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  const release = await startWorkspaceActivity(cwd, "editor", "files.write");
                  try {
                    result =
                      (await writeHostFile(cwd, params.path, params.expected, params.content)) ??
                      null;
                  } finally {
                    await release();
                  }
                  break;
                }
                case "git.index": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await hostGitIndex(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                  );
                  break;
                }
                case "git.fileDiff": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  result = await hostFileDiff(
                    await resolveHostWorktreeAsync(project.cwd, params.cwd),
                    params.path,
                    params.staged === true,
                  );
                  break;
                }
                case "git.action": {
                  const project = await engine.store.project(String(params.projectId ?? ""));
                  const cwd = await resolveHostWorktreeAsync(project.cwd, params.cwd);
                  const release = await startWorkspaceActivity(cwd, "mutation", "git.action");
                  try {
                    result =
                      (await engine.withIdleProject(
                        project.id,
                        async () =>
                          await hostGitAction(
                            cwd,
                            params.action,
                            params.path,
                            params.message,
                            params.content,
                            params.expectedOriginal,
                          ),
                      )) ?? null;
                  } finally {
                    await release();
                  }
                  break;
                }
                default:
                  throw new Error("Unsupported host method");
              }
            },
          );
          const inline = serializedResponse(result);
          response.end(inline === undefined ? JSON.stringify({ result }) : `{"result":${inline}}`);
        } catch (error) {
          if (!response.destroyed)
            response.writeHead(error instanceof RequestAuthorizationError ? 401 : 400).end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Host request failed",
              }),
            );
        } finally {
          if (dispatchStarted !== undefined)
            perfMetrics.recordDuration(dispatchMethod, performance.now() - dispatchStarted);
        }
      });
      requests.add(accepted);
      void accepted
        .catch(() => {
          if (!response.destroyed) {
            if (!response.headersSent)
              response.writeHead(500).end(JSON.stringify({ error: "Host request failed." }));
            else response.destroy();
          }
        })
        .finally(() => requests.delete(accepted));
    },
  );
  let startup: Promise<void> = Promise.resolve();
  let resourceClose: Promise<void> | undefined;
  server.on("listening", () => {
    if (closing) return;
    startup = engine.store.db.outsideScope(async () => {
      if (closing) return;
      await managed.retention.start();
      if (closing) return;
      await queueDrainer.start();
      if (closing) return;
      crews.start();
      perfMetrics.start();
      await attachmentOwnership.start();
      if (closing) return;
      await mobileLan.start();
      if (closing) return;
      await social.start();
    });
    void startup.catch(() => {
      if (!closing) console.warn("Host background startup failed.");
    });
  });
  // Node does not await EventEmitter listeners. The CLI and fixtures await this
  // same promise before closing the engine/actor; flags are set before any await.
  const closeResources = (): Promise<void> => {
    if (resourceClose) return resourceClose;
    closing = true;
    resourceClose = engine.store.db.outsideScope(async () => {
      const pending: Promise<unknown>[] = [];
      const drain = (action: () => unknown) => {
        try {
          pending.push(Promise.resolve(action()));
        } catch (error) {
          pending.push(Promise.reject(error));
        }
      };
      drain(() => managed.retention.stop());
      drain(async () => await queueDrainer.close());
      drain(() => localVoice.close());
      drain(() => voiceSetup.close());
      drain(() => crews.close());
      drain(() => attachmentOwnership.close());
      drain(async () => await terminals.close());
      drain(() => devServerAccess.close());
      drain(() => gitWatches.close());
      drain(() => diagnostics.close());
      drain(() => perfMetrics.close());
      drain(async () => await devicePreviews.dispose());
      drain(async () => await deviceHost.dispose());
      drain(async () => await sharedBrowser.close());
      drain(async () => await logMonitors.close());
      drain(async () => await tunnels.close());
      drain(async () => await desktop.closeAsync());
      drain(() => desktopDelete.close());
      drain(() => desktop.live.closeWriterTransfers());
      drain(() => mobilePairing.close());
      drain(async () => await mobileLan.close());
      drain(() => conversationDesktop.close());
      drain(async () => await hostNotes.close());
      drain(async () => await social.stop());
      drain(async () => await xBrowser.stop(social));
      // Attach rejection handlers immediately while startup is still settling.
      const drained = Promise.allSettled(pending);
      const requested = Promise.allSettled([...requests]);
      await startup.catch(() => {});
      // A start already inside an async phase must not register a late loop.
      crews.stop();
      attachmentOwnership.close();
      const final = Promise.allSettled([social.dispose(), requested]);
      const results = [...(await drained), ...(await final)];
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "Host resources did not all close cleanly.");
    });
    return resourceClose;
  };
  server.on("close", () => {
    void closeResources().catch(() => console.warn("Host resources did not all close cleanly."));
  });
  try {
    await managed.recover((id) => tasks.reconcileDelivery(id));
    await Promise.all([
      attachmentOwnership.ready,
      providerInbox.ready,
      crews.ready,
      social.ready,
      socialPeers.ready,
      mcpHttp.tokens.ready,
      queueDrainer.ready,
    ]);
  } catch (error) {
    await closeResources().catch(() => {});
    throw error;
  }
  return Object.assign(server, {
    tasks,
    automations,
    goals,
    stewards,
    managedWorkspaces: managed,
    social,
    tunnels,
    terminals,
    runtimeLogAccess,
    conversationAccess,
    closeResources,
  });
}
