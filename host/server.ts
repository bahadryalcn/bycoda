import { executeAssistantObservationTool, isAssistantObservationAction, observationRoomConsumer } from "./assistant/observations/assistant-observation-tools";
import { AssistantObservationPages } from "./assistant/observations/assistant-observation-pages";
import { AssistantObservationNativePages, type NativePageScope } from "./assistant/observations/assistant-observation-native-pages";
import { AssistantObservationHostPages } from "./assistant/observations/assistant-observation-host-pages";
import { verifyNativeObservationPage, verifyNativeObservationCompletion, type NativeObservationCapture } from "./assistant/observations/assistant-native-observation-page";
import { roomNativeResult, mergeNativeLibraryProofs, type NativeLibraryProof } from "./assistant/native/assistant-native-library-proof";
import { AssistantNativeVoiceLeases, type NativeVoiceLease } from "./assistant/native/assistant-native-voice-leases";
import { AssistantObservationProjectPages, collectGoalObservationProjects } from "./assistant/observations/assistant-observation-project-pages";
import { createNativeDevicesService } from "./domains/native-devices/service";
import { RoomAttestationSigner, roomAttestationKeyPath } from "./assistant/room/assistant-room-attestation";
import { createRoomNativeTargetAdapter } from "./assistant/room/assistant-room-native-target";
import { hostRoomDelegationStore } from "./assistant/room/assistant-room-delegation-store";
import { conversationGitReviewHash } from "./conversation/conversation-git-review";
import {
  ConversationManagementTools,
  isManagementAction,
  managementPage,
  managementCommand,
  pageDesktopManagementSnapshot,
  type ManagementReceipt,
  type GlobalManagementPrincipal,
  type ManagementAction,
} from "./conversation/conversation-management-tools";
import { ConversationThreadWorkTools, THREAD_WORK_ACTIONS } from "./conversation/conversation-thread-work-tools";
import { ConversationThreadCrewTools, threadCrewAction } from "./conversation/conversation-thread-crew-tools";
import {
  isSessionManagementAction,
  dispatchSessionManagement,
} from "./conversation/conversation-session-management";
import {
  ConversationManagementRuntime,
  isGlobalRuntimeRead,
  isRuntimeManagementAction,
} from "./conversation/conversation-management-runtime";
import { projectManagementPath, runConversationGitAction } from "./conversation/conversation-project-management";
import {
  dispatchWorkspaceManagement,
  isWorkspaceManagementAction,
} from "./conversation/conversation-workspace-management";
import { conversationListArguments, pageConversationListResult } from "./conversation/conversation-list-page";
import { conversationSessionPage } from "../src/shared/model/conversationSessionPage";
import { elapsedSince, monotonicNow } from "../src/shared/lib/time/timestamps";
import { bindNativeDevicesOwner } from "./ports/native-devices";
import { bindNativeDeliveryOwner } from "./ports/native-delivery";
import { createNativeDeliveryStore } from "./native-delivery/native-delivery-store";
import { assertNativeDeliveryEffect } from "./native-delivery/native-delivery-epochs";
import { createNativeDeliveryService } from "./domains/native-delivery/service";
import {
  NATIVE_DELIVERY_METHODS,
  type NativeDeliveryMethod,
} from "../src/shared/model/host-contracts/native-delivery";
import {
  NATIVE_DEVICE_METHODS,
  DEVICE_LIFECYCLE_METHODS,
  MOBILE_DEVICE_PREVIEW_METHODS,
} from "../src/shared/model/host-contracts/native-devices";
import { ModelCatalogCache } from "./providers/model-catalog-cache";
import { projectDisplayNames } from "./projects/project-display-names";
import { hostProviderAccounts } from "./providers/provider-accounts";
import { createRealtimeSecret, createVoiceClientSecret } from "./voice/voice";
import { VoiceCloudCredentials } from "./voice/voice-cloud-credentials";
import { LocalVoiceService } from "./voice/voice-local";
import { inspectVoiceRuntime } from "./voice/voice-runtime";
import { VoiceSetupService } from "./voice/voice-setup";
import {
  prepareVoiceToolDispatch,
  validateVoiceToolList,
  voiceToolCatalog,
  voiceThreadToolAllowed,
  parseVoiceToolCall,
} from "./voice/voice-tools";
import { HostVoiceToolDisclosure } from "./voice/voice-tool-disclosure";
import { createRoomManagementDispatcher, roomManagementDiscovery, roomAccountResult, captureRoomProject, hasRoomProjectCapture } from "./assistant/management/assistant-management-dispatch";
import { AssistantRoomNotebook, isRoomNotebookAction } from "./assistant/room/assistant-room-notebook";
import { AssistantRoomSocialSend } from "./assistant/room/assistant-room-social-send";
import { AssistantRoomInbox, isRoomInboxAction } from "./assistant/room/assistant-room-inbox";
import { AssistantRoomRemote } from "./assistant/room/assistant-room-remote";
import { verifyWorkspaceReceipt } from "./assistant/native/assistant-workspace-receipt";
import { AssistantWorkspaceOwner, workspaceOperationJson } from "./assistant/native/assistant-workspace-owner";
import { describeWorkspaceTransfer, transferAssistantWorkspaceOperation } from "./assistant/native/assistant-workspace-transfer";
import { AsyncLocalStorage } from "node:async_hooks";
import { executeRoomSessionAction, isRoomSessionAction, validateRoomSessionAction } from "./assistant/room/assistant-room-session";
import { createRoomFileTools, isRoomFileAction, isRoomFileWrite } from "./assistant/room/assistant-room-files";
import { createRoomDevServerTools, isRoomDevServerAction } from "./assistant/room/assistant-room-dev-servers";
import { createRoomTerminalTools, isRoomTerminalAction, isRoomTerminalWrite } from "./assistant/room/assistant-room-terminals";
import { createRoomBrowserTools, isRoomBrowserAction } from "./assistant/room/assistant-room-browser";
import { isRoomWorkspaceAction, validateRoomWorkspaceAction } from "./assistant/room/assistant-room-workspace";
import { validateRoomOrganization } from "./assistant/room/assistant-room-organization";
import { AssistantVisibilityFence } from "./assistant/native/assistant-visibility-fence";
import { NativeAdmissionOwner } from "./assistant/native/assistant-native-admission";
import { AssistantVisibilityAdmission } from "./assistant/native/assistant-visibility-admission";
import { createRoomNativeSourceAdapter } from "./assistant/room/assistant-room-native-adapter";
import { AssistantObservationJournal } from "./assistant/observations/assistant-observation-journal";
import { installAssistantObservationProducers } from "./assistant/observations/assistant-observation-producers";
import { voiceGlobalToolAllowed } from "../src/shared/model/voiceToolScope";
import { readSessionUsage } from "./usage/usage-report";
import {
  desktopActorId,
  desktopOperationId,
  desktopReviewSecret,
  openDesktopReview,
  sealDesktopReview,
  openDesktopResource,
  sealDesktopResource,
  type DesktopReviewScope,
} from "./desktop/reviewed-desktop-scope";
import { readHostAccess } from "./security/access/access-center";
import { inlineSessionSync } from "./sessions/inlineSessionSync";
import { HostCrews } from "./crews/crews";
import { ConversationProjectTools, isProjectConversationTool } from "./conversation/conversation-project-tools";
import { callFileConversationTool, isFileConversationTool } from "./conversation/conversation-file-tools";
import { callVisualConversationTool, isVisualConversationTool } from "./conversation/conversation-visual-tools";
import {
  CONVERSATION_TASK_EXECUTION_DEFAULTS,
  TASK_READ_TOOLS,
  callConversationTaskRead,
  normalizeConversationTaskConfiguration,
} from "./conversation/conversation-task-tools";
import { ConversationGoalTools, isGoalWriteTool } from "./conversation/conversation-goal-tools";
import { ConversationTaskQueueTools, isTaskQueueTool } from "./conversation/conversation-task-queue-tools";
import { ConversationStewardTools, isStewardConversationTool } from "./conversation/conversation-steward-tools";
import {
  ConversationRuntimeReadTools,
  isRuntimeReadConversationTool,
} from "./conversation/conversation-runtime-read-tools";
import { probeNativeCodexImageCapability } from "./social/social-images";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { sessionConversationPage } from "../src/features/agent-app/model/sessionConversation";
import {
  localSessionLinkFields,
  type LocalSessionLocator,
} from "../src/features/sessions/model/localSessionReference";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createEnvironmentService } from "./domains/environment/service";
import { createProjectsService } from "./domains/projects/service";
import { createSessionReadService } from "./domains/sessions/service";
import { createCommandService } from "./domains/commands/service";
import { createFileService } from "./domains/files/service";
import { createTerminalService, type TerminalAction } from "./domains/terminals/service";
import { fileRevertGeneration } from "./sessions/session-file-revert";
import { createHostGitService } from "./domains/git/service";
import { createHostNotesService } from "./domains/notes/service";
import { createHostTasksService } from "./domains/tasks/service";
import { createHostGoalsService } from "./domains/goals/service";
import { createHostSprintsService } from "./domains/sprints/service";
import { createHostAutomationsService } from "./domains/automations/service";
import { createHostStewardsService } from "./domains/stewards/service";
import { createCrewImageCapabilityProbe } from "./domains/crews/image-capability";
import { createHostCrewsService } from "./domains/crews/service";
import {
  createDevServersService,
  type DevServerAction,
  type DevServerBridgeAction,
} from "./domains/dev-servers/service";
import { withHostGitMutation } from "./git/git-mutations";
import { createHostPersistenceService } from "./domains/environment/persistence-service";
import { SafeCounterSchema } from "../src/shared/model/host-contracts/schemas";
import { rewindAuthorityGeneration } from "./sessions/session-rewind";
import {
  createSessionQueueService,
  type SessionQueueAction,
} from "./domains/sessions/queue-service";
import { createHostDispatcher } from "./transport/dispatch";
import { createNativeWorkspacesService } from "./domains/native-workspaces/service";
import { createModelsService } from "./domains/models/service";
import { createNativeServicesService } from "./domains/native-services/service";
import { createNativeServiceUploadService } from "./domains/native-services/upload";
import {
  NATIVE_SERVICE_UPLOAD_METHODS,
  type NativeServiceUploadMethod,
} from "../src/shared/model/host-contracts/native-service-upload";
import { bindNativeServicesOwner } from "./ports/native-services";
import {
  NATIVE_SERVICE_METHODS,
  NativeAssistantBrowserPanelParamsSchema,
  type NativeServiceMethod,
} from "../src/shared/model/host-contracts/native-services";
import { createNativeBufferUploadService } from "./domains/native-workspaces/buffer-upload";
import { bindNativeWorkspaceOwner, nativeBufferUploadPlatform } from "./ports/native-workspaces";
import {
  NATIVE_BUFFER_UPLOAD_METHODS,
  type NativeBufferUploadMethod,
} from "../src/shared/model/host-contracts/native-buffer-upload";
import {
  NATIVE_WORKSPACE_METHODS,
  type NativeWorkspaceMethod,
} from "../src/shared/model/host-contracts/native-workspaces";
import { attachHostWebSocketTransport, HOST_WS_READ_CAPABILITY } from "./transport/ws/server";
import {
  HostBulkTransfers,
  createHostBulkHandler,
  hostBulkDependencies,
  taskBulkDeleteKeys,
  noteBulkDeleteKeys,
  goalBulkDeleteKeys,
  automationBulkDeleteKeys,
  stewardBulkDeleteKeys,
} from "./transport/http/bulk";
import { HostSubscriptionHub } from "./transport/ws/subscriptions";
import {
  crewDefinitionBulkDeleteKeys,
  crewAgentBulkDeleteKeys,
  crewRunBulkDeleteKeys,
} from "./transport/http/bulk";
import { MobileTlsAuthority } from "./security/mobile-tls";
import { JsonValueSchema, WS_LIMITS } from "../src/shared/model/host-contracts";
import { McpHttp, managedMcpCatalog, managedDiscoveryResult } from "./mcp/mcp-http";
import {
  ConversationPreviewWorkflow,
  type ConversationPreviewInput,
  type PreviewBrowserState,
  type PreviewPresentation,
} from "./conversation/conversation-preview";
import { readHarnessSkill, searchHarnessSkills } from "./skills/harness-skills";
import { skillInvocationTokens } from "../src/features/skills/model/skillTokens";
import { hostname, homedir } from "node:os";
import { RuntimeTerminalLogs } from "./execution/runtime-terminal-logs";
import { HostTerminals } from "./terminals/terminals";
import { createManagedWorkspaceRuntime, inManagedWorkspace } from "./managed/managed-workspace-runtime";
import { readHostBuildIdentity } from "./build-identity";
import { WORKSPACE_CAPABILITIES } from "./workspaces/workspace-contracts";
import { HostAuthorityFenceError } from "./storage/authority-fence";
import type { WorkspaceRpcRequest } from "./workspaces/workspace-rpc-contracts";
import { createHash, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  HOST_PROTOCOL_VERSION,
  type HostSession,
  type HostSessionSummary,
  type RemoteProvider,
  type SessionSync,
  type SessionSyncResponse,
} from "../src/features/connections/model/protocol";
import { HostEngine, parseCommand } from "./engine";
import { isClearSessionCommand } from "../src/features/sessions/model/newSessionCommand";
import { HostAutomations } from "./automations/automations";
import { SocialService, type SocialPrincipal } from "./social/social";
import { createSessionAuthorityResolver } from "./sessions/session-authority";
import { socialAgentGenerator } from "./social/social-agent";
import { OsSocialCredentials } from "./social/social-credentials";
import { SocialTransport } from "./social/social-transport";
import { XBrowserSessions } from "./social/social-browser";
import { SocialPeers } from "./social/social-peers";
import { createSocialAdapters } from "../src/integrations/social/platformAdapters";
import { HostTasks } from "./tasks/tasks";
import { HostSprints } from "./sprints/sprints";
import { AttachmentOwnership } from "./attachments/attachment-ownership";
import { HostGoals } from "./goals/goals";
import { HostAssistant } from "./assistant/service";
import type { ConversationTool } from "./conversation/conversation-tools";
import { assistantExecutionPorts } from "./assistant/core/assistant-runtime";
import { AssistantTurnPolicyDeferredError } from "./assistant/core/assistant-turn-policy";
import { assistantDomain } from "./domains/assistant/service";
import { AssistantRequestValidationSchema, AssistantResponseValidationSchema } from "../src/shared/model/host-contracts/assistant";
import { withVoiceGenerationsRetired } from "./assistant/voice/assistant-voice-retirement";
import { captureLiveVoiceGeneration, captureVoiceRuntimeSource } from "./assistant/voice/assistant-voice-status";
import { z } from "zod";
import { ingestNativeObservations, nativeObservationOperation } from "./assistant/observations/assistant-native-observations";
import { verifyAssistantNotificationReceipt } from "./assistant/native/assistant-notification-receipt";
import { assistantSessionRuntime } from "./assistant/sessions/assistant-session-runtime";
import { HostAssistantManualSessions } from "./assistant/sessions/assistant-manual-sessions";
import { HostAssistantKeepAwake } from "./assistant/core/assistant-keep-awake";
import { HostDesktopControl } from "./desktop/desktop-control-host";
import { desktopControlDomain } from "./desktop/desktop-control-domain";
import { HostDesktopHelper } from "./desktop-helper";
import { desktopHelperDomain } from "./desktop-helper-domain";
import { readDesktopPresence } from "./desktop/desktop-presence";
import {
  ConversationDesktopControlTools,
  isDesktopControlConversationTool,
} from "./conversation/conversation-desktop-control-tools";
import { HostStewards } from "./stewards/stewards";
import { dirname, join } from "node:path";
import { DeviceHost } from "./devices/device-host";
import { DevicePreviews } from "./devices/device-preview";
import type { DeviceAction } from "../src/features/devices/types";
import { GenericAcpService, type GenericAcpMetadataPatch } from "./providers/generic-acp";
import { HandoffHistoryStore } from "./tasks/handoff-history";
import { ResourceDiagnostics } from "./diagnostics/resource-diagnostics";
import { perfMetrics, mcpMetricName } from "./diagnostics/perf-metrics";
import { snapshotWeight } from "../src/features/connections/model/snapshotWeight";
import { performance } from "node:perf_hooks";
import { BrowserRuntime } from "./browser/browser-runtime";
import { SessionBrowserRegistry } from "./browser/shared-browser";
import { RuntimeLogMonitors } from "./execution/runtime-log-monitors";
import { DevServersService } from "./dev-servers/dev-servers";
import { DevServerAccess } from "./dev-servers/dev-server-access";
import { RuntimeLogsService, scrubRuntimeLogText } from "./execution/runtime-logs";
import { RuntimeLogAccess, runtimeLogToolQuery } from "./execution/runtime-log-tools";
import {
  ConversationDesktopRelay,
  sessionConversationToolCatalog,
  isRoomOnlyConversationAction,
  validateSessionConversationTool,
  validateConversationTool,
} from "./conversation/conversation-tools";
import { openDevServerBrowser } from "./dev-servers/dev-server-browser";
import type { DevServerDetails } from "../src/features/host-tools/devServerTypes";
import { WebControl } from "./web/web-control";
import type { GenericAcpConfig } from "../src/features/providers/model/genericAcp";
import type { HandoffHistory } from "../src/features/sessions/model/handoffBudget";
import { DesktopSessions, type DesktopSessionMeta } from "./desktop/desktopSessions";
import { DesktopCommandDelivery } from "./desktop/desktop-command-delivery";
import { QueueDrainer, queueRowCommands } from "./sessions/queue-drainer";
import { SessionQueues } from "./sessions/session-queue";
import { RequestAuthorizationError } from "./store-db";
import {
  HostDomainAuthorizationError,
  HostDomainOutcomeError,
  assertDomainAuthority,
  type HostDomainContext,
} from "./domains/context";
import { RunLeases } from "./execution/run-lease";
import { LeaseHeldError, type RunLease } from "../src/features/sync/model/runLease";
import { AdoptedChanges } from "./workspaces/adoptedChanges";
import { sameQueuedModelTarget } from "../src/features/sessions/model/messageQueue";
import { parseRemoteAttachments, resolveAttachments, resolveQuestionAttachments } from "./attachments/attachments";
import { DesktopDelete } from "./desktop/desktopDelete";
import { hostInbox } from "./notes/host-notes";
import { AsyncHostNotes } from "./host-notes-async";
import {
  ConversationWorkspaceTools,
  isWorkspaceConversationTool,
} from "./conversation/conversation-workspace-tools";
import { ProviderInboxBridge } from "./providers/provider-inbox";
import { MobilePairing } from "./mobile/mobile-pairing";
import { createMobileAccessService } from "./mobile/mobile-access";
import { MobileLanAccess } from "./mobile/mobile-lan";
import { ExternalTunnels } from "./tunnels/tunnels";
import {
  parseRemoteInboxOperation,
  inboxOperationWrites,
} from "../src/features/inbox/model/remoteInbox";
import { branchCache } from "./git/git-actions";
import { withOverlay } from "./desktop/desktopLive";
import { writeAttachmentChunk, readAttachmentChunk, attachmentUploadStatus } from "./attachments/attachments";
import { sessionWorkCwd, type LinkedWorkItem } from "../src/features/sessions/model/session";
import { parseGithubWorkItemUrl } from "../src/shared/lib/githubWorkItem";
import { SyncTransfers, serializedResponse } from "./sync/sync-transfer";
import { RevisionWaits } from "./storage/revisionWait";
import {
  TranscriptPages,
  transcriptPage,
  partialSessionSync,
  previewRewindHistory,
  previewSession,
  withHead,
} from "./sessions/transcriptPage";
import { RemoteChanges } from "./workspaces/remoteChanges";
import { GitWatches } from "./git/git-watch";
import { syncPull, syncPush } from "./sync/sync";
import type { SyncOp } from "../src/features/sync/model/syncProtocol";
import { browseHostDirectories, createHostDirectory } from "./browser/browse";
import { createHostBranch, hostBranches, switchHostBranch } from "./git/git-branches";
import { createHostWorktree, hostWorktrees, resolveHostWorktreeAsync } from "./git/git-worktrees";
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
} from "./workspaces/workspace";
import { WorkspaceCommands } from "./workspaces/workspace-commands";
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
import { listShellProfiles, setChosenProfile, setReviewedProfile } from "./execution/shellProfiles";
import { hasShellPhysicalOwner } from "./execution/shell-ownership";
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

export type HostPrivateControlHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;
export type HostPrivateControl = {
  lifecycle?: HostPrivateControlHandler;
  nativeAuthorityBootstrap?: HostPrivateControlHandler & { close(): void | Promise<void> };
};

let rejectionGuards = 0;
let hostDegradedSince: number | undefined;
function logUnhandledRejection(reason: unknown) {
  hostDegradedSince ??= Date.now();
  // Messages and absolute paths may contain prompts or credentials. Retain only
  // bounded frame locations, never arbitrary exception text or function names.
  const frames = reason instanceof Error && typeof reason.stack === "string"
    ? reason.stack.split("\n").slice(1, 17).flatMap((line) => {
        const match = /(?:^|[\\/])([\w.-]+\.[cm]?js):(\d+):(\d+)\)?\s*$/.exec(line);
        return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
      })
    : [];
  const name = reason instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(reason.name)
    ? reason.name : "UnknownError";
  console.warn(`Host state may be degraded after an unhandled rejection (${name}).${frames.length ? ` Frames: ${frames.join(", ")}` : ""}`);
}
/** An unawaited rejection must not terminate a Host that is serving other clients. */
function guardUnhandledRejections(): () => void {
  if (rejectionGuards++ === 0) process.on("unhandledRejection", logUnhandledRejection);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--rejectionGuards === 0) process.off("unhandledRejection", logUnhandledRejection);
  };
}

export async function createHostServer(
  engine: HostEngine,
  providers: RemoteProvider[],
  privateControl?: HostPrivateControlHandler | HostPrivateControl,
  automationsOverride?: HostAutomations,
  tasksOverride?: HostTasks,
  desktop = new DesktopSessions(),
  goalsOverride?: HostGoals,
  stewardsOverride?: HostStewards,
  socialOverride?: SocialService,
  tunnelsOverride?: ExternalTunnels,
  terminalsOverride?: HostTerminals,
) {
  const controls: HostPrivateControl | undefined =
    typeof privateControl === "function" ? { lifecycle: privateControl } : privateControl;
  const lifecycle = controls?.lifecycle;
  await engine.ready;
  const terminals = terminalsOverride ?? new HostTerminals();
  const runLeases = new RunLeases();
  const inWorkspace = inManagedWorkspace;
  const managed = createManagedWorkspaceRuntime(engine.store, engine, {
    probe: async (workspace) => {
      const activities: import("./workspaces/workspace-contracts").WorkspaceActivity[] = [];
      const add = (
        kind: import("./workspaces/workspace-contracts").WorkspaceActivity["kind"],
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
      }
      for (const summary of await engine.store.startupStates(workspace.id)) {
        if (
          summary.workspaceId !== workspace.id &&
          !(summary.worktreeCwd && inWorkspace(summary.worktreeCwd, workspace.path))
        ) continue;
        if (summary.running || desktop.live.busyClient(summary.id) || runLeases.holder(summary.id))
          add("provider", summary.id);
        if (summary.shellRunning) add("shell", summary.id);
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
      if (await hasShellPhysicalOwner(engine.store, "session", entry.ownerId)) return false;
      // Only rows from a previous Host process reach here; the workspace probe
      // still refuses while a real process uses the directory.
      if (
        !["provider", "shell", "devServer"].includes(entry.kind) ||
        engine.desktopRefreshBlocked(entry.ownerId) ||
        desktop.live.busyClient(entry.ownerId) ||
        runLeases.holder(entry.ownerId)
      )
        return false;
      const summary = (await engine.store.startupStates()).find(
        (value) => value.id === entry.ownerId,
      );
      if (summary?.running || summary?.shellRunning) return false;
      if (!summary || !(await engine.store.sessionAuthority(entry.ownerId)))
        console.warn(
          `Retiring stale workspace activity ${entry.id} (${entry.kind}): its previous owner ${entry.ownerId} has no live session record.`,
        );
      return true;
    },
  });
  const managedWorkspaces = managed.registry;
  const workspacePolicy = managed.policy;
  const featureClaims = managed.claims;
  const buildIdentity = readHostBuildIdentity();
  const startWorkspaceActivity = async (
    cwd: string,
    kind: import("./workspaces/workspace-contracts").WorkspaceActivity["kind"],
    ownerId: string,
  ) => {
    const entries: { id: string; workspaceId: string }[] = [];
    // The runtime relaxes only stale rewind journals when exact rewind is off.
    const gated =
      kind === "mutation" ||
      kind === "operation" ||
      kind === "provider" ||
      kind === "shell" ||
      kind === "devServer" ||
      kind === "editor";
    try {
      for (const workspace of await managed.list()) {
        if (!inWorkspace(cwd, workspace.path)) continue;
        if (gated) await managed.assertWritable(workspace.id);
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
      owner: import("./workspaces/workspace-service-contracts").WorkspaceOwnerAuthorization,
    ) => Promise<T>,
  ) => managed.withOwner(await workspaceOwnerDeviceId(token), action);
  const requestWorkspaceOwner =
    (token: string): NonNullable<HostDomainContext["workspaceOwner"]> =>
    (action) =>
      withWorkspaceOwner(token, async (owner) => {
        const result = await action(
          bindNativeWorkspaceOwner(managed, owner, () =>
            assertNativeDeliveryEffect(
              engine.store,
              createHash("sha256").update(token).digest("hex"),
              "buffer",
            ),
          ),
        );
        if (
          createHash("sha256")
            .update(await workspaceOwnerDeviceId(token))
            .digest("hex") !== owner.ownerId
        )
          throw new HostDomainAuthorizationError();
        return result;
      });
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
  const assistantPorts = assistantExecutionPorts(
    engine.store,
    goals,
    tasks,
    () => hostNotes,
    () => automations,
  );
  const namedProjects = async () => {
    const registered = await engine.store.projects();
    return projectDisplayNames(
      registered,
      desktop.live.projectDirectory(registered, engine.store.environmentId),
    );
  };
  assistantPorts.listProjects = async () =>
    (await namedProjects()).map((project) => ({
      id: project.id,
      path: project.cwd,
      name: project.name,
    }));
  const assistantKeepAwake = new HostAssistantKeepAwake();
  assistantPorts.keepAwake = (enabled) => assistantKeepAwake.setEnabled(enabled);
  assistantPorts.readPresence = readDesktopPresence;
  const assistant = new HostAssistant(engine.store, assistantPorts);
  const roomAttestationSigner = new RoomAttestationSigner(
    roomAttestationKeyPath(dirname(engine.store.attachmentDir)),
    engine.store.environmentId,
    id => assistant.threadBinding(id),
  );
  await assistant.ready;
  tasks.assistantGoalAdmission = (goalId) => assistant.autonomousJobAllowed(goalId);
  const previousProviderSchedule = engine.beforeProviderTurn;
  engine.beforeProviderTurn = async (input) => {
    await previousProviderSchedule?.(input);
    if (input.author?.kind !== "task") return;
    const authorId = input.author.id;
    const task = await tasks.get(authorId);
    const goalId = task?.goalId ?? (await goals.list()).find((goal) => goal.id === authorId)?.id;
    if (goalId && !(await assistant.autonomousJobAllowed(goalId)))
      throw new AssistantTurnPolicyDeferredError();
  };
  assistantPorts.manualProjectVisible = async (id) => {
    const directory = desktop.live.projectDirectory(
      await engine.store.projects(),
      engine.store.environmentId,
    );
    return directory.privacyReady && directory.projects.some((project) => project.id === id);
  };
  const manualAssistantSessions = new HostAssistantManualSessions(engine.store, {
    enabled: () => assistant.manualSupervisionAllowed(),
    name: () => assistant.identityName(),
    visibleProject: (id) => assistant.manualProjectAllowed(id),
  });
  await manualAssistantSessions.ready;
  assistantPorts.manual = manualAssistantSessions;
  const managedAssistantSessions = assistantSessionRuntime(
    engine.store,
    engine,
    assistant,
    tasks,
    manualAssistantSessions,
  );
  await managedAssistantSessions.ready;
  assistantPorts.detachSession = async (input) => {
    const result = await managedAssistantSessions.detach(
      input.jobId,
      input.sessionId,
      input.expectedVersion,
    );
    await engine.store.markAssistantManagedSession(input.sessionId, input.jobId);
    return result;
  };
  assistantPorts.manageSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "nudge", ...input },
      { kind: "chief", id: `assistant-chief:${engine.store.environmentId}` },
    );
    if (result.recovery) return result.recovery;
    if (result.operation?.delivery !== "delivered")
      throw new Error(
        "Managed session delivery remains unknown; inspect its state before continuing.",
      );
  };
  assistantPorts.manageManualSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "nudge", ...input },
      { kind: "chief", id: `assistant-chief:${engine.store.environmentId}` },
    );
    if (result.operation?.delivery !== "delivered")
      throw new Error(
        "Manual conversation delivery remains unknown; inspect its state before continuing.",
      );
  };
  assistantPorts.answerSession = async (input) => {
    const result = await managedAssistantSessions.request(
      { op: "answer", ...input },
      { kind: "chief", id: `assistant-chief:${engine.store.environmentId}` },
    );
    if (result.operation?.delivery !== "submitted")
      throw new Error(
        "Worker question submission remains unknown; inspect the original question before continuing.",
      );
  };
  assistantPorts.onPause = () => managedAssistantSessions.stop();
  assistantPorts.onResume = () => managedAssistantSessions.resume();
  assistantPorts.onJobPause = (id) => managedAssistantSessions.pauseJob(id);
  assistantPorts.onJobResume = (id) => managedAssistantSessions.resumeJob(id);
  const desktopControl = new HostDesktopControl(engine.store, {
    onOperation: (event) => assistant.recordDesktopOperation(event),
    presence: readDesktopPresence,
    // Headed actions on this route are explicitly requested by the device owner.
    // Agents use their separate captured principal and never inherit this grant.
    physicalGrant: async (principal) => principal.kind === "owner",
  });
  await desktopControl.ready;
  const desktopHelper = new HostDesktopHelper({
    outsideScope: (work) => engine.store.db.outsideScope(work),
  });
  const previousOwnerInstructions = engine.ownerInstructions;
  engine.ownerInstructions = async () =>
    [await previousOwnerInstructions?.(), await assistant.instructions("sessions")]
      .filter(Boolean)
      .join("\n");
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
  const touchTerminalWorkspace = (projectId: string, terminalId: unknown, closedCwd?: string) =>
    recordWorkspaceActivity(async () => {
      const terminal = terminals.list(projectId).terminals.find((entry) => entry.id === terminalId);
      const cwd = terminal?.cwd ?? closedCwd;
      if (!cwd) return;
      const workspaces = await managedWorkspaces.list({
        projectId,
        environmentId: engine.store.environmentId,
      });
      for (const workspace of workspaces)
        if (inWorkspace(cwd, workspace.path)) await managedWorkspaces.touchActivity(workspace.id);
    });
  const logMonitors = new RuntimeLogMonitors(browserRuntime.load, runtimeLogs);
  const sharedBrowser = new SessionBrowserRegistry(browserRuntime.load, Date.now, { runtimeLogs });
  const conversationPreviews = new ConversationPreviewWorkflow();
  const devServers = new DevServersService({
    runtimeLogs,
    startActivity: (cwd, ownerId) => startWorkspaceActivity(cwd, "devServer", ownerId),
    workspaceIdForDirectory: async (cwd) =>
      (await managed.list()).find((value) => inWorkspace(cwd, value.path))?.id,
  });
  // Cloud voice keys (ElevenLabs) live in their own OS-encrypted vault.
  const voiceCloud = new VoiceCloudCredentials(
    new OsSocialCredentials(
      join(featureDirectory, "voice", "credentials"),
      engine.store.environmentId,
    ),
  );
  const localVoice = new LocalVoiceService({ cloudKey: (provider) => voiceCloud.get(provider) });
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
  const sessionRead = <T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> =>
    signal ? engine.store.withReadCancellation(signal, work) : work();
  const inHost = async (id: string, signal?: AbortSignal) => {
    return !!(await sessionRead(signal, () => engine.store.sessionAuthority(id)));
  };
  const localSessionReference = async (id: string): Promise<LocalSessionLocator | undefined> =>
    (await inHost(id))
      ? {
          kind: "host",
          environmentId: engine.store.environmentId,
          sessionId: id,
        }
      : await desktop.localSessionReferenceAsync(id);
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
  const desktopSnapshot = async (id: string, signal?: AbortSignal) => {
    if (!id || (await inHost(id, signal))) return undefined;
    const cwd = await desktop.projectCwdAsync(id, signal);
    const project = cwd
      ? (await sessionRead(signal, () => engine.store.projects())).find((p) => desktop.samePath(p.cwd, cwd))
      : undefined;
    const snapshot = project && (await desktop.snapshotAsync(id, project.id, project.cwd, signal));
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
  /**
   * A desktop-only session without its 7-10 MB transcript (`snapshotMetaAsync`): project,
   * folder, harness, model, settings, usage limit and the last user block's text. Use it
   * wherever a call site decides on those; keep `featureSession` where the blocks are the
   * content (a conversation page, a provider prompt built from history, adoption).
   */
  const desktopMeta = async (id: string): Promise<DesktopSessionMeta | undefined> => {
    if (!id || (await inHost(id))) return undefined;
    const cwd = await desktop.projectCwdAsync(id);
    const project = cwd
      ? (await engine.store.projects()).find((p) => desktop.samePath(p.cwd, cwd))
      : undefined;
    const snapshot = project && (await desktop.snapshotMetaAsync(id, project.id, project.cwd));
    return snapshot &&
      (snapshot.session.harness === "acp" ||
        providers.includes(snapshot.session.harness as RemoteProvider))
      ? snapshot
      : undefined;
  };
  /** Same ownership rules as `featureSession`: the desktop-only copy, else the host's own. */
  const featureMeta = async (id: string): Promise<DesktopSessionMeta> => {
    const meta = await desktopMeta(id);
    if (meta) return meta;
    const hosted = await engine.store.session(id);
    const lastUser = hosted.session.blocks.findLast((block) => block.role === "user");
    return { ...hosted, lastUserText: lastUser?.text ?? "" };
  };
  /**
   * Reads that need only what a commit left (a queued send's model, the last user block)
   * do not query the desktop database again while the desktop stamp is unchanged.
   * The stamp is read first, so a newer transcript only ever causes one more read.
   * Never use it for an authority recheck.
   */
  const stableMetas = new Map<string, { key: string; value: DesktopSessionMeta }>();
  const featureMetaStable = async (id: string): Promise<DesktopSessionMeta> => {
    if (!id || (await inHost(id))) return await featureMeta(id);
    const stamp = await desktop.stampAsync(id);
    const key = stamp ? `${stamp.updatedAt}\0${stamp.running}` : undefined;
    const known = stableMetas.get(id);
    if (key && known?.key === key) return known.value;
    const value = await featureMeta(id);
    stableMetas.delete(id);
    if (key) {
      stableMetas.set(id, { key, value });
      while (stableMetas.size > 2) stableMetas.delete(stableMetas.keys().next().value!);
    }
    return value;
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
  /** Existence check for queue calls. A conversation the host already stores is one indexed
   * read; only a desktop-only one needs the desktop notes worker, which may be busy for long.
   * `running` asks for the desktop's live status (only finishing without acceptance needs it). */
  const queueSessionKnown = async (id: string, running = false) => {
    if (running) return await queueSessionStatus(id);
    try {
      return await engine.store.sessionStatus(id);
    } catch {
      return await queueSessionStatus(id);
    }
  };
  const explicitSkillNames = async (id: string) =>
    skillInvocationTokens((await featureMetaStable(id)).lastUserText).map((token) =>
      token.name.replace(/^skill:/, ""),
    );
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
  social.setAssistantThreadResolver((id) => assistant.threadBinding(id));
  social.forgetBrowserSession ??= async (accountId) => {
    await xBrowser.workflows.cancelAccount(social, accountId);
    await xBrowser.forget(accountId);
  };
  social.cancelBrowserWorkflow ??= async (accountId) =>
    await xBrowser.workflows.cancelAccount(social, accountId);
  const runtimeLogAccess = new RuntimeLogAccess(social, Date.now, (id) =>
    assistant.threadBinding(id),
  );
  const conversationAccess = new RuntimeLogAccess(social, Date.now, (id) =>
    assistant.threadBinding(id),
  );
  const conversationDesktop = new ConversationDesktopRelay(engine.store.environmentId);
  const conversationDesktopControl = new ConversationDesktopControlTools({
    environmentId: engine.store.environmentId,
    desktop: desktopControl,
    presence: async () => {
      const native = await readDesktopPresence();
      const manual = await assistant.ownerPresence();
      if (manual.state === "dnd")
        throw new Error("Desktop input is deferred while Do not disturb is active.");
      return {
        supported: native.supported,
        locked: native.locked,
        ownerPresent:
          native.idleMs === undefined
            ? undefined
            : manual.state === "away" || native.idleMs >= 10 * 60000
              ? false
              : true,
      };
    },
    approveOperation: ({ operation, operationHash, cwd, principal }, authorized) =>
      conversationDesktop.call(
        "desktop.act.authorize",
        { operation, operationHash },
        cwd,
        principal,
        authorized,
      ),
  });
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
    // Identity and folder only: a metadata read, not the transcript (twice per call).
    const target = await featureMeta(params.sessionId);
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
          // A fresh read of exactly the fields compared below (never the stable cache).
          const current = await featureMeta(target.session.id);
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
  const refresh = async (id: string, known?: { updatedAt: number; running: boolean }, signal?: AbortSignal) => {
    let current;
    try {
      current = await engine.store.session(id, signal);
    } catch {
      return;
    }
    if (!current.desktop) return;
    if (current.authorityGeneration !== undefined) return;
    const stamp = known ?? (await desktop.stampAsync(id, 0, signal));
    if (!stamp) return;
    if (stamp.running) throw new LeaseHeldError(runLeases.holder(id)?.holder ?? "desktop");
    if (stamp.updatedAt <= current.desktop.updatedAt) return;
    // Cheap guards first: a session the host is running or rewinding is left
    // alone anyway, and an unreadable copy stays unreadable until it changes.
    if (current.status === "running" || engine.desktopRefreshBlocked(id)) return;
    if (unreadableDesktopCopies.get(id) === stamp.updatedAt) return;
    const project = await sessionRead(signal, () => engine.store.project(current.projectId));
    const snapshot = await desktop.snapshotAsync(id, project.id, project.cwd, signal);
    if (snapshot) {
      unreadableDesktopCopies.delete(id);
      signal?.throwIfAborted();
      // Accepted refresh mutation retains its original owner through settlement.
      await engine.refreshFromDesktop(snapshot);
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
      hosted = await engine.store.session(id, signal);
    } catch {
      /* desktop-only */
    }
    if (hosted && (!hosted.desktop || hosted.status === "running")) return undefined;
    const stamp = await desktop.stampAsync(id, polling ? WATCH_STAMP_MS : 0, signal);
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
    const limited = !!(await featureMeta(id)).session.usageLimit;
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
            // The desktop's running state is covered by its run-holder stamp below.
            !(await desktopRunHolder(id)) &&
            (await queueSessionKnown(id)) !== "running" &&
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
          ? await withRetiredDesktopWriters(id, () => engine.store.transaction(action, "critical"))
          : await engine.store.transaction(action, "critical"),
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
      .then(async () => {
        // Workspace bookkeeping runs before taking the store queue: it lists every
        // workspace and writes one, which is no reason to hold the other requests back.
        if (desktop.live.busyClient(id) !== clientId) return;
        await touchSessionWorkspace(id);
        await engine.store.db.scope(async () => {
          // A later heartbeat may already have released or replaced this owner.
          if (desktop.live.busyClient(id) !== clientId) return;
          const holder = `desktop:${clientId}`;
          let heldBefore = acceptedAt;
          // A window running a turn holds the conversation whether or not it asked first
          // (an older app, or a release that raced with its next turn).
          if (!runLeases.renew(id, holder)) {
            try {
              const running = await hostRuns(id);
              if (desktop.live.busyClient(id) !== clientId) return;
              const existing = runLeases.holder(id);
              runLeases.acquire(id, holder, () =>
                running || engine.hasRetainedProviderWriter(id) ? "host" : undefined,
              );
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
        });
      })
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
   * A heartbeat answer is built from memory plus a bounded wait on the store: the window
   * counts silence as gone, so a stalled store queue must not delay the reply. Whatever
   * has not finished keeps running and lands later; the missing part of the answer is
   * simply absent, which the window treats as "no news".
   */
  const BEAT_STORE_WAIT_MS = 1_500;
  const withinBeat = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    const pending = work();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), BEAT_STORE_WAIT_MS);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      // An abandoned wait must not surface as an unhandled rejection.
      pending.catch(() => undefined);
    }
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
      else if (current)
        answers[sessionId] = runLeases.renew(sessionId, holder, Number(epoch)) ?? null;
      else {
        try {
          const grant = (hostRunning: boolean) =>
            runLeases.acquire(sessionId, holder, () => {
              // Heartbeats observe ownership; they cannot retire a Host writer.
              if (hostRunning || engine.hasRetainedProviderWriter(sessionId)) return "host";
              const busy = desktop.live.busyClient(sessionId);
              return busy && `desktop:${busy}` !== holder ? `desktop:${busy}` : undefined;
            });
          // Whether the host runs it is a store read. When the store queue is busy for
          // long, answer from the engine's own memory of its runs instead of stalling.
          let late = false;
          const stored = await withinBeat(
            () =>
              engine.store.db.scope(async () => {
                if (late) return undefined;
                return { lease: grant(await hostRuns(sessionId)) };
              }),
            undefined,
          );
          if (stored) answers[sessionId] = stored.lease;
          else {
            late = true;
            answers[sessionId] = grant(engine.hasActiveRun(sessionId));
          }
        } catch {
          answers[sessionId] = null;
        }
      }
    }
    return answers;
  };
  /** Renews the drain leases a desktop reports on its heartbeat. */
  const queueLeaseAnswers = new Map<
    string,
    {
      lease: import("../src/features/connections/model/sharedQueue").DrainLease;
      version: number;
      blocked: boolean;
      checkedAt: number;
    }
  >();
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
      const key = JSON.stringify([holder, sessionId, epoch]);
      const cached = queueLeaseAnswers.get(key);
      if (
        cached &&
        cached.version === engine.store.db.dataMutationVersion &&
        cached.blocked === (blocked === true) &&
        Date.now() - cached.checkedAt < 5000 &&
        cached.lease.expiresAt > Date.now() + 5000
      ) {
        leases[sessionId] = await sessionQueues.renew(sessionId, holder, Number(epoch));
        continue;
      }
      // A holder that cannot send for a reason of its own (a sync conflict on its
      // copy) is neither stalled nor replaced by the host sending on its own copy.
      queueDrainer.noteBlocked(sessionId, holder, blocked === true);
      // A holder that could send but does not is not renewed: its lease ends
      // and the host sends the row.
      leases[sessionId] = (await queueDrainer.holderStalled(sessionId))
        ? await sessionQueues.release(sessionId, holder, Number(epoch))
        : await sessionQueues.renew(sessionId, holder, Number(epoch));
      const lease = leases[sessionId];
      if (lease)
        queueLeaseAnswers.set(key, {
          lease,
          version: engine.store.db.dataMutationVersion,
          blocked: blocked === true,
          checkedAt: Date.now(),
        });
      else queueLeaseAnswers.delete(key);
      while (queueLeaseAnswers.size > 1024)
        queueLeaseAnswers.delete(queueLeaseAnswers.keys().next().value!);
    }
    return leases;
  };
  /** The desktop copy with its live prompts; a running one carries a run id
   * so watchers can stop it and answer its prompts. */
  const desktopView = async (
    id: string,
    projectId?: string,
    signal?: AbortSignal,
  ): Promise<Awaited<HostSession | undefined>> => {
    // Watchers re-request the same unchanged transcript many times (pages,
    // block fetches, polls); parsing it again is only needed once it moves.
    const stamp = await desktop.stampAsync(id, 0, signal);
    const key =
      stamp && (projectId || !(await inHost(id, signal)))
        ? `${id}\0${projectId ?? ""}\0${stamp.updatedAt}\0${stamp.running}\0${desktop.live.overlay(id)?.changedAt ?? 0}`
        : undefined;
    const known = key ? viewMemo.get(key) : undefined;
    if (known) return known;
    const view = await buildDesktopView(id, projectId, signal);
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
    signal?: AbortSignal,
  ): Promise<Awaited<HostSession | undefined>> => {
    const project = projectId ? await sessionRead(signal, () => engine.store.project(projectId)) : undefined;
    const snapshot = project
      ? await desktop.snapshotAsync(id, project.id, project.cwd, signal)
      : await desktopSnapshot(id, signal);
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
      blockRevisions: _revisions,
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
  const catchUp = async (id: string, known?: { updatedAt: number; running: boolean }, signal?: AbortSignal) => {
    try {
      await refresh(id, known, signal);
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
  const imageCapability = createCrewImageCapabilityProbe({
    probe: (authorize) =>
      probeNativeCodexImageCapability(join(featureDirectory, "crews"), authorize),
  });
  const crews = new HostCrews(
    engine.store,
    engine,
    tasks,
    async (projectId) => await models(projectId),
    Date.now,
    imageCapability,
    {
      session: async (id) => {
        const value = await featureMeta(id);
        const native = await desktopWatch(id);
        return native?.running
          ? { ...value, status: "running", runId: "desktop" }
          : value;
      },
      command: (command, context) => commandService.dispatch(command, context),
    },
  );
  const sessionListEpoch = randomUUID();
  await engine.store.db.prepare(`CREATE TABLE IF NOT EXISTS session_read_sources (
    session_id TEXT PRIMARY KEY, source_key TEXT NOT NULL, epoch TEXT NOT NULL
  )`).run();
  // Only pending source transitions are held in memory. Persisted epochs prevent
  // an A-B-A owner change from reviving an earlier revision baseline.
  type SourceInvalidation = {
    epoch: string;
    pending: Promise<void>;
    started: boolean;
    previous?: SourceInvalidation;
    run: () => Promise<void>;
  };
  const sourceInvalidations = new Map<string, SourceInvalidation>();
  const settleSourceInvalidation = async (id: string, entry: SourceInvalidation) => {
    try {
      await entry.pending;
    } catch {
      if (!entry.started && entry.previous) {
        await settleSourceInvalidation(id, entry.previous);
        if (!entry.started) entry.pending = entry.run();
        return settleSourceInvalidation(id, entry);
      }
      // A lost acknowledgement is not proof of failure. Reconcile the exact
      // transition token; never issue another update for an uncertain outcome.
      const row = await engine.store.db.prepare("SELECT epoch FROM session_read_sources WHERE session_id=?").get(id);
      if (!row || row.epoch !== entry.epoch)
        throw new Error("Session read source transition is unresolved; retry reconciliation");
    }
    if (sourceInvalidations.get(id) === entry) sourceInvalidations.delete(id);
  };
  const invalidateSessionSource = (id: string) => {
    const previous = sourceInvalidations.get(id);
    const epoch = randomUUID();
    const entry: SourceInvalidation = { epoch, started: false, previous, pending: Promise.resolve(), run: async () => {
      entry.started = true;
      await engine.store.db.storeScope(async () => {
        await engine.store.db.prepare(`INSERT INTO session_read_sources (session_id, source_key, epoch)
          VALUES (?, '', ?) ON CONFLICT(session_id) DO UPDATE SET source_key='', epoch=excluded.epoch`)
          .run(id, epoch);
      });
    } };
    const pending = (previous ? settleSourceInvalidation(id, previous) : Promise.resolve()).then(entry.run);
    entry.pending = pending;
    sourceInvalidations.set(id, entry);
    void pending.then(() => {
      if (sourceInvalidations.get(id) === entry) sourceInvalidations.delete(id);
    }, (error) => {
      console.error("Session read source invalidation failed:", error);
    });
  };
  const sessionSourceKey = async (id: string): Promise<string> => {
    const watch = await desktopWatch(id);
    if (watch) {
      const overlay = desktop.live.overlay(id);
      return createHash("sha256").update(JSON.stringify([sessionListEpoch, "desktop", overlay?.sourceEpoch ?? null])).digest("hex");
    }
    const session = await engine.store.session(id);
    return createHash("sha256").update(JSON.stringify([sessionListEpoch, "host", session.authorityGeneration ?? null, session.createdAt ?? null])).digest("hex");
  };
  const sessionSourceEpoch = async (id: string): Promise<string> => {
    while (sourceInvalidations.has(id)) await settleSourceInvalidation(id, sourceInvalidations.get(id)!);
    const source = await sessionSourceKey(id);
    const epoch = await engine.store.transaction(async () => {
      const known = await engine.store.db.prepare("SELECT source_key, epoch FROM session_read_sources WHERE session_id=?").get(id);
      if (known && known.source_key === source) return String(known.epoch);
      await engine.store.db.prepare(`INSERT INTO session_read_sources (session_id, source_key, epoch)
        VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET
        source_key=excluded.source_key, epoch=excluded.epoch
        WHERE session_read_sources.source_key <> excluded.source_key`).run(id, source, randomUUID());
      const row = await engine.store.db.prepare("SELECT epoch FROM session_read_sources WHERE session_id=?").get(id);
      if (!row) throw new Error("Session read source is unavailable");
      return String(row.epoch);
    });
    if (source !== await sessionSourceKey(id)) throw new Error("Session read owner changed; retry");
    return epoch;
  };
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
            await social.snapshot({
              ...principal,
              actorId:
                principal.kind === "assistant-thread"
                  ? `thread:${principal.threadId}`
                  : `session:${principal.sessionId}`,
            })
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
  const mobileIngressSecret = `${randomUUID()}${randomUUID()}`;
  const mobileLan = new MobileLanAccess(
    join(featureDirectory, "mobile-lan.json"),
    engine.store.environmentId,
    () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return address.port;
    },
    undefined,
    undefined,
    {
      ingressSecret: mobileIngressSecret,
      tlsAuthority: new MobileTlsAuthority(
        join(featureDirectory, "mobile-tls.json"),
        engine.store.environmentId,
      ),
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
    sessionReference: localSessionReference,
  });
  // The service reads this only after composition has finished. An explicit
  // return type keeps metadata inference independent of the dispatcher that
  // owns the same service; the catalog always comes from its actual handlers.
  function advertisedRpcMethods(): string[] {
    return [...domainDispatcher.methods];
  }
  const environmentService = createEnvironmentService({
    snapshot: async () => ({
      protocolVersion: HOST_PROTOCOL_VERSION,
      environmentId: engine.store.environmentId,
      name: hostname(),
      webControl: webControl
        ? { origin: webControl.origin, url: `${webControl.origin}/control` }
        : undefined,
      platform: process.platform,
      mobileTls: (await mobileLan.status()).tls,
      persistence: engine.store.db.persistenceHealth(),
      gitRewindExecution: "host",
      methods: advertisedRpcMethods(),
      ...(buildIdentity ? { buildIdentity } : {}),
      // Older clients validate this list against Codex and Claude only.
      providers: [
        ...new Set([...providers, ...((await genericAcp.list()).length ? ["acp" as const] : [])]),
      ],
      capabilities: [
        "browser.sessionScopes.v1",
        "browser.ownerPresentationScopes.v1",
        "assistant.v1",
        "desktop.control.v1",
        HOST_WS_READ_CAPABILITY,
        "transport.ws.sessions.v2",
        "sessions.approvalOccurrence.v1",
        "sessions.desktopControlReceipts.v1",
        "transport.ws.queue.v2",
        "transport.ws.files.v2",
        "transport.ws.terminals.v2",
        "transport.ws.git.v2",
        "transport.ws.notes.v2",
        "transport.ws.tasks.v2",
        "transport.ws.goals.v2",
        "transport.ws.stewards.v2",
        "transport.ws.crews.v2",
        "transport.ws.devServers.v2",
        "transport.ws.sprints.v2",
        "transport.ws.automations.v2",
        "transport.ws.health.v2",
        "transport.ws.streams.v2",
        "transport.ws.bulk.v2",
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
        "native.buffers.recovery.v1",
        "transport.ws.models.v1",
        "transport.ws.devices.v1",
        "transport.ws.devices.preview.mobile.v1",
        "native.services.v1",
        "native.workspaces.v1",
        "native.buffers.upload.v1",
        "native.buffers.delivery.v1",
        "native.services.delivery.v1",
        "native.services.workspace.format.bounded.v1",
        "native.buffers.delivery.ack.v1",
        "native.services.delivery.ack.v1",
        "native.delivery.epochs.v2",
        "transport.ws.workspaces.cleanup.v1",
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
        "models.providerAccounts.v1",
        "sessions.configure.providerAccount.v1",
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
        "sessions.questionAttachments",
        "sessions.questionAttachments.v2",
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
        "sessions.host-writer-retirement.v1",
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
        "browser.shared.viewport.v1",
        "conversation.tools.management.v1",
        "runtime.logs",
        "conversation.tools",
        "runtime.logs.monitors",
        "browser.annotation",
        "dev.servers",
        "dev.servers.private-access",
        "voice.realtime.v1",
        "voice.realtime.v2",
        "voice.tools.v1",
        "voice.local.v1",
        "voice.cloud.v1",
        "voice.local.setup.v1",
        "social.v1",
        "social.policy.reviewed.v1",
        "social.programs.v2",
      ],
    }),
  });
  const projectsService = createProjectsService({
    list: namedProjects,
    directoryPorts: {
      directory: async () =>
        desktop.live.projectDirectory(await engine.store.projects(), engine.store.environmentId),
      browse: browseHostDirectories,
      createDirectory: createHostDirectory,
      open: (cwd, authorized) =>
        engine.store.db.withAuthorization(authorized, () => engine.openProject(cwd)),
    },
  });
  const sessionService = createSessionReadService<
    HostSession,
    Extract<SessionSync, { kind: "delta" }>["value"],
    HostSessionSummary,
    SessionSyncResponse
  >({
    repository: {
      projectList: projectSessionList,
      session: (id, signal) => engine.store.session(id, signal),
      sync: (id, revision, signal) => engine.store.sync(id, revision, signal),
      readView: readSessionView,
      catchUp: (id, signal) => catchUp(id, undefined, signal),
    },
    nativeProjection: {
      watch: desktopWatch,
      view: desktopView,
      sync: desktopSync,
      recheckMs: desktopRecheckMs,
    },
    transcript: {
      page: (...args) => transcriptPages.page(...args),
      preview: previewSession,
      summaryPage: (value) => transcriptPage(value, undefined, undefined, true),
      partial: partialSessionSync,
      withHead,
      previewRewindHistory,
    },
    transfers,
    revisionWaits,
    sourceEpoch: sessionSourceEpoch,
  });
  const sessionQueueService = createSessionQueueService({
    environmentId: engine.store.environmentId,
    transaction: (work) => engine.store.transaction(work, "critical"),
    sessionStatus: queueSessionKnown,
    desktopWatch,
    queues: {
      get: (id) => sessionQueues.get(id),
      serve: (...args) => sessionQueues.serve(...args),
    },
    attachments: {
      validateExposure: (params) => attachmentOwnership.validateExposure(params),
      normalize: (raw) => resolveAttachments(engine.store, parseRemoteAttachments(raw)),
    },
  });
  const queueOperation =
    (action: SessionQueueAction) =>
    async (
      params: Record<string, unknown>,
      context: import("./domains/context").HostDomainContext,
    ) => {
      const exposeAttachments = context.exposeQueueAttachments;
      if (!exposeAttachments)
        throw new Error("Authenticated queue attachment grant is unavailable.");
      return sessionQueueService[action](params, { ...context, exposeAttachments });
    };
  const desktopCommandDelivery = new DesktopCommandDelivery(desktop.live, engine.store);
  const questionBinding = async (sessionId: string, runId: string, requestId: number) => {
    const view = await readSessionView(sessionId);
    // A live desktop may own a Host-backed conversation whose native transcript
    // is unavailable here. Its authenticated original heartbeat owns the prompt.
    const desktopQuestion = runId === DESKTOP_RUN_ID && desktop.live.busyClient(sessionId)
      ? desktop.live.overlay(sessionId)?.patch.pendingQuestion : undefined;
    const question = desktopQuestion ?? view.session.pendingQuestion;
    const currentRun = desktopQuestion ? DESKTOP_RUN_ID : view.runId;
    if (currentRun !== runId || question?.requestId !== requestId || !question.occurrenceId)
      throw new Error("The original question is no longer available");
    return question.occurrenceId;
  };
  const bindQuestionUpload = async (principal: string, params: Record<string, unknown>) => {
    if (params.questionSessionId === undefined && params.questionRequestId === undefined && params.questionRunId === undefined) {
      await attachmentOwnership.assertUnboundUpload(String(params.id ?? ""));
      return;
    }
    const sessionId = String(params.questionSessionId ?? "");
    const runId = String(params.questionRunId ?? "");
    const requestId = params.questionRequestId;
    if (!sessionId || !runId || !Number.isSafeInteger(requestId) || Number(requestId) < 0)
      throw new Error("Invalid question attachment binding");
    const occurrence = await questionBinding(sessionId, runId, Number(requestId));
    await attachmentOwnership.bindQuestion(principal, String(params.id ?? ""), sessionId, runId, Number(requestId), occurrence);
  };
  const commandService = createCommandService<HostSession>({
    repository: {
      receiptStatus: (id) => engine.store.receiptStatus(id),
      desktopCommandStatus: (id, principalId, signature) =>
        engine.store.desktopCommandStatus(id, principalId, signature),
      acceptDesktopCommand: (input, revalidate) =>
        engine.store.acceptDesktopCommand(input, revalidate),
      transaction: (operation) => engine.store.transaction(operation, "critical"),
      readView: readSessionView,
      modelTarget: async (id) => (await featureMetaStable(id)).session,
      adopt,
      touchWorkspace: touchSessionWorkspace,
    },
    execution: {
      commandSignature: (command) => createHash("sha256").update(JSON.stringify(command)).digest("hex"),
      persistenceReady: () => engine.store.db.persistenceHealth().state === "ready",
      validateCommand: (command) => {
        parseCommand(command);
      },
      validateQuestionAttachments: async (command, context) => {
        if (command.type !== "answer" || command.reply.kind !== "answered" || !command.reply.attachments) return;
        if (!context.principalId || !command.runId) throw new Error("Question attachment identity is unavailable");
        const ids = Object.values(command.reply.attachments).flat().map((file) => file.id);
        if (!ids.length) return;
        const occurrence = await questionBinding(command.sessionId, command.runId, command.requestId);
        await attachmentOwnership.assertQuestion(context.principalId, ids, command.sessionId, command.runId, command.requestId, occurrence);
      },
      attachmentRefs: parseRemoteAttachments,
      previewContextual: (command, value) => engine.previewContextual(command, value),
      command: (command) => engine.command(command),
      clearConversation: (command) => engine.clearConversation(command),
      rewind: (command) => engine.rewind(command),
      assertHostMayRun,
      isClearCommand: isClearSessionCommand,
    },
    queue: {
      reapStale: (id) => sessionQueues.reapStale(id),
      get: (id) => sessionQueues.get(id),
      renew: (id, client) => sessionQueues.renew(id, client),
      assertSend: (...args) => sessionQueues.assertSend(...args),
      consumed: (id, message) => sessionQueues.consumed(id, message),
      sameModelTarget: sameQueuedModelTarget,
      kick: (id) => queueDrainer.kick(id),
      leaseHeld: (holder, detail) => new LeaseHeldError(holder, detail),
    },
    nativeProjection: {
      watch: desktopWatch,
      alive: () => !!desktop.live.alive(),
      prepareDesktop: async (command, context) => {
        let resolved = command;
        if (
          command.type === "answer" &&
          command.reply.kind === "answered" &&
          command.reply.attachments
        ) {
          const parsed = parseCommand(command);
          if (parsed.type !== "answer" || parsed.reply.kind !== "answered")
            throw new Error("Invalid question answer");
          const pending = desktop.live.overlay(command.sessionId)?.patch.pendingQuestion;
          if (!pending || pending.requestId !== command.requestId)
            throw new Error("Question is already resolved");
          const attachments = Object.fromEntries(
            await Promise.all(Object.entries(parsed.reply.attachments ?? {}).map(async ([id, files]) => {
              const question = pending.questions.find((item) => item.id === id);
              if (!question?.allowCustom || question.preserveCustomWhitespace)
                throw new Error("This question cannot accept attachments");
              return [id, await resolveQuestionAttachments(engine.store, parseRemoteAttachments(files))] as const;
            })),
          );
          if (desktop.live.overlay(command.sessionId)?.patch.pendingQuestion !== pending)
            throw new Error("Question changed while resolving attachments");
          resolved = { ...parsed, reply: { ...parsed.reply, attachments } };
        }
        const prepared = await desktop.live.prepareDesktop(resolved);
        return {
          ...prepared,
          revalidate: async () => {
            // Accepted work outlives its transport wait, never its principal.
            if (!(await context.authorized())) throw new HostDomainAuthorizationError();
            await prepared.revalidate();
            if (!(await context.authorized())) throw new HostDomainAuthorizationError();
          },
        };
      },
      trackDesktop: (prepared) => desktop.live.trackDesktop(prepared),
      withRetiredWriters: withRetiredDesktopWriters,
    },
    crews: { ownerDirective: (command) => crews.ownerDirective(command) },
  });
  const fileService = createFileService({
    project: (id) => engine.store.project(id),
    resolveWorkspace: resolveHostWorktreeAsync,
    activity: startWorkspaceActivity,
    files: {
      read: readHostFile,
      list: listHostFiles,
      index: indexHostFiles,
      search: searchHostFiles,
      searchContent: searchHostContent,
      create: createHostPath,
      write: writeHostFile,
    },
  });
  const terminalService = createTerminalService({
    project: (id) => engine.store.project(id),
    terminals,
    activity: touchTerminalWorkspace,
  });
  const gitService = createHostGitService({
    project: (id) => engine.store.project(id),
    resolveWorktree: resolveHostWorktreeAsync,
    withIdleProject: (id, work) => engine.withIdleProject(id, work),
    serializeMutation: (cwd, work, scope) => withHostGitMutation(cwd, work, undefined, scope),
    startActivity: (cwd) => startWorkspaceActivity(cwd, "mutation", "git.action"),
    invalidateRoots: () => workspace.invalidateRoots(),
    diff: async (cwd) =>
      (
        await exec(
          "git",
          ["-c", "core.pager=cat", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
          { cwd, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
        )
      ).stdout,
    branches: hostBranches,
    switch: switchHostBranch,
    createBranch: createHostBranch,
    worktrees: hostWorktrees,
    worktreeCreate: createHostWorktree,
    index: hostGitIndex,
    fileDiff: hostFileDiff,
    action: hostGitAction,
  });
  const notesService = createHostNotesService({
    session: featureSession,
    project: (id) => engine.store.project(id),
    notes: hostNotes,
  });
  const tasksService = createHostTasksService({
    project: (id) => engine.store.project(id),
    tasks,
    withAuthorization: (authorized, work) => engine.store.db.withAuthorization(authorized, work),
    retarget: (id, target, autoMerge, context) => {
      if (!context.retargetTask)
        throw new Error("Authenticated workspace-owner capability is required");
      return context.retargetTask(id, target, autoMerge) as ReturnType<HostTasks["retarget"]>;
    },
  });
  const goalsService = createHostGoalsService({ goals });
  const devServersService = createDevServersService({
    project: (id) => engine.store.project(id),
    projects: () => engine.store.projects(),
    workspace: async (id) => (await workspaceForOwnerRpc(id)) ?? undefined,
    assertWorkspaceWritable: (id) => managed.assertWritable(id),
    servers: devServers,
    openExternal: async (url, _context, authorize) => {
      await authorize();
      return openDevServerBrowser(url);
    },
  });
  const sprintsService = createHostSprintsService({ sprints });
  const approveManagementOperation = async (
    operation: { action: string; input: Record<string, unknown>; operationHash: string },
    principal: import("./execution/runtime-log-tools").RuntimeLogSubjectPrincipal,
    authorized: () => Promise<boolean>,
  ) => {
    const decision = await conversationDesktop.call(
      "management.write.authorize",
      { operation },
      (await engine.store.project(principal.projectId)).cwd,
      principal,
      authorized,
    ) as { approved?: boolean; operationHash?: string };
    if (decision.approved && principal.kind === "assistant-thread" &&
      !(await visibleProjectForThread(principal.projectId, principal.threadId, authorized)))
      throw new Error("The target project became unavailable or locked during review.");
    return decision;
  };
  const conversationThreadWork = new ConversationThreadWorkTools(
    engine.store,
    tasks,
    goals,
    automations,
    approveManagementOperation,
  );
  const conversationThreadCrews = new ConversationThreadCrewTools(crews, {
    approve: approveManagementOperation,
    receipt: async (key) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => {
      await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    },
  });
  const conversationManagementRuntime = new ConversationManagementRuntime({
    subscribe: (listener) => engine.store.subscribeChanges(listener),
    snapshot: async (projectId) => {
      const sessions = (await projectSessionList(projectId)).list.slice(0, 100).map((row) => ({
        kind: "session",
        id: row.id,
        status: row.status,
        needsInput: row.needsInput,
        updatedAt: row.updatedAt,
      }));
      const taskRows = (await tasks.list())
        .filter((row) => row.projectId === projectId)
        .slice(0, 100)
        .map((row) => ({ kind: "task", id: row.id, status: row.status, updatedAt: row.updatedAt }));
      const goalRows = (await goals.list())
        .filter((row) => row.projectIds.length === 1 && row.projectIds[0] === projectId)
        .slice(0, 100)
        .map((row) => ({ kind: "goal", id: row.id, status: row.status, updatedAt: row.updatedAt }));
      return [...sessions, ...taskRows, ...goalRows].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
      );
    },
    read: async (action, args, principal, authorized) => {
      const context: HostDomainContext = { authorized };
      if (action === "environment.describe") return environmentService.describe({});
      if (action === "environment.persistence.status")
        return persistenceService.status({}, context);
      if (action === "sync.status") {
        const row = (await engine.store.db
          .prepare("SELECT value FROM metadata WHERE key='syncRev'")
          .get()) as { value: string } | undefined;
        const revision = row ? Number(row.value) : null;
        return {
          revision: Number.isSafeInteger(revision) ? revision : null,
          available: Number.isSafeInteger(revision),
          state: "host-sync-metadata",
        };
      }
      if (action === "tunnels.status") return tunnels.status();
      if (action === "mobile.access.status")
        return args.mode === "lan" ? mobileLan.status() : mobileAccess.status();
      if (action === "history.import.status") {
        if (principal.kind !== "session")
          throw new Error("Choose a real focused session for history import status.");
        const own = await featureSession(principal.sessionId);
        if (own.projectId !== principal.projectId)
          throw new Error("Conversation belongs to another project.");
        const cwd = sessionWorkCwd(own.session);
        return conversationDesktop.call(
          "historyImport.status",
          {
            ...args,
            sessionId: principal.sessionId,
          },
          cwd,
          principal,
          authorized,
        );
      }
      throw new Error("Unsupported runtime management action.");
    },
  });
  const conversationManagement = new ConversationManagementTools({
    receipt: async (key) => {
      const row = (await engine.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key)) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key, value) => {
      await engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: approveManagementOperation,
    execute: async (action, args, principal, authorized) => {
      if (isRuntimeManagementAction(action))
        return conversationManagementRuntime.call(action, args, principal, authorized);
      const projectId = principal.projectId,
        environmentId = engine.store.environmentId;
      const project = await engine.store.project(projectId);
      const context: HostDomainContext = {
        authorized,
        principalId: `management:${principal.kind === "assistant-thread" ? principal.threadId : principal.sessionId}`,
      };
      const checkSession = async (id: unknown) => {
        const value = await featureSession(String(id));
        if (value.projectId !== projectId)
          throw new Error("Conversation belongs to another project.");
        return value;
      };
      const cwd =
        principal.kind === "session"
          ? sessionWorkCwd((await checkSession(principal.sessionId)).session)
          : project.cwd;
      if (isSessionManagementAction(action))
        return dispatchSessionManagement(action, args, principal, authorized, {
          session: featureSession,
          preview: (input, source) => engine.previewContextual(input, source),
          dispatch: (command) => commandService.dispatch(command, context),
        });
      if (isWorkspaceManagementAction(action))
        return dispatchWorkspaceManagement(action, args, principal, authorized, {
          environmentId,
          ownerProject: async (owner) =>
            owner.kind === "session"
              ? (await featureSession(owner.id)).projectId
              : owner.kind === "task"
                ? (await tasks.get(owner.id))?.projectId
                : undefined,
          workspace: workspaceForOwnerRpc,
          assertWritable: (id) => managed.assertWritable(id),
          registry: managedWorkspaces,
          featureClaims,
          removal: managed.removal,
          delivery: managed.delivery,
          reviewTaskDelivery: (id) => tasks.reviewDelivery(id),
        });
      if (action === "projects.get")
        return { id: project.id, name: project.name, cwd: project.cwd, environmentId };
      if (["projects.browse", "projects.createDirectory", "projects.open"].includes(action)) {
        const path = await projectManagementPath(project.cwd, args.path);
        if (action === "projects.open") return projectsService.open({ cwd: path }, context);
        const listing =
          action === "projects.createDirectory"
            ? await projectsService.createDirectory({ path, name: args.name }, context)
            : await projectsService.browse({ path }, context);
        return { path: listing.path, ...managementPage(listing.entries, args) };
      }
      if (action === "projects.workspacePolicy.get")
        return workspacePolicy.get({ projectId, environmentId });
      if (action === "workspaces.list")
        return managementPage(
          (await managedWorkspaces.list({ projectId, environmentId })).filter(
            (row) => row.projectId === projectId,
          ),
          args,
        );
      if (action === "workspaces.featureClaims.list")
        return managementPage(
          (await featureClaims.list({ projectId })).filter((row) => row.projectId === projectId),
          args,
        );
      if (action.startsWith("workspaces.")) {
        const value = await workspaceForOwnerRpc(args.workspaceId);
        if (!value || value.projectId !== projectId)
          throw new Error("Workspace is not in this project.");
        if (action === "workspaces.get") return value;
        const request = {
          workspaceId: value.id,
          expectedRevision: Number(args.expectedRevision),
          idempotencyKey: String(args.requestId),
        };
        if (action === "workspaces.resume") return managedWorkspaces.resume(request);
        if (action === "workspaces.finish") return managedWorkspaces.finish(request);
        if (action === "workspaces.close") return managedWorkspaces.close(request);
      }
      if (action.startsWith("sprints.")) {
        const scoped = (row: { projects: Array<{ projectId: string; environmentId: string }> }) =>
          row.projects.length > 0 &&
          row.projects.every(
            (ref) => ref.projectId === projectId && ref.environmentId === environmentId,
          );
        if (action === "sprints.list")
          return managementPage((await sprints.list()).sprints.filter(scoped), args);
        if (action !== "sprints.create" && args.sprintId !== null) {
          const current = await sprints.get(String(args.sprintId));
          if (!current || !scoped(current))
            throw new Error("Sprint is not wholly in this project.");
        }
        const { sprintId, requestId, ...fields } = args;
        const input = { ...fields, requestId };
        if (action === "sprints.get") return sprintsService.get({ id: sprintId }, context);
        if (action === "sprints.report") return sprintsService.report({ id: sprintId }, context);
        if (action === "sprints.create")
          return sprintsService.create(
            {
              input: {
                ...input,
                id: sprintId,
                projects: [{ environmentId, projectId, cwd: project.cwd, name: project.name }],
                capacityPoints: args.capacityPoints ?? null,
                projectCapacities: {},
              },
            },
            context,
          );
        if (action === "sprints.update")
          return sprintsService.update({ id: sprintId, input }, context);
        if (action === "sprints.start")
          return sprintsService.start({ id: sprintId, input }, context);
        if (action === "sprints.complete")
          return sprintsService.complete({ id: sprintId, input }, context);
        if (action === "sprints.archive")
          return sprintsService.archive({ id: sprintId, input }, context);
        if (action === "sprints.plan") {
          const task = await tasks.get(String(args.taskId));
          if (!task || task.projectId !== projectId)
            throw new Error("Task is not in this project.");
          return sprintsService.plan(
            { input: { ...input, sprintId, environmentId, projectId } },
            context,
          );
        }
      }
      if (action === "git.status") {
        const status = await gitService.index({ projectId, cwd }, context);
        return {
          ...status,
          files: undefined,
          expectedStatus: await conversationGitReviewHash(cwd),
          ...managementPage(status.files, args),
        };
      }
      if (action === "git.stash" || action === "git.pull")
        return gitService.managedAction(
          { projectId, cwd },
          context,
          (lockedCwd) => runConversationGitAction(lockedCwd, action, args),
          {
            beforeEffect: async (lockedCwd) => {
              if ((await conversationGitReviewHash(lockedCwd)) !== args.expectedStatus)
                throw new Error("Git status changed; read it and review again.");
            },
          },
        );
      if (action === "git.stage" || action === "git.unstage" || action === "git.commit") {
        if ((await conversationGitReviewHash(cwd)) !== args.expectedStatus)
          throw new Error("Git status changed; read it and review again.");
        return gitService.action(
          {
            projectId,
            cwd,
            action:
              action === "git.commit"
                ? "commit"
                : action === "git.stage"
                  ? "stageFiles"
                  : "unstageFiles",
            ...(args.paths ? { path: args.paths } : {}),
            ...(args.message ? { message: args.message } : {}),
          },
          context,
          {
            beforeEffect: async (lockedCwd) => {
              if ((await conversationGitReviewHash(lockedCwd)) !== args.expectedStatus)
                throw new Error("Git status changed while waiting; review again.");
            },
          },
        );
      }
      if (
        action.startsWith("preferences.") ||
        action.startsWith("providers.") ||
        action.startsWith("projects.organization.")
      ) {
        const desktopAction = action.startsWith("projects.organization.")
          ? action.replace("projects.organization.", "organization.")
          : action === "providers.status"
            ? "providerManagement.read"
            : action === "providers.quota.refresh"
              ? "providerManagement.quotaRefresh"
              : action === "providers.operation.status"
                ? "providerManagement.status"
                : action;
        const {
          requestId,
          offset: _offset,
          limit: _limit,
          memberOffset: _memberOffset,
          ...fields
        } = args;
        if (principal.kind === "assistant-thread") {
          if (!action.startsWith("projects.organization."))
            throw new Error("Use the global assistant source for desktop settings.");
          const result = await conversationDesktop.callAssistantThread(desktopAction, {
            ...fields, ...(requestId ? { operationId: requestId } : {}),
          }, { threadId: principal.threadId, environmentId, projectId, targetProjectCwd: project.cwd }, authorized);
          return pageDesktopManagementSnapshot(result, args);
        }
        const result = await conversationDesktop.call(
          desktopAction,
          {
            ...fields,
            ...(requestId ? { operationId: requestId } : {}),
            sessionId: principal.sessionId,
          },
          cwd,
          principal,
          authorized,
        );
        return pageDesktopManagementSnapshot(result, args);
      }
      if (action === "commands.status") {
        await checkSession(args.sessionId);
        const receipt = await commandService.status({ commandId: args.commandId }, context);
        if (receipt && receipt.sessionId !== args.sessionId)
          throw new Error("Command belongs to another conversation.");
        return receipt;
      }
      if (action === "commands.dispatch" || action === "ownerQuestions.answer") {
        const command =
          action === "commands.dispatch"
            ? (args.command as Record<string, unknown>)
            : {
                type: "answer",
                sessionId: args.sessionId,
                runId: args.runId,
                requestId: args.questionRequestId,
                reply: { kind: "answered", answers: args.answers },
              };
        await checkSession(command.sessionId);
        return commandService.dispatch(managementCommand(command, String(args.requestId)), context);
      }
      if (action === "ownerQuestions.list") {
        const rows = (await projectSessionList(projectId)).list;
        const values = await Promise.all(
          rows
            .filter((row) => row.needsInput)
            .slice(0, 100)
            .map(async (row) => {
              const value = await checkSession(row.id);
              return {
                sessionId: row.id,
                title: row.title,
                runId: value.runId ?? null,
                question: value.session.pendingQuestion ?? null,
              };
            }),
        );
        return managementPage(
          values.filter((row) => row.question),
          args,
        );
      }
      if (action === "events.read") {
        const snapshot = await projectSessionList(projectId);
        return {
          mode: "sampled" as const,
          durable: false,
          sampledAt: Date.now(),
          ...managementPage(
            snapshot.list
              .filter((row) => row.updatedAt > Number(args.after ?? 0))
              .map((row) => ({
                kind: "session-state",
                sessionId: row.id,
                status: row.status,
                needsInput: row.needsInput,
                updatedAt: row.updatedAt,
                lastActivityAt: row.runActivity?.lastActivityAt ?? row.lastActivityAt ?? null,
              })),
            args,
          ),
        };
      }
      throw new Error("Unsupported management action.");
    },
  });
  const globalAssistantManagement = new ConversationManagementTools<ManagementAction, GlobalManagementPrincipal>({
    receipt: async (key) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => {
      await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    },
    approve: async (operation, principal, authorized) => conversationDesktop.callAssistantThread(
      "management.write.authorize", { operation }, principal, authorized,
    ) as Promise<{ approved?: boolean; operationHash?: string }>,
    execute: async (action, args, principal, authorized) => {
      const desktopAction = action.startsWith("projects.organization.")
        ? action.replace("projects.organization.", "organization.")
        : action === "providers.status" ? "providerManagement.read"
        : action === "providers.quota.refresh" ? "providerManagement.quotaRefresh"
        : action === "providers.operation.status" ? "providerManagement.status" : action;
      const { requestId, offset: _offset, limit: _limit, memberOffset: _memberOffset, ...fields } = args;
      const value = await conversationDesktop.callAssistantThread(desktopAction, {
        ...fields,
        ...(desktopAction === "organization.read" ? { ...(args.offset === undefined ? {} : { offset: args.offset }), ...(args.limit === undefined ? {} : { limit: args.limit }) } : {}),
        ...(requestId ? { operationId: requestId } : {}),
      }, principal, authorized);
      if (desktopAction === "organization.read" && value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).items)) {
        const known = await engine.store.projects();
        const directory = value as Record<string, unknown>;
        directory.items = (directory.items as unknown[]).map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          const record = item as Record<string, unknown>;
          const matches = known.filter((project) => project.cwd === record.cwd);
          return matches.length === 1 ? { ...record, projectId: matches[0].id } : record;
        });
        if (!(await authorized())) throw new Error("Assistant thread authority revoked.");
      }
      return pageDesktopManagementSnapshot(value, args);
    },
  });
  const globalServerManagement = new ConversationManagementTools<string, GlobalManagementPrincipal>({
    receipt: async (key) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => {
      await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    },
    approve: async (operation, principal, authorized) => conversationDesktop.callAssistantThread("management.write.authorize", { operation }, principal, authorized) as Promise<{ approved?: boolean; operationHash?: string }>,
    execute: async (action, args, principal, authorized) => {
      const input = args.serverInput as Record<string, unknown>;
      const { operationId: _operationId, ...canonical } = input;
      return conversationDesktop.callAssistantThread(action, canonical, principal, authorized);
    },
  }, new Set());
  const executeAccountSocial = async (call: { threadId: string; accountId: string; action: string; input: Record<string, unknown>; requestId: string }, deviceHash: string, authorized: () => Promise<boolean>, includeProof = false) => {
    if (!(await authorized())) throw new Error("Room account authority revoked.");
    const grant = await social.issueAccountThreadGrant(call.threadId, call.accountId, deviceHash);
    try {
      const principal = await social.principalForToken(grant.token);
      if (!principal || !(await authorized())) throw new Error("Room account authority revoked.");
      const grantAuthorization = social.authorization(grant.token);
      const grantCheck = typeof grantAuthorization === "function" ? grantAuthorization : grantAuthorization.check;
      const check = async () => (await authorized()) && (await grantCheck());
      const result = await engine.store.db.withAuthorization(check, () => socialTransport.rpc(principal, "social.tools.call", { action: call.action, input: call.input, requestId: call.requestId }));
      if (!(await check())) throw new Error("Room account authority revoked.");
      return includeProof ? roomAccountResult(result, [{ accountId: grant.scope.accountId, version: grant.scope.version }]) : result;
    } finally { social.revokeSessionGrant(grant.token); }
  };
  const visibilityFence = new AssistantVisibilityFence();
  const nativeAdmissionOwner = new NativeAdmissionOwner(
    process.env.BYCODA_NATIVE_ADMISSION_REGISTRY ?? join(dirname(engine.store.attachmentDir), "native-admission-registry.json"),
    engine.store.environmentId,
    !process.env.BYCODA_NATIVE_ADMISSION_REGISTRY,
  );
  const roomDelegationTarget = createRoomNativeTargetAdapter({
    environmentId: engine.store.environmentId,
    admission: nativeAdmissionOwner,
    store: hostRoomDelegationStore(engine.store),
    withProject: async (projectId, actions, requestId, operationHash, expectedNative, authorized, body) => {
      const room = await assistant.globalRoomBinding();
      if (!room) throw new Error("Target Host Room source is unavailable.");
      const current = async () => await authorized() && (await assistant.globalRoomBinding())?.id === room.id;
      return withRoomProjectScope({ threadId: room.id, projectId, family: "conversation", action: "delegation.target", input: { actions: [...actions], operationHash }, requestId }, current, async (valid, captured) => {
        // The reviewed origin and the target's live privacy owner may be distinct
        // enrolled installations. One registry lease fences both original keys.
        if (captured.registryRevision !== expectedNative.revision || !(await nativeAdmissionOwner.current(expectedNative.installationId, expectedNative.revision)))
          throw new Error("Target Host Native delegation source changed.");
        return body(valid, captured.projectCwd);
      });
    },
    execute: async (action, input, principal, _requestId, authorized) => {
      const { expectedUpdatedAt: _expectedUpdatedAt, ...canonicalInput } = input;
      validateConversationTool(action, action === "tasks.update" ? canonicalInput : input);
      if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
      if (action === "sessions.list") {
        const { list } = await projectSessionList(principal.projectId);
        return conversationSessionPage(list.map(row => ({ ...row, busy: row.status === "running" })), input);
      }
      if (action === "sessions.read") {
        const target = await featureSession(String(input.sessionId));
        if (target.projectId !== principal.projectId) throw new Error("Conversation belongs to another project.");
        return sessionConversationPage({ ...target.session, busy: target.status === "running" }, input, await localSessionReference(target.session.id));
      }
      if (action === "tasks.create" || action === "tasks.update")
        return conversationThreadWork.callDelegated(action, input, principal, authorized);
      const rows = (await tasks.list(principal.projectId)).filter(row => row.projectId === principal.projectId);
      if (action === "tasks.list") return managementPage(rows, input);
      if (action === "tasks.get") {
        const item = rows.find(row => row.id === input.taskId);
        if (!item) throw new Error("Task is unavailable in the delegated project.");
        return item;
      }
      throw new Error("Delegated write operations are unavailable.");
    },
  });
  const visibilityAdmission = new AssistantVisibilityAdmission(engine.store.environmentId, nativeAdmissionOwner, visibilityFence);
  const observationJournal = new AssistantObservationJournal(engine.store);
  const observationPages = new AssistantObservationPages(engine.store);
  const observationNativePages = new AssistantObservationNativePages(engine.store);
  const observationHostPages = new AssistantObservationHostPages(engine.store);
  const nativeVoiceLeases = new AssistantNativeVoiceLeases(engine.store);
  const nativeObservationGeneration = (proof: NativeLibraryProof) => createHash("sha256").update(JSON.stringify([proof.environmentId, proof.threadId, proof.installationId, proof.issuer, proof.registryRevision, proof.visibilityEpoch, proof.policyGeneration])).digest("hex");
  const observationProjectPages = new AssistantObservationProjectPages(engine.store);
  const assistantWorkspaceOwner = new AssistantWorkspaceOwner(engine.store);
  assistantPorts.roomObservationDelivered = async (threadId, observations, proofs, valid, projectProofs = [], nativeProofs = []) => {
    for (const item of observations) {
      if (!item || typeof item !== "object") continue;
      const observation = item as { source?: { family?: string; action?: string; projectId?: string; accountId?: string; nativeLibrary?: boolean }; value?: { state?: string; observationSource?: unknown; snapshot?: { snapshotId?: unknown; offset?: unknown; nextOffset?: unknown; coverage?: unknown } } };
      const source = observation.source, snapshot = observation.value?.snapshot;
      if (source?.family !== "conversation" || source.action !== "observations.resnapshot" || observation.value?.state !== "incomplete" || !snapshot || typeof snapshot.snapshotId !== "string" || !Number.isSafeInteger(snapshot.offset) || !Number.isSafeInteger(snapshot.nextOffset)) continue;
      if (source.nativeLibrary && source.projectId && !source.accountId && observation.value?.observationSource === "native-session") {
        const proof = nativeProofs.find(item => item.threadId === threadId && item.environmentId === engine.store.environmentId);
        const project = projectProofs.find(item => item.projectId === source.projectId);
        if (!proof || !project || !Array.isArray(snapshot.coverage) || snapshot.coverage.length !== 1 || snapshot.coverage[0] !== "native-session") throw new Error("Native session disclosure provenance unavailable.");
        const generation = createHash("sha256").update(JSON.stringify([nativeObservationGeneration(proof),source.projectId,project.cwd])).digest("hex");
        await observationNativePages.delivered({ threadId, installationId: proof.installationId, generation, consumer: observationRoomConsumer(threadId,generation,"native-session"), source: "native-session" }, snapshot.snapshotId, Number(snapshot.offset), Number(snapshot.nextOffset), valid);
        continue;
      }
      if (source.nativeLibrary && !source.projectId && !source.accountId) {
        const selected = observation.value?.observationSource;
        const proof = nativeProofs.find(proof => proof.threadId === threadId && proof.environmentId === engine.store.environmentId);
        if (!proof || (selected !== "note" && selected !== "server" && selected !== "crew") || !Array.isArray(snapshot.coverage) || snapshot.coverage.length !== 1 || snapshot.coverage[0] !== selected) throw new Error("Native observation disclosure proof is unavailable.");
        const generation = nativeObservationGeneration(proof);
        if (selected === "crew") {
          await observationHostPages.delivered({ threadId, generation, consumer: observationRoomConsumer(threadId, generation, selected) }, snapshot.snapshotId, Number(snapshot.offset), Number(snapshot.nextOffset), valid);
          continue;
        }
        await observationNativePages.delivered({ threadId, installationId: proof.installationId, generation, consumer: observationRoomConsumer(threadId, generation, selected), source: selected }, snapshot.snapshotId, Number(snapshot.offset), Number(snapshot.nextOffset), valid);
        continue;
      }
      if (source.projectId && !source.accountId) {
        const selected = observation.value?.observationSource;
        if ((selected !== "task" && selected !== "session" && selected !== "goal") || !Array.isArray(snapshot.coverage) || snapshot.coverage.length !== 1 || snapshot.coverage[0] !== selected) throw new Error("Observation page project provenance is unavailable.");
        const goalProofs = selected === "goal" ? await collectGoalObservationProjects(engine.store, source.projectId) : undefined;
        if (goalProofs?.some(expected => !projectProofs.some(actual => actual.projectId === expected.projectId && actual.cwd === expected.cwd))) throw new Error("Goal observation disclosure scope changed.");
        await observationProjectPages.delivered({ threadId, projectId: source.projectId, source: selected, consumer: observationRoomConsumer(threadId, undefined, selected) }, snapshot.snapshotId, Number(snapshot.offset), Number(snapshot.nextOffset), valid, goalProofs);
        continue;
      }
      if (!source.accountId || source.projectId) throw new Error("Observation page scope is unavailable.");
      const proof = proofs.find(value => value.accountId === source.accountId);
      if (!proof) throw new Error("Observation page account provenance is unavailable.");
      await observationPages.delivered({ threadId, accountId: source.accountId, version: proof.version, consumer: observationRoomConsumer(threadId, proof.version) }, snapshot.snapshotId, Number(snapshot.offset), Number(snapshot.nextOffset), valid);
    }
  };
  let observationCoverage: Awaited<ReturnType<typeof installAssistantObservationProducers>> | undefined;
  const roomProjectNotes = new ConversationManagementTools<string>({
    approve: approveManagementOperation,
    receipt: async key => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => { await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    execute: async (action, input, principal, authorized) => {
      if (principal.kind !== "assistant-thread" || !["notes.create", "notes.update", "notes.delete"].includes(action) || !input.noteInput || typeof input.noteInput !== "object" || Array.isArray(input.noteInput)) throw new Error("Invalid project note operation.");
      try { return await conversationWorkspace.call(action as ConversationTool, input.noteInput as Record<string, unknown>, principal, undefined, authorized); }
      finally { await hostNotes.settled(); }
    },
  }, new Set());
  const roomResourceReceipts = {
    receipt: async (key: string) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key: string, value: ManagementReceipt) => {
      await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
    },
    approve: approveManagementOperation,
  };
  const roomFiles = createRoomFileTools({
    ...roomResourceReceipts,
    run: (principal, command, input, authorized) => workspace.run(command, input, `room:${engine.store.environmentId}:${principal.threadId}`, authorized),
  });
  const roomDevServers = createRoomDevServerTools({
    ...roomResourceReceipts,
    project: id => engine.store.project(id),
    handle: (action, input, projects, authorize) => devServers.handle(action, input, projects, authorize),
  });
  const roomTerminals = createRoomTerminalTools({ ...roomResourceReceipts, terminals, project: id => engine.store.project(id) });
  const roomBrowser = createRoomBrowserTools({ ...roomResourceReceipts, registry: sharedBrowser, previews: conversationPreviews, describe: value => browserRuntime.describe(value) });
  const roomSessions = new ConversationManagementTools<string>({
    approve: approveManagementOperation,
    receipt: async key => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => { await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    execute: async (action, input, principal, authorized) => {
      if (principal.kind !== "assistant-thread" || !isRoomSessionAction(action)) throw new Error("A real Room session source is required.");
      return executeRoomSessionAction(action, input, { kind: "assistant-thread", threadId: principal.threadId, projectId: principal.projectId, name: await assistant.identityName() }, authorized, engine.store, engine);
    },
  }, new Set(["sessions.submit.status"]));
  const workspaceTransferSource = new AsyncLocalStorage<{ valid: () => boolean; source: { deviceHash: string; projectCwd: string; installationId: string; registryRevision: string; visibilityEpoch: number; policyGeneration: string } }>();
  const roomWorkspace = new ConversationManagementTools<string>({
    approve: approveManagementOperation,
    receipt: async (key) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? JSON.parse(String(row.value)) as ManagementReceipt : undefined;
    },
    saveReceipt: async (key, value) => { await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    execute: async (action, input, principal, authorized) => {
      if (principal.kind !== "assistant-thread" || !isRoomWorkspaceAction(action)) throw new Error("A real Room workspace source is required.");
      const project = await engine.store.project(principal.projectId);
      if (action !== "workspace.sessions.submit.status" && action !== "workspace.operation.status") {
        const bound = workspaceTransferSource.getStore();
        if (!bound || bound.source.projectCwd !== project.cwd) throw new Error("Native workspace scope is unavailable.");
        const current = async () => bound.valid() && await authorized() && bound.valid();
        const source = { environmentId: engine.store.environmentId, threadId: principal.threadId, projectId: principal.projectId, targetProjectCwd: project.cwd, targetDeviceHash: bound.source.deviceHash, installationId: bound.source.installationId, registryRevision: bound.source.registryRevision, visibilityEpoch: bound.source.visibilityEpoch, policyGeneration: bound.source.policyGeneration, action, originalInput: input, requestId: String(input.requestId) };
        return transferAssistantWorkspaceOperation(assistantWorkspaceOwner, source, current, bound.valid,
          value => conversationDesktop.callAssistantThread("workspace.operation.execute", value, { threadId: principal.threadId, environmentId: engine.store.environmentId, projectId: principal.projectId, targetProjectCwd: project.cwd, targetDeviceHash: bound.source.deviceHash }, current),
          value => verifyWorkspaceReceipt(nativeAdmissionOwner, value as { relayId: string; envelope: unknown }, { environmentId: engine.store.environmentId, threadId: principal.threadId, projectId: principal.projectId, targetCwd: project.cwd, operationId: source.requestId, action, originalInput: input }, current, bound.source));
      }
      return conversationDesktop.callAssistantThread(action, input, { threadId: principal.threadId, environmentId: engine.store.environmentId, projectId: project.id, targetProjectCwd: project.cwd }, authorized);
    },
  }, new Set(["workspace.sessions.submit.status"]));
  const roomNotebook = new AssistantRoomNotebook(assistant, {
    receipt: async (key) => {
      const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return row ? (JSON.parse(String(row.value)) as ManagementReceipt) : undefined;
    },
    saveReceipt: async (key, value) => {
      await engine.store.db
        .prepare(
          "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    approve: async (operation, principal, authorized) =>
      conversationDesktop.callAssistantThread(
        "management.write.authorize",
        { operation },
        principal,
        authorized,
      ) as Promise<{ approved?: boolean; operationHash?: string }>,
  });
  const visibleProjectForThread = async (id: string, threadId: string, authorized: () => Promise<boolean>) => {
    const project = await engine.store.project(id);
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await conversationDesktop.callAssistantThread("organization.read", { offset, limit: 100 }, { threadId, environmentId: engine.store.environmentId }, authorized) as { items?: Array<{ cwd?: string }>; nextOffset?: number | null };
      if (!Array.isArray(page.items)) return false;
      if (page.items.some((item) => item.cwd === project.cwd)) return true;
      if (page.nextOffset == null || page.nextOffset !== offset + 100) return false;
    }
    return false;
  };
  const roomVisibleProject = async (id: string, threadId: string, admission: import("./assistant/management/assistant-management-turn").RoomManagementAdmission) => visibleProjectForThread(id, threadId, admission.authorized);
  social.retireAssistantVoiceGenerations = async (generations, effect) => {
    const authorized = async () => {
      try {
        await engine.store.db.checkAuthorization();
        for (const generation of generations)
          if (!(await engine.store.db.prepare("SELECT id FROM devices WHERE hash=?").get(generation.deviceHash))) return false;
        return true;
      } catch { return false; }
    };
    const expected = generations.map(generation => ({
      environmentId: engine.store.environmentId,
      threadId: generation.threadId,
      generationKey: generation.generationKey,
      requestId: randomUUID(),
      operationHash: createHash("sha256").update(JSON.stringify([generation.threadId, generation.generationKey, generation.deviceHash, generation.accounts])).digest("hex"),
    }));
    return withVoiceGenerationsRetired({
      admission: nativeAdmissionOwner,
      relay: (item, check) => {
        const generation = generations.find(value => value.threadId === item.threadId && value.generationKey === item.generationKey);
        if (!generation) throw new Error("Voice generation retirement source changed.");
        return conversationDesktop.callAssistantThread("voice.generation.retire", { generationKey: item.generationKey, requestId: item.requestId, operationHash: item.operationHash }, { threadId: item.threadId, environmentId: item.environmentId, targetDeviceHash: generation.deviceHash }, check) as Promise<{ relayId: string; envelope: unknown }>;
      },
    }, expected, authorized, effect);
  };
  assistantPorts.roomAccountProofsValid = async (threadId, proofs) => social.assistantAccountProofsValid(threadId, proofs);
  const retireNativeVoiceGenerations = async <T>(generations: NativeVoiceLease[], effect: (valid: () => boolean) => Promise<T>): Promise<T> => {
    const authorized = async () => {
      try {
        await engine.store.db.checkAuthorization();
        for (const generation of generations) {
          if (generation.environmentId !== engine.store.environmentId || !(await engine.store.db.prepare("SELECT id FROM devices WHERE hash=?").get(generation.deviceHash))) return false;
        }
        return true;
      } catch { return false; }
    };
    const expected = generations.map(generation => ({ environmentId: generation.environmentId, threadId: generation.threadId, generationKey: generation.generationKey, requestId: randomUUID(), operationHash: createHash("sha256").update(JSON.stringify(["native.voice.retire", generation])).digest("hex") }));
    return withVoiceGenerationsRetired({ admission: nativeAdmissionOwner, relay: (item, check) => {
      const generation = generations.find(value => value.threadId === item.threadId && value.generationKey === item.generationKey);
      if (!generation) throw new Error("Native voice retirement source changed.");
      return conversationDesktop.callAssistantThread("voice.generation.retire", { generationKey: item.generationKey, requestId: item.requestId, operationHash: item.operationHash }, { threadId: item.threadId, environmentId: item.environmentId, targetDeviceHash: generation.deviceHash }, check) as Promise<{ relayId: string; envelope: unknown }>;
    } }, expected, authorized, effect);
  };
  assistantPorts.roomProjectProofsValid = async proofs => {
    try {
      if (proofs.length > 1000) return false;
      const seen = new Map<string, string>();
      for (const proof of proofs) {
        if (!proof.projectId || !proof.cwd || (seen.has(proof.projectId) && seen.get(proof.projectId) !== proof.cwd) || (await engine.store.project(proof.projectId)).cwd !== proof.cwd) return false;
        seen.set(proof.projectId, proof.cwd);
      }
      return true;
    }
    catch { return false; }
  };
  assistantPorts.withRoomAccountDisclosure = async (threadId, proofs, admission, effect) =>
    social.withAssistantAccountProofs(threadId, proofs, async () => !admission.signal?.aborted && await admission.authorized(), effect);
  assistantPorts.roomManagementVisible = async (threadId, projectIds, admission) => {
    if (projectIds.length > 1000) return false;
    try {
      for (const id of new Set(projectIds)) if (!(await roomVisibleProject(id, threadId, admission))) return false;
      return true;
    } catch { return false; }
  };
  const withRoomProjectScope = async <T>(
    call: import("./assistant/management/assistant-management-turn").RoomManagementCall,
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, source: { deviceHash: string; projectCwd: string; installationId: string; registryRevision: string; visibilityEpoch: number; policyGeneration: string }) => Promise<T>,
    expectedDeviceHash?: string,
  ): Promise<T> => {
    if (!call.projectId) throw new Error("A project target is required for native scope.");
    const project = await engine.store.project(call.projectId);
    const operationHash = createHash("sha256").update(JSON.stringify([call.family, call.action, call.input])).digest("hex");
    const captured = await conversationDesktop.callAssistantThread(
      "privacy.scope.capture", { action: call.action, requestId: call.requestId, operationHash },
      { threadId: call.threadId, environmentId: engine.store.environmentId, projectId: call.projectId, targetProjectCwd: project.cwd, ...(expectedDeviceHash ? { targetDeviceHash: expectedDeviceHash } : {}) }, authorized,
    ) as { relayId: string; envelope: unknown; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(captured.deviceHash)) throw new Error("Native project source device is unavailable.");
    if (expectedDeviceHash && captured.deviceHash !== expectedDeviceHash) throw new Error("Native project source device changed.");
    return visibilityAdmission.withCapture(captured.envelope, {
      environmentId: engine.store.environmentId, threadId: call.threadId, projectId: call.projectId,
      targetCwd: project.cwd, action: call.action, requestId: call.requestId, operationHash, relayId: captured.relayId,
    }, authorized, (valid, identity) => engine.store.withProjectIdentityRead([{ projectId: call.projectId!, cwd: project.cwd }], identityValid => engine.store.db.withAuthorization(async () => valid() && identityValid() && await authorized() && valid() && identityValid(), async () => {
      captureRoomProject(call.projectId!, project.cwd);
      return body(() => valid() && identityValid(), { deviceHash: captured.deviceHash, projectCwd: project.cwd, ...identity });
    })));
  };
  let taskNotificationReadyUntil = 0;
  const withNativeObservationScope = async <T>(
    threadId: string, requestId: string, input: unknown,
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, proof: NativeLibraryProof, capture: NativeObservationCapture, deviceHash: string) => Promise<T>,
    targetDeviceHash?: string,
  ): Promise<T> => {
    if ((await assistant.globalRoomBinding())?.id !== threadId) throw new Error("Native library requires the original Global Room.");
    const operationHash = createHash("sha256").update(JSON.stringify(["native.observations", threadId, requestId, input])).digest("hex");
    const captured = await conversationDesktop.callAssistantThread("privacy.account.capture", { requestId, operationHash }, { threadId, environmentId: engine.store.environmentId, ...(targetDeviceHash ? { targetDeviceHash } : {}) }, authorized) as { relayId: string; envelope: { operationJson: string }; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(captured.deviceHash)) throw new Error("Native library source device is unavailable.");
    return visibilityAdmission.withAccountCapture(captured.envelope, { environmentId: engine.store.environmentId, threadId, relayId: captured.relayId, requestId, operationHash }, authorized, (valid, identity) => {
      const proof: NativeLibraryProof = { environmentId: engine.store.environmentId, threadId, ...identity };
      const original = JSON.parse(captured.envelope.operationJson) as { projectionRevision: number; policyDigest: string; privacyRevision: number };
      const capture = { ...proof, projectionRevision: original.projectionRevision, policyDigest: original.policyDigest, privacyRevision: original.privacyRevision };
      return engine.store.db.withAuthorization(async () => valid() && await authorized() && valid(), () => body(valid, proof, capture, captured.deviceHash));
    });
  };
  const withNativeSessionScope = async <T>(call: import("./assistant/management/assistant-management-turn").RoomManagementCall, authorized: () => Promise<boolean>, body: (valid: () => boolean, proof: NativeLibraryProof, capture: NativeObservationCapture, deviceHash: string, cwd: string) => Promise<T>) => {
    if (!call.projectId || (await assistant.globalRoomBinding())?.id !== call.threadId) throw new Error("Native session observations require the original global Room and exact project.");
    const project = await engine.store.project(call.projectId);
    const operationHash = createHash("sha256").update(JSON.stringify(["native.session.observations",call.threadId,call.projectId,project.cwd,call.requestId,call.input])).digest("hex");
    const projectCapture = await conversationDesktop.callAssistantThread("privacy.scope.capture", { action: call.action, requestId: call.requestId, operationHash }, { threadId: call.threadId, environmentId: engine.store.environmentId, projectId: call.projectId, targetProjectCwd: project.cwd }, authorized) as { relayId: string; envelope: unknown; deviceHash: string };
    if (!/^[a-f0-9]{64}$/.test(projectCapture.deviceHash)) throw new Error("Native session source device unavailable.");
    const accountCapture = await conversationDesktop.callAssistantThread("privacy.account.capture", { requestId: call.requestId, operationHash }, { threadId: call.threadId, environmentId: engine.store.environmentId, targetDeviceHash: projectCapture.deviceHash }, authorized) as { relayId: string; envelope: { operationJson: string }; deviceHash: string };
    if (accountCapture.deviceHash !== projectCapture.deviceHash) throw new Error("Native session source device changed.");
    const expectedProject = { environmentId: engine.store.environmentId, threadId: call.threadId, projectId: call.projectId, targetCwd: project.cwd, action: call.action, requestId: call.requestId, operationHash, relayId: projectCapture.relayId };
    const expectedAccount = { environmentId: engine.store.environmentId, threadId: call.threadId, requestId: call.requestId, operationHash, relayId: accountCapture.relayId };
    return visibilityAdmission.withCaptures([{ envelope: projectCapture.envelope, expected: expectedProject }], authorized, (valid, identity) => engine.store.withProjectIdentityRead([{ projectId: call.projectId!, cwd: project.cwd }], async identityValid => {
      if (!valid() || !identityValid()) throw new Error("Native session source changed.");
      captureRoomProject(call.projectId!,project.cwd);
      const original = JSON.parse(accountCapture.envelope.operationJson) as { projectionRevision: number; policyDigest: string; privacyRevision: number };
      const proof: NativeLibraryProof = { environmentId: engine.store.environmentId, threadId: call.threadId, ...identity };
      return body(() => valid() && identityValid(), proof, { ...proof, ...original }, projectCapture.deviceHash, project.cwd);
    }), [{ envelope: accountCapture.envelope, expected: expectedAccount }]);
  };
  assistantPorts.observedTaskDeliveryConfigured = () => true;
  assistantPorts.observationTasksReady = () => monotonicNow() < taskNotificationReadyUntil;
  assistantPorts.pollObservedTasks = async (projectIds, accept, active) => {
    const room = await assistant.globalRoomBinding();
    if (!room) throw new Error("Assistant global Room source is unavailable.");
    let incomplete = false;
    for (const projectId of [...new Set(projectIds)]) {
      const authorized = async () => active() && (await assistant.globalRoomBinding())?.id === room.id && await assistant.manualProjectAllowed(projectId);
      if (!(await authorized())) { incomplete = true; continue; }
      const call = { threadId: room.id, projectId, family: "conversation" as const, action: "observations.read", input: {}, requestId: randomUUID() };
      try {
        await withRoomProjectScope(call, authorized, async (scopeValid, source) => {
          const valid = () => active() && scopeValid();
          const page = await observationJournal.read("chief:task", { projectId }, authorized, async event => event.source === "task" && event.projectIds.length === 1 && event.projectIds[0] === projectId, valid, 3, 3000, "task");
          if (page.status === "gap") throw new Error("Task observation history has a retention gap; owner resnapshot is required.");
          for (const event of page.events) {
            if (!(await accept(event, valid))) break;
            await observationJournal.acknowledge("chief:task", { projectId }, event.sequence, authorized, valid);
          }
          const targets = (await assistant.observedNotificationTargets()).filter(target => target.projectId === projectId);
          for (const target of targets) {
            if (!valid()) throw new Error("Task notification source changed.");
            const prior = await assistant.observedNotificationIntent(target.id);
            if (prior?.state === "accepted" || prior?.state === "suppressed") continue;
            if (prior && prior.state !== "prepared" && (prior.threadId !== room.id || prior.projectId !== projectId || prior.deviceHash !== source.deviceHash)) continue;
            const intent = prior && prior.state !== "prepared" ? prior : await assistant.prepareObservedNotification(room.id, target.id, projectId, source.deviceHash, valid);
            if (!intent) continue;
            const requestId = `observation-${intent.operationHash}`;
            const input = { notificationId: intent.notificationId, kind: intent.kind, requestId, operationHash: intent.operationHash, projectCwds: [source.projectCwd] };
            const expected = { environmentId: engine.store.environmentId, threadId: room.id, notificationId: intent.notificationId, kind: intent.kind, requestId, operationHash: intent.operationHash };
            const relay = (action: "assistant.notification.status" | "assistant.notification.deliver") => conversationDesktop.callAssistantThread(action, input, { threadId: room.id, environmentId: engine.store.environmentId, targetDeviceHash: source.deviceHash }, authorized) as Promise<{ relayId: string; envelope: unknown }>;
            const status = await verifyAssistantNotificationReceipt(nativeAdmissionOwner, await relay("assistant.notification.status"), expected, authorized);
            taskNotificationReadyUntil = status.permission === "granted" ? monotonicNow() + 15_000 : 0;
            if (intent.state === "pending" || intent.state === "unknown") {
              if (status.state === "accepted" || status.state === "suppressed") await assistant.settleObservedNotification(intent, status.state);
              continue;
            }
            if (status.permission !== "granted" || !valid()) continue;
            if (!(await assistant.armObservedNotification(intent, valid))) continue;
            if (status.state === "accepted" || status.state === "suppressed") { await assistant.settleObservedNotification(intent, status.state); continue; }
            try {
              const receipt = await verifyAssistantNotificationReceipt(nativeAdmissionOwner, await relay("assistant.notification.deliver"), expected, authorized);
              await assistant.settleObservedNotification(intent, receipt.state);
            } catch (error) {
              await assistant.settleObservedNotification(intent, "unknown");
              throw error;
            }
          }
        });
      } catch { taskNotificationReadyUntil = 0; incomplete = true; }
    }
    if (incomplete) throw new Error("Some task observation sources were unavailable or need resnapshot.");
  };
  assistantPorts.withRoomProjectDisclosure = async (threadId, projectIds, admission, effect, projectProofs) => {
    const ids = [...new Set(projectIds)];
    if (!ids.length) return effect(() => true);
    const initialThread = await assistant.threadBinding(threadId);
    if (!initialThread || initialThread.id !== threadId) throw new Error("Room disclosure source is unavailable.");
    const authorized = async () => {
      if (admission.signal?.aborted || !(await admission.authorized())) return false;
      const current = await assistant.threadBinding(threadId);
      return !!current && current.id === threadId && current.projectId === initialThread.projectId;
    };
    const requestId = randomUUID();
    const operationHash = createHash("sha256").update(JSON.stringify(["room.disclosure", threadId, ids.slice().sort(), requestId])).digest("hex");
    const captures: Array<{ envelope: unknown; expected: import("./assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture }> = [];
    for (const projectId of ids) {
      const project = await engine.store.project(projectId);
      const result = await conversationDesktop.callAssistantThread("privacy.scope.capture", { action: "room.disclosure", requestId, operationHash }, { threadId, environmentId: engine.store.environmentId, projectId, targetProjectCwd: project.cwd }, authorized) as { relayId: string; envelope: unknown };
      captures.push({ envelope: result.envelope, expected: { environmentId: engine.store.environmentId, threadId, projectId, targetCwd: project.cwd, action: "room.disclosure", requestId, operationHash, relayId: result.relayId } });
    }
    const proofs = [...(projectProofs ?? [])];
    if (proofs.some(proof => !ids.includes(proof.projectId))) throw new Error("Room disclosure contains an unqualified project source.");
    for (const item of captures) {
      const expected = proofs.filter(proof => proof.projectId === item.expected.projectId);
      if (expected.some(proof => proof.cwd !== item.expected.targetCwd)) throw new Error("Room project identity changed before disclosure.");
      if (!expected.length) proofs.push({ projectId: item.expected.projectId, cwd: item.expected.targetCwd });
    }
    return visibilityAdmission.withCaptures(captures, authorized, valid => engine.store.withProjectIdentityRead(proofs, async identityValid => {
      if (!valid() || !identityValid()) throw new Error("Room project scope revoked.");
      return effect(() => valid() && identityValid());
    }));
  };
  assistantPorts.withSummarySourceDisclosure = async (targetThreadId, projectProofs, accountProofs, effect, expectedNative, nativeSources = []) => {
    const actor = await assistant.globalRoomBinding();
    const target = await assistant.threadBinding(targetThreadId);
    if (!actor || !target || target.id !== targetThreadId) throw new Error("Summary Room source is unavailable.");
    const nativeProofs = mergeNativeLibraryProofs(nativeSources);
    if (nativeProofs.some(proof => proof.environmentId !== engine.store.environmentId || proof.threadId !== actor.id)) throw new Error("Summary Native library source changed.");
    if (projectProofs.length > 1000 || accountProofs.length > 100) throw new Error("Summary source scope is too large.");
    const authorized = async () => {
      const current = await assistant.threadBinding(targetThreadId);
      return (await assistant.globalRoomBinding())?.id === actor.id && !!current && current.id === target.id && current.projectId === target.projectId;
    };
    if (!(await authorized()) || (accountProofs.length && !(await social.assistantAccountProofsValid(actor.id, accountProofs)))) throw new Error("Summary source access is unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256").update(JSON.stringify(["summary.disclosure", targetThreadId, projectProofs, accountProofs, requestId])).digest("hex");
    const checkIssuer = (envelope: unknown) => {
      if (expectedNative && JSON.parse(String((envelope as { operationJson?: unknown })?.operationJson)).issuer !== expectedNative.issuer) throw new Error("Native disclosure window changed.");
    };
    const run = async (valid: () => boolean) => {
      if (expectedNative && !(await nativeAdmissionOwner.current(expectedNative.installationId, expectedNative.revision))) throw new Error("Native disclosure trust changed.");
      return effect(valid);
    };
    const verifyNative = (identity: import("./assistant/native/assistant-visibility-admission").VisibilityIdentity & { issuer: string }) => {
      if (nativeProofs.some(proof => proof.installationId !== identity.installationId || proof.issuer !== identity.issuer || proof.registryRevision !== identity.registryRevision || proof.visibilityEpoch !== identity.visibilityEpoch || proof.policyGeneration !== identity.policyGeneration)) throw new Error("Summary Native library privacy changed.");
    };
    if (!projectProofs.length) {
      if (!accountProofs.length && !expectedNative && !nativeProofs.length) throw new Error("Summary source scope is unavailable.");
      const captured = await conversationDesktop.callAssistantThread("privacy.account.capture", { requestId, operationHash }, { threadId: actor.id, environmentId: engine.store.environmentId, ...(expectedNative ? { targetDeviceHash: expectedNative.deviceHash } : {}) }, authorized) as { relayId: string; envelope: unknown };
      checkIssuer(captured.envelope);
      return visibilityAdmission.withAccountCapture(captured.envelope, { environmentId: engine.store.environmentId, threadId: actor.id, relayId: captured.relayId, requestId, operationHash }, authorized, (nativeValid, identity) => {
        verifyNative(identity);
        return accountProofs.length ? social.withAssistantAccountProofs(actor.id, accountProofs, authorized, accountValid => run(() => nativeValid() && accountValid())) : run(nativeValid);
      });
    }
    const captures: Array<{ envelope: unknown; expected: import("./assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture }> = [];
    for (const proof of projectProofs) {
      if ((await engine.store.project(proof.projectId)).cwd !== proof.cwd) throw new Error("Summary project identity changed.");
      const captured = await conversationDesktop.callAssistantThread("privacy.scope.capture", { action: "summary.disclosure", requestId, operationHash }, { threadId: actor.id, environmentId: engine.store.environmentId, projectId: proof.projectId, targetProjectCwd: proof.cwd, ...(expectedNative ? { targetDeviceHash: expectedNative.deviceHash } : {}) }, authorized) as { relayId: string; envelope: unknown };
      checkIssuer(captured.envelope);
      captures.push({ envelope: captured.envelope, expected: { environmentId: engine.store.environmentId, threadId: actor.id, projectId: proof.projectId, targetCwd: proof.cwd, action: "summary.disclosure", requestId, operationHash, relayId: captured.relayId } });
    }
    const nativeCaptures: Array<{ envelope: unknown; expected: { environmentId: string; threadId: string; relayId: string; requestId: string; operationHash: string } }> = [];
    if (nativeProofs.length) {
      const captured = await conversationDesktop.callAssistantThread("privacy.account.capture", { requestId, operationHash }, { threadId: actor.id, environmentId: engine.store.environmentId }, authorized) as { relayId: string; envelope: unknown };
      nativeCaptures.push({ envelope: captured.envelope, expected: { environmentId: engine.store.environmentId, threadId: actor.id, requestId, operationHash, relayId: captured.relayId } });
    }
    return visibilityAdmission.withCaptures(captures, authorized, (nativeValid, identity) => engine.store.withProjectIdentityRead(projectProofs, async projectValid => {
      verifyNative(identity);
      const valid = () => nativeValid() && projectValid();
      if (!valid()) throw new Error("Summary source access changed.");
      if (!accountProofs.length) return run(valid);
      return social.withAssistantAccountProofs(actor.id, accountProofs, authorized, accountValid => run(() => valid() && accountValid()));
    }), nativeCaptures);
  };
  assistantPorts.withVoiceNarrationAuthorization = async (input, admission, effect) => {
    const authorized = async () => !admission.signal?.aborted && admission.environmentId === engine.store.environmentId && /^[a-f0-9]{64}$/.test(admission.deviceHash) && await admission.authorized() && (await assistant.globalRoomBinding())?.id === input.threadId;
    if (!(await authorized()) || input.projectIds.length > 100) throw new Error("Voice narration source unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256").update(JSON.stringify(["narration", input, admission.deviceHash, requestId])).digest("hex");
    const expected = { environmentId: engine.store.environmentId, threadId: input.threadId, generationKey: input.generation, requestId, operationHash };
    const captured = await conversationDesktop.callAssistantThread("voice.generation.status", { generationKey: input.generation, requestId, operationHash }, { threadId: input.threadId, environmentId: engine.store.environmentId, targetDeviceHash: admission.deviceHash }, authorized) as { relayId: string; envelope: unknown };
    const native = await captureLiveVoiceGeneration(nativeAdmissionOwner, expected, captured, authorized);
    const projects = await Promise.all([...new Set(input.projectIds)].map(async projectId => ({ projectId, cwd: (await engine.store.project(projectId)).cwd })));
    return assistantPorts.withSummarySourceDisclosure!(input.threadId, projects, input.accountProofs ?? [], async valid => {
      if (!valid() || !(await authorized())) throw new Error("Voice narration source changed.");
      if (input.accountProofs?.length) await social.registerAssistantVoiceLease({ threadId: input.threadId, generationKey: input.generation, deviceHash: admission.deviceHash, accounts: input.accountProofs }, valid);
      return effect(() => valid() && !admission.signal?.aborted);
    }, { ...native, deviceHash: admission.deviceHash });
  };
  social.roomSendSourceAdmission = async source => {
    if ((await assistant.globalRoomBinding())?.id !== source.threadId) return false;
    return source.projectId === null ? source.projectCwd === null : (await engine.store.project(source.projectId)).cwd === source.projectCwd;
  };
  social.withRoomSendSource = async (source, effect) => {
    if (!(await social.roomSendSourceAdmission!(source))) throw new Error("Room social source changed.");
    return assistantPorts.withSummarySourceDisclosure!(source.threadId, source.projectId ? [{ projectId: source.projectId, cwd: source.projectCwd! }] : [], [{ accountId: source.accountId, version: source.accountGrantVersion }], effect);
  };
  const roomRemote = new AssistantRoomRemote({
    read: async key => { const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key); return row ? JSON.parse(String(row.value)) : undefined; },
    write: async (key, value) => { await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    native: (action, input, source, authorized) => conversationDesktop.callAssistantThread(action, input, source, authorized),
  });
  const roomInbox = new AssistantRoomInbox({
    read: async key => { const row = await engine.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key); return row ? JSON.parse(String(row.value)) : undefined; },
    write: async (key, value) => { await engine.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); },
    execute: (input, source, authorized) => conversationDesktop.callAssistantThread("inbox.room.execute", input, { threadId: source.threadId, environmentId: source.environmentId, projectId: source.projectId, targetProjectCwd: source.projectCwd, targetDeviceHash: source.deviceHash }, authorized),
  });
  const roomSocialSend = new AssistantRoomSocialSend({
    receipt: roomResourceReceipts.receipt,
    saveReceipt: roomResourceReceipts.saveReceipt,
    approve: (operation, principal, authorized) => conversationDesktop.callAssistantThread("management.write.authorize", { operation }, principal, authorized) as Promise<{ approved?: boolean; operationHash?: string }>,
    snapshot: async (proposal, principal, authorized) => social.prepareRoomSend(proposal, principal, proposal.projectId ? (await engine.store.project(proposal.projectId)).cwd : null, authorized),
    enqueue: (proposal, snapshot, principal, authorized, review) => social.enqueueReviewedRoomSend(proposal, snapshot, principal, authorized, review),
    readback: (jobId, principal, authorized) => social.roomSendJobStatus(jobId, principal, authorized),
  });
  const executeRoomSocialSend = async (call: import("./assistant/management/assistant-management-turn").RoomManagementCall, admission: import("./assistant/management/assistant-management-turn").RoomManagementAdmission, authorized: () => Promise<boolean>) => {
    validateConversationTool(call.action, call.input);
    const accountId = String(call.input.accountId), projectId = call.input.projectId as string | null;
    if ((call.projectId ?? null) !== projectId || (call.accountId && call.accountId !== accountId)) throw new Error("Room social target changed.");
    const source = { kind: "assistant-thread" as const, threadId: call.threadId, environmentId: engine.store.environmentId };
    const grant = await social.issueAccountThreadGrant(call.threadId, accountId, admission.deviceHash);
    const proof = { accountId, version: grant.scope.version };
    const projectProofs = projectId ? [{ projectId, cwd: (await engine.store.project(projectId)).cwd }] : [];
    let scopeValid = () => true;
    const current = async () => scopeValid() && await authorized() && scopeValid();
    const qualify = <T>(effect: () => Promise<T>) => assistantPorts.withSummarySourceDisclosure!(call.threadId, projectProofs, [proof], async valid => {
      if (!valid() || !(await authorized())) throw new Error("Room social authority changed.");
      scopeValid = valid;
      for (const project of projectProofs) captureRoomProject(project.projectId, project.cwd);
      try { const result = await effect(); if (!(await current())) throw new Error("Room social authority changed."); return result; }
      finally { scopeValid = () => true; }
    });
    try {
      const result = call.action === "social.send.status"
        ? await roomSocialSend.status(source, String(call.input.operationId), current, qualify)
        : await roomSocialSend.submit(call.input, source, current, call.requestId, qualify);
      return roomAccountResult(result ?? { state: "unknown" }, [proof]);
    } finally { social.revokeSessionGrant(grant.token); }
  };
  assistantPorts.withRoomResponseDisclosure = async (scopes, admission, effect) => {
    if (scopes.length > 1000 || scopes.reduce((sum, item) => sum + item.projects.length, 0) > 1000) throw new Error("Room response source scope is too large.");
    const authorized = async () => {
      if (admission.signal?.aborted || !(await admission.authorized())) return false;
      for (const scope of scopes) {
        const thread = await assistant.threadBinding(scope.threadId);
        if (!thread || thread.id !== scope.threadId || (thread.projectId && scope.projects.some(id => id !== thread.projectId)) || (thread.projectId && scope.accounts.length)) return false;
      }
      return true;
    };
    if (!(await authorized())) throw new Error("Room response authority is unavailable.");
    const nativeProofs = mergeNativeLibraryProofs(...scopes.map(scope => scope.nativeProofs ?? []));
    for (const scope of scopes) for (const proof of scope.nativeProofs ?? []) {
      if (proof.environmentId !== engine.store.environmentId || proof.threadId !== scope.threadId || (await assistant.globalRoomBinding())?.id !== proof.threadId) throw new Error("Native library response source changed.");
    }
    const requestId = randomUUID();
    const operationHash = createHash("sha256").update(JSON.stringify(["room.response.disclosure", scopes.map(scope => [scope.threadId, scope.projects.slice().sort()]), requestId])).digest("hex");
    const captures: Array<{ envelope: unknown; expected: import("./assistant/native/assistant-visibility-admission").ExpectedVisibilityCapture }> = [];
    const nativeCaptures: Array<{ envelope: unknown; expected: { environmentId: string; threadId: string; relayId: string; requestId: string; operationHash: string } }> = [];
    for (const proof of nativeProofs) {
      const captured = await conversationDesktop.callAssistantThread("privacy.account.capture", { requestId, operationHash }, { threadId: proof.threadId, environmentId: engine.store.environmentId }, authorized) as { relayId: string; envelope: unknown };
      nativeCaptures.push({ envelope: captured.envelope, expected: { environmentId: engine.store.environmentId, threadId: proof.threadId, requestId, operationHash, relayId: captured.relayId } });
    }
    for (const scope of scopes) for (const projectId of scope.projects) {
      const project = await engine.store.project(projectId);
      const captured = await conversationDesktop.callAssistantThread("privacy.scope.capture", { action: "room.disclosure", requestId, operationHash }, { threadId: scope.threadId, environmentId: engine.store.environmentId, projectId, targetProjectCwd: project.cwd }, authorized) as { relayId: string; envelope: unknown };
      captures.push({ envelope: captured.envelope, expected: { environmentId: engine.store.environmentId, threadId: scope.threadId, projectId, targetCwd: project.cwd, action: "room.disclosure", requestId, operationHash, relayId: captured.relayId } });
    }
    const accountScopes = scopes.filter(scope => scope.accounts.length);
    const holdAccounts = (index: number, valid: () => boolean): ReturnType<typeof effect> => {
      if (!valid()) throw new Error("Room response scope changed.");
      if (index === accountScopes.length) return effect(valid);
      const scope = accountScopes[index];
      return social.withAssistantAccountProofs(scope.threadId, scope.accounts, authorized, accountValid => holdAccounts(index + 1, () => valid() && accountValid()));
    };
    if (!captures.length && !nativeCaptures.length) return holdAccounts(0, () => true);
    const proofs = scopes.flatMap(scope => {
      const expected = [...(scope.projectProofs ?? [])];
      if (expected.some(proof => !scope.projects.includes(proof.projectId))) throw new Error("Room response contains an unqualified project source.");
      for (const item of captures.filter(item => item.expected.threadId === scope.threadId)) {
        const found = expected.filter(proof => proof.projectId === item.expected.projectId);
        if (found.some(proof => proof.cwd !== item.expected.targetCwd)) throw new Error("Room project identity changed before response disclosure.");
        if (!found.length) expected.push({ projectId: item.expected.projectId, cwd: item.expected.targetCwd });
      }
      return expected;
    });
    return visibilityAdmission.withCaptures(captures, authorized, (valid, identity) => {
      if (nativeProofs.some(proof => proof.installationId !== identity.installationId || proof.issuer !== identity.issuer || proof.registryRevision !== identity.registryRevision || proof.visibilityEpoch !== identity.visibilityEpoch || proof.policyGeneration !== identity.policyGeneration)) throw new Error("Native library response privacy changed.");
      return engine.store.withProjectIdentityRead(proofs, identityValid => holdAccounts(0, () => valid() && identityValid()));
    }, nativeCaptures);
  };
  assistantPorts.roomNativeProofsValid = async (proofs, admission) => {
    try {
      const sources = mergeNativeLibraryProofs(proofs);
      if (!sources.length) return true;
      if (!admission) {
        for (const expected of sources) {
          const authorized = async () => expected.environmentId === engine.store.environmentId && (await assistant.globalRoomBinding())?.id === expected.threadId;
          const current = await withNativeObservationScope(expected.threadId, randomUUID(), { action: "native.provenance.check" }, authorized, async (valid, captured) => valid() && nativeObservationGeneration(expected) === nativeObservationGeneration(captured));
          if (!current) return false;
        }
        return true;
      }
      if (admission.environmentId !== engine.store.environmentId) return false;
      return await assistantPorts.withRoomResponseDisclosure!(sources.map(proof => ({ threadId: proof.threadId, projects: [], accounts: [], nativeProofs: [proof] })), admission, async valid => valid());
    } catch { return false; }
  };
  assistantPorts.withNativeVoiceSourcesRetired = effect => nativeVoiceLeases.retireAll(retireNativeVoiceGenerations, effect);
  assistantPorts.withNativeVoiceRuntimeRegistration = async (input, admission, effect) => {
    const authorized = async () => !admission.signal?.aborted && admission.environmentId === engine.store.environmentId && /^[a-f0-9]{64}$/.test(admission.deviceHash) && await admission.authorized() && (await assistant.globalRoomBinding())?.id === input.threadId;
    if (!(await authorized()) || !input.nativeProofs.length) throw new Error("Native voice runtime source is unavailable.");
    const requestId = randomUUID();
    const operationHash = createHash("sha256").update(JSON.stringify(["voice.runtime.register", input, admission.deviceHash, requestId])).digest("hex");
    const captured = await conversationDesktop.callAssistantThread("voice.generation.source", { generationKey: input.generationKey, requestId, operationHash }, { threadId: input.threadId, environmentId: engine.store.environmentId, targetDeviceHash: admission.deviceHash }, authorized) as { relayId: string; envelope: unknown };
    const source = await captureVoiceRuntimeSource(nativeAdmissionOwner, { environmentId: engine.store.environmentId, threadId: input.threadId, generationKey: input.generationKey, requestId, operationHash }, captured, authorized);
    if (input.nativeProofs.some(proof => proof.installationId !== source.installationId || proof.issuer !== source.issuer || proof.registryRevision !== source.revision)) throw new Error("Native voice runtime belongs to another source.");
    return assistantPorts.withRoomResponseDisclosure!([{ threadId: input.threadId, projects: input.projectProofs.map(proof => proof.projectId), projectProofs: input.projectProofs, accounts: input.accountProofs, nativeProofs: input.nativeProofs }], admission, async valid => {
      if (!valid() || !(await authorized())) throw new Error("Native voice runtime authority changed.");
      if (input.accountProofs.length) await social.registerAssistantVoiceLease({ threadId: input.threadId, generationKey: input.generationKey, deviceHash: admission.deviceHash, accounts: input.accountProofs }, valid);
      return nativeVoiceLeases.withRegistration({ threadId: input.threadId, generationKey: input.generationKey, deviceHash: admission.deviceHash, nativeProofs: input.nativeProofs }, () => valid() && !admission.signal?.aborted, effect);
    });
  };
  const executeRoomObservation = async (call: import("./assistant/management/assistant-management-turn").RoomManagementCall, admission: import("./assistant/management/assistant-management-turn").RoomManagementAdmission, authorized: () => Promise<boolean>) => {
    const fetchNativePage = async (native: { capture: NativeObservationCapture; deviceHash: string; projectId?: string; cwd?: string }, source: "note" | "server" | "native-session", valid: () => boolean, pageOffset: number, fingerprint?: string) => {
      const requestId = randomUUID();
      const operationHash = createHash("sha256").update(JSON.stringify(["native.observations.baseline", call.threadId, source, pageOffset, fingerprint, requestId])).digest("hex");
      const captured = await conversationDesktop.callAssistantThread(source === "native-session" ? "observations.native.projectBaseline" : "observations.native.baseline", { requestId, operationHash, source, offset: pageOffset, ...(fingerprint ? { fingerprint } : {}) }, { threadId: call.threadId, environmentId: engine.store.environmentId, targetDeviceHash: native.deviceHash, ...(source === "native-session" ? { projectId: native.projectId, targetProjectCwd: native.cwd } : {}) }, authorized) as { relayId: string; envelope: unknown };
      return verifyNativeObservationPage(nativeAdmissionOwner, native.capture, { relayId: captured.relayId, requestId, operationHash, source, offset: pageOffset, ...(source === "native-session" ? { projectId: native.projectId, targetCwd: native.cwd } : {}) }, captured.envelope, valid);
    };
    const run = (valid: () => boolean, consumerGeneration?: string, goalProofs?: { projectId: string; cwd: string }[], native?: { proof: NativeLibraryProof; capture: NativeObservationCapture; deviceHash: string; projectId?: string; cwd?: string }) => executeAssistantObservationTool({
      journal: observationJournal,
      consumerGeneration,
      ...(native ? { nativeInstallationId: native.proof.installationId } : {}),
      ...(native ? { nativeSourceGap: async (_scope: unknown, source: string) => {
        if (source === "crew") return !(await observationHostPages.covered({ threadId: call.threadId, generation: consumerGeneration!, consumer: observationRoomConsumer(call.threadId, consumerGeneration, "crew") }));
        if (source !== "note" && source !== "server" && source !== "native-session") throw new Error("Native observation source is unavailable.");
        const status = await fetchNativePage(native, source, valid, 0);
        const scope: NativePageScope = { threadId: call.threadId, installationId: native.proof.installationId, generation: consumerGeneration!, consumer: observationRoomConsumer(call.threadId, consumerGeneration, source), source };
        const [uncertain, covered] = await Promise.all([observationNativePages.uncertain(scope), observationNativePages.covered(scope)]);
        return status.sourceGap || uncertain || !covered;
      } } : {}),
      authorizeScope: async () => valid() && await authorized(),
      authorizeEvent: async (_thread, scope, event) => valid() && ("nativeInstallationId" in scope
        ? event.nativeInstallationId === scope.nativeInstallationId && event.projectIds.length === 0 && !event.accountId
        : "hostLibrary" in scope ? event.source === "crew" && event.hostLibrary === true && event.projectIds.length === 0 && !event.accountId && !event.nativeInstallationId
        : "accountId" in scope
        ? event.source === "social" && event.accountId === scope.accountId && event.projectIds.length === 0
        : event.source !== "social" && event.projectIds.includes(scope.projectId)),
      guard: () => valid,
      resnapshot: async (_thread, scope, _admission, offset, snapshotId, consumer, source) => {
        if ("hostLibrary" in scope) {
          if (!native || !consumerGeneration || source !== "crew") throw new Error("Host Crew observation source unavailable.");
          return observationHostPages.page({ threadId: call.threadId, generation: consumerGeneration, consumer }, offset, snapshotId, valid);
        }
        if ("nativeInstallationId" in scope || ("projectId" in scope && source === "native-session")) {
          if (!native || !consumerGeneration || (source !== "note" && source !== "server" && source !== "native-session")) return { complete: false, value: { reason: "This Native source has no qualified baseline." } };
          return observationNativePages.page({ threadId: call.threadId, installationId: native.proof.installationId, generation: consumerGeneration, consumer, source }, offset, snapshotId, async (pageOffset, fingerprint) => {
            return fetchNativePage(native, source, valid, pageOffset, fingerprint);
          }, valid, async request => {
            const operationHash = createHash("sha256").update(JSON.stringify(["native.observations.complete", call.threadId, source, request.fingerprint, request.watermark, request.requestId])).digest("hex");
            const captured = await conversationDesktop.callAssistantThread(source === "native-session" ? "observations.native.projectComplete" : "observations.native.complete", { ...request, source, operationHash }, { threadId: call.threadId, environmentId: engine.store.environmentId, targetDeviceHash: native.deviceHash, ...(source === "native-session" ? { projectId: native.projectId, targetProjectCwd: native.cwd } : {}) }, authorized) as { relayId: string; envelope: unknown };
            await verifyNativeObservationCompletion(nativeAdmissionOwner, native.capture, { relayId: captured.relayId, requestId: request.requestId, operationHash, source, fingerprint: request.fingerprint, watermark: request.watermark, ...(source === "native-session" ? { projectId: native.projectId, targetCwd: native.cwd } : {}) }, captured.envelope, valid);
          });
        }
        if (!("accountId" in scope)) {
          if (source === "task" || source === "session" || (source === "goal" && goalProofs)) return observationProjectPages.page({ threadId: call.threadId, projectId: scope.projectId, consumer, source }, offset, snapshotId, valid, goalProofs);
          return { complete: false, value: { reason: "Select task, session or goal for a source-qualified project baseline. Other sources require their own visibility-qualified baseline." } };
        }
        if (!consumerGeneration) throw new Error("Observation account grant generation is unavailable.");
        return observationPages.page({ threadId: call.threadId, accountId: scope.accountId, version: consumerGeneration, consumer }, offset, snapshotId, valid);
      },
    }, call, admission);
    if (call.input.nativeLibrary === true) {
      if (call.projectId || call.accountId) throw new Error("Native library does not use project or account scope.");
      return withNativeObservationScope(call.threadId, call.requestId, call.input, authorized, async (valid, proof, capture, deviceHash) => {
        const value = await run(valid, nativeObservationGeneration(proof), undefined, { proof, capture, deviceHash });
        return roomNativeResult(value, [proof]);
      });
    }
    if (call.projectId && call.input.source === "native-session") {
      return withNativeSessionScope(call, authorized, async (valid,proof,capture,deviceHash,cwd) => {
        const generation=createHash("sha256").update(JSON.stringify([nativeObservationGeneration(proof),call.projectId,cwd])).digest("hex");
        return roomNativeResult(await run(valid,generation,undefined,{ proof,capture,deviceHash,projectId:call.projectId,cwd }),[proof]);
      });
    }
    if (call.projectId && !call.accountId) {
      if (call.input.source === "goal") {
        const proofs = await collectGoalObservationProjects(engine.store, call.projectId);
        return assistantPorts.withRoomProjectDisclosure!(call.threadId, proofs.map(proof => proof.projectId), admission, valid => {
          for (const proof of proofs) captureRoomProject(proof.projectId, proof.cwd);
          return run(valid, undefined, proofs);
        }, proofs);
      }
      return withRoomProjectScope(call, authorized, valid => run(valid));
    }
    if (!call.accountId || call.projectId) throw new Error("Choose exactly one observation scope.");
    const grant = await social.issueAccountThreadGrant(call.threadId, call.accountId, admission.deviceHash);
    try {
      const proof = { accountId: grant.scope.accountId, version: grant.scope.version };
      const result = await social.withAssistantAccountProofs(call.threadId, [proof], authorized, valid => run(valid, proof.version));
      return roomAccountResult(result, [proof]);
    } finally { social.revokeSessionGrant(grant.token); }
  };
  assistantPorts.roomManagement = createRoomManagementDispatcher({
    environmentId: engine.store.environmentId,
    thread: (id) => assistant.threadBinding(id),
    visibleProject: roomVisibleProject,
    execute: async (call, admission) => {
      const authorized = async () => {
        if (admission.signal?.aborted || !(await admission.authorized())) return false;
        const thread = await assistant.threadBinding(call.threadId);
        return !!thread && thread.id === call.threadId && (!thread.projectId || thread.projectId === call.projectId);
      };
      const value = await engine.store.db.withAuthorization(authorized, async () => {
        if (call.family === "conversation" && ["remote.grants.list", "remote.call", "remote.result"].includes(call.action)) {
          if (call.projectId || (await assistant.globalRoomBinding())?.id !== call.threadId) throw new Error("Remote operations require the original Global Room.");
          return roomRemote.call(call.action, call.input, { threadId: call.threadId, environmentId: engine.store.environmentId }, call.requestId, authorized);
        }
        if (call.family === "conversation" && ["social.send.propose", "social.send.status"].includes(call.action))
          return executeRoomSocialSend(call, admission, authorized);
        if (call.family === "conversation" && isAssistantObservationAction(call.action))
          return executeRoomObservation(call, admission, authorized);
        if (call.family === "social" && !call.projectId && !call.accountId && call.action === "accounts.list")
          { const result = await social.listAssistantAccountsWithProof(call.threadId, admission.deviceHash, call.input); return roomAccountResult(result.value, result.accounts); }
        if (call.family === "social" && !call.projectId && call.accountId)
          return executeAccountSocial({ ...call, accountId: call.accountId }, admission.deviceHash, authorized, true);
        if (call.family === "conversation" && isRoomNotebookAction(call.action))
          return roomNotebook.call(
            call.action,
            call.input,
            {
              kind: "assistant-thread",
              threadId: call.threadId,
              environmentId: engine.store.environmentId,
            },
            authorized,
            call.requestId,
          );
      if (call.family !== "conversation") {
        if (call.projectId && call.family === "social") throw new Error("Project Room social disclosure requires explicit combined account and project authority.");
        if (!call.projectId) throw new Error("Choose a visible project for this Room tool.");
        const delegated = await prepareVoiceToolDispatch(call, {
          authorized,
          environmentId: engine.store.environmentId,
          deviceHash: admission.deviceHash,
          threadIdentity: (id) => assistant.threadBinding(id),
          sessionIdentity: async () => { throw new Error("Room tools do not borrow sessions."); },
          issuers: { conversation: conversationAccess, social, "runtime-logs": runtimeLogAccess },
        });
        try {
          if (call.family === "social") {
            const principal = await social.principalForToken(delegated.token);
            if (!principal) throw new Error("Room social authority unavailable.");
            const socialAuthorized = social.authorization(delegated.token);
            const socialCheck = typeof socialAuthorized === "function" ? socialAuthorized : socialAuthorized.check;
            return await engine.store.db.withAuthorization({
              check: async () => (await authorized()) && (await socialCheck()),
              prepare: async () => {
                const prepared = typeof socialAuthorized === "function" ? socialAuthorized : await socialAuthorized.prepare();
                return async () => (await authorized()) && (await prepared());
              },
            }, () => socialTransport.rpc(principal, "social.tools.call", delegated.params));
          }
          const principal = await runtimeLogAccess.principalForToken(delegated.token);
          if (!principal) throw new Error("Room log authority unavailable.");
          await refreshLogSources();
          const query = runtimeLogToolQuery(call.action, call.input, principal);
          return await withRoomProjectScope(call, authorized, async () => {
            const result = call.action === "sources" || call.action === "runtimeLogs.sources" ? runtimeLogs.sources(query) : runtimeLogs.read(query);
            if (!(await runtimeLogAccess.principalForToken(delegated.token))) throw new Error("Room log authority revoked.");
            return result;
          });
        } finally { delegated.release(); }
      }
      if (!call.projectId) {
        const principal: GlobalManagementPrincipal = { kind: "assistant-thread", threadId: call.threadId, environmentId: engine.store.environmentId };
        if (isGlobalRuntimeRead(call.action))
          return conversationManagementRuntime.call(call.action as import("./conversation/conversation-management-runtime").RuntimeManagementAction, call.input, principal, authorized);
        if (["tools.list", "tools.search", "tools.describe", "tools.status"].includes(call.action)) return roomManagementDiscovery(call.action, call.input);
        if (call.action === "servers.ssh.execute" && call.input.requestId !== call.requestId)
          throw new Error("SSH operation identity changed.");
        if (["servers.list", "servers.get", "servers.ssh.execute", "servers.ssh.status", "servers.ssh.cancel"].includes(call.action))
          return conversationDesktop.callAssistantThread(call.action, call.input, principal, authorized);
        if (call.action === "servers.ssh.save" || call.action === "servers.ssh.remove") {
          if (call.input.operationId !== call.requestId || typeof call.input.expectedInventoryRevision !== "string" || !/^[a-f0-9]{64}$/.test(call.input.expectedInventoryRevision)) throw new Error("Server operation identity or inventory revision is missing.");
          return globalServerManagement.call(call.action, { requestId: call.requestId, serverInput: call.input }, principal, authorized);
        }
        if (!isManagementAction(call.action)) throw new Error("This global Room operation is unavailable.");
        if (!["preferences.read", "preferences.status", "providers.status", "providers.operation.status", "projects.organization.read"].includes(call.action) && call.input.requestId !== call.requestId)
          throw new Error("Management operation identity changed.");
        return globalAssistantManagement.call(call.action, call.input, principal, authorized);
      }
      const principal = { kind: "assistant-thread" as const, threadId: call.threadId, projectId: call.projectId, provider: "assistant" as const };
      let effectValid = () => true;
      const effectAuthorized = async () => effectValid() && await authorized() && effectValid();
      const qualifyEffect = <T>(effect: () => Promise<T>) => withRoomProjectScope(call, authorized, async valid => {
        effectValid = valid;
        try { return await effect(); } finally { effectValid = () => true; }
      });
      if (isRoomBrowserAction(call.action)) return withRoomProjectScope(call, authorized, async (valid, captured) => {
        const current = async () => valid() && await authorized() && valid();
        return roomBrowser.call(call.action, call.input, { environmentId: engine.store.environmentId, projectId: call.projectId!, projectCwd: captured.projectCwd, threadId: call.threadId, deviceHash: admission.deviceHash }, call.requestId, current, undefined,
          async () => await conversationDesktop.callAssistantThread("ui.tools.open", { tab: "browser", projectHost: true }, { threadId: call.threadId, environmentId: engine.store.environmentId, projectId: call.projectId!, targetProjectCwd: captured.projectCwd, targetDeviceHash: captured.deviceHash }, current) as PreviewPresentation);
      });
      if (isRoomFileAction(call.action) || isRoomDevServerAction(call.action) || isRoomTerminalAction(call.action)) {
        const project = await engine.store.project(call.projectId);
        const source = { ...principal, projectCwd: project.cwd };
        const input = (isRoomFileWrite(call.action) || isRoomTerminalWrite(call.action) || ["devServers.start", "devServers.stop", "devServers.restart"].includes(call.action)) ? { ...call.input, requestId: call.requestId } : call.input;
        const qualify = <T>(effect: () => Promise<T>) => withRoomProjectScope(call, authorized, async (valid, captured) => {
          if (captured.projectCwd !== source.projectCwd) throw new Error("Room resource project changed during review.");
          effectValid = valid;
          try { return await effect(); } finally { effectValid = () => true; }
        });
        if (isRoomTerminalAction(call.action)) return roomTerminals.call(call.action, input, { ...source, environmentId: engine.store.environmentId, deviceHash: admission.deviceHash }, effectAuthorized, qualify);
        return isRoomFileAction(call.action)
          ? roomFiles.call(call.action, input, source, effectAuthorized, qualify)
          : roomDevServers.call(call.action, input, source, effectAuthorized, qualify);
      }
      if (isRoomSessionAction(call.action)) {
        const input = validateRoomSessionAction(call.action, call.input, call.requestId);
        return roomSessions.call(call.action, input, principal, effectAuthorized, qualifyEffect);
      }
      if (call.action === "workspace.operation.status" || call.action === "projects.organization.status") {
        const organizationStatus = call.action === "projects.organization.status" ? validateRoomOrganization(call.action, call.input, call.requestId) as { requestId: string; originalInput?: Record<string, unknown> } : undefined;
        if (organizationStatus && !organizationStatus.originalInput) throw new Error("Inspect the original organization patch with its exact originalInput.");
        const input = validateRoomWorkspaceAction("workspace.operation.status", organizationStatus ? { operationId: organizationStatus.requestId, action: "organization.patch", originalInput: organizationStatus.originalInput } : call.input, call.requestId) as { operationId: string; action: string; originalInput: Record<string, unknown> };
        return withRoomProjectScope(call, authorized, async (valid, source) => {
          const current = async () => valid() && await authorized() && valid();
          const owner = await assistantWorkspaceOwner.lookup(engine.store.environmentId, call.threadId, input.operationId);
          if (!owner) return { state: "unknown" };
          const operationHash = createHash("sha256").update(workspaceOperationJson({ action: input.action as typeof owner.action, targetProjectCwd: source.projectCwd, originalInput: input.originalInput }), "utf8").digest("hex");
          if (owner.projectId !== call.projectId || owner.targetProjectCwd !== source.projectCwd || owner.action !== input.action || owner.operationHash !== operationHash) throw new Error("Workspace original request identity changed.");
          if (owner.targetDeviceHash !== source.deviceHash || owner.installationId !== source.installationId) throw new Error("Reconnect the original desktop device to inspect this request.");
          const captured = await conversationDesktop.callAssistantThread("workspace.operation.status", input, { threadId: call.threadId, environmentId: engine.store.environmentId, projectId: call.projectId, targetProjectCwd: source.projectCwd, targetDeviceHash: owner.targetDeviceHash }, current) as { relayId: string; envelope: unknown };
          return verifyWorkspaceReceipt(nativeAdmissionOwner, captured, { environmentId: engine.store.environmentId, threadId: call.threadId, projectId: call.projectId!, targetCwd: source.projectCwd, operationId: input.operationId, action: input.action, originalInput: input.originalInput }, current, source);
        });
      }
      if (call.action === "workspace.sessions.submit.status") {
        const input = validateRoomWorkspaceAction(call.action, call.input, call.requestId);
        return withRoomProjectScope(call, authorized, () => roomWorkspace.call(call.action, input, principal, authorized));
      }
      if (call.action === "projects.organization.read") {
        const input = validateRoomOrganization(call.action, call.input, call.requestId);
        return withRoomProjectScope(call, authorized, async (valid, source) => conversationDesktop.callAssistantThread("organization.read", input, { threadId: call.threadId, environmentId: engine.store.environmentId, projectId: call.projectId, targetProjectCwd: source.projectCwd, targetDeviceHash: source.deviceHash }, async () => valid() && await authorized() && valid()));
      }
      if (isRoomWorkspaceAction(call.action) || call.action === "projects.organization.patch") {
        const action = call.action === "projects.organization.patch" ? "organization.patch" : call.action;
        const input = call.action === "projects.organization.patch" ? validateRoomOrganization(call.action, call.input, call.requestId) : validateRoomWorkspaceAction(action, call.input, call.requestId);
        return describeWorkspaceTransfer(await roomWorkspace.call(action, input, principal, effectAuthorized, effect => withRoomProjectScope(call, authorized, async (valid, source) => {
          effectValid = valid;
          try { return await workspaceTransferSource.run({ valid, source }, effect); }
          finally { effectValid = () => true; }
        })));
      }
      if (["tools.list", "tools.search", "tools.describe", "tools.status"].includes(call.action)) return roomManagementDiscovery(call.action, call.input, call.projectId);
      if ((call.action.startsWith("preferences.") || call.action.startsWith("providers.")) && isManagementAction(call.action)) {
        if (!call.action.endsWith(".status") && call.action !== "preferences.read" && call.input.requestId !== call.requestId) throw new Error("Management operation identity changed.");
        return globalAssistantManagement.call(call.action, call.input, { kind: "assistant-thread", threadId: call.threadId, environmentId: engine.store.environmentId }, authorized);
      }
      if (call.action === "sessions.list") return withRoomProjectScope(call, authorized, async () => {
        const { list } = await projectSessionList(call.projectId!);
        return conversationSessionPage(list.map((row) => ({ ...row, busy: row.status === "running" })), call.input);
      });
      if (call.action === "sessions.read") return withRoomProjectScope(call, authorized, async () => {
        const target = await featureSession(String(call.input.sessionId));
        if (target.projectId !== call.projectId) throw new Error("Conversation belongs to another project.");
        return sessionConversationPage({ ...target.session, busy: target.status === "running" }, call.input, await localSessionReference(target.session.id));
      });
      if (threadCrewAction(call.action)) {
        if (call.input.operationId !== undefined && call.input.operationId !== call.requestId) throw new Error("Crew operation identity changed.");
        return conversationThreadCrews.call(call.action, call.input, principal, effectAuthorized, qualifyEffect);
      }
      if (THREAD_WORK_ACTIONS.has(call.action)) return conversationThreadWork.call(call.action, call.input, principal, effectAuthorized, call.requestId, qualifyEffect);
      if (isManagementAction(call.action)) {
        if (call.input.requestId !== undefined && call.input.requestId !== call.requestId && !call.action.endsWith(".status")) throw new Error("Management operation identity changed.");
        if (call.action === "history.import.status")
          throw new Error("Choose a real focused session for history import status.");
        return conversationManagement.call(call.action, call.input, principal, effectAuthorized, qualifyEffect);
      }
      if (call.action === "notes.list" || call.action === "notes.read")
        return withRoomProjectScope(call, authorized, () => conversationWorkspace.call(call.action as ConversationTool, call.input, principal, undefined, authorized));
      if (["notes.create", "notes.update", "notes.delete"].includes(call.action))
        return roomProjectNotes.call(call.action, { requestId: call.requestId, noteInput: call.input }, principal, effectAuthorized, qualifyEffect);
      if (call.action === "inbox.list") return withRoomProjectScope(call, authorized, async () => {
        const result = hostInbox({ sessions: (await projectSessionList(call.projectId!)).list, tasks: await tasks.list(), goals: await goals.list(), automations: await automations.list(), threads: [] }, call.projectId);
        return { ...managementPage(result.items, call.input), scope: result.scope, socialIncluded: false, externalProviderInboxAvailable: false };
      });
      if (call.action === "inbox.providers.status") return withRoomProjectScope(call, authorized, async () => {
        return { state: "unknown", supportedProviders: ["github", "jira"], credentialsChecked: false, reason: "Provider discovery verifies the current Native account and saved visibility. Supply an explicit provider to inbox.providers.list; keep its accountProof for follow-up operations." };
      });
      if (isRoomInboxAction(call.action)) return withRoomProjectScope(call, authorized, async (valid, source) => roomInbox.call(call.action, call.input, { environmentId: engine.store.environmentId, threadId: call.threadId, projectId: call.projectId!, projectCwd: source.projectCwd, deviceHash: source.deviceHash }, call.requestId, async () => valid() && await authorized() && valid()));
      if (/^inbox\./.test(call.action)) throw new Error("Project Room inbox remote transport requires a qualified owner workflow.");
      throw new Error("This project Room operation is unavailable in text turns.");
      });
      if (call.projectId && !hasRoomProjectCapture(call.projectId)) {
        // These return public schemas or application-wide metadata, never a
        // project read. A missing fence on project data must not be repaired by
        // attaching a later cwd after the data has already been read.
        const metadataOnly = ["tools.list", "tools.search", "tools.describe", "tools.status", "preferences.read", "preferences.patch", "preferences.status", "providers.status", "providers.quota.refresh", "providers.operation.status"].includes(call.action);
        if (!metadataOnly) throw new Error("Room project data was not captured under its source permit.");
        await withRoomProjectScope(call, authorized, async () => undefined);
      }
      return value;
    },
  });
  const automationsService = createHostAutomationsService({ automations });
  const stewardsService = createHostStewardsService({ stewards });
  const crewsService = createHostCrewsService({ crews });
  const crewOperation =
    (method: Parameters<typeof crewsService.call>[0]) =>
    (params: Record<string, unknown>, context: HostDomainContext) =>
      crewsService.call(method, params, context);
  const persistenceService = createHostPersistenceService({
    status: () => engine.store.db.persistenceHealth(),
    recover: (authorized) =>
      engine.store.db.withAuthorization(authorized, () => engine.store.db.recoverPersistence()),
  });
  const nativeWorkspacesService = createNativeWorkspacesService({
    managed,
    workspace: workspaceForOwnerRpc,
    touchActivity: (id) => managedWorkspaces.touchActivity(id),
  });
  const modelsService = createModelsService({
    read: models,
    accounts: hostProviderAccounts,
    providers,
  });
  const nativeDevicesService = createNativeDevicesService();
  const nativeDevicesOwner = (token: string) =>
    bindNativeDevicesOwner(
      { store: engine.store, host: deviceHost, previews: devicePreviews },
      createHash("sha256").update(token).digest("hex"),
      () => engine.store.authenticated(token),
    );
  const nativeServicesService = createNativeServicesService();
  const nativeDeliveryService = createNativeDeliveryService();
  const nativeDeliveryJournal = createNativeDeliveryStore(engine.store);
  const nativeServiceUploads = createNativeServiceUploadService({
    environmentId: engine.store.environmentId,
    platform: nativeBufferUploadPlatform,
    execute: (target, params, context) => nativeServicesService.call(target, params, context),
    deliver: (target, identity, paramsJson, context) =>
      nativeDeliveryService.call(
        "native.services.delivery.apply",
        { ...identity, target, paramsJson },
        context,
      ),
  });
  type NativeBrowserResultLifetime = (read: (publish: (value: unknown, valid: () => boolean) => Promise<void>) => Promise<void>) => Promise<unknown>;
  const nativeServicesOwner = (token: string, retainBrowserResult?: NativeBrowserResultLifetime) =>
    bindNativeServicesOwner(
      {
        store: engine.store,
        delegation: (action, input, authorized) => action === "publicKey" || action === "nativeChallenge" || action === "origin" || action === "attest"
          ? createRoomNativeSourceAdapter({ environmentId: engine.store.environmentId, admission: nativeAdmissionOwner, signer: roomAttestationSigner, thread: id => assistant.threadBinding(id) })(action, input, authorized)
          : roomDelegationTarget(action, input, authorized),
        social,
        peers: socialPeers,
        conversation: conversationAccess,
        runtimeLogs: runtimeLogAccess,
        terminalLogs,
        desktop: conversationDesktop,
        desktopControl,
        assistantName: () => assistant.identityName(),
        assistantPresence: () => assistant.nativePresenceStatus(),
        visibilityEpoch: async () => ({ epoch: visibilityFence.currentEpoch() }),
        observationsIngest: async raw => {
          const envelope = z.strictObject({ operationJson: z.string().max(32768), proof: z.unknown() }).parse(raw);
          const operation = nativeObservationOperation.parse(JSON.parse(envelope.operationJson));
          const proof = envelope.proof as import("./assistant/native/assistant-native-admission").NativeAdmissionProof;
          if (operation.hostId !== engine.store.environmentId || proof?.challenge?.installationId !== operation.installationId) throw new Error("Native observation source changed.");
          const revision = await nativeAdmissionOwner.consume({ installationId: operation.installationId, hostId: engine.store.environmentId, action: "assistant.observations.ingest", requestDigest: createHash("sha256").update(envelope.operationJson).digest("hex") }, proof);
          const projects = await engine.store.projects();
          const scopes = operation.entries.flatMap(entry => {
            const project = entry.sourceCwd ? projects.find(project => project.cwd === entry.sourceCwd) : undefined;
            return project ? [{ projectId: project.id, cwd: project.cwd }] : [];
          });
          return nativeAdmissionOwner.withEffect(operation.installationId, revision, lease => engine.store.withProjectIdentityRead(scopes, projectValid => ingestNativeObservations({ store: engine.store, journal: observationJournal, operation, verifiedHostId: engine.store.environmentId, verifiedInstallationId: operation.installationId, valid: () => lease.valid() && projectValid(), resolve: async cwd => {
            const project = scopes.find(project => project.cwd === cwd);
            return project ? { projectId: project.projectId, valid: () => lease.valid() && projectValid() } : null;
          }, resolvePersonal: async () => ({ valid: () => lease.valid() && projectValid() }) })));
        },
        browserPanel: retainBrowserResult ? async raw => {
          const params = NativeAssistantBrowserPanelParamsSchema.parse(raw);
          if (!params.projectCwd || params.projectCwd.length > 4096 || params.projectCwd.includes("\u0000")) throw new Error("Invalid Room browser project path.");
          if (params.environmentId !== engine.store.environmentId) throw new Error("Room browser Host changed.");
          const thread = await assistant.threadBinding(params.threadId);
          if (!thread || (thread.projectId && thread.projectId !== params.projectId)) throw new Error("Room browser source changed.");
          if ((await engine.store.project(params.projectId)).cwd !== params.projectCwd) throw new Error("Room browser project changed.");
          const { requestId: inputRequestId, takeover, ...input } = params.input;
          if (params.action === "browser.input" && inputRequestId !== params.requestId) throw new Error("Original browser input identity changed.");
          if (takeover !== undefined && (params.action !== "browser.claim" || typeof takeover !== "boolean")) throw new Error("Invalid browser control request.");
          // The native panel echoes its current lease on status/claim. It is
          // not a target override and does not grant control for either read.
          if (params.action === "browser.status" || params.action === "browser.claim") delete input.leaseId;
          validateConversationTool(params.action, input);
          const deviceHash = createHash("sha256").update(token).digest("hex");
          const authorized = async () => !!(await engine.store.authenticated(token)) && !!(await assistant.threadBinding(params.threadId));
          const call = { threadId: params.threadId, projectId: params.projectId, family: "conversation" as const, action: params.action, input, requestId: params.requestId };
          return retainBrowserResult(async publish => withRoomProjectScope(call, authorized, async (valid, captured) => {
            if (captured.projectCwd !== params.projectCwd) throw new Error("Room browser project changed during qualification.");
            const rawResult = await roomBrowser.call(params.action, input, { environmentId: params.environmentId, projectId: params.projectId, projectCwd: captured.projectCwd, threadId: params.threadId, deviceHash }, params.requestId, async () => valid() && await authorized() && valid(), { takeover: takeover === true });
            let value = rawResult;
            if (params.action === "browser.input") {
              const receipt = rawResult as { state?: string; result?: object };
              if (receipt.state !== "completed" || !receipt.result) throw new Error(`Browser input outcome is unknown. Original operation: ${params.requestId}. Check its status; do not resend it.`);
              value = { ...receipt.result, operationId: params.requestId };
            }
            await publish(value, valid);
          }, deviceHash));
        } : undefined,
        authorizeAssistantNotification: input => assistant.authorizeObservedNotification(input, createHash("sha256").update(token).digest("hex")),
        authorizeAssistantWorkspace: input => assistantWorkspaceOwner.authorize(
          { ...input, environmentId: engine.store.environmentId },
          createHash("sha256").update(token).digest("hex"),
        ),
        visibilityRevoke: async () => {
          const drained = visibilityFence.revokeAll();
          const epoch = visibilityFence.currentEpoch();
          return nativeVoiceLeases.retireAll(retireNativeVoiceGenerations, async valid => {
            await drained;
            if (!valid()) throw new Error("Native voice closure is not confirmed.");
            return { epoch };
          });
        },
        visibilityReopen: (input, authorized) => visibilityAdmission.reopen(input, authorized),
        setAssistantPresence: async (state) => {
          await assistant.request({ op: "presence.set", state }, "owner");
        },
        workspace,
        inHost,
        desktopProjectCwd: (id) => desktop.projectCwdAsync(id),
        describe: mcpBridgeMetadata,
      },
      createHash("sha256").update(token).digest("hex"),
      () => engine.store.authenticated(token),
    );
  const nativeDeliveryOwner = (token: string) =>
    bindNativeDeliveryOwner(
      {
        store: engine.store,
        journal: nativeDeliveryJournal,
        workspaceOwner: requestWorkspaceOwner(token),
        services: nativeServicesOwner(token),
      },
      createHash("sha256").update(token).digest("hex"),
      () => engine.store.authenticated(token),
    );
  const nativeBufferUploads = createNativeBufferUploadService({
    environmentId: engine.store.environmentId,
    platform: nativeBufferUploadPlatform,
    update: (params, context) =>
      nativeWorkspacesService.call("native.buffers.update", params, context),
    deliver: (identity, paramsJson, context) =>
      nativeDeliveryService.call(
        "native.buffers.delivery.apply",
        { ...identity, paramsJson },
        context,
      ),
  });
  const domainDispatcher = createHostDispatcher({
    environmentId: engine.store.environmentId,
    environment: environmentService,
    projects: projectsService,
    operations: {
      "assistant.request": assistantDomain(assistant, engine.store),
      "desktop.request": desktopControlDomain(desktopControl, engine.store),
      "desktop.helper.request": desktopHelperDomain(desktopHelper, engine.store),
      ...Object.fromEntries(
        NATIVE_DELIVERY_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeDeliveryService.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        [
          ...NATIVE_DEVICE_METHODS,
          ...DEVICE_LIFECYCLE_METHODS,
          ...MOBILE_DEVICE_PREVIEW_METHODS,
        ].map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeDevicesService.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_SERVICE_UPLOAD_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeServiceUploads.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_SERVICE_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeServicesService.call(method, params, context),
        ]),
      ),
      "models.list": modelsService.list,
      ...Object.fromEntries(
        NATIVE_BUFFER_UPLOAD_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeBufferUploads.call(method, params, context),
        ]),
      ),
      ...Object.fromEntries(
        NATIVE_WORKSPACE_METHODS.map((method) => [
          method,
          (params: Record<string, unknown>, context: HostDomainContext) =>
            nativeWorkspacesService.call(method, params, context),
        ]),
      ),
      "crews.list": crewOperation("crews.list"),
      "crews.schema": crewOperation("crews.schema"),
      "crews.inspect": crewOperation("crews.inspect"),
      "crews.save": crewOperation("crews.save"),
      "crews.delete": crewOperation("crews.delete"),
      "crews.deleteRun": crewOperation("crews.deleteRun"),
      "crews.agent.save": crewOperation("crews.agent.save"),
      "crews.agent.delete": crewOperation("crews.agent.delete"),
      "crews.start": crewOperation("crews.start"),
      "crews.get": crewOperation("crews.get"),
      "crews.assign": crewOperation("crews.assign"),
      "crews.request": crewOperation("crews.request"),
      "crews.resolve": crewOperation("crews.resolve"),
      "crews.respond": crewOperation("crews.respond"),
      "crews.answer": crewOperation("crews.answer"),
      "crews.pause": crewOperation("crews.pause"),
      "crews.stop": crewOperation("crews.stop"),
      "crews.resume": crewOperation("crews.resume"),
      "crews.accept": crewOperation("crews.accept"),
      "crews.finish": crewOperation("crews.finish"),
      "sessions.list": sessionService.list,
      "sessions.page": sessionService.page,
      "sessions.sync": sessionService.sync,
      "sessions.get": sessionService.get,
      "sessions.block": sessionService.block,
      "sessions.syncChunk": sessionService.syncChunk,
      "commands.status": commandService.status,
      "commands.dispatch": commandService.dispatch,
      "sessions.queue.get": queueOperation("get"),
      "sessions.queue.change": queueOperation("change"),
      "sessions.queue.claim": queueOperation("claim"),
      "sessions.queue.finish": queueOperation("finish"),
      "sessions.queue.release": queueOperation("release"),
      "sessions.queue.lease": queueOperation("lease"),
      "files.read": fileService.read,
      "files.list": fileService.list,
      "files.index": fileService.index,
      "files.search": fileService.search,
      "files.searchContent": fileService.searchContent,
      "files.create": fileService.create,
      "files.write": fileService.write,
      "sprints.list": sprintsService.list,
      "sprints.get": sprintsService.get,
      "sprints.create": sprintsService.create,
      "sprints.update": sprintsService.update,
      "sprints.start": sprintsService.start,
      "sprints.complete": sprintsService.complete,
      "sprints.archive": sprintsService.archive,
      "sprints.plan": sprintsService.plan,
      "sprints.report": sprintsService.report,
      "sprints.ingest": sprintsService.ingest,
      "sprints.goalContext": sprintsService.setGoalContext,
      "automations.list": automationsService.list,
      "automations.preview": automationsService.preview,
      "automations.save": automationsService.save,
      "automations.delete": automationsService.delete,
      "automations.runs": automationsService.runs,
      "automations.runNow": automationsService.runNow,
      "devServers.list": devServersService.list,
      "devServers.details": devServersService.details,
      "devServers.start": devServersService.start,
      "devServers.stop": devServersService.stop,
      "devServers.kill": devServersService.kill,
      "devServers.restart": devServersService.restart,
      "devServers.logs": devServersService.logs,
      "devServers.openExternal": devServersService.openExternal,
      "devServers.bridgeCheck": devServersService.bridgeCheck,
      "devServers.bridgeOpen": devServersService.bridgeOpen,
      "devServers.bridgeRead": devServersService.bridgeRead,
      "devServers.bridgeWrite": devServersService.bridgeWrite,
      "devServers.bridgeClose": devServersService.bridgeClose,
      "goals.list": goalsService.list,
      "goals.create": goalsService.create,
      "goals.finalReview.recheck": goalsService.recheckFinalReview,
      "goals.approve": goalsService.approve,
      "goals.update": goalsService.update,
      "goals.replan": goalsService.replan,
      "goals.cancel": goalsService.cancel,
      "goals.delete": goalsService.delete,
      "stewards.list": stewardsService.list,
      "stewards.save": stewardsService.save,
      "stewards.delete": stewardsService.delete,
      "stewards.runNow": stewardsService.runNow,
      "stewards.decline": stewardsService.decline,
      "tasks.snapshotWithCursor": tasksService.snapshotWithCursor,
      "tasks.events": tasksService.events,
      "tasks.list": tasksService.list,
      "tasks.save": tasksService.save,
      "tasks.move": tasksService.move,
      "tasks.start": tasksService.start,
      "tasks.reorder": tasksService.reorder,
      "tasks.retarget": tasksService.retarget,
      "tasks.review.recheck": tasksService.recheckReview,
      "tasks.notes.read": tasksService.readNotes,
      "tasks.notes.resolve": tasksService.resolveNote,
      "tasks.delete": tasksService.delete,
      "tasks.preflight": tasksService.preflight,
      "tasks.evaluation.save": tasksService.recordEvaluation,
      "projects.directory": projectsService.directory,
      "projects.browse": projectsService.browse,
      "projects.createDirectory": projectsService.createDirectory,
      "projects.open": projectsService.open,
      "notes.list": notesService.list,
      "notes.get": notesService.get,
      "notes.upsert": notesService.upsert,
      "notes.delete": notesService.delete,
      "git.diff": gitService.diff,
      "git.branches": gitService.branches,
      "git.switch": gitService.switch,
      "git.createBranch": gitService.createBranch,
      "git.worktrees": gitService.worktrees,
      "git.worktreeCreate": gitService.worktreeCreate,
      "git.index": gitService.index,
      "git.fileDiff": gitService.fileDiff,
      "git.action": gitService.action,
      "terminals.list": terminalService.list,
      "terminals.create": terminalService.create,
      "terminals.read": terminalService.read,
      "terminals.write": terminalService.write,
      "terminals.interrupt": terminalService.interrupt,
      "terminals.close": terminalService.close,
      "environment.persistence.status": persistenceService.status,
      "environment.persistence.recover": persistenceService.recover,
    },
  });
  const bulkTransfers = new HostBulkTransfers({ environmentId: engine.store.environmentId });
  const previousTaskDelete = tasks.onDelete;
  const taskDeleted: NonNullable<typeof tasks.onDelete> = (task) => {
    for (const key of taskBulkDeleteKeys(task)) bulkTransfers.invalidate(key);
    previousTaskDelete?.(task);
  };
  tasks.onDelete = taskDeleted;
  const previousGoalDelete = goals.onDelete;
  const goalDeleted: NonNullable<typeof goals.onDelete> = (goal) => {
    for (const key of goalBulkDeleteKeys(goal)) bulkTransfers.invalidate(key);
    previousGoalDelete?.(goal);
  };
  goals.onDelete = goalDeleted;
  const previousAutomationDelete = automations.onDelete;
  const automationDeleted: NonNullable<typeof automations.onDelete> = (automation) => {
    for (const key of automationBulkDeleteKeys(automation)) bulkTransfers.invalidate(key);
    previousAutomationDelete?.(automation);
  };
  automations.onDelete = automationDeleted;
  const previousStewardDelete = stewards.onDelete;
  const stewardDeleted: NonNullable<typeof stewards.onDelete> = (steward) => {
    for (const key of stewardBulkDeleteKeys(steward)) bulkTransfers.invalidate(key);
    previousStewardDelete?.(steward);
  };
  stewards.onDelete = stewardDeleted;
  const previousCrewDefinitionDeleted = crews.onDefinitionDeleted;
  const crewDefinitionDeleted: NonNullable<typeof crews.onDefinitionDeleted> = (change) => {
    for (const key of crewDefinitionBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewDefinitionDeleted?.(change);
  };
  crews.onDefinitionDeleted = crewDefinitionDeleted;
  const previousCrewAgentDeleted = crews.onAgentDeleted;
  const crewAgentDeleted: NonNullable<typeof crews.onAgentDeleted> = (change) => {
    for (const key of crewAgentBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewAgentDeleted?.(change);
  };
  crews.onAgentDeleted = crewAgentDeleted;
  const previousCrewRunDeleted = crews.onRunDeleted;
  const crewRunDeleted: NonNullable<typeof crews.onRunDeleted> = (change) => {
    for (const key of crewRunBulkDeleteKeys(change)) bulkTransfers.invalidate(key);
    return previousCrewRunDeleted?.(change);
  };
  crews.onRunDeleted = crewRunDeleted;
  hostNotes.onDelete = (note) => {
    for (const key of noteBulkDeleteKeys(note)) bulkTransfers.invalidate(key);
  };
  const authenticateDevice = async (token: string) =>
    (await engine.store.authenticated(token))
      ? createHash("sha256").update(token).digest("hex")
      : null;
  const bulkHandler = createHostBulkHandler({
    transfers: bulkTransfers,
    authenticate: authenticateDevice,
  });
  const subscriptionHub = new HostSubscriptionHub({
    environmentId: engine.store.environmentId,
    load: async (target, principalId, signal, context) =>
      await engine.store.db.outsideScope(async () => {
        signal.throwIfAborted();
        pruneStreamVersions();
        const resource =
          target.kind === "session"
            ? `session:${target.sessionId}`
            : target.kind === "project"
              ? `project:${target.projectId}`
              : "environment";
        const lease = bulkTransfers.begin(principalId, resource);
        try {
          let value: unknown;
          let revision: number | undefined;
          let baseRevision: number | undefined;
          let sourceEpoch: string | undefined;
          let kind: "snapshot" | "delta" = "snapshot";
          if (target.kind === "environment") value = { projects: await projectsService.list() };
          else if (target.kind === "project") {
            streamProjectVersions.set(
              target.projectId,
              engine.store.projectVersion(target.projectId),
            );
            const current = await projectSessionList(target.projectId);
            value = { etag: current.etag, sessions: current.list };
          } else {
            if (
              !(await engine.store.withReadCancellation(signal, () => engine.store.sessionStateMetadata(target.sessionId))) &&
              !(await desktop.projectCwdAsync(target.sessionId, signal))
            )
              return null;
            const projectRow = await sessionRead(signal, () => engine.store.db
              .prepare("SELECT project_id FROM session_state WHERE id=?")
              .get(target.sessionId));
            const projectId = projectRow ? String(projectRow.project_id) : undefined;
            if (projectId) {
              streamProjects.set(target.sessionId, projectId);
              if (!streamProjectVersions.has(projectId))
                streamProjectVersions.set(projectId, engine.store.projectVersion(projectId));
            }
            const sync = await engine.store.db.withAuthorization(context.authorized, () =>
              sessionService.stream(
                { sessionId: target.sessionId, revision: context.revision, sourceEpoch: context.sourceEpoch },
                { authorized: context.authorized, signal },
              ),
            );
            sourceEpoch = sync.kind === "unchanged" ? sync.sourceEpoch : sync.value.sourceEpoch;
            if (sync.kind === "unchanged")
              return { kind: "unchanged" as const, revision: sync.revision, sourceEpoch: sync.sourceEpoch };
            if (sync.kind === "delta") {
              value = sync;
              kind = "delta";
              baseRevision = sync.base;
            } else value = sync.value;
            revision = sync.value.revision;
          }
          signal.throwIfAborted();
          const data = JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
          return {
            kind,
            revision,
            baseRevision,
            ...(sourceEpoch ? { sourceEpoch } : {}),
            data: bulkTransfers.encode(lease, data, WS_LIMITS.streamChunkBytes - 1024),
          };
        } finally {
          bulkTransfers.release(lease);
        }
      }),
  });
  const streamProjects = new Map<string, string>();
  const streamProjectVersions = new Map<string, number>();
  const pruneStreamVersions = () => {
    const targets = subscriptionHub.targets();
    const sessions = new Set(
      targets.flatMap((target) => (target.kind === "session" ? [target.sessionId] : [])),
    );
    for (const id of streamProjects.keys()) if (!sessions.has(id)) streamProjects.delete(id);
    const projects = new Set([
      ...targets.flatMap((target) => (target.kind === "project" ? [target.projectId] : [])),
      ...streamProjects.values(),
    ]);
    for (const id of streamProjectVersions.keys())
      if (!projects.has(id)) streamProjectVersions.delete(id);
  };
  let unattributedVersion = engine.store.unattributedChangeVersion;
  const unsubscribeChanges = engine.store.subscribeChanges(() => {
    const globalChange = unattributedVersion !== engine.store.unattributedChangeVersion;
    unattributedVersion = engine.store.unattributedChangeVersion;
    let attributed = false;
    for (const [projectId, version] of streamProjectVersions) {
      const current = engine.store.projectVersion(projectId);
      if (current === version) continue;
      attributed = true;
      streamProjectVersions.set(projectId, current);
      subscriptionHub.invalidate({ kind: "project", projectId });
      for (const [sessionId, project] of streamProjects)
        if (project === projectId) subscriptionHub.invalidate({ kind: "session", sessionId });
    }
    // A commit no project version explains (queue, approval, settings…) still
    // refreshes every stream, as before targeted invalidation.
    if (globalChange || !attributed) subscriptionHub.invalidate();
    else subscriptionHub.invalidate({ kind: "environment" });
  });
  const httpTokenHashes = new WeakMap<object, { token: string; hash: string }>();
  const heldPolls = new Map<{ revoked: boolean }, string>();
  const unsubscribeAuthorization = engine.store.subscribeAuthorizationChanges(() => {
    for (const [state, token] of heldPolls)
      void engine.store.authenticated(token).then(
        (valid) => {
          state.revoked = !valid;
          if (!valid) signal.notify();
        },
        () => {
          state.revoked = true;
          signal.notify();
        },
      );
  });
  const unsubscribeAuthority = engine.store.subscribeAuthorityChanges((change) => {
    invalidateSessionSource(change.sessionId);
    bulkTransfers.invalidate(`session:${change.sessionId}`);
    transfers.forget(change.sessionId);
    subscriptionHub.resnapshot({ kind: "session", sessionId: change.sessionId });
    if (change.projectId) {
      bulkTransfers.invalidate(`project:${change.projectId}`);
      subscriptionHub.resnapshot({ kind: "project", projectId: change.projectId });
    }
  });
  const previousDesktopChange = desktop.live.onChange;
  const previousDesktopSourceChange = desktop.live.onSourceChange;
  desktop.live.onSourceChange = (sessionIds) => {
    previousDesktopSourceChange?.(sessionIds);
    for (const sessionId of sessionIds) {
      invalidateSessionSource(sessionId);
      bulkTransfers.invalidate(`session:${sessionId}`);
      transfers.forget(sessionId);
      subscriptionHub.resnapshot({ kind: "session", sessionId });
    }
  };
  desktop.live.onChange = (sessionIds) => {
    previousDesktopChange?.(sessionIds);
    subscriptionHub.invalidate({ kind: "environment" });
    for (const sessionId of sessionIds) {
      subscriptionHub.invalidate({ kind: "session", sessionId });
      const projectId = streamProjects.get(sessionId);
      if (projectId) subscriptionHub.invalidate({ kind: "project", projectId });
    }
    // Desktop-only project membership can be outside the Host session store.
    for (const projectId of streamProjectVersions.keys())
      subscriptionHub.invalidate({ kind: "project", projectId });
  };
  const invalidateSessionCopies = (sessionId: string, projectId: string) => {
    subscriptionHub.forget({ kind: "session", sessionId });
    bulkTransfers.invalidate(`session:${sessionId}`);
    transfers.forget(sessionId);
    bulkTransfers.invalidate(`project:${projectId}`);
    subscriptionHub.resnapshot({ kind: "project", projectId });
  };
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
        if (request.url === "/native-authority/bootstrap" && controls?.nativeAuthorityBootstrap) {
          controls.nativeAuthorityBootstrap(request, response);
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        let dispatchStarted: number | undefined;
        let dispatchMethod: unknown;
        let deviceEffectAdmitted = false;
        let releaseVoiceTool: (() => void) | undefined;
        let voiceDisclosure: HostVoiceToolDisclosure | undefined;
        let voiceBrowserOwner: string | undefined;
        const resultScopeReleases: Array<() => void> = [];
        const resultScopeSettlements: Promise<void>[] = [];
        let voiceToolLog:
          | { action: string; requestId: string | null; startedAt: number; outcome: string }
          | undefined;
        try {
          if (await bulkHandler(request, response)) return;
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
          let token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
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
          let tokenIdentity = httpTokenHashes.get(request.socket);
          if (tokenIdentity?.token !== token) {
            tokenIdentity = { token, hash: createHash("sha256").update(token).digest("hex") };
            httpTokenHashes.set(request.socket, tokenIdentity);
          }
          const tokenHash = tokenIdentity.hash;
          const pollState = { revoked: false };
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
          let params =
            input.params && typeof input.params === "object" && !Array.isArray(input.params)
              ? (input.params as Record<string, unknown>)
              : {};
          const transportToken = token;
          const resultAuthorities: Array<() => Promise<boolean>> = [];
          const domainContext = {
            deviceEffectAdmitted: () => {
              deviceEffectAdmitted = true;
            },
            nativeDevices: nativeDevicesOwner(token),
            nativeDelivery: nativeDeliveryOwner(token),
            retainResultAuthority: (check: () => Promise<boolean>) => {
              resultAuthorities.push(check);
            },
            nativeServices: nativeServicesOwner(token, read => {
              let resolveReady!: (value: unknown) => void;
              let rejectReady!: (reason: unknown) => void;
              const ready = new Promise<unknown>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
              let release!: () => void;
              const released = new Promise<void>(resolve => { release = resolve; });
              let published = false;
              const settled = read(async (value, valid) => {
                if (published) throw new Error("Native browser result was already published.");
                published = true;
                resultAuthorities.push(async () => valid());
                resolveReady(value);
                await released;
              });
              resultScopeReleases.push(release);
              resultScopeSettlements.push(settled);
              void settled.then(() => { if (!published) rejectReady(new Error("Native browser result is unavailable.")); }).catch(rejectReady);
              return ready;
            }),
            workspaceOwner: requestWorkspaceOwner(token),
            principalId: tokenHash,
            devServerAccess: (
              method: string,
              params: Record<string, unknown>,
              authorize: () => Promise<void>,
            ) => devServerAccess.handle(method, params, transportToken, authorize),
            retargetTask: (id: string, target: unknown, autoMerge: unknown) =>
              withWorkspaceOwner(transportToken, (owner) =>
                tasks.retarget(id, target, autoMerge, owner),
              ),
            authorized: async () => await engine.store.authenticated(transportToken),
            closing: () => closing || response.destroyed,
          };
          // Scope the timer to dispatch, including all early returns and failures.
          // Never retain input/params or error contents in the metrics collector.
          dispatchStarted = performance.now();
          dispatchMethod = input.method;
          let result: unknown;
          const endResult = async (value: unknown, verify?: () => Promise<void>, awaitWrite = false) => {
            const inline = serializedResponse(value);
            const body = voiceDisclosure
              ? await voiceDisclosure.body(value)
              : inline === undefined
                ? JSON.stringify({ result: value })
                : `{"result":${inline}}`;
            await verify?.();
            if (awaitWrite || voiceDisclosure) {
              await new Promise<void>((resolve, reject) => {
                const closed = () => { cleanup(); reject(new Error("Response closed before write completed.")); };
                const failed = (error: Error) => { cleanup(); reject(error); };
                const cleanup = () => { response.off("close", closed); response.off("error", failed); };
                response.once("close", closed);
                response.once("error", failed);
                response.end(body, () => {
                  try { voiceDisclosure?.markSent(); cleanup(); resolve(); }
                  catch (error) { cleanup(); reject(error); }
                });
              });
            } else response.end(body);
          };
          if (input.method === "assistant.request" && (params.op === "observation.delivery.list" || params.op === "observation.delivery.refresh")) {
            if (request.headers.origin || peerIdentity || socialPrincipal || runtimePrincipal || conversationPrincipal) throw new Error("Native owner device required for notification recovery.");
            const ownerToken = token;
            if (!ownerToken) throw new Error("Native owner device required for notification recovery.");
            const recovery = AssistantRequestValidationSchema.parse(params);
            if (recovery.op !== "observation.delivery.list" && recovery.op !== "observation.delivery.refresh") throw new Error("Invalid notification recovery request.");
            const room = await assistant.canonicalGlobalRoomBinding();
            const ownerAuthorized = async () => await engine.store.authenticated(ownerToken);
            const authorized = async () => !!room && (await assistant.canonicalGlobalRoomBinding())?.id === room.id && await ownerAuthorized() && await assistantPorts.manualProjectVisible?.(recovery.projectId) === true;
            if (!room || !(await authorized())) throw new Error("Notification recovery source is unavailable.");
            const target = { threadId: room.id, projectId: recovery.projectId, family: "conversation" as const, action: recovery.op, input: recovery.op === "observation.delivery.refresh" ? { notificationId: recovery.notificationId } : {}, requestId: randomUUID() };
            await withRoomProjectScope(target, authorized, async (valid, source) => {
              let rows: { notificationId: string; projectId: string; state: "pending" | "unknown" | "accepted" | "suppressed" }[];
              if (recovery.op === "observation.delivery.list") rows = await assistant.observedNotificationRecovery(recovery.projectId);
              else {
                const intent = await assistant.observedNotificationIntent(recovery.notificationId);
                if (!intent || intent.projectId !== recovery.projectId || intent.threadId !== room.id || intent.deviceHash !== source.deviceHash) throw new Error("Reconnect the original notification device to check its status.");
                const requestId = `observation-${intent.operationHash}`;
                const nativeInput = { notificationId: intent.notificationId, kind: intent.kind, requestId, operationHash: intent.operationHash, projectCwds: [source.projectCwd] };
                const captured = await conversationDesktop.callAssistantThread("assistant.notification.status", nativeInput, { threadId: room.id, environmentId: engine.store.environmentId, targetDeviceHash: intent.deviceHash }, authorized) as { relayId: string; envelope: unknown };
                const receipt = await verifyAssistantNotificationReceipt(nativeAdmissionOwner, captured, { environmentId: engine.store.environmentId, threadId: room.id, notificationId: intent.notificationId, kind: intent.kind, requestId, operationHash: intent.operationHash }, authorized);
                if (receipt.state !== "unknown") await assistant.settleObservedNotification(intent, receipt.state);
                rows = [{ notificationId: intent.notificationId, projectId: intent.projectId, state: receipt.state === "unknown" ? "unknown" : receipt.state }];
              }
              if (!valid()) throw new Error("Notification recovery scope changed.");
              await endResult(AssistantResponseValidationSchema.parse({ observationDeliveries: rows }), async () => { if (!valid() || !(await authorized())) throw new Error("Notification recovery authority changed."); }, true);
            });
            return;
          }
          if (await mcpHttp.rpc(input.method, params, token, response)) return;
          if (peerIdentity) {
            result = await engine.store.db.withAuthorization(
              async () => !!(await socialPeers.authenticated(transportToken)),
              () => socialPeers.peerRpc(peerIdentity, String(input.method), params),
            );
            if (!(await socialPeers.authenticated(token)))
              throw new Error("Peer authority revoked.");
            response.end(JSON.stringify({ result }));
            return;
          }
          if (input.method === "voice.tools.list" || input.method === "voice.tools.call") {
            // Voice is an owner-started desktop surface, never an escalation route
            // for a provider, social peer or browser-origin request.
            if (
              request.headers.origin ||
              socialPrincipal ||
              runtimePrincipal ||
              conversationPrincipal ||
              !(await engine.store.authenticated(token))
            )
              throw new Error("Native owner device required for voice tools.");
            const ownerToken = token;
            if (input.method === "voice.tools.list") {
              validateVoiceToolList(params);
              const project = params.projectId === undefined
                ? undefined
                : await engine.store.project(String(params.projectId));
              if (!project) {
                const thread = await assistant.threadBinding(String(params.threadId));
                if (!thread || thread.id !== params.threadId || thread.projectId)
                  throw new Error("A verified global assistant thread is required.");
              }
              if (params.sessionId !== undefined) {
                const own = await featureMeta(String(params.sessionId));
                if (!project || own.projectId !== project.id)
                  throw new Error("Voice tool session belongs to another project.");
              }
              if (!(await engine.store.authenticated(ownerToken)))
                throw new Error("Native owner authority revoked.");
              const tools = voiceToolCatalog().filter(tool => params.sessionId === undefined || tool.family !== "conversation" || !isRoomOnlyConversationAction(tool.action));
              response.end(JSON.stringify({ result: { tools } }));
              return;
            }
            const call = parseVoiceToolCall(params);
            voiceToolLog = {
              action: call.action,
              requestId: call.requestId ?? null,
              startedAt: monotonicNow(),
              outcome: "response",
            };
            console.info("Voice tool started", {
              action: voiceToolLog.action,
              requestId: voiceToolLog.requestId,
            });
            if (call.causalContextId) {
              voiceDisclosure = new HostVoiceToolDisclosure(
                {
                  authorized: async () =>
                    !response.destroyed && (await engine.store.authenticated(ownerToken)),
                  begin: (input) => assistant.beginVoiceToolDisclosure(input),
                  finish: (id, source) => assistant.finishVoiceToolDisclosure(id, source),
                  fail: (id) => assistant.failVoiceToolDisclosure(id),
                },
                serializedResponse,
              );
              await voiceDisclosure.begin(call.causalContextId, call.requestId!);
              response.once("close", () => {
                void voiceDisclosure?.fail().catch(() => undefined);
              });
            }
            if (!call.projectId && (call.family === "social" || (call.family === "conversation" && isAssistantObservationAction(call.action) && call.accountId))) {
              if (!call.causalContextId || !call.threadId || !call.requestId || !voiceDisclosure || !social.retireAssistantVoiceGenerations)
                throw new Error("Account-scoped voice disclosure is unavailable until the active voice generation can be revoked.");
              const authorized = async () => !response.destroyed && !!(await engine.store.authenticated(ownerToken));
              const admission = { environmentId: engine.store.environmentId, deviceHash: tokenHash, authorized };
              const generation = await assistant.pendingVoiceGeneration(call.causalContextId, call.requestId, call.threadId);
              const qualifiedCall = { threadId: call.threadId, ...(call.accountId ? { accountId: call.accountId } : {}), family: call.family, action: call.action, input: call.input, requestId: call.requestId };
              voiceDisclosure.bind({ threadId: call.threadId, ...(call.accountId ? { accountId: call.accountId } : {}), family: call.family, action: call.action });
              const output = await assistantPorts.roomManagement!(qualifiedCall, admission);
              const proofs = output.contributorAccounts;
              if (!proofs || (call.accountId && !proofs.some(proof => proof.accountId === call.accountId))) throw new Error("Room account provenance is unavailable.");
              voiceDisclosure.bindAccountProofs(proofs);
              await social.withAssistantAccountProofs(call.threadId, proofs, authorized, async valid => {
                if (proofs.length) await social.registerAssistantVoiceLease({ threadId: call.threadId!, generationKey: generation.generationKey, deviceHash: tokenHash, accounts: proofs }, valid);
                if (!valid()) throw new Error("Room account scope revoked.");
                await endResult(output.value, async () => { if (!(await authorized())) throw new Error("Native owner authority revoked."); }, true);
                await assistantPorts.roomObservationDelivered?.(call.threadId!, [{ source: output.source, value: output.value }], proofs, valid);
              });
              return;
            }
            if (call.family === "conversation" && isAssistantObservationAction(call.action) && (call.input.nativeLibrary === true || call.input.source === "native-session")) {
              const nativeSession = call.input.source === "native-session";
              if (!call.threadId || !call.requestId || !call.causalContextId || !voiceDisclosure || call.accountId || (nativeSession ? !call.projectId : !!call.projectId)) throw new Error("Native observation voice disclosure requires the original Room and active voice generation.");
              const authorized = async () => !response.destroyed && !!(await engine.store.authenticated(ownerToken));
              const admission = { environmentId: engine.store.environmentId, deviceHash: tokenHash, authorized };
              const qualifiedCall = { threadId: call.threadId, ...(call.projectId ? { projectId: call.projectId } : {}), family: "conversation" as const, action: call.action, input: call.input, requestId: call.requestId };
              const generation = await assistant.pendingVoiceGeneration(call.causalContextId, call.requestId, call.threadId);
              voiceDisclosure.bind({ threadId: call.threadId, ...(call.projectId ? { projectId: call.projectId } : {}), family: call.family, action: call.action, nativeLibrary: true });
              const output = await assistantPorts.roomManagement!(qualifiedCall, admission);
              const nativeProofs = output.contributorNativeProofs;
              if (!nativeProofs?.length) throw new Error("Native library provenance is unavailable.");
              voiceDisclosure.bindNativeProofs(nativeProofs);
              const projectProofs = output.contributorProjects ?? [];
              if (nativeSession && !projectProofs.some(proof => proof.projectId === call.projectId)) throw new Error("Native session project provenance is unavailable.");
              if (projectProofs.length) voiceDisclosure.bindProjectProofs(projectProofs);
              await assistantPorts.withNativeVoiceRuntimeRegistration!({ threadId: call.threadId, generationKey: generation.generationKey, nativeProofs, projectProofs, accountProofs: [] }, admission, async valid => {
                if (!valid()) throw new Error("Native library scope revoked.");
                await endResult(output.value, async () => { if (!(await authorized()) || !valid()) throw new Error("Native owner authority revoked."); }, true);
                  await assistantPorts.roomObservationDelivered?.(call.threadId!, [{ source: output.source, value: output.value }], [], valid, projectProofs, nativeProofs);
              });
              return;
            }
            if (call.family === "conversation" && isAssistantObservationAction(call.action)) {
              if (!call.threadId || !call.requestId || (!!call.projectId === !!call.accountId))
                throw new Error("Choose one verified observation scope and a Room thread.");
              const authorized = async () => !response.destroyed && !!(await engine.store.authenticated(ownerToken));
              const admission = { environmentId: engine.store.environmentId, deviceHash: tokenHash, authorized };
              const qualifiedCall = { threadId: call.threadId, ...(call.projectId ? { projectId: call.projectId } : {}), ...(call.accountId ? { accountId: call.accountId } : {}), family: "conversation" as const, action: call.action, input: call.input, requestId: call.requestId };
              voiceDisclosure?.bind({ threadId: call.threadId, ...(call.projectId ? { projectId: call.projectId } : {}), ...(call.accountId ? { accountId: call.accountId } : {}), family: call.family, action: call.action });
              const output = await assistantPorts.roomManagement!(qualifiedCall, admission);
              const send = () => endResult(output.value, async () => { if (!(await authorized())) throw new Error("Native owner authority revoked."); }, true);
              if (call.projectId) {
                voiceDisclosure?.bindProjectProofs(output.contributorProjects ?? []);
                const projectProofs = output.contributorProjects ?? [];
                const projects = [...new Set([call.projectId, ...projectProofs.map(proof => proof.projectId)])];
                await assistantPorts.withRoomProjectDisclosure!(call.threadId, projects, admission, async valid => {
                  if (!valid()) throw new Error("Room project scope revoked.");
                  await send();
                  await assistantPorts.roomObservationDelivered?.(call.threadId!, [{ source: output.source, value: output.value }], [], valid, projectProofs);
                }, projectProofs);
              }
              else {
                if (!output.contributorAccounts?.some(proof => proof.accountId === call.accountId)) throw new Error("Room account provenance is unavailable.");
                await social.withAssistantAccountProofs(call.threadId, output.contributorAccounts, authorized, async valid => { if (!valid()) throw new Error("Room account scope revoked."); await send(); });
              }
              return;
            }
            if (!call.projectId) {
              const authorizeGlobal = async () => {
                if (response.destroyed || !(await engine.store.authenticated(ownerToken))) return false;
                const thread = await assistant.threadBinding(call.threadId!);
                return !!thread && thread.id === call.threadId && !thread.projectId;
              };
              if (!voiceGlobalToolAllowed(call.family, call.action) || !(await authorizeGlobal()))
                throw new Error(
                  "A verified global assistant thread and supported global operation are required.",
                );
              voiceDisclosure?.bind({
                threadId: call.threadId,
                ...(call.accountId ? { accountId: call.accountId } : {}),
                family: call.family,
                action: call.action,
              });
              if (call.family === "social") {
                if (call.accountId) result = await executeAccountSocial({ ...call, threadId: call.threadId!, accountId: call.accountId, requestId: call.requestId! }, tokenHash, authorizeGlobal);
                else if (call.action === "accounts.list") result = await social.listAssistantAccounts(call.threadId!, tokenHash, call.input);
                else throw new Error("Choose an explicitly granted social account.");
              }
              else if (isRoomNotebookAction(call.action))
                result = await roomNotebook.call(
                  call.action,
                  call.input,
                  {
                    kind: "assistant-thread",
                    threadId: call.threadId!,
                    environmentId: engine.store.environmentId,
                  },
                  authorizeGlobal,
                  call.requestId!,
                );
              else if (isGlobalRuntimeRead(call.action))
                result = await conversationManagementRuntime.call(call.action as import("./conversation/conversation-management-runtime").RuntimeManagementAction, call.input, { kind: "assistant-thread", threadId: call.threadId!, environmentId: engine.store.environmentId }, authorizeGlobal);
              else if (call.action === "tools.list")
                result = { environmentId: engine.store.environmentId, tools: voiceToolCatalog() };
              else if (["tools.search", "tools.describe", "tools.status"].includes(call.action))
                result = managedDiscoveryResult(call.action, call.input, managedMcpCatalog());
              else if (["servers.list", "servers.get", "servers.ssh.execute", "servers.ssh.status", "servers.ssh.cancel"].includes(call.action))
                result = await conversationDesktop.callAssistantThread(call.action, call.input, { threadId: call.threadId!, environmentId: engine.store.environmentId }, authorizeGlobal);
              else if (call.action === "servers.ssh.save" || call.action === "servers.ssh.remove") {
                if (typeof call.input.operationId !== "string" || !call.input.operationId || typeof call.input.expectedInventoryRevision !== "string" || !/^[a-f0-9]{64}$/.test(call.input.expectedInventoryRevision))
                  throw new Error("Read the server inventory and provide its revision and a stable operationId.");
                result = await globalServerManagement.call(call.action, { requestId: call.input.operationId, serverInput: call.input }, { kind: "assistant-thread", threadId: call.threadId!, environmentId: engine.store.environmentId }, authorizeGlobal);
              }
              else {
                if (!isManagementAction(call.action)) throw new Error("Unsupported global assistant operation.");
                result = await globalAssistantManagement.call(call.action, call.input, {
                  kind: "assistant-thread", threadId: call.threadId!, environmentId: engine.store.environmentId,
                }, authorizeGlobal);
              }
              await endResult(result, async () => { if (!(await authorizeGlobal())) throw new Error("Native owner authority revoked."); });
              return;
            }
            if (call.threadId && !call.sessionId && !(call.family === "conversation" && call.action === "desktop.status")) {
              const inputRequestId = typeof call.input.requestId === "string" ? call.input.requestId : typeof call.input.operationId === "string" ? call.input.operationId : undefined;
              const readOnly = /(?:^|\.)(?:list|get|read|status|search|describe|inspect|runs|schema|sources)$/.test(call.action);
              if (!call.requestId && !inputRequestId && !readOnly) throw new Error("A stable Room operation identity is required.");
              const requestId = call.requestId ?? inputRequestId ?? randomUUID();
              // Normal completion retires the socket too. Preserve authority
              // through final lease settlement while rejecting premature close.
              const authorized = async () => (!response.destroyed || response.writableFinished) && !!(await engine.store.authenticated(ownerToken));
              const qualifiedCall = { threadId: call.threadId, projectId: call.projectId, family: call.family, action: call.action, input: call.input, requestId };
              voiceDisclosure?.bind({ threadId: call.threadId, projectId: call.projectId, family: call.family, action: call.action });
              const output = await assistantPorts.roomManagement!(qualifiedCall, { environmentId: engine.store.environmentId, deviceHash: tokenHash, authorized });
              voiceDisclosure?.bindProjectProofs(output.contributorProjects ?? []);
              await withRoomProjectScope(qualifiedCall, authorized, async () => {
                if (!output.source.projectCwd || (await engine.store.project(call.projectId!)).cwd !== output.source.projectCwd) throw new Error("Voice project identity changed before disclosure.");
                await endResult(output.value, async () => { if (!(await authorized())) throw new Error("Native owner authority revoked."); });
                if (!response.writableFinished) await new Promise<void>((resolve, reject) => {
                  response.once("finish", resolve);
                  response.once("close", () => response.writableFinished ? resolve() : reject(new Error("Voice response delivery is unknown.")));
                });
              });
              return;
            }
            const delegated = await prepareVoiceToolDispatch(params, {
              authorized: async () =>
                !response.destroyed && (await engine.store.authenticated(ownerToken)),
              environmentId: engine.store.environmentId,
              deviceHash: tokenHash,
              threadIdentity: (id) => assistant.threadBinding(id),
              sessionIdentity: async (sessionId) => {
                const own = await featureMeta(sessionId);
                await engine.store.project(own.projectId);
                return { projectId: own.projectId, provider: own.session.harness };
              },
              issuers: {
                conversation: conversationAccess,
                social,
                "runtime-logs": runtimeLogAccess,
              },
            });
            releaseVoiceTool = delegated.release;
            voiceDisclosure?.bind(delegated.source);
            voiceBrowserOwner = delegated.browserOwner;
            response.once("close", delegated.release);
            if (response.destroyed) {
              delegated.release();
              throw new Error("Voice tool connection closed.");
            }
            token = delegated.token;
            input.method = delegated.method;
            params = delegated.params;
            if (delegated.family === "conversation")
              conversationPrincipal = await conversationAccess.principalForToken(token);
            else if (delegated.family === "social")
              socialPrincipal = await social.principalForToken(token);
            else runtimePrincipal = await runtimeLogAccess.principalForToken(token);
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
            if (boundPrincipal.kind === "assistant-thread") {
              const action = String(params.action ?? "");
              const args = params.input as Record<string, unknown>;
              validateConversationTool(action, args);
              const authorized = async () => {
                const current = await conversationAccess.principalForToken(token);
                return (
                  current?.kind === "assistant-thread" &&
                  current.threadId === boundPrincipal.threadId &&
                  current.projectId === boundPrincipal.projectId
                );
              };
              result = await engine.store.db.withAuthorization(
                conversationAccess.authorization(token),
                async () => {
                  if (action === "tools.list")
                    return {
                      environmentId: engine.store.environmentId,
                      projectId: boundPrincipal.projectId,
                      tools: voiceToolCatalog().filter((tool) =>
                        voiceThreadToolAllowed(tool.family, tool.action),
                      ),
                    };
                  if (["tools.search", "tools.describe", "tools.status"].includes(action))
                    return managedDiscoveryResult(action, args, managedMcpCatalog());
                  if (action === "sessions.list") {
                    const { list } = await projectSessionList(boundPrincipal.projectId);
                    const page = conversationSessionPage(
                      list.map((row) => ({
                        id: row.id,
                        title: row.title,
                        harness: row.harness,
                        model: row.model,
                        busy: row.status === "running",
                        hasDraft: !!row.draft,
                        updatedAt: row.updatedAt,
                        lastActivityAt:
                          row.runActivity?.lastActivityAt ?? row.lastActivityAt ?? null,
                        runActivity: row.runActivity ?? null,
                      })),
                      args,
                    );
                    return {
                      ...page,
                      sessions: await Promise.all(
                        page.sessions.map(async (row) => {
                          const locator = await localSessionReference(row.id);
                          return {
                            ...row,
                            ...(locator ? localSessionLinkFields(locator, row.title) : {}),
                          };
                        }),
                      ),
                    };
                  }
                  if (action === "sessions.read") {
                    const target = await featureSession(String(args.sessionId));
                    if (target.projectId !== boundPrincipal.projectId)
                      throw new Error("Conversation belongs to another project.");
                    return sessionConversationPage(
                      { ...target.session, busy: target.status === "running" },
                      args,
                      await localSessionReference(target.session.id),
                    );
                  }
                  if (isRoomNotebookAction(action))
                    return roomNotebook.call(action, args, { kind: "assistant-thread", threadId: boundPrincipal.threadId, environmentId: engine.store.environmentId }, authorized, String(params.requestId));
                  if (isRoomWorkspaceAction(action))
                    return roomWorkspace.call(action, validateRoomWorkspaceAction(action, args, String(params.requestId)), boundPrincipal, authorized);
                  if (threadCrewAction(action))
                    return conversationThreadCrews.call(action, args, boundPrincipal, authorized);
                  if (THREAD_WORK_ACTIONS.has(action))
                    return conversationThreadWork.call(
                      action,
                      args,
                      boundPrincipal,
                      authorized,
                      typeof params.requestId === "string" ? params.requestId : undefined,
                    );
                  if (isManagementAction(action))
                    return conversationManagement.call(action, args, boundPrincipal, authorized);
                  if (isDesktopControlConversationTool(action))
                    return conversationDesktopControl.call(
                      action,
                      args,
                      boundPrincipal,
                      (await engine.store.project(boundPrincipal.projectId)).cwd,
                      authorized,
                    );
                  if (/^(notes|inbox)\./.test(action))
                    return conversationWorkspace.call(
                      action as ConversationTool,
                      args,
                      boundPrincipal,
                      undefined,
                      authorized,
                    );
                  if (action === "host.limits.status" || action === "shell.profiles")
                    return conversationRuntimeReads.call(action, args, boundPrincipal, authorized);
                  throw new Error("Choose a focused session before using this conversation tool.");
                },
              );
              if (!(await authorized())) throw new Error("Conversation authority revoked.");
              await endResult(result, async () => {
                if (!(await authorized())) throw new Error("Conversation authority revoked.");
              });
              return;
            }
            return await engine.store.db.withAuthorization(
              conversationAccess.authorization(token),
              async () => {
                const action = String(params.action ?? "");
                const originalArgs = params.input as Record<string, unknown>;
                validateSessionConversationTool(action, originalArgs);
                const args = conversationListArguments(action, originalArgs);
                const scopedDeviceAuthorized = async () => {
                  const current = await conversationAccess.principalForToken(token);
                  return (
                    !!current &&
                    current.sessionId === boundPrincipal.sessionId &&
                    current.projectId === boundPrincipal.projectId
                  );
                };
                const scopedDeviceEffect = { authorized: scopedDeviceAuthorized };
                const projectId = boundPrincipal.projectId;
                const project = await engine.store.project(projectId);
                if (isManagementAction(action)) {
                  result = await conversationManagement.call(
                    action,
                    args,
                    boundPrincipal,
                    scopedDeviceAuthorized,
                  );
                } else if (isDesktopControlConversationTool(action)) {
                  const cwd = sessionWorkCwd((await featureMeta(boundPrincipal.sessionId)).session);
                  result = await conversationDesktopControl.call(
                    action,
                    args,
                    boundPrincipal,
                    cwd,
                    scopedDeviceAuthorized,
                  );
                } else if (action === "sessions.list" || action === "sessions.read") {
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
                    const page = conversationSessionPage(
                      list.map((row) => ({ ...row, busy: row.status === "running" })),
                      args,
                    );
                    if (!(await conversationAccess.principalForToken(token)))
                      throw new Error("Session authority revoked.");
                    result = {
                      cwd: project.cwd,
                      total: page.total,
                      nextCursor: page.nextCursor,
                      state: page.state,
                      sessions: await Promise.all(
                        page.sessions.map(async (session) => {
                          const locator = await localSessionReference(session.id);
                          return {
                            id: session.id,
                            title: session.title,
                            harness: session.harness,
                            model: session.model,
                            busy: session.status === "running",
                            hasDraft: !!session.draft,
                            updatedAt: session.updatedAt,
                            lastActivityAt:
                              session.runActivity?.lastActivityAt ?? session.lastActivityAt ?? null,
                            runActivity: session.runActivity ?? null,
                            ...(locator ? localSessionLinkFields(locator, session.title) : {}),
                          };
                        }),
                      ),
                    };
                  } else {
                    const target = await featureSession(String(args.sessionId));
                    if (target.projectId !== projectId)
                      throw new Error("Conversation belongs to another project");
                    result = sessionConversationPage(
                      { ...target.session, busy: target.status === "running" },
                      args,
                      await localSessionReference(target.session.id),
                    );
                  }
                  if (!(await scopedDeviceAuthorized()))
                    throw new Error("Session authority revoked.");
                } else if (action === "skills.search")
                  result = await searchHarnessSkills(
                    sessionWorkCwd((await featureMeta(boundPrincipal.sessionId)).session),
                    args,
                    undefined,
                    boundPrincipal.sessionId,
                    await explicitSkillNames(boundPrincipal.sessionId),
                    (await featureMeta(boundPrincipal.sessionId)).session.harness,
                  );
                else if (action === "skills.read")
                  result = await readHarnessSkill(
                    sessionWorkCwd((await featureMeta(boundPrincipal.sessionId)).session),
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
                    (await featureMeta(boundPrincipal.sessionId)).session.harness,
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
                else if (isVisualConversationTool(action)) {
                  const own = await featureMeta(boundPrincipal.sessionId);
                  if (own.projectId !== projectId)
                    throw new Error("Conversation belongs to another project.");
                  const root = await resolveHostWorktreeAsync(
                    project.cwd,
                    sessionWorkCwd(own.session),
                  );
                  result = await callVisualConversationTool(
                    root,
                    action,
                    args,
                    scopedDeviceAuthorized,
                    browserRuntime.load,
                  );
                } else if (isFileConversationTool(action)) {
                  const own = await featureMeta(boundPrincipal.sessionId);
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
                      return await workspace.run(command, input, tokenHash);
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
                    tools: sessionConversationToolCatalog(),
                  };
                else if (["tools.search", "tools.describe", "tools.status"].includes(action))
                  result = managedDiscoveryResult(action, args, managedMcpCatalog().filter(tool => tool.group !== "conversation" || !isRoomOnlyConversationAction(tool.action)));
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
                  result = await deviceHost.preflight(
                    args.deviceId as string | undefined,
                    scopedDeviceEffect,
                  );
                else if (action === "devices.preview")
                  result = devicePreviews.start(
                    args as any,
                    `${projectId}:${boundPrincipal.sessionId}`,
                    scopedDeviceAuthorized,
                  );
                else if (action === "devices.preview.status")
                  result = await devicePreviews.authorizedStatus(
                    String(args.id),
                    `${projectId}:${boundPrincipal.sessionId}`,
                    args.includeFrame === true,
                    scopedDeviceAuthorized,
                  );
                else if (action === "devices.status")
                  result = await deviceHost.status(scopedDeviceEffect);
                else if (action === "devices.list")
                  result = await deviceHost.list(scopedDeviceEffect);
                else if (action === "devices.start")
                  result = await deviceHost.start(scopedDeviceEffect);
                else if (action === "devices.boot")
                  result = await deviceHost.boot(String(args.deviceId), scopedDeviceEffect);
                else if (action === "devices.capture")
                  result = await deviceHost.capture(String(args.deviceId), scopedDeviceEffect);
                else if (action === "devices.control.status")
                  result = await deviceHost.control.status(String(args.deviceId));
                else if (action === "devices.control.claim")
                  result = await deviceHost.control.claim(String(args.deviceId), `conversation:${tokenHash}:${boundPrincipal.sessionId}`, String(args.requestId), scopedDeviceAuthorized);
                else if (action === "devices.control.release")
                  result = await deviceHost.control.release(String(args.deviceId), `conversation:${tokenHash}:${boundPrincipal.sessionId}`, String(args.leaseId));
                else if (action === "devices.control.renew")
                  result = await deviceHost.control.renew(String(args.deviceId), `conversation:${tokenHash}:${boundPrincipal.sessionId}`, String(args.leaseId));
                else if (action === "devices.inspect") {
                  const id = String(args.deviceId), owner = `conversation:${tokenHash}:${boundPrincipal.sessionId}`, lease = String(args.leaseId);
                  await deviceHost.control.assert(id, owner, lease);
                  result = await deviceHost.inspect(id, `${owner}:${lease}`, { authorized: async () => {
                    if (!(await scopedDeviceAuthorized())) return false;
                    try { await deviceHost.control.assert(id, owner, lease); return true; } catch { return false; }
                  } });
                }
                else if (action === "devices.action")
                  result = await deviceHost.control.execute(String(args.deviceId), `conversation:${tokenHash}:${boundPrincipal.sessionId}`, String(args.leaseId), String(args.requestId), args.action, (track) => deviceHost.action(
                    String(args.deviceId), args.action as DeviceAction,
                    { track, authorized: async () => {
                      if (!(await scopedDeviceAuthorized())) return false;
                      try { await deviceHost.control.assert(String(args.deviceId), `conversation:${tokenHash}:${boundPrincipal.sessionId}`, String(args.leaseId)); return true; } catch { return false; }
                    } }, `conversation:${tokenHash}:${boundPrincipal.sessionId}:${String(args.leaseId)}`,
                  ));
                else if (action === "browser.preview")
                  result = await conversationPreviews.run(
                    args as unknown as ConversationPreviewInput,
                    { projectId, sessionId: boundPrincipal.sessionId, principalId: tokenHash },
                    {
                      authorize: async () => {
                        if (!(await conversationAccess.principalForToken(token)))
                          throw new Error("Session authority revoked.");
                      },
                      browser: async (method, params) =>
                        (await sharedBrowser.dispatchForSession(
                          method,
                          { ...params, projectId, sessionId: boundPrincipal.sessionId },
                          voiceBrowserOwner ?? token,
                        )) as unknown as PreviewBrowserState,
                      present: async () =>
                        (await conversationDesktop.call(
                          "ui.tools.open",
                          { tab: "browser", projectHost: true },
                          project.cwd,
                          boundPrincipal,
                          async () => !!(await conversationAccess.principalForToken(token)),
                        )) as PreviewPresentation,
                    },
                  );
                else if (action.startsWith("browser.")) {
                  result = await sharedBrowser.dispatchForSession(
                    action,
                    { ...args, projectId, sessionId: boundPrincipal.sessionId },
                    voiceBrowserOwner ?? token,
                  );
                  // Agents decide setup from real readiness, not from open:false.
                  if (["browser.status", "browser.claim", "browser.release"].includes(action))
                    result = await browserRuntime.describe(result as object);
                } else if (action.startsWith("tasks.")) {
                  const list = (await tasks.list()).filter((task) => task.projectId === projectId);
                  if (action === "tasks.create") {
                    const own = (await featureMeta(boundPrincipal.sessionId)).session;
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
                  result = {
                    ...diagnostics.read(`session:${boundPrincipal.sessionId}`),
                    health: hostDegradedSince === undefined
                      ? { state: "unknown" }
                      : { state: "degraded", since: hostDegradedSince, reason: "unhandled-rejection" },
                  };
                result = pageConversationListResult(action, originalArgs, result);
                await endResult(result, async () => {
                  if (!(await scopedDeviceAuthorized()))
                    throw new Error("Session authority revoked.");
                  if (action === "devices.preview" || action === "devices.preview.status") {
                    const original = devicePreviews.resultAuthority(
                      (result as { id: string }).id,
                      `${projectId}:${boundPrincipal.sessionId}`,
                    );
                    if (!(await original())) throw new Error("Preview authority expired.");
                  }
                });
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
            await endResult(result, async () => {
              if (!(await runtimeLogAccess.principalForToken(token)))
                throw new Error("Session authority revoked.");
            });
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
                  actorId: `device:${tokenHash}`,
                  provider: "owner",
                };
                if (
                  [
                    "social.bridge.describe",
                    "social.access.issue",
                    "social.native.status",
                    "social.native.enroll",
                    "social.native.register",
                    "social.native.authority",
                    "social.native.reset",
                  ].includes(String(input.method))
                ) {
                  if (principal.kind !== "owner") throw new Error("Native owner device required.");
                  result = await nativeServicesService.legacy(
                    input.method as Parameters<typeof nativeServicesService.legacy>[0],
                    params,
                    domainContext,
                  );
                } else if (String(input.method).startsWith("social.native.")) {
                  if (principal.kind !== "owner") throw new Error("Native owner device required.");
                  throw new Error("Unsupported native social operation.");
                } else result = await socialTransport.rpc(principal, String(input.method), params);
                await endResult(result, () => engine.store.db.checkAuthorization());
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
                case "native.turn.begin":
                case "native.turn.end":
                case "native.activity.start":
                case "native.activity.end":
                case "native.buffers.update":
                case "native.buffers.retire":
                case "native.buffers.reconcile":
                case "native.buffers.recovery.list":
                case "native.buffers.recovery.read":
                case "native.buffers.recovery.status":
                case "native.rewind.plan":
                case "native.rewind.prepare":
                case "native.rewind.apply":
                case "native.rewind.status":
                case "native.rewind.lookup":
                case "native.rewind.cancelPreparation":
                case "native.rewind.ack":
                case "workspaces.cleanup.plan":
                case "workspaces.cleanup.apply":
                case "workspaces.cleanup.status": {
                  result = await nativeWorkspacesService.call(
                    input.method as NativeWorkspaceMethod,
                    params,
                    domainContext,
                    {
                      legacy: !input.method.startsWith("native.buffers.recovery."),
                    },
                  );
                  break;
                }
                case "native.buffers.delivery.apply":
                case "native.delivery.epochs.open":
                case "native.delivery.epochs.status":
                case "native.delivery.epochs.compact":
                case "native.delivery.epochs.close":
                case "native.buffers.delivery.status":
                case "native.buffers.delivery.ack":
                case "native.services.delivery.apply":
                case "native.services.delivery.status":
                case "native.services.delivery.ack":
                case "native.services.delivery.result.read":
                  result = await nativeDeliveryService.call(
                    input.method as NativeDeliveryMethod,
                    params,
                    domainContext,
                  );
                  break;
                case "native.buffers.upload.start":
                case "native.buffers.upload.write":
                case "native.buffers.upload.commit":
                case "native.buffers.upload.status":
                case "native.buffers.upload.abort": {
                  result = await nativeBufferUploads.call(
                    input.method as NativeBufferUploadMethod,
                    params,
                    domainContext,
                  );
                  break;
                }
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
                    if (input.method === "sessions.managedTurn.begin")
                      return managed.nativeTurns.begin(
                        params as unknown as Parameters<typeof managed.nativeTurns.begin>[0],
                        owner,
                      );
                    return managed.nativeTurns[
                      input.method === "sessions.managedTurn.end" ? "end" : "status"
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
                  const generation = fileRevertGeneration(params.authorityGeneration);
                  await engine.store.assertAuthority(sessionId, generation);
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
                      ? await engine.checkpoints.filesRevertPlan(
                          sessionId,
                          cwd,
                          userBlockId,
                          ...(generation === undefined ? [] : [generation]),
                        )
                      : await engine.checkpoints.filesRevert(
                          sessionId,
                          cwd,
                          userBlockId,
                          params.planToken as string | undefined,
                          ...(generation === undefined ? [] : [generation]),
                        );
                  break;
                }
                case "sessions.rewind.status": {
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (
                    !value ||
                    value.owner.kind !== "session" ||
                    value.owner.id !== params.sessionId
                  )
                    throw new Error("Session does not own this workspace");
                  const current = await engine.store.sessionStateMetadata(value.owner.id);
                  result = {
                    workspace: value,
                    ...(current
                      ? { conversationRevision: current.revision }
                      : { currentConversationUnavailable: true }),
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
                  if (
                    input.method === "sessions.rewind.plan" &&
                    !(await managed.exactGitRewind.enabled())
                  )
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (
                    !value ||
                    value.owner.kind !== "session" ||
                    value.owner.id !== params.sessionId
                  )
                    throw new Error("Session does not own this workspace");
                  const action =
                    input.method === "sessions.rewind.plan"
                      ? "plan"
                      : input.method === "sessions.rewind.undo"
                        ? "undo"
                        : "apply";
                  const existing =
                    action !== "plan" && typeof params.idempotencyKey === "string"
                      ? await managedWorkspaces.findOperation({
                          workspaceId: value.id,
                          kind: "rewind",
                          idempotencyKey: params.idempotencyKey,
                        })
                      : null;
                  // A durable historical receipt is an outcome, even if new work
                  // is now disabled or its authority floor has advanced.
                  if (
                    existing?.kind === "rewind" &&
                    existing.phase === "complete" &&
                    existing.receipt
                  ) {
                    result = await managed.rewind[action as "apply" | "undo"](
                      params as unknown as WorkspaceRpcRequest<"sessions.rewind.apply">,
                    );
                    break;
                  }
                  if (!(await managed.exactGitRewind.enabled()))
                    throw new Error("Exact Git rewind is disabled on this execution host");
                  await engine.store.assertAuthority(
                    value.owner.id,
                    rewindAuthorityGeneration(params.authorityGeneration),
                  );
                  if (!(await inHost(value.owner.id)))
                    throw new Error(
                      "Git rewind requires a host-executed session; native protocol is unavailable",
                    );
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
                  break;
                }
                case "workspaces.activities.stop": {
                  const id = String(params.activityId ?? "");
                  const value = await workspaceForOwnerRpc(params.workspaceId);
                  if (!value) throw new Error("Managed workspace not found");
                  // Resolve exact current durable owner, not an unbounded duplicate
                  // receipt cache. Disconnect never proves a dirty/native editor idle.
                  const entry = (await managed.activity.list(value.id)).find(
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
                            ownerId: tokenHash,
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
                  const action = input.method.slice("terminals.".length) as TerminalAction;
                  result = await terminalService[action](params, domainContext, { legacy: true });
                  break;
                }
                case "native.services.upload.begin":
                case "native.services.upload.append":
                case "native.services.upload.commit":
                case "native.services.upload.status":
                case "native.services.upload.cancel": {
                  result = await nativeServiceUploads.call(
                    input.method as NativeServiceUploadMethod,
                    params,
                    domainContext,
                  );
                  break;
                }
                case "desktop.status":
                  result = await nativeServicesService.call(
                    "native.services.desktop.status",
                    params,
                    domainContext,
                  );
                  break;
                case "desktop.stop":
                  result = await nativeServicesService.call(
                    "native.services.desktop.stop",
                    params,
                    domainContext,
                  );
                  break;
                case "assistant.request":
                  result = await assistantDomain(assistant, engine.store)(params, domainContext);
                  break;
                case "desktop.request":
                  result = await desktopControlDomain(desktopControl, engine.store)(
                    params,
                    domainContext,
                  );
                  break;
                case "desktop.helper.request":
                  result = await desktopHelperDomain(desktopHelper, engine.store)(
                    params,
                    domainContext,
                  );
                  break;
                case "native.services.desktop.stop":
                case "native.services.assistant.delegation.publicKey":
                case "native.services.assistant.observations.ingest":
                case "native.services.assistant.delegation.origin":
                case "native.services.assistant.delegation.nativeChallenge":
                case "native.services.assistant.delegation.attest":
                case "native.services.assistant.delegation.issue":
                case "native.services.assistant.delegation.issue.status":
                case "native.services.assistant.delegation.challenge":
                case "native.services.assistant.delegation.call":
                case "native.services.assistant.delegation.revoke":
                case "native.services.assistant.presence.get":
                case "native.services.assistant.visibility.epoch":
                case "native.services.assistant.notification.authorize":
                case "native.services.assistant.workspace.authorize":
                case "native.services.assistant.browser.panel":
                case "native.services.assistant.visibility.revoke":
                case "native.services.assistant.visibility.reopen":
                case "native.services.assistant.presence.set":
                case "native.services.desktop.status":
                case "native.services.runtimeLogs.bridge.describe":
                case "native.services.runtimeLogs.access.issue":
                case "native.services.runtimeLogs.terminals.append":
                case "native.services.conversation.bridge.describe":
                case "native.services.conversation.access.issue":
                case "native.services.conversation.desktop.take":
                case "native.services.conversation.desktop.finish":
                case "native.services.conversation.desktop.authorize":
                case "native.services.social.bridge.describe":
                case "native.services.social.access.issue":
                case "native.services.social.native.status":
                case "native.services.social.native.enroll":
                case "native.services.social.native.register":
                case "native.services.social.native.authority":
                case "native.services.social.native.reset":
                case "native.services.workspace.format": {
                  result = await nativeServicesService.call(
                    input.method as NativeServiceMethod,
                    params,
                    domainContext,
                  );
                  break;
                }
                case "conversation.desktop.take":
                case "conversation.desktop.finish":
                case "conversation.desktop.authorize":
                case "conversation.bridge.describe":
                case "conversation.access.issue":
                case "runtimeLogs.terminals.append":
                case "runtimeLogs.bridge.describe":
                case "runtimeLogs.access.issue": {
                  result = await nativeServicesService.legacy(
                    input.method as Parameters<typeof nativeServicesService.legacy>[0],
                    params,
                    domainContext,
                  );
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
                    const session = await featureMeta(String(params.sessionId));
                    if (params.projectId !== undefined && session.projectId !== params.projectId)
                      throw new Error("Runtime logs belong to another project");
                  }
                  result =
                    input.method === "runtimeLogs.sources"
                      ? runtimeLogs.sources(params)
                      : runtimeLogs.read(params);
                  break;
                }
                case "devServers.list":
                case "devServers.details":
                case "devServers.start":
                case "devServers.stop":
                case "devServers.kill":
                case "devServers.restart":
                case "devServers.logs":
                case "devServers.openExternal":
                case "devServers.bridgeCheck":
                case "devServers.bridgeOpen":
                case "devServers.bridgeRead":
                case "devServers.bridgeWrite":
                case "devServers.bridgeClose": {
                  const action = input.method.slice("devServers.".length) as
                    | DevServerAction
                    | DevServerBridgeAction;
                  result = await devServersService.execute(action, params, domainContext, {
                    legacy: true,
                  });
                  break;
                }
                case "resources.read":
                  result = {
                    ...diagnostics.read(token),
                    health: hostDegradedSince === undefined
                      ? { state: "unknown" }
                      : { state: "degraded", since: hostDegradedSince, reason: "unhandled-rejection" },
                  };
                  break;
                case "browser.setup":
                  // Explicit machine tools are authorized by the paired host credential.
                  // When a conversation project is supplied, retain its validation.
                  if (params.projectId !== undefined)
                    await engine.store.project(String(params.projectId ?? ""));
                  await browserRuntime.setup();
                  result = await browserRuntime.describe(
                    await sharedBrowser.dispatch("browser.status", params, token),
                  );
                  break;
                case "browser.status":
                case "browser.claim":
                case "browser.release":
                case "browser.open":
                case "browser.resize":
                case "browser.frame":
                case "browser.input":
                case "browser.close": {
                  if (params.ownerPresentationScope === undefined && params.projectId !== undefined)
                    await engine.store.project(String(params.projectId));
                  let browserParams = params;
                  if (
                    params.ownerPresentationScope === undefined &&
                    params.sessionId !== undefined
                  ) {
                    const session = await featureMeta(String(params.sessionId));
                    if (params.projectId !== undefined && session.projectId !== params.projectId)
                      throw new Error("Browser belongs to another project");
                    browserParams = { ...params, projectId: session.projectId };
                  }
                  // Only paired owner RPCs may explicitly take control. Conversation
                  // tools use dispatchForSession and cannot enable this option.
                  result = await browserRuntime.describe(
                    await sharedBrowser.dispatch(input.method, browserParams, token, {
                      takeover: input.method === "browser.claim" && params.takeover === true,
                    }),
                  );
                  break;
                }
                case "browser.annotation.start":
                case "browser.annotation.hover":
                case "browser.annotation.select":
                case "browser.annotation.parent":
                case "browser.annotation.traverse":
                case "browser.annotation.clear":
                case "browser.annotation.read":
                case "browser.annotation.cancel": {
                  const projectId = String(params.projectId ?? "");
                  if (params.ownerPresentationScope === undefined) {
                    await engine.store.project(projectId);
                    if ((await featureMeta(String(params.sessionId ?? ""))).projectId !== projectId)
                      throw new Error("Conversation belongs to another project");
                  } else if (
                    !projectId ||
                    typeof params.sessionId !== "string" ||
                    !params.sessionId
                  ) {
                    throw new Error(
                      "Owner browser presentation requires project and conversation identity",
                    );
                  }
                  result = await sharedBrowser.dispatch(input.method, params, token);
                  break;
                }
                case "environment.describe":
                  result = await environmentService.describe(params);
                  break;
                case "environment.persistence.status":
                  result = await persistenceService.status(params, domainContext, { legacy: true });
                  break;
                case "environment.persistence.recover":
                  result = await persistenceService.recover(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "voice.clientSecret":
                  await engine.store.project(String(params.projectId ?? ""));
                  result = await createVoiceClientSecret();
                  break;
                case "voice.local.inspect":
                  result = await inspectVoiceRuntime(params.config, {
                    cloudKey: async (provider) => Boolean(await voiceCloud.get(provider)),
                  });
                  break;
                case "voice.realtime.secret":
                case "voice.cloud.status":
                case "voice.cloud.setKey":
                  // Sign-ins and keys stay on this computer: no browser or remote caller.
                  if (
                    request.headers.origin ||
                    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
                      request.socket.remoteAddress ?? "",
                    )
                  )
                    throw new Error("Cloud voice is available only on this computer.");
                  result =
                    input.method === "voice.realtime.secret"
                      ? await createRealtimeSecret(params.provider)
                      : input.method === "voice.cloud.status"
                        ? await voiceCloud.status()
                        : await voiceCloud.setKey(params.provider, params.key ?? null);
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
                  if (input.method === "voice.local.setup") {
                    if (localVoice.isActive) throw new Error("Disconnect voice before installing.");
                    // Unload a recognizer kept warm after dictation before replacing it.
                    localVoice.close();
                  }
                  result =
                    input.method === "voice.local.setup"
                      ? voiceSetup.start(params.config)
                      : voiceSetup.status();
                  break;
                case "voice.local.speak":
                  result = localVoice.speak(params.lease, params.text, params.language);
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
                  result = await localVoice.start(params.config, params.recognitionOnly === true);
                  break;
                case "voice.local.transcribe":
                  result = await localVoice.transcribe(
                    params.lease,
                    params.audio,
                    params.language,
                    params.endpoint,
                  );
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
                  if ((await featureMeta(sessionId)).projectId !== projectId)
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
                case "devices.preview.impact":
                case "devices.setup":
                case "devices.stop":
                case "devices.status":
                case "devices.preflight":
                case "devices.preview":
                case "devices.preview.status":
                case "devices.start":
                case "devices.list":
                case "devices.boot":
                case "devices.capture":
                case "devices.control.status":
                case "devices.control.claim":
                case "devices.control.release":
                case "devices.control.renew":
                case "devices.inspect":
                case "devices.action":
                  result = await nativeDevicesService.call(input.method, params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "projects.list":
                  result = await projectsService.list({}, domainContext);
                  break;
                case "projects.directory":
                  result = await projectsService.directory(params, domainContext, { legacy: true });
                  break;
                case "projects.browse":
                  result = await projectsService.browse(params, domainContext, { legacy: true });
                  break;
                case "projects.createDirectory":
                  result = await projectsService.createDirectory(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "projects.open":
                  result = await projectsService.open(params, domainContext, { legacy: true });
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
                case "models.list": {
                  result = await modelsService.list(params, domainContext, { legacy: true });
                  break;
                }
                case "sessions.list":
                  result = await sessionService.list(params, domainContext);
                  break;
                case "machine.changes": {
                  heldPolls.set(pollState, token);
                  response.once("close", () => {
                    heldPolls.delete(pollState);
                  });
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
                          sourceEpoch?: string;
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
                      const known = await engine.store.sessionStateMetadata(sessionId);
                      if (!known && !(await desktop.stampAsync(sessionId, WATCH_STAMP_MS))) return undefined;
                      const epoch = await sessionSourceEpoch(sessionId);
                      const host = await engine.store.sessionStateMetadata(sessionId);
                      if (host && (!host.desktop || host.status === "running")) {
                        if (epoch !== await sessionSourceEpoch(sessionId)) throw new Error("Session read owner changed; retry");
                        return { revision: host.revision, sourceEpoch: epoch };
                      }
                      // A change-poll tick: a fraction-of-a-second old read is fine.
                      const stamp = await desktop.stampAsync(sessionId, WATCH_STAMP_MS);
                      if (!host && !stamp) return undefined;
                      if (host && (!stamp || !stamp.running)) {
                        if (epoch !== await sessionSourceEpoch(sessionId)) throw new Error("Session read owner changed; retry");
                        return { revision: host.revision, sourceEpoch: epoch };
                      }
                      const overlay = desktop.live.overlay(sessionId);
                      const revision = Math.max(
                        stamp?.updatedAt ?? host?.revision ?? 0,
                        overlay?.changedAt ?? 0,
                      );
                      if (epoch !== await sessionSourceEpoch(sessionId)) throw new Error("Session read owner changed; retry");
                      return { revision, sourceEpoch: epoch };
                    },
                    projectChangeSnapshot,
                    () => closing || response.destroyed || pollState.revoked,
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
                    tokenHash,
                    () => engine.store.authenticated(token),
                  );
                  result = await inlineSessionSync(
                    {
                      inlineSync: params.inlineSync === true,
                      inlineSessionIds: inlineSessionIds as string[] | undefined,
                      sessions: params.sessions as { sessionId: string; revision: number; sourceEpoch?: string }[],
                      projects: [],
                    },
                    result as Awaited<ReturnType<RemoteChanges["read"]>>,
                    async (id, revision) => {
                      // Desktop rows may require transcript IO. Keep those on sessions.sync.
                      const metadata = await engine.store.sessionStateMetadata(id);
                      if (!metadata || (await desktopWatch(id, true))) return undefined;
                      const sourceEpoch = await sessionSourceEpoch(id);
                      const sync = await engine.store.sync(id, revision);
                      if (sourceEpoch !== await sessionSourceEpoch(id)) return undefined;
                      return sync.kind === "delta"
                        ? {
                            ...sync,
                            value: {
                              ...sync.value,
                              sourceEpoch,
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
                case "sessions.pin.state":
                case "sessions.pin.apply":
                case "sessions.pin.receipt": {
                  const sessionId = String(params.sessionId ?? "");
                  const projectId = String(params.projectId ?? "");
                  if (!sessionId || !projectId || sessionId.length > 4096 || projectId.length > 4096) throw new Error("Invalid pin scope");
                  const operationId = String(params.operationId ?? "");
                  if (input.method !== "sessions.pin.state" && (!operationId || operationId.length > 4096)) throw new Error("Invalid pin operation ID");
                  if (input.method === "sessions.pin.receipt") {
                    result = await engine.store.pinReceipt(sessionId, projectId, operationId);
                    break;
                  }
                  const authorityGeneration = params.authorityGeneration === undefined ? undefined : SafeCounterSchema.min(1).parse(params.authorityGeneration);
                  await engine.store.assertAuthority(sessionId, authorityGeneration);
                  if (input.method === "sessions.pin.state") {
                    result = await engine.store.pinState(sessionId, projectId, authorityGeneration);
                  } else {
                    if (authorityGeneration === undefined) await adopt(sessionId);
                    if (typeof params.desiredPinned !== "boolean") throw new Error("Invalid pin value");
                    const expectedVersion = SafeCounterSchema.parse(params.expectedVersion);
                    result = await engine.store.pinApply(sessionId, projectId, operationId, params.desiredPinned, expectedVersion, authorityGeneration);
                  }
                  break;
                }
                case "sessions.update": {
                  const sessionId = String(params.sessionId ?? "");
                  const authorityGeneration =
                    params.authorityGeneration === undefined
                      ? undefined
                      : SafeCounterSchema.min(1).parse(params.authorityGeneration);
                  await engine.store.assertAuthority(sessionId, authorityGeneration);
                  if (authorityGeneration === undefined) await adopt(sessionId);
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
                  result = await engine.updateSession(sessionId, patch, authorityGeneration);
                  break;
                }
                case "sessions.delete": {
                  const sessionId = String(params.sessionId ?? "");
                  const requestedGeneration =
                    params.authorityGeneration === undefined
                      ? undefined
                      : SafeCounterSchema.min(1).parse(params.authorityGeneration);
                  let authorityGeneration = requestedGeneration;
                  try {
                    await engine.store.assertAuthority(sessionId, authorityGeneration);
                  } catch (error) {
                    if (!(error instanceof HostAuthorityFenceError)) throw error;
                    // A stale client generation must not make a session undeletable.
                    console.warn("Ignoring stale authority generation on session delete.");
                    authorityGeneration = await engine.store.currentAuthorityGeneration(sessionId);
                  }
                  const host = await engine.store.sessionAuthority(sessionId);
                  const workspaceId = host
                    ? (await engine.store.session(sessionId)).session.workspaceId
                    : (await managed.list()).find(
                        (value) => value.owner.kind === "session" && value.owner.id === sessionId,
                      )?.id;
                  const managedSession = workspaceId ? await managed.get(workspaceId) : undefined;
                  if (managedSession) {
                    await managed.assertWritable(managedSession.id);
                  }
                  let release: (() => Promise<void>) | undefined;
                  if (managedSession?.directoryState === "present") {
                    try {
                      release = await startWorkspaceActivity(
                        managedSession.path,
                        "mutation",
                        "session-delete",
                      );
                    } catch (error) {
                      console.warn("Session delete proceeds without a workspace activity:", error);
                    }
                  }
                  let admittedHost: boolean | undefined;
                  let admittedDesktopCwd: string | undefined;
                  let admittedWorkspaceId: string | undefined;
                  let admittedGeneration: number | undefined;
                  let deletionIdentityCaptured = false;
                  const admittedDelete = async () => {
                    if (!(await engine.store.authenticated(token)))
                      throw new Error("Authentication expired");
                    const hostPresent = await inHost(sessionId);
                    const currentGeneration =
                      await engine.store.currentAuthorityGeneration(sessionId);
                    if (deletionIdentityCaptured && currentGeneration !== admittedGeneration)
                      throw new Error("Session authority changed; refresh before deleting");
                    if (!deletionIdentityCaptured) {
                      admittedGeneration = currentGeneration;
                      if (authorityGeneration === undefined)
                        authorityGeneration = currentGeneration;
                    }
                    if (hostPresent) {
                      await engine.store.assertAuthority(sessionId, authorityGeneration);
                      const current = await engine.store.session(sessionId);
                      if (current.projectId !== params.projectId)
                        throw new Error("Session does not belong to this project");
                      if (
                        deletionIdentityCaptured &&
                        current.session.workspaceId !== admittedWorkspaceId
                      )
                        throw new Error("Session workspace changed; refresh before deleting");
                      admittedWorkspaceId = current.session.workspaceId;
                    }
                    const currentCwd = (await desktop.projectCwdAsync(sessionId)) ?? undefined;
                    if (
                      deletionIdentityCaptured &&
                      (admittedHost !== hostPresent ||
                        !!admittedDesktopCwd !== !!currentCwd ||
                        (admittedDesktopCwd &&
                          currentCwd &&
                          !desktop.samePath(admittedDesktopCwd, currentCwd)))
                    )
                      throw new Error("Session identity changed; refresh before deleting");
                    admittedHost = hostPresent;
                    admittedDesktopCwd = currentCwd;
                    deletionIdentityCaptured = true;
                    if (currentCwd) {
                      const project = (await engine.store.projects()).find((p) =>
                        desktop.samePath(p.cwd, currentCwd),
                      );
                      if (!project || project.id !== params.projectId)
                        throw new Error("Session does not belong to this project");
                      if ((await desktop.stampAsync(sessionId))?.running)
                        throw new Error("Stop this session before deleting it");
                    } else if (!hostPresent) throw new Error("Session not found on this machine");
                    if (managedSession) await managed.assertWritable(managedSession.id);
                  };
                  try {
                    result = await engine.withRetiredProviderWriterForDeletion(
                      sessionId,
                      async () => {
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
                            // A stored "running" with no live Host run is stale, not a blocker.
                            (engine.hasActiveRun(sessionId) &&
                              (await engine.store.sessionStateMetadata(sessionId))?.status ===
                                "running")
                          )
                            throw new Error("Stop this session before deleting it");
                          await admittedDelete();
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
                          if (!(await engine.store.authenticated(token)))
                            throw new Error("Authentication expired");
                          if (
                            (await engine.store.currentAuthorityGeneration(sessionId)) !==
                            admittedGeneration
                          )
                            throw new Error("Session authority changed; refresh before deleting");
                          let historyCwd = cwd;
                          if (await inHost(sessionId)) {
                            await engine.store.assertAuthority(sessionId, authorityGeneration);
                            const current = await engine.store.session(sessionId);
                            historyCwd = current.session.cwd || cwd;
                            if (current.projectId !== project.id)
                              throw new Error("Session does not belong to this project");
                            await engine.store.deleteSession(sessionId, authorityGeneration, {
                              staleRunning: !engine.hasActiveRun(sessionId),
                            });
                          }
                          invalidateSessionCopies(sessionId, project.id);
                          await sessionQueues.delete(sessionId);
                          await engine.checkpoints.retireDeletedSessionHistory(sessionId, historyCwd).then((result) => {
                            if (result.retainedUnknown) console.warn("Deleted session legacy or unreferenced file history retained; ownership is not proven.");
                          }).catch((error) => console.warn("Deleted session file history retained:", error));
                          return { deleted: true };
                        }
                        const current = await engine.store.session(sessionId);
                        if (current.projectId !== params.projectId)
                          throw new Error("Session does not belong to this project");
                        await admittedDelete();
                        await engine.store.deleteSession(sessionId, authorityGeneration, {
                          staleRunning: !engine.hasActiveRun(sessionId),
                        });
                        invalidateSessionCopies(sessionId, current.projectId);
                        await sessionQueues.delete(sessionId);
                        await engine.checkpoints.retireDeletedSessionHistory(sessionId, current.session.cwd).then((result) => {
                          if (result.retainedUnknown) console.warn("Deleted session legacy or unreferenced file history retained; ownership is not proven.");
                        }).catch((error) => console.warn("Deleted session file history retained:", error));
                        return { deleted: true };
                      },
                      admittedDelete,
                    );
                    break;
                  } finally {
                    await release?.();
                  }
                }
                case "sessions.page":
                  result = await sessionService.page(params, domainContext);
                  break;
                case "sessions.sync":
                  result = await sessionService.sync(params, domainContext);
                  break;
                case "commands.status":
                  result = await commandService.status(params, domainContext);
                  break;
                case "sessions.desktopLive": {
                  const beat = desktop.live.beat(params);
                  const durableCommands = await withinBeat(
                    () =>
                      desktopCommandDelivery.poll(params, () =>
                        assertDomainAuthority(domainContext),
                      ),
                    [],
                  );
                  // Renew the reported epoch before queued busy bookkeeping can
                  // implicitly reacquire an expired lease with a new epoch.
                  // Otherwise this same heartbeat is falsely answered as lost.
                  const renewedRunLeases = await renewRunLeases(params);
                  await withinBeat(() => heartbeatEffects, undefined);
                  result = {
                    ...beat,
                    commands: [...beat.commands, ...durableCommands],
                    deletions: await withinBeat(
                      () =>
                        desktopDelete.beat(
                          `${tokenHash}:${String(params.clientId ?? "")}`,
                          params.deletions,
                        ),
                      { jobs: [], acked: [] },
                    ),
                    inbox: await withinBeat(
                      () => providerInbox.beat(tokenHash, params.clientId, params.inbox),
                      { jobs: [], acked: [] },
                    ),
                    notesRevision: hostNotes.revision,
                    // Lets the desktop re-read only the shared queues another computer
                    // changed, instead of polling every idle one on a timer.
                    queues: sessionQueues.changesSince(params.queueSeq),
                    // Likewise the adopted conversations whose host copy moved, so the
                    // desktop mirrors them at once instead of polling `sessions.adopted`.
                    adopted: await withinBeat(
                      () => adoptedChanges.changesSince(params.adoptedSeq),
                      undefined,
                    ),
                    // The same beat keeps this desktop's drain leases alive. A lease it
                    // no longer holds is `null`: the host drains that queue itself.
                    queueLeases: await withinBeat(() => renewQueueLeases(params), undefined),
                    // And its run leases: `null` is a conversation it must stop writing to.
                    runLeases: renewedRunLeases,
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
                  // The same existence check as the queue calls. A conversation the host
                  // already stores is known by one indexed read; only a desktop-only one
                  // needs the desktop database, whose notes worker may be busy for long.
                  await queueSessionKnown(id);
                  result = await engine.withRetiredProviderWriter(id, () =>
                    engine.store.db.scope(async () => {
                      if (!(await engine.store.authenticated(token)))
                        throw new Error("Owner authority revoked; your message was not sent.");
                      const hostRunning = writerTransfers.has(id) || (await hostRuns(id));
                      return {
                        lease: runLeases.acquire(id, holder, () => {
                          // The host's own turn, or another window's, keeps it from being granted.
                          if (hostRunning) return "host";
                          const busy = desktop.live.busyClient(id);
                          return busy && `desktop:${busy}` !== holder
                            ? `desktop:${busy}`
                            : undefined;
                        }),
                      };
                    }),
                  );
                  break;
                }
                case "sessions.queue.get":
                case "sessions.queue.change":
                case "sessions.queue.claim":
                case "sessions.queue.finish":
                case "sessions.queue.release":
                case "sessions.queue.lease": {
                  const action = input.method.slice("sessions.queue.".length) as SessionQueueAction;
                  result = await sessionQueueService[action](
                    params,
                    {
                      ...domainContext,
                      exposeAttachments: (ids, exposureParams) =>
                        attachmentOwnership.expose(token, ids, exposureParams),
                    },
                    { legacy: true },
                  );
                  break;
                }
                case "sessions.syncChunk":
                  result = await sessionService.syncChunk(params, domainContext);
                  break;
                case "sessions.block":
                  result = await sessionService.block(params, domainContext);
                  break;
                case "sessions.get":
                  result = await sessionService.get(params, domainContext);
                  break;
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
                case "commands.dispatch":
                  result = await commandService.dispatch(params, domainContext, { legacy: true });
                  break;
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
                    "checkpoint",
                  );
                  break;
                }
                case "usage.sessions.read":
                  result = await readSessionUsage(engine.store, params);
                  break;
                case "notes.list":
                  result = await notesService.list(params, domainContext, { legacy: true });
                  break;
                case "notes.get":
                  result = await notesService.get(params, domainContext, { legacy: true });
                  break;
                case "notes.upsert":
                  result = await notesService.upsert(params, domainContext, { legacy: true });
                  break;
                case "notes.delete":
                  result = await notesService.delete(params, domainContext, { legacy: true });
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
                  result = await providerInbox.request(tokenHash, params.requestId, operation);
                  break;
                }
                case "inbox.provider.result":
                  result = await providerInbox.result(tokenHash, params.requestId);
                  break;
                case "inbox.list": {
                  const projectId =
                    params.projectId === undefined ? undefined : String(params.projectId);
                  const projects = projectId
                    ? [await engine.store.project(projectId)]
                    : await engine.store.projects();
                  // Bounded fan-out: with 100+ projects an unbounded Promise.all queues every
                  // list job (and its desktop read) at once and starves the point reads.
                  const lists: Awaited<ReturnType<typeof projectSessionList>>[] = [];
                  let nextProject = 0;
                  await Promise.all(
                    Array.from({ length: Math.min(4, projects.length) }, async () => {
                      for (;;) {
                        const index = nextProject++;
                        if (index >= projects.length) return;
                        lists[index] = await projectSessionList(projects[index].id);
                      }
                    }),
                  );
                  const sessions = lists.flatMap((entry) => entry.list);
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
                  result = await automationsService.list(params, domainContext, { legacy: true });
                  break;
                case "automations.preview":
                  result = await automationsService.preview(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "automations.save":
                  result = await automationsService.save(params, domainContext, { legacy: true });
                  break;
                case "automations.delete":
                  result = await automationsService.delete(params, domainContext, { legacy: true });
                  break;
                case "automations.runs":
                  result = await automationsService.runs(params, domainContext, { legacy: true });
                  break;
                case "automations.runNow":
                  result = await automationsService.runNow(params, domainContext, { legacy: true });
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
                  result = await crewsService.call(input.method, params, domainContext, {
                    legacy: true,
                  });
                  break;
                // These cross-project planning routes belong only to paired owner
                // dispatch. Project-scoped conversation tools have their own allowlist.
                case "sprints.list":
                  result = await sprintsService.list(params, domainContext, { legacy: true });
                  break;
                case "sprints.get":
                  result = await sprintsService.get(params, domainContext, { legacy: true });
                  break;
                case "sprints.create":
                  result = await sprintsService.create(params, domainContext, { legacy: true });
                  break;
                case "sprints.update":
                  result = await sprintsService.update(params, domainContext, { legacy: true });
                  break;
                case "sprints.start":
                  result = await sprintsService.start(params, domainContext, { legacy: true });
                  break;
                case "sprints.complete":
                  result = await sprintsService.complete(params, domainContext, { legacy: true });
                  break;
                case "sprints.archive":
                  result = await sprintsService.archive(params, domainContext, { legacy: true });
                  break;
                case "sprints.plan":
                  result = await sprintsService.plan(params, domainContext, { legacy: true });
                  break;
                case "sprints.report":
                  result = await sprintsService.report(params, domainContext, { legacy: true });
                  break;
                case "sprints.ingest":
                  result = await sprintsService.ingest(params, domainContext, { legacy: true });
                  break;
                case "sprints.goalContext":
                  result = await sprintsService.setGoalContext(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "tasks.snapshotWithCursor":
                  result = await tasksService.snapshotWithCursor(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "tasks.events":
                  result = await tasksService.events(params, domainContext, { legacy: true });
                  break;
                case "tasks.list":
                  result = await tasksService.list(params, domainContext, { legacy: true });
                  break;
                case "tasks.save":
                  result = await tasksService.save(params, domainContext, { legacy: true });
                  break;
                case "tasks.move":
                  result = await tasksService.move(params, domainContext, { legacy: true });
                  break;
                case "tasks.start":
                  result = await tasksService.start(params, domainContext, { legacy: true });
                  break;
                case "tasks.reorder":
                  result = await tasksService.reorder(params, domainContext, { legacy: true });
                  break;
                case "tasks.retarget":
                  result = await tasksService.retarget(params, domainContext, { legacy: true });
                  break;
                case "tasks.review.recheck":
                  result = await tasksService.recheckReview(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "tasks.notes.read":
                  result = await tasksService.readNotes(params, domainContext, { legacy: true });
                  break;
                case "tasks.notes.resolve":
                  result = await tasksService.resolveNote(params, domainContext, { legacy: true });
                  break;
                case "tasks.delete":
                  result = await tasksService.delete(params, domainContext, { legacy: true });
                  break;
                case "goals.list":
                  result = await goalsService.list(params, domainContext, { legacy: true });
                  break;
                case "goals.create":
                  result = await goalsService.create(params, domainContext, { legacy: true });
                  break;
                case "goals.final-review.recheck":
                  result = await goalsService.recheckFinalReview(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "tasks.preflight":
                  result = await tasksService.preflight(params, domainContext, { legacy: true });
                  break;
                case "tasks.evaluation.save":
                  result = await tasksService.recordEvaluation(params, domainContext, {
                    legacy: true,
                  });
                  break;
                case "goals.approve":
                  result = await goalsService.approve(params, domainContext, { legacy: true });
                  break;
                case "goals.update":
                  result = await goalsService.update(params, domainContext, { legacy: true });
                  break;
                case "goals.replan":
                  result = await goalsService.replan(params, domainContext, { legacy: true });
                  break;
                case "goals.cancel":
                  result = await goalsService.cancel(params, domainContext, { legacy: true });
                  break;
                case "goals.delete":
                  result = await goalsService.delete(params, domainContext, { legacy: true });
                  break;
                case "host.settings.get":
                  result = await tasks.limits.state();
                  break;
                case "host.settings.save":
                  await tasks.limits.save(params.settings);
                  result = await tasks.limits.state();
                  void tasks
                    .tick()
                    .catch((error) => console.warn("Task scheduler tick failed", error));
                  break;
                case "stewards.list":
                  result = await stewardsService.list(params, domainContext, { legacy: true });
                  break;
                case "stewards.save":
                  result = await stewardsService.save(params, domainContext, { legacy: true });
                  break;
                case "stewards.delete":
                  result = await stewardsService.delete(params, domainContext, { legacy: true });
                  break;
                case "stewards.runNow":
                  result = await stewardsService.runNow(params, domainContext, { legacy: true });
                  break;
                case "stewards.decline":
                  result = await stewardsService.decline(params, domainContext, { legacy: true });
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
                  const status = await attachmentUploadStatus(engine.store, params, async () => {
                    await bindQuestionUpload(tokenHash, params);
                    await attachmentOwnership.touch(token, params);
                  });
                  await attachmentOwnership.uploaded(params, status.offset);
                  result = status;
                  break;
                }
                case "attachments.upload": {
                  const uploaded = await writeAttachmentChunk(engine.store, params, async () => {
                    await bindQuestionUpload(tokenHash, params);
                    await attachmentOwnership.touch(token, params);
                  });
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
                  workspace.cancelSearches(tokenHash);
                  diagnostics.revoke(token);
                  sharedBrowser.revoke(token);
                  conversationPreviews.revoke(tokenHash);
                  // Only the caller's own credential. Sessions and other devices
                  // are unaffected; the host keeps running.
                  result = {
                    revoked: await engine.store.revokeToken(token),
                  };
                  break;
                case "git.diff":
                  result = await gitService.diff(params, domainContext, { legacy: true });
                  break;
                case "git.branches":
                  result = await gitService.branches(params, domainContext, { legacy: true });
                  break;
                case "git.switch":
                  result = await gitService.switch(params, domainContext, { legacy: true });
                  break;
                case "git.createBranch":
                  result = await gitService.createBranch(params, domainContext, { legacy: true });
                  break;
                case "git.worktrees":
                  result = await gitService.worktrees(params, domainContext, { legacy: true });
                  break;
                case "git.worktreeCreate":
                  result = await gitService.worktreeCreate(params, domainContext, { legacy: true });
                  break;
                case "files.read":
                  result = await fileService.read(params, domainContext, { legacy: true });
                  break;
                case "files.list":
                  result = await fileService.list(params, domainContext, { legacy: true });
                  break;
                case "files.index":
                  result = await fileService.index(params, domainContext, { legacy: true });
                  break;
                case "workspace.run":
                  if (params.command === "format_text_file") {
                    result = await nativeServicesService.call(
                      "native.services.workspace.format",
                      params,
                      domainContext,
                      { legacy: true },
                    );
                    break;
                  }
                  result = (await workspace.run(params.command, params.args, tokenHash)) ?? null;
                  break;
                case "files.search":
                  result = await fileService.search(params, domainContext, { legacy: true });
                  break;
                case "files.searchContent":
                  result = await fileService.searchContent(params, domainContext, { legacy: true });
                  break;
                case "files.create":
                  result = await fileService.create(params, domainContext, { legacy: true });
                  break;
                case "files.write":
                  result = await fileService.write(params, domainContext, { legacy: true });
                  break;
                case "git.index":
                  result = await gitService.index(params, domainContext, { legacy: true });
                  break;
                case "git.fileDiff":
                  result = await gitService.fileDiff(params, domainContext, { legacy: true });
                  break;
                case "git.action":
                  result = await gitService.action(params, domainContext, { legacy: true });
                  break;
                default:
                  throw new Error("Unsupported host method");
              }
            },
          );
          const finishResult = () => endResult(result, async () => {
            for (const check of resultAuthorities)
              if (!(await check())) throw new Error("Result authority expired.");
          }, input.method === "assistant.request" || input.method === "native.services.assistant.browser.panel");
          if (input.method === "assistant.request") {
            await assistant.withResponseDisclosure(AssistantResponseValidationSchema.parse(result), {
              environmentId: engine.store.environmentId,
              deviceHash: tokenHash,
              authorized: domainContext.authorized,
            }, finishResult);
          } else await finishResult();
        } catch (error) {
          if (voiceToolLog) voiceToolLog.outcome = "error";
          if (!response.destroyed && !response.headersSent)
            response
              .writeHead(
                error instanceof RequestAuthorizationError ||
                  error instanceof HostDomainAuthorizationError ||
                  (error instanceof HostDomainOutcomeError &&
                    (error.cause instanceof RequestAuthorizationError ||
                      error.cause instanceof HostDomainAuthorizationError))
                  ? 401
                  : 400,
              )
              .end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "Host request failed",
                  ...(deviceEffectAdmitted
                    ? { code: "HOST_DEVICE_OPERATION_UNCONFIRMED", delivery: "unknown" }
                    : error instanceof HostDomainOutcomeError
                      ? { delivery: error.delivery }
                      : {}),
                  ...(typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "HOST_CONTROL_RECEIPT_UNCONFIRMED" &&
                  "controlApplied" in error &&
                  error.controlApplied === true
                    ? { code: "HOST_CONTROL_RECEIPT_UNCONFIRMED", delivery: "unknown" }
                    : {}),
                }),
              );
          else if (!response.destroyed && !response.writableEnded) response.destroy();
        } finally {
          for (const release of resultScopeReleases) release();
          await Promise.allSettled(resultScopeSettlements);
          if (voiceToolLog)
            console.info("Voice tool", {
              action: voiceToolLog.action,
              requestId: voiceToolLog.requestId,
              elapsedMs: elapsedSince(voiceToolLog.startedAt),
              outcome:
                response.destroyed && !response.writableEnded
                  ? "disconnected"
                  : voiceToolLog.outcome,
            });
          await voiceDisclosure?.fail().catch(() => undefined);
          releaseVoiceTool?.();
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
  const websocket = attachHostWebSocketTransport({
    server,
    environmentId: engine.store.environmentId,
    mobileIngressSecret,
    methods: domainDispatcher.methods,
    capabilities: [
      "browser.sessionScopes.v1",
      "browser.ownerPresentationScopes.v1",
      "native.buffers.recovery.v1",
      "transport.ws.models.v1",
      "transport.ws.devices.v1",
      "transport.ws.devices.preview.mobile.v1",
      "native.services.v1",
      "native.workspaces.v1",
      "native.buffers.upload.v1",
      "native.buffers.delivery.v1",
      "native.services.delivery.v1",
      "native.services.workspace.format.bounded.v1",
      "native.buffers.delivery.ack.v1",
      "native.services.delivery.ack.v1",
      "native.delivery.epochs.v2",
      "transport.ws.workspaces.cleanup.v1",
      "transport.ws.sessions.v2",
      "sessions.approvalOccurrence.v1",
      "sessions.desktopControlReceipts.v1",
      "transport.ws.queue.v2",
      "transport.ws.files.v2",
      "transport.ws.terminals.v2",
      "transport.ws.git.v2",
      "transport.ws.notes.v2",
      "transport.ws.tasks.v2",
      "transport.ws.goals.v2",
      "transport.ws.devServers.v2",
      "transport.ws.sprints.v2",
      "transport.ws.automations.v2",
      "transport.ws.health.v2",
      "transport.ws.bulk.v2",
    ],
    subscriptions: subscriptionHub,
    bulk: bulkTransfers,
    bulkDependencies: async (method, params) => {
      const cwd =
        method === "notes.list" &&
        params.sessionId === undefined &&
        typeof params.projectId === "string"
          ? (await engine.store.project(params.projectId)).cwd
          : undefined;
      return hostBulkDependencies(method, params, cwd);
    },
    authenticate: async (token) =>
      await engine.store.db.outsideScope(async () => {
        if (!(await engine.store.authenticated(token))) return null;
        return {
          id: createHash("sha256").update(token).digest("hex"),
          devServerAccess: (method, params, authorize) =>
            devServerAccess.handle(method, params, token, authorize),
          nativeDevices: nativeDevicesOwner(token),
          nativeDelivery: nativeDeliveryOwner(token),
          nativeServices: nativeServicesOwner(token),
          workspaceOwner: requestWorkspaceOwner(token),
          retargetTask: (id, target, autoMerge) =>
            withWorkspaceOwner(token, (owner) => tasks.retarget(id, target, autoMerge, owner)),
          // Domain transactions already own the serialized database scope. Re-entering
          // outsideScope here would queue authorization behind the transaction itself.
          authorized: async () => await engine.store.authenticated(token),
          exposeQueueAttachments: (ids, params) =>
            engine.store.db.withAuthorization(
              () => engine.store.authenticated(token),
              () => attachmentOwnership.expose(token, ids, params),
            ),
        };
      }),
    dispatch: async (method, params, context) =>
      await engine.store.db.outsideScope(
        async () => await domainDispatcher.dispatch(method, params, context),
      ),
  });
  const releaseRejectionGuard = guardUnhandledRejections();
  let startup: Promise<void> = Promise.resolve();
  let resourceClose: Promise<void> | undefined;
  server.on("listening", () => {
    if (closing) return;
    startup = engine.store.db.outsideScope(async () => {
      // Keep the actual startup promises owned through shutdown, even after a
      // deadline warning. Independent starts must not wait behind a hung peer.
      const step = async (name: string, action: () => unknown) => {
        if (closing) return;
        const timer = setTimeout(() => {
          if (!closing) console.warn(`Host background startup step "${name}" has not settled after 30 seconds.`);
        }, 30_000);
        timer.unref();
        try {
          await action();
        } catch (error) {
          if (!closing)
            console.warn(
              `Host background startup step "${name}" failed: ${error instanceof Error ? error.name : "Error"}.`,
            );
        } finally {
          clearTimeout(timer);
        }
      };
      await Promise.all([
        step("retention", () => managed.retention.start()),
        step("queue-drainer", () => queueDrainer.start()),
        step("crews", () => crews.start()),
        step("assistant", () => assistant.start()),
        step("perf-metrics", () => perfMetrics.start()),
        step("attachment-ownership", () => attachmentOwnership.start()),
        step("mobile-lan", () => mobileLan.start()),
        step("social", () => social.start()),
      ]);
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
    releaseRejectionGuard();
    resourceClose = engine.store.db.outsideScope(async () => {
      const pending: Promise<unknown>[] = [];
      const drain = (action: () => unknown) => {
        try {
          pending.push(Promise.resolve(action()));
        } catch (error) {
          pending.push(Promise.reject(error));
        }
      };
      drain(() => controls?.nativeAuthorityBootstrap?.close());
      drain(async () => await websocket.close());
      drain(() => nativeBufferUploads.close());
      drain(() => nativeServiceUploads.close());
      drain(() => {
        unsubscribeChanges();
        unsubscribeAuthorization();
        unsubscribeAuthority();
        if (tasks.onDelete === taskDeleted) tasks.onDelete = previousTaskDelete;
        if (goals.onDelete === goalDeleted) goals.onDelete = previousGoalDelete;
        if (automations.onDelete === automationDeleted)
          automations.onDelete = previousAutomationDelete;
        if (stewards.onDelete === stewardDeleted) stewards.onDelete = previousStewardDelete;
        if (crews.onDefinitionDeleted === crewDefinitionDeleted)
          crews.onDefinitionDeleted = previousCrewDefinitionDeleted;
        if (crews.onAgentDeleted === crewAgentDeleted)
          crews.onAgentDeleted = previousCrewAgentDeleted;
        if (crews.onRunDeleted === crewRunDeleted) crews.onRunDeleted = previousCrewRunDeleted;
        subscriptionHub.close();
        bulkTransfers.close();
      });
      drain(() => managed.retention.stop());
      drain(() => managed.nativeActivity.closeBufferRecoveryCatalog());
      drain(async () => await queueDrainer.close());
      drain(() => localVoice.close());
      drain(() => assistant.close());
      drain(() => assistantKeepAwake.close());
      drain(() => managedAssistantSessions.close());
      drain(() => desktopControl.close());
      drain(() => desktopHelper.close());
      engine.ownerInstructions = previousOwnerInstructions;
      drain(() => voiceSetup.close());
      drain(() => crews.close());
      drain(() => attachmentOwnership.close());
      drain(async () => await terminals.close());
      drain(() => devServerAccess.close());
      drain(() => devServers.close());
      drain(() => gitWatches.close());
      drain(() => diagnostics.close());
      drain(() => perfMetrics.close());
      drain(async () => await devicePreviews.dispose());
      drain(async () => await deviceHost.dispose());
      drain(async () => await sharedBrowser.close());
      drain(() => conversationPreviews.close());
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
      const requested = Promise.allSettled(requests);
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
      tasks.ready,
      goals.ready,
    ]);
    observationCoverage = await installAssistantObservationProducers(engine.store, observationJournal);
  } catch (error) {
    await closeResources().catch(() => {});
    throw error;
  }
  return Object.assign(server, {
    assistant,
    desktop,
    observationJournal,
    observationCoverage,
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
