import { AsyncLocalStorage } from "node:async_hooks";
import { type RemoteProvider } from "../../src/features/connections/model/protocol";
import { HostAssistantKeepAwake } from "../assistant/core/assistant-keep-awake";
import { NativeAdmissionOwner } from "../assistant/native/assistant-native-admission";
import { AssistantNativeVoiceLeases } from "../assistant/native/assistant-native-voice-leases";
import { AssistantVisibilityAdmission } from "../assistant/native/assistant-visibility-admission";
import { AssistantVisibilityFence } from "../assistant/native/assistant-visibility-fence";
import { AssistantWorkspaceOwner } from "../assistant/native/assistant-workspace-owner";
import { AssistantObservationHostPages } from "../assistant/observations/assistant-observation-host-pages";
import { AssistantObservationJournal } from "../assistant/observations/assistant-observation-journal";
import { AssistantObservationNativePages } from "../assistant/observations/assistant-observation-native-pages";
import { AssistantObservationPages } from "../assistant/observations/assistant-observation-pages";
import { AssistantObservationProjectPages } from "../assistant/observations/assistant-observation-project-pages";
import { RoomAttestationSigner } from "../assistant/room/assistant-room-attestation";
import { AssistantRoomNotebook } from "../assistant/room/assistant-room-notebook";
import { HostAssistant } from "../assistant/service";
import { AttachmentOwnership } from "../attachments/attachment-ownership";
import { HostAutomations } from "../automations/automations";
import { BrowserRuntime } from "../browser/browser-runtime";
import { SessionBrowserRegistry } from "../browser/shared-browser";
import type { BrowserRecordingService } from "../browser/browser-recording";
import { ConversationDesktopControlTools } from "../conversation/conversation-desktop-control-tools";
import type { AccountPlatformRuntime } from "./account-platform";
import type { DecisionModelsService } from "../decision-models/decision-service";
import { ConversationGoalTools } from "../conversation/conversation-goal-tools";
import { ConversationSecretTools } from "../secrets/conversation-secret-tools";
import type { PullRequestWatches } from "../pull-request-watch/pull-request-watch";
import type { PullRequestWatchTools } from "../pull-request-watch/pull-request-watch-tools";
import { ConversationManagementRuntime } from "../conversation/conversation-management-runtime";
import {
  ConversationManagementTools,
  type GlobalManagementPrincipal,
  type ManagementAction,
} from "../conversation/conversation-management-tools";
import { ConversationPreviewWorkflow } from "../conversation/conversation-preview";
import { ConversationProjectTools } from "../conversation/conversation-project-tools";
import { ConversationRuntimeReadTools } from "../conversation/conversation-runtime-read-tools";
import { ConversationStewardTools } from "../conversation/conversation-steward-tools";
import { ConversationTaskQueueTools } from "../conversation/conversation-task-queue-tools";
import { ConversationThreadCrewTools } from "../conversation/conversation-thread-crew-tools";
import { ConversationThreadWorkTools } from "../conversation/conversation-thread-work-tools";
import { ConversationDesktopRelay } from "../conversation/conversation-tools";
import { ConversationWorkspaceTools } from "../conversation/conversation-workspace-tools";
import { HostCrews } from "../crews/crews";
import { HostDesktopHelper } from "../desktop-helper";
import { DesktopCommandDelivery } from "../desktop/desktop-command-delivery";
import { HostDesktopControl } from "../desktop/desktop-control-host";
import { DesktopDelete } from "../desktop/desktopDelete";
import type { RemoteActivityFeed } from "../desktop/remoteActivity";
import { DesktopSessions } from "../desktop/desktopSessions";
import { DevServerAccess } from "../dev-servers/dev-server-access";
import { DevServersService } from "../dev-servers/dev-servers";
import { DeviceHost } from "../devices/device-host";
import { DevicePreviews } from "../devices/device-preview";
import { ResourceDiagnostics } from "../diagnostics/resource-diagnostics";
import { HostEngine } from "../engine";
import { RunLeases } from "../execution/run-lease";
import { RuntimeLogMonitors } from "../execution/runtime-log-monitors";
import { RuntimeLogAccess } from "../execution/runtime-log-tools";
import { RuntimeLogsService } from "../execution/runtime-logs";
import type { RuntimeLogWaiter } from "../execution/runtime-log-wait";
import { RuntimeTerminalLogs } from "../execution/runtime-terminal-logs";
import { GitWatches } from "../git/git-watch";
import { HostGoals } from "../goals/goals";
import { AsyncHostNotes } from "../host-notes-async";
import { McpHttp } from "../mcp/mcp-http";
import type { McpHub } from "../mcp/hub/hub";
import { MobileLanAccess } from "../mobile/mobile-lan";
import { MobilePairing } from "../mobile/mobile-pairing";
import { GenericAcpService } from "../providers/generic-acp";
import { ModelCatalogCache } from "../providers/model-catalog-cache";
import { ProviderInboxBridge } from "../providers/provider-inbox";
import { QueueDrainer } from "../sessions/queue-drainer";
import { SessionQueues } from "../sessions/session-queue";
import { TranscriptPages } from "../sessions/transcriptPage";
import { SocialService } from "../social/social";
import { XBrowserSessions } from "../social/social-browser";
import { SocialPeers } from "../social/social-peers";
import { SocialTransport } from "../social/social-transport";
import { HostSprints } from "../sprints/sprints";
import { HostStewards } from "../stewards/stewards";
import { RevisionWaits } from "../storage/revisionWait";
import { SyncTransfers } from "../sync/sync-transfer";
import { HandoffHistoryStore } from "../tasks/handoff-history";
import { HostTasks } from "../tasks/tasks";
import { HostTerminals } from "../terminals/terminals";
import { HostBulkTransfers } from "../transport/http/bulk";
import { HostSubscriptionHub } from "../transport/ws/subscriptions";
import { ExternalTunnels } from "../tunnels/tunnels";
import { VoiceCloudCredentials } from "../voice/voice-cloud-credentials";
import { LocalVoiceService } from "../voice/voice-local";
import { VoiceSetupService } from "../voice/voice-setup";
import type { ApprovalRegistry } from "../approvals/approval-registry";
import type { PushNotifications } from "../push/push-service";
import type { PushDeviceStore } from "../push/push-store";
import { AdoptedChanges } from "../workspaces/adoptedChanges";
import { RemoteChanges } from "../workspaces/remoteChanges";
import { WorkspaceCommands } from "../workspaces/workspace-commands";
import type { createAssistantRuntime } from "./assistant";
import type { createAssistantDisclosureRuntime } from "./assistant-disclosure";
import type { createAssistantNativeRuntime } from "./assistant-native";
import type { createCommandsRuntime } from "./commands";
import type { createDevelopmentRuntime } from "./development";
import type { createDevicesRuntime } from "./devices";
import type { createEnvironmentRuntime } from "./environment";
import type { createGitRuntime } from "./git";
import type { createHttpRuntime } from "./http";
import type { createManagementRuntime } from "./management";
import type { createMobileRuntime } from "./mobile";
import type { createNativeRuntime } from "./native";
import type { ConversationDelegation } from "../delegation/service";
import type { createProjectsRuntime } from "./projects";
import type { createRegistryRuntime } from "./registry";
import type { createSessionLeasesRuntime } from "./session-leases";
import type { createSessionListRuntime } from "./session-list";
import type { createSessionQueueRuntime } from "./session-queue";
import type { createSessionServicesRuntime } from "./session-services";
import type { createSessionViewsRuntime } from "./session-views";
import type { createSessionsRuntime } from "./sessions";
import type { createSocialRuntime } from "./social";
import type { createStewardsRuntime } from "./stewards";
import type { createSubscriptionsRuntime } from "./subscriptions";
import { HostPrivateControl, HostPrivateControlHandler } from "./support";
import type { createTasksRuntime } from "./tasks";
import type { createWebsocketRuntime } from "./websocket";
import type { createWorkspacesRuntime } from "./workspaces";
export interface ServerBindings {
  engine: HostEngine;
  desktop: DesktopSessions;
  runLeases: RunLeases;
  terminals: HostTerminals;
  tasks: Awaited<ReturnType<typeof createTasksRuntime>>["tasks"];
  automationsOverride: HostAutomations | undefined;
  managed: ReturnType<typeof createWorkspacesRuntime>["managed"];
  tasksOverride: HostTasks | undefined;
  goalsOverride: HostGoals | undefined;
  goals: Awaited<ReturnType<typeof createTasksRuntime>>["goals"];
  hostNotes: AsyncHostNotes;
  automations: Awaited<ReturnType<typeof createTasksRuntime>>["automations"];
  stewardsOverride: HostStewards | undefined;
  recordWorkspaceActivity: ReturnType<typeof createWorkspacesRuntime>["recordWorkspaceActivity"];
  managedWorkspaces: ReturnType<typeof createWorkspacesRuntime>["managedWorkspaces"];
  inWorkspace: ReturnType<typeof createWorkspacesRuntime>["inWorkspace"];
  startWorkspaceActivity: ReturnType<typeof createWorkspacesRuntime>["startWorkspaceActivity"];
  featureDirectory: ReturnType<typeof createDevicesRuntime>["featureDirectory"];
  devServers: DevServersService;
  server: ReturnType<typeof createHttpRuntime>["server"];
  assertHostMayRun: Awaited<ReturnType<typeof createSessionQueueRuntime>>["assertHostMayRun"];
  providers: RemoteProvider[];
  refresh: Awaited<ReturnType<typeof createSessionQueueRuntime>>["refresh"];
  socialOverride: SocialService | undefined;
  featureSession: Awaited<ReturnType<typeof createSessionsRuntime>>["featureSession"];
  assistant: HostAssistant;
  desktopControl: HostDesktopControl;
  featureMeta: Awaited<ReturnType<typeof createSessionsRuntime>>["featureMeta"];
  sessionRead: Awaited<ReturnType<typeof createSessionsRuntime>>["sessionRead"];
  sessionQueues: SessionQueues;
  queueSessionKnown: Awaited<ReturnType<typeof createSessionsRuntime>>["queueSessionKnown"];
  adopt: Awaited<ReturnType<typeof createSessionsRuntime>>["adopt"];
  touchSessionWorkspace: ReturnType<typeof createWorkspacesRuntime>["touchSessionWorkspace"];
  withRetiredDesktopWriters: Awaited<
    ReturnType<typeof createSessionsRuntime>
  >["withRetiredDesktopWriters"];
  hostRuns: Awaited<ReturnType<typeof createSessionQueueRuntime>>["hostRuns"];
  queueDrainer: QueueDrainer;
  inHost: Awaited<ReturnType<typeof createSessionsRuntime>>["inHost"];
  desktopWatch: Awaited<ReturnType<typeof createSessionQueueRuntime>>["desktopWatch"];
  desktopSnapshot: Awaited<ReturnType<typeof createSessionsRuntime>>["desktopSnapshot"];
  genericAcp: GenericAcpService;
  stewards: Awaited<ReturnType<typeof createStewardsRuntime>>["stewards"];
  conversationDesktop: ConversationDesktopRelay;
  models: ReturnType<typeof createProjectsRuntime>["models"];
  commandService: ReturnType<typeof createCommandsRuntime>["commandService"];
  catchUp: ReturnType<typeof createSessionViewsRuntime>["catchUp"];
  projectSessionList: Awaited<ReturnType<typeof createSessionListRuntime>>["projectSessionList"];
  social: Awaited<ReturnType<typeof createSocialRuntime>>["social"];
  tunnelsOverride: ExternalTunnels | undefined;
  conversationAccess: RuntimeLogAccess;
  runtimeLogAccess: RuntimeLogAccess;
  runtimeLogs: RuntimeLogsService;
  runtimeLogWaiter: RuntimeLogWaiter;
  refreshLogSources: ReturnType<typeof createDevelopmentRuntime>["refreshLogSources"];
  conversationWorkspace: ConversationWorkspaceTools;
  localSessionReference: Awaited<ReturnType<typeof createSessionsRuntime>>["localSessionReference"];
  domainDispatcher: ReturnType<typeof createRegistryRuntime>["domainDispatcher"];
  webControl: ReturnType<typeof createDevelopmentRuntime>["webControl"];
  mobileLan: MobileLanAccess;
  buildIdentity: ReturnType<typeof createWorkspacesRuntime>["buildIdentity"];
  namedProjects: Awaited<ReturnType<typeof createAssistantRuntime>>["namedProjects"];
  readSessionView: ReturnType<typeof createSessionViewsRuntime>["readSessionView"];
  desktopView: ReturnType<typeof createSessionViewsRuntime>["desktopView"];
  desktopSync: ReturnType<typeof createSessionViewsRuntime>["desktopSync"];
  desktopRecheckMs: ReturnType<typeof createProjectsRuntime>["desktopRecheckMs"];
  transcriptPages: TranscriptPages;
  transfers: SyncTransfers;
  revisionWaits: RevisionWaits;
  sessionSourceEpoch: Awaited<ReturnType<typeof createSessionListRuntime>>["sessionSourceEpoch"];
  attachmentOwnership: AttachmentOwnership;
  featureMetaStable: Awaited<ReturnType<typeof createSessionsRuntime>>["featureMetaStable"];
  questionBinding: ReturnType<typeof createSessionServicesRuntime>["questionBinding"];
  crews: HostCrews;
  touchTerminalWorkspace: ReturnType<typeof createDevicesRuntime>["touchTerminalWorkspace"];
  workspace: WorkspaceCommands;
  workspaceForOwnerRpc: ReturnType<typeof createWorkspacesRuntime>["workspaceForOwnerRpc"];
  sprints: HostSprints;
  visibleProjectForThread: ReturnType<
    typeof createAssistantNativeRuntime
  >["visibleProjectForThread"];
  environmentService: ReturnType<typeof createEnvironmentRuntime>["environmentService"];
  persistenceService: ReturnType<typeof createNativeRuntime>["persistenceService"];
  tunnels: ReturnType<typeof createMobileRuntime>["tunnels"];
  mobileAccess: ReturnType<typeof createMobileRuntime>["mobileAccess"];
  featureClaims: ReturnType<typeof createWorkspacesRuntime>["featureClaims"];
  projectsService: ReturnType<typeof createSessionServicesRuntime>["projectsService"];
  workspacePolicy: ReturnType<typeof createWorkspacesRuntime>["workspacePolicy"];
  sprintsService: ReturnType<typeof createGitRuntime>["sprintsService"];
  gitService: ReturnType<typeof createGitRuntime>["gitService"];
  socialTransport: SocialTransport;
  withRoomProjectScope: ReturnType<typeof createAssistantDisclosureRuntime>["withRoomProjectScope"];
  conversationThreadWork: ConversationThreadWorkTools;
  assistantPorts: Awaited<ReturnType<typeof createAssistantRuntime>>["assistantPorts"];
  approveManagementOperation: ReturnType<
    typeof createManagementRuntime
  >["approveManagementOperation"];
  sharedBrowser: SessionBrowserRegistry & { recordings: BrowserRecordingService };
  conversationPreviews: ConversationPreviewWorkflow;
  browserRuntime: BrowserRuntime;
  nativeAdmissionOwner: NativeAdmissionOwner;
  roomVisibleProject: ReturnType<typeof createAssistantNativeRuntime>["roomVisibleProject"];
  visibilityAdmission: AssistantVisibilityAdmission;
  observationJournal: AssistantObservationJournal;
  roomResourceReceipts: ReturnType<typeof createAssistantNativeRuntime>["roomResourceReceipts"];
  withNativeObservationScope: ReturnType<
    typeof createAssistantDisclosureRuntime
  >["withNativeObservationScope"];
  nativeObservationGeneration: ReturnType<
    typeof createAssistantNativeRuntime
  >["nativeObservationGeneration"];
  nativeVoiceLeases: AssistantNativeVoiceLeases;
  retireNativeVoiceGenerations: ReturnType<
    typeof createAssistantDisclosureRuntime
  >["retireNativeVoiceGenerations"];
  observationHostPages: AssistantObservationHostPages;
  observationNativePages: AssistantObservationNativePages;
  observationProjectPages: AssistantObservationProjectPages;
  observationPages: AssistantObservationPages;
  withNativeSessionScope: ReturnType<
    typeof createAssistantDisclosureRuntime
  >["withNativeSessionScope"];
  executeAccountSocial: ReturnType<typeof createAssistantNativeRuntime>["executeAccountSocial"];
  roomNotebook: AssistantRoomNotebook;
  conversationManagementRuntime: ConversationManagementRuntime;
  globalServerManagement: ConversationManagementTools<string, GlobalManagementPrincipal>;
  globalAssistantManagement: ConversationManagementTools<
    ManagementAction,
    GlobalManagementPrincipal
  >;
  roomBrowser: ReturnType<typeof createAssistantNativeRuntime>["roomBrowser"];
  roomTerminals: ReturnType<typeof createAssistantNativeRuntime>["roomTerminals"];
  roomFiles: ReturnType<typeof createAssistantNativeRuntime>["roomFiles"];
  roomDevServers: ReturnType<typeof createAssistantNativeRuntime>["roomDevServers"];
  roomSessions: ConversationManagementTools<string>;
  assistantWorkspaceOwner: AssistantWorkspaceOwner;
  assistantBackgroundEffect: ReturnType<
    typeof createAssistantNativeRuntime
  >["assistantBackgroundEffect"];
  executeBackgroundEffect: ReturnType<
    typeof createAssistantNativeRuntime
  >["executeBackgroundEffect"];
  backgroundEffectStatus: ReturnType<typeof createAssistantNativeRuntime>["backgroundEffectStatus"];
  roomWorkspace: ConversationManagementTools<string>;
  workspaceTransferSource: AsyncLocalStorage<{
    valid: () => boolean;
    source: {
      deviceHash: string;
      projectCwd: string;
      installationId: string;
      registryRevision: string;
      visibilityEpoch: number;
      policyGeneration: string;
    };
  }>;
  conversationThreadCrews: ConversationThreadCrewTools;
  conversationManagement: ConversationManagementTools;
  roomProjectNotes: ConversationManagementTools<string>;
  deviceHost: DeviceHost;
  devicePreviews: DevicePreviews;
  roomAttestationSigner: RoomAttestationSigner;
  roomDelegationTarget: ReturnType<typeof createAssistantNativeRuntime>["roomDelegationTarget"];
  socialPeers: SocialPeers;
  terminalLogs: RuntimeTerminalLogs;
  visibilityFence: AssistantVisibilityFence;
  mcpBridgeMetadata: ReturnType<typeof createMobileRuntime>["mcpBridgeMetadata"];
  requestWorkspaceOwner: ReturnType<typeof createWorkspacesRuntime>["requestWorkspaceOwner"];
  desktopHelper: HostDesktopHelper;
  nativeDeliveryService: ReturnType<typeof createNativeRuntime>["nativeDeliveryService"];
  nativeDevicesService: ReturnType<typeof createNativeRuntime>["nativeDevicesService"];
  nativeServiceUploads: ReturnType<typeof createNativeRuntime>["nativeServiceUploads"];
  nativeServicesService: ReturnType<typeof createNativeRuntime>["nativeServicesService"];
  modelsService: ReturnType<typeof createNativeRuntime>["modelsService"];
  nativeBufferUploads: ReturnType<typeof createNativeRuntime>["nativeBufferUploads"];
  nativeWorkspacesService: ReturnType<typeof createNativeRuntime>["nativeWorkspacesService"];
  crewOperation: ReturnType<typeof createNativeRuntime>["crewOperation"];
  sessionService: ReturnType<typeof createSessionServicesRuntime>["sessionService"];
  queueOperation: ReturnType<typeof createSessionServicesRuntime>["queueOperation"];
  fileService: ReturnType<typeof createGitRuntime>["fileService"];
  automationsService: ReturnType<typeof createNativeRuntime>["automationsService"];
  devServersService: ReturnType<typeof createGitRuntime>["devServersService"];
  goalsService: ReturnType<typeof createGitRuntime>["goalsService"];
  stewardsService: ReturnType<typeof createNativeRuntime>["stewardsService"];
  tasksService: ReturnType<typeof createGitRuntime>["tasksService"];
  notesService: ReturnType<typeof createGitRuntime>["notesService"];
  terminalService: ReturnType<typeof createGitRuntime>["terminalService"];
  signal: ReturnType<typeof createProjectsRuntime>["signal"];
  invalidateSessionSource: Awaited<
    ReturnType<typeof createSessionListRuntime>
  >["invalidateSessionSource"];
  mcpHttp: McpHttp;
  mcpHub: McpHub;
  lifecycle: HostPrivateControlHandler | undefined;
  controls: HostPrivateControl | undefined;
  bulkHandler: ReturnType<typeof createSubscriptionsRuntime>["bulkHandler"];
  mobilePairing: MobilePairing;
  httpTokenHashes: WeakMap<object, { token: string; hash: string }>;
  nativeDevicesOwner: ReturnType<typeof createNativeRuntime>["nativeDevicesOwner"];
  nativeDeliveryOwner: ReturnType<typeof createNativeRuntime>["nativeDeliveryOwner"];
  nativeServicesOwner: ReturnType<typeof createNativeRuntime>["nativeServicesOwner"];
  devServerAccess: DevServerAccess;
  withWorkspaceOwner: ReturnType<typeof createWorkspacesRuntime>["withWorkspaceOwner"];
  conversationDesktopControl: ConversationDesktopControlTools;
  conversationRuntimeReads: ConversationRuntimeReadTools;
  explicitSkillNames: Awaited<ReturnType<typeof createSessionsRuntime>>["explicitSkillNames"];
  conversationStewards: ConversationStewardTools;
  conversationTaskQueue: ConversationTaskQueueTools;
  conversationDelegation: ConversationDelegation;
  conversationGoals: ConversationGoalTools;
  conversationSecrets: ConversationSecretTools;
  pullRequestWatch: PullRequestWatches;
  pullRequestWatchTools: PullRequestWatchTools;
  conversationProject: ConversationProjectTools;
  logMonitors: RuntimeLogMonitors;
  diagnostics: ResourceDiagnostics;
  workspaceOwnerDeviceId: ReturnType<typeof createWorkspacesRuntime>["workspaceOwnerDeviceId"];
  voiceCloud: VoiceCloudCredentials;
  localVoice: LocalVoiceService;
  voiceSetup: VoiceSetupService;
  pushDevices: PushDeviceStore;
  pushNotifications: PushNotifications;
  approvals: ApprovalRegistry;
  decisionModels: DecisionModelsService;
  accountPlatform: AccountPlatformRuntime;
  catalogs: ModelCatalogCache;
  handoffHistory: HandoffHistoryStore;
  heldPolls: Map<{ revoked: boolean }, string>;
  remoteChanges: RemoteChanges;
  projectChangeSnapshot: Awaited<
    ReturnType<typeof createSessionListRuntime>
  >["projectChangeSnapshot"];
  taskChangeEtag: Awaited<ReturnType<typeof createSessionListRuntime>>["taskChangeEtag"];
  gitWatches: GitWatches;
  desktopDelete: DesktopDelete;
  /** Remote changes the desktop shows a notice for; read on its heartbeat. */
  remoteActivity: RemoteActivityFeed;
  invalidateSessionCopies: ReturnType<typeof createSubscriptionsRuntime>["invalidateSessionCopies"];
  withinBeat: ReturnType<typeof createSessionLeasesRuntime>["withinBeat"];
  desktopCommandDelivery: DesktopCommandDelivery;
  renewRunLeases: ReturnType<typeof createSessionLeasesRuntime>["renewRunLeases"];
  heartbeatEffects: ReturnType<typeof createSessionLeasesRuntime>["heartbeatEffects"];
  providerInbox: ProviderInboxBridge;
  adoptedChanges: AdoptedChanges;
  renewQueueLeases: ReturnType<typeof createSessionLeasesRuntime>["renewQueueLeases"];
  writerTransfers: Set<string>;
  sessionQueueService: ReturnType<typeof createSessionServicesRuntime>["sessionQueueService"];
  scopedDesktopCall: Awaited<ReturnType<typeof createSocialRuntime>>["scopedDesktopCall"];
  desktopSigningSecret: Awaited<ReturnType<typeof createSocialRuntime>>["desktopSigningSecret"];
  crewsService: ReturnType<typeof createNativeRuntime>["crewsService"];
  bindQuestionUpload: ReturnType<typeof createSessionServicesRuntime>["bindQuestionUpload"];
  mobileIngressSecret: ReturnType<typeof createMobileRuntime>["mobileIngressSecret"];
  subscriptionHub: HostSubscriptionHub;
  bulkTransfers: HostBulkTransfers;
  closing: ReturnType<typeof createHttpRuntime>["closing"];
  websocket: ReturnType<typeof createWebsocketRuntime>["websocket"];
  unsubscribeChanges: ReturnType<typeof createSubscriptionsRuntime>["unsubscribeChanges"];
  unsubscribeAuthorization: ReturnType<
    typeof createSubscriptionsRuntime
  >["unsubscribeAuthorization"];
  unsubscribeAuthority: ReturnType<typeof createSubscriptionsRuntime>["unsubscribeAuthority"];
  taskDeleted: ReturnType<typeof createSubscriptionsRuntime>["taskDeleted"];
  previousTaskDelete: ReturnType<typeof createSubscriptionsRuntime>["previousTaskDelete"];
  goalDeleted: ReturnType<typeof createSubscriptionsRuntime>["goalDeleted"];
  previousGoalDelete: ReturnType<typeof createSubscriptionsRuntime>["previousGoalDelete"];
  automationDeleted: ReturnType<typeof createSubscriptionsRuntime>["automationDeleted"];
  previousAutomationDelete: ReturnType<
    typeof createSubscriptionsRuntime
  >["previousAutomationDelete"];
  stewardDeleted: ReturnType<typeof createSubscriptionsRuntime>["stewardDeleted"];
  previousStewardDelete: ReturnType<typeof createSubscriptionsRuntime>["previousStewardDelete"];
  crewDefinitionDeleted: ReturnType<typeof createSubscriptionsRuntime>["crewDefinitionDeleted"];
  previousCrewDefinitionDeleted: ReturnType<
    typeof createSubscriptionsRuntime
  >["previousCrewDefinitionDeleted"];
  crewAgentDeleted: ReturnType<typeof createSubscriptionsRuntime>["crewAgentDeleted"];
  previousCrewAgentDeleted: ReturnType<
    typeof createSubscriptionsRuntime
  >["previousCrewAgentDeleted"];
  crewRunDeleted: ReturnType<typeof createSubscriptionsRuntime>["crewRunDeleted"];
  previousCrewRunDeleted: ReturnType<typeof createSubscriptionsRuntime>["previousCrewRunDeleted"];
  assistantKeepAwake: HostAssistantKeepAwake;
  managedAssistantSessions: Awaited<
    ReturnType<typeof createAssistantRuntime>
  >["managedAssistantSessions"];
  previousOwnerInstructions: Awaited<
    ReturnType<typeof createAssistantRuntime>
  >["previousOwnerInstructions"];
  xBrowser: XBrowserSessions;
  requests: Set<Promise<void>>;
  observationCoverage: ReturnType<typeof createAssistantNativeRuntime>["observationCoverage"];
}
