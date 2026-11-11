import { createRuntimeSlot } from "./server/runtime-slot";
import { type RemoteProvider } from "../src/features/connections/model/protocol";
import { HostAutomations } from "./automations/automations";
import { DesktopSessions } from "./desktop/desktopSessions";
import { HostEngine } from "./engine";
import { RunLeases } from "./execution/run-lease";
import { HostGoals } from "./goals/goals";
import { createAssistantRuntime } from "./server/assistant";
import { createAssistantDisclosureRuntime } from "./server/assistant-disclosure";
import { createAssistantNativeRuntime } from "./server/assistant-native";
import { createAssistantRoomRuntime } from "./server/assistant-room";
import { createServerBindings } from "./server/dependencies";

import { createCommandsRuntime } from "./server/commands";
import { createConversationRuntime } from "./server/conversation";
import { createCrewsRuntime } from "./server/crews";
import { createDevelopmentRuntime } from "./server/development";
import { createDevicesRuntime } from "./server/devices";
import { createEnvironmentRuntime } from "./server/environment";
import { createGitRuntime } from "./server/git";
import { createHttpRuntime } from "./server/http";
import { bootPhase } from "./server/boot-phases";
import { createLifecycleRuntime } from "./server/lifecycle";
import { createManagementRuntime } from "./server/management";
import { createMobileRuntime } from "./server/mobile";
import { McpHub } from "./mcp/hub/hub";
import { dirname } from "node:path";
import { createNativeRuntime } from "./server/native";
import { createProjectsRuntime } from "./server/projects";
import { createRegistryRuntime } from "./server/registry";
import { createSessionLeasesRuntime } from "./server/session-leases";
import { createSessionListRuntime } from "./server/session-list";
import { createSessionQueueRuntime } from "./server/session-queue";
import { createSessionServicesRuntime } from "./server/session-services";
import { createSessionViewsRuntime } from "./server/session-views";
import { createSessionsRuntime } from "./server/sessions";
import { createSocialRuntime } from "./server/social";
import { createStewardsRuntime } from "./server/stewards";
import { createSubscriptionsRuntime } from "./server/subscriptions";
import { HostPrivateControl, HostPrivateControlHandler } from "./server/support";
import { createTasksRuntime } from "./server/tasks";
import { createAccountPlatformRuntime } from "./server/account-platform";
import { createDecisionModelsRuntime } from "./server/decision-models";
import { createVoiceRuntime } from "./server/voice";
import { createPushRuntime } from "./server/push";
import { createWebsocketRuntime } from "./server/websocket";
import { createWorkspacesRuntime } from "./server/workspaces";
import { SocialService } from "./social/social";
import { HostStewards } from "./stewards/stewards";
import { HostTasks } from "./tasks/tasks";
import { HostTerminals } from "./terminals/terminals";
import { ExternalTunnels } from "./tunnels/tunnels";

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
  mcpHubOverride?: McpHub,
) {
  const controls: HostPrivateControl | undefined =
    typeof privateControl === "function" ? { lifecycle: privateControl } : privateControl;
  const lifecycle = controls?.lifecycle;
  await engine.ready;
  const terminals = terminalsOverride ?? new HostTerminals();
  const mcpHub =
    mcpHubOverride ??
    new McpHub({
      dataDir: dirname(engine.store.attachmentDir),
      projectCwd: async (id) => (await engine.store.project(id).catch(() => undefined))?.cwd,
    });
  const runLeases = new RunLeases();
  const dependencies = createServerBindings(
    {
      engine: () => engine,
      desktop: () => desktop,
      runLeases: () => runLeases,
      terminals: () => terminals,
      tasks: () => tasksRuntime.current.tasks,
      automationsOverride: () => automationsOverride,
      managed: () => workspacesRuntime.managed,
      tasksOverride: () => tasksOverride,
      goalsOverride: () => goalsOverride,
      goals: () => tasksRuntime.current.goals,
      hostNotes: () => conversationRuntime.hostNotes,
      automations: () => tasksRuntime.current.automations,
      stewardsOverride: () => stewardsOverride,
      recordWorkspaceActivity: () => workspacesRuntime.recordWorkspaceActivity,
      managedWorkspaces: () => workspacesRuntime.managedWorkspaces,
      inWorkspace: () => workspacesRuntime.inWorkspace,
      startWorkspaceActivity: () => workspacesRuntime.startWorkspaceActivity,
      featureDirectory: () => devicesRuntime.featureDirectory,
      devServers: () => devicesRuntime.devServers,
      server: () => httpRuntime.server,
      assertHostMayRun: () => sessionQueueRuntime.current.assertHostMayRun,
      providers: () => providers,
      refresh: () => sessionQueueRuntime.current.refresh,
      socialOverride: () => socialOverride,
      featureSession: () => sessionsRuntime.current.featureSession,
      assistant: () => assistantRuntime.current.assistant,
      desktopControl: () => assistantRuntime.current.desktopControl,
      featureMeta: () => sessionsRuntime.current.featureMeta,
      sessionRead: () => sessionsRuntime.current.sessionRead,
      sessionQueues: () => sessionsRuntime.current.sessionQueues,
      queueSessionKnown: () => sessionsRuntime.current.queueSessionKnown,
      adopt: () => sessionsRuntime.current.adopt,
      touchSessionWorkspace: () => workspacesRuntime.touchSessionWorkspace,
      withRetiredDesktopWriters: () => sessionsRuntime.current.withRetiredDesktopWriters,
      hostRuns: () => sessionQueueRuntime.current.hostRuns,
      queueDrainer: () => sessionQueueRuntime.current.queueDrainer,
      inHost: () => sessionsRuntime.current.inHost,
      desktopWatch: () => sessionQueueRuntime.current.desktopWatch,
      desktopSnapshot: () => sessionsRuntime.current.desktopSnapshot,
      genericAcp: () => devicesRuntime.genericAcp,
      stewards: () => stewardsRuntime.current.stewards,
      conversationDesktop: () => socialRuntime.current.conversationDesktop,
      models: () => projectsRuntime.models,
      commandService: () => commandsRuntime.commandService,
      catchUp: () => sessionViewsRuntime.catchUp,
      projectSessionList: () => sessionListRuntime.current.projectSessionList,
      social: () => socialRuntime.current.social,
      tunnelsOverride: () => tunnelsOverride,
      mcpHub: () => mcpHub,
      conversationAccess: () => socialRuntime.current.conversationAccess,
      runtimeLogAccess: () => socialRuntime.current.runtimeLogAccess,
      runtimeLogs: () => devicesRuntime.runtimeLogs,
      runtimeLogWaiter: () => devicesRuntime.runtimeLogWaiter,
      refreshLogSources: () => developmentRuntime.refreshLogSources,
      conversationWorkspace: () => conversationRuntime.conversationWorkspace,
      localSessionReference: () => sessionsRuntime.current.localSessionReference,
      domainDispatcher: () => registryRuntime.domainDispatcher,
      webControl: () => developmentRuntime.webControl,
      mobileLan: () => mobileRuntime.mobileLan,
      buildIdentity: () => workspacesRuntime.buildIdentity,
      namedProjects: () => assistantRuntime.current.namedProjects,
      readSessionView: () => sessionViewsRuntime.readSessionView,
      desktopView: () => sessionViewsRuntime.desktopView,
      desktopSync: () => sessionViewsRuntime.desktopSync,
      desktopRecheckMs: () => projectsRuntime.desktopRecheckMs,
      transcriptPages: () => projectsRuntime.transcriptPages,
      transfers: () => projectsRuntime.transfers,
      revisionWaits: () => projectsRuntime.revisionWaits,
      sessionSourceEpoch: () => sessionListRuntime.current.sessionSourceEpoch,
      attachmentOwnership: () => sessionsRuntime.current.attachmentOwnership,
      featureMetaStable: () => sessionsRuntime.current.featureMetaStable,
      questionBinding: () => sessionServicesRuntime.questionBinding,
      crews: () => crewsRuntime.crews,
      touchTerminalWorkspace: () => devicesRuntime.touchTerminalWorkspace,
      workspace: () => projectsRuntime.workspace,
      workspaceForOwnerRpc: () => workspacesRuntime.workspaceForOwnerRpc,
      sprints: () => tasksRuntime.current.sprints,
      visibleProjectForThread: () => assistantNativeRuntime.visibleProjectForThread,
      environmentService: () => environmentRuntime.environmentService,
      persistenceService: () => nativeRuntime.persistenceService,
      tunnels: () => mobileRuntime.tunnels,
      mobileAccess: () => mobileRuntime.mobileAccess,
      featureClaims: () => workspacesRuntime.featureClaims,
      projectsService: () => sessionServicesRuntime.projectsService,
      workspacePolicy: () => workspacesRuntime.workspacePolicy,
      sprintsService: () => gitRuntime.sprintsService,
      gitService: () => gitRuntime.gitService,
      socialTransport: () => socialRuntime.current.socialTransport,
      withRoomProjectScope: () => assistantDisclosureRuntime.withRoomProjectScope,
      conversationThreadWork: () => managementRuntime.conversationThreadWork,
      assistantPorts: () => assistantRuntime.current.assistantPorts,
      approveManagementOperation: () => managementRuntime.approveManagementOperation,
      sharedBrowser: () => devicesRuntime.sharedBrowser,
      conversationPreviews: () => devicesRuntime.conversationPreviews,
      browserRuntime: () => devicesRuntime.browserRuntime,
      nativeAdmissionOwner: () => assistantNativeRuntime.nativeAdmissionOwner,
      roomVisibleProject: () => assistantNativeRuntime.roomVisibleProject,
      visibilityAdmission: () => assistantNativeRuntime.visibilityAdmission,
      observationJournal: () => assistantNativeRuntime.observationJournal,
      roomResourceReceipts: () => assistantNativeRuntime.roomResourceReceipts,
      withNativeObservationScope: () => assistantDisclosureRuntime.withNativeObservationScope,
      nativeObservationGeneration: () => assistantNativeRuntime.nativeObservationGeneration,
      nativeVoiceLeases: () => assistantNativeRuntime.nativeVoiceLeases,
      retireNativeVoiceGenerations: () => assistantDisclosureRuntime.retireNativeVoiceGenerations,
      observationHostPages: () => assistantNativeRuntime.observationHostPages,
      observationNativePages: () => assistantNativeRuntime.observationNativePages,
      observationProjectPages: () => assistantNativeRuntime.observationProjectPages,
      observationPages: () => assistantNativeRuntime.observationPages,
      withNativeSessionScope: () => assistantDisclosureRuntime.withNativeSessionScope,
      executeAccountSocial: () => assistantNativeRuntime.executeAccountSocial,
      roomNotebook: () => assistantNativeRuntime.roomNotebook,
      conversationManagementRuntime: () => managementRuntime.conversationManagementRuntime,
      globalServerManagement: () => managementRuntime.globalServerManagement,
      globalAssistantManagement: () => managementRuntime.globalAssistantManagement,
      roomBrowser: () => assistantNativeRuntime.roomBrowser,
      roomTerminals: () => assistantNativeRuntime.roomTerminals,
      roomFiles: () => assistantNativeRuntime.roomFiles,
      roomDevServers: () => assistantNativeRuntime.roomDevServers,
      roomSessions: () => assistantNativeRuntime.roomSessions,
      assistantWorkspaceOwner: () => assistantNativeRuntime.assistantWorkspaceOwner,
      roomWorkspace: () => assistantNativeRuntime.roomWorkspace,
      workspaceTransferSource: () => assistantNativeRuntime.workspaceTransferSource,
      conversationThreadCrews: () => managementRuntime.conversationThreadCrews,
      conversationManagement: () => managementRuntime.conversationManagement,
      roomProjectNotes: () => assistantNativeRuntime.roomProjectNotes,
      deviceHost: () => devicesRuntime.deviceHost,
      devicePreviews: () => devicesRuntime.devicePreviews,
      roomAttestationSigner: () => assistantRuntime.current.roomAttestationSigner,
      roomDelegationTarget: () => assistantNativeRuntime.roomDelegationTarget,
      socialPeers: () => socialRuntime.current.socialPeers,
      terminalLogs: () => devicesRuntime.terminalLogs,
      visibilityFence: () => assistantNativeRuntime.visibilityFence,
      mcpBridgeMetadata: () => mobileRuntime.mcpBridgeMetadata,
      requestWorkspaceOwner: () => workspacesRuntime.requestWorkspaceOwner,
      desktopHelper: () => assistantRuntime.current.desktopHelper,
      nativeDeliveryService: () => nativeRuntime.nativeDeliveryService,
      nativeDevicesService: () => nativeRuntime.nativeDevicesService,
      nativeServiceUploads: () => nativeRuntime.nativeServiceUploads,
      nativeServicesService: () => nativeRuntime.nativeServicesService,
      modelsService: () => nativeRuntime.modelsService,
      nativeBufferUploads: () => nativeRuntime.nativeBufferUploads,
      nativeWorkspacesService: () => nativeRuntime.nativeWorkspacesService,
      crewOperation: () => nativeRuntime.crewOperation,
      sessionService: () => sessionServicesRuntime.sessionService,
      queueOperation: () => sessionServicesRuntime.queueOperation,
      fileService: () => gitRuntime.fileService,
      automationsService: () => nativeRuntime.automationsService,
      devServersService: () => gitRuntime.devServersService,
      goalsService: () => gitRuntime.goalsService,
      stewardsService: () => nativeRuntime.stewardsService,
      tasksService: () => gitRuntime.tasksService,
      notesService: () => gitRuntime.notesService,
      terminalService: () => gitRuntime.terminalService,
      signal: () => projectsRuntime.signal,
      invalidateSessionSource: () => sessionListRuntime.current.invalidateSessionSource,
      mcpHttp: () => mobileRuntime.mcpHttp,
      lifecycle: () => lifecycle,
      controls: () => controls,
      bulkHandler: () => subscriptionsRuntime.bulkHandler,
      mobilePairing: () => mobileRuntime.mobilePairing,
      httpTokenHashes: () => subscriptionsRuntime.httpTokenHashes,
      nativeDevicesOwner: () => nativeRuntime.nativeDevicesOwner,
      nativeDeliveryOwner: () => nativeRuntime.nativeDeliveryOwner,
      nativeServicesOwner: () => nativeRuntime.nativeServicesOwner,
      devServerAccess: () => developmentRuntime.devServerAccess,
      withWorkspaceOwner: () => workspacesRuntime.withWorkspaceOwner,
      conversationDesktopControl: () => socialRuntime.current.conversationDesktopControl,
      conversationRuntimeReads: () => projectsRuntime.conversationRuntimeReads,
      explicitSkillNames: () => sessionsRuntime.current.explicitSkillNames,
      conversationStewards: () => projectsRuntime.conversationStewards,
      conversationTaskQueue: () => projectsRuntime.conversationTaskQueue,
      conversationDelegation: () => projectsRuntime.conversationDelegation,
      conversationGoals: () => projectsRuntime.conversationGoals,
      conversationSecrets: () => projectsRuntime.conversationSecrets,
      pullRequestWatch: () => projectsRuntime.pullRequestWatch,
      pullRequestWatchTools: () => projectsRuntime.pullRequestWatchTools,
      conversationProject: () => projectsRuntime.conversationProject,
      logMonitors: () => devicesRuntime.logMonitors,
      diagnostics: () => devicesRuntime.diagnostics,
      workspaceOwnerDeviceId: () => workspacesRuntime.workspaceOwnerDeviceId,
      voiceCloud: () => voiceRuntime.voiceCloud,
      localVoice: () => voiceRuntime.localVoice,
      voiceSetup: () => voiceRuntime.voiceSetup,
      pushDevices: () => pushRuntime.pushDevices,
      pushNotifications: () => pushRuntime.pushNotifications,
      approvals: () => pushRuntime.approvals,
      decisionModels: () => decisionRuntime.decisionModels,
      accountPlatform: () => accountPlatformRuntime,
      catalogs: () => projectsRuntime.catalogs,
      handoffHistory: () => devicesRuntime.handoffHistory,
      heldPolls: () => subscriptionsRuntime.heldPolls,
      remoteChanges: () => projectsRuntime.remoteChanges,
      projectChangeSnapshot: () => sessionListRuntime.current.projectChangeSnapshot,
      taskChangeEtag: () => sessionListRuntime.current.taskChangeEtag,
      gitWatches: () => projectsRuntime.gitWatches,
      desktopDelete: () => sessionsRuntime.current.desktopDelete,
      remoteActivity: () => sessionsRuntime.current.remoteActivity,
      invalidateSessionCopies: () => subscriptionsRuntime.invalidateSessionCopies,
      withinBeat: () => sessionLeasesRuntime.withinBeat,
      desktopCommandDelivery: () => sessionServicesRuntime.desktopCommandDelivery,
      renewRunLeases: () => sessionLeasesRuntime.renewRunLeases,
      heartbeatEffects: () => sessionLeasesRuntime.heartbeatEffects,
      providerInbox: () => conversationRuntime.providerInbox,
      adoptedChanges: () => sessionsRuntime.current.adoptedChanges,
      renewQueueLeases: () => sessionLeasesRuntime.renewQueueLeases,
      writerTransfers: () => sessionsRuntime.current.writerTransfers,
      sessionQueueService: () => sessionServicesRuntime.sessionQueueService,
      scopedDesktopCall: () => socialRuntime.current.scopedDesktopCall,
      desktopSigningSecret: () => socialRuntime.current.desktopSigningSecret,
      crewsService: () => nativeRuntime.crewsService,
      bindQuestionUpload: () => sessionServicesRuntime.bindQuestionUpload,
      mobileIngressSecret: () => mobileRuntime.mobileIngressSecret,
      subscriptionHub: () => subscriptionsRuntime.subscriptionHub,
      bulkTransfers: () => subscriptionsRuntime.bulkTransfers,
      closing: () => httpRuntime.closing,
      websocket: () => websocketRuntime.websocket,
      unsubscribeChanges: () => subscriptionsRuntime.unsubscribeChanges,
      unsubscribeAuthorization: () => subscriptionsRuntime.unsubscribeAuthorization,
      unsubscribeAuthority: () => subscriptionsRuntime.unsubscribeAuthority,
      taskDeleted: () => subscriptionsRuntime.taskDeleted,
      previousTaskDelete: () => subscriptionsRuntime.previousTaskDelete,
      goalDeleted: () => subscriptionsRuntime.goalDeleted,
      previousGoalDelete: () => subscriptionsRuntime.previousGoalDelete,
      automationDeleted: () => subscriptionsRuntime.automationDeleted,
      previousAutomationDelete: () => subscriptionsRuntime.previousAutomationDelete,
      stewardDeleted: () => subscriptionsRuntime.stewardDeleted,
      previousStewardDelete: () => subscriptionsRuntime.previousStewardDelete,
      crewDefinitionDeleted: () => subscriptionsRuntime.crewDefinitionDeleted,
      previousCrewDefinitionDeleted: () => subscriptionsRuntime.previousCrewDefinitionDeleted,
      crewAgentDeleted: () => subscriptionsRuntime.crewAgentDeleted,
      previousCrewAgentDeleted: () => subscriptionsRuntime.previousCrewAgentDeleted,
      crewRunDeleted: () => subscriptionsRuntime.crewRunDeleted,
      previousCrewRunDeleted: () => subscriptionsRuntime.previousCrewRunDeleted,
      assistantKeepAwake: () => assistantRuntime.current.assistantKeepAwake,
      managedAssistantSessions: () => assistantRuntime.current.managedAssistantSessions,
      previousOwnerInstructions: () => assistantRuntime.current.previousOwnerInstructions,
      xBrowser: () => socialRuntime.current.xBrowser,
      requests: () => httpRuntime.requests,
      observationCoverage: () => assistantNativeRuntime.observationCoverage,
    },
    {
      heartbeatEffects: (value) => {
        sessionLeasesRuntime.heartbeatEffects = value;
      },
      closing: (value) => {
        httpRuntime.closing = value;
      },
      observationCoverage: (value) => {
        assistantNativeRuntime.observationCoverage = value;
      },
    },
  );
  const workspacesRuntime = createWorkspacesRuntime(dependencies);
  const tasksRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createTasksRuntime>>>();
  await bootPhase("runtime-tasks", () => createTasksRuntime(dependencies, tasksRuntime.publish));
  const assistantRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createAssistantRuntime>>>();
  await bootPhase("runtime-assistant", () =>
    createAssistantRuntime(dependencies, assistantRuntime.publish),
  );
  const stewardsRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createStewardsRuntime>>>();
  await bootPhase("runtime-stewards", () =>
    createStewardsRuntime(dependencies, stewardsRuntime.publish),
  );
  const devicesRuntime = createDevicesRuntime(dependencies);
  const voiceRuntime = createVoiceRuntime(dependencies);
  // Before Social so the decision service can be handed to it (see phase3-p35b-done.md).
  const decisionRuntime = createDecisionModelsRuntime(dependencies);
  const developmentRuntime = createDevelopmentRuntime(dependencies);
  const sessionsRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createSessionsRuntime>>>();
  await bootPhase("runtime-sessions", () =>
    createSessionsRuntime(dependencies, sessionsRuntime.publish),
  );
  const socialRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createSocialRuntime>>>();
  await bootPhase("runtime-social", () => createSocialRuntime(dependencies, socialRuntime.publish));
  const sessionQueueRuntime =
    createRuntimeSlot<Awaited<ReturnType<typeof createSessionQueueRuntime>>>();
  await bootPhase("runtime-session-queue", () =>
    createSessionQueueRuntime(dependencies, sessionQueueRuntime.publish),
  );
  const sessionLeasesRuntime = createSessionLeasesRuntime(dependencies);
  const sessionViewsRuntime = createSessionViewsRuntime(dependencies);
  const projectsRuntime = createProjectsRuntime(dependencies);
  const crewsRuntime = createCrewsRuntime(dependencies);
  const sessionListRuntime =
    createRuntimeSlot<Awaited<ReturnType<typeof createSessionListRuntime>>>();
  await bootPhase("runtime-session-list", () =>
    createSessionListRuntime(dependencies, sessionListRuntime.publish),
  );
  const pushRuntime = createPushRuntime(dependencies);
  const conversationRuntime = createConversationRuntime(dependencies);
  const mobileRuntime = createMobileRuntime(dependencies);
  const environmentRuntime = createEnvironmentRuntime(dependencies);
  const sessionServicesRuntime = createSessionServicesRuntime(dependencies);
  const commandsRuntime = createCommandsRuntime(dependencies);
  const accountPlatformRuntime = await bootPhase("runtime-account-platform", () =>
    createAccountPlatformRuntime(dependencies),
  );
  const gitRuntime = createGitRuntime(dependencies);
  const managementRuntime = createManagementRuntime(dependencies);
  const assistantNativeRuntime = createAssistantNativeRuntime(dependencies);
  const assistantDisclosureRuntime = createAssistantDisclosureRuntime(dependencies);
  createAssistantRoomRuntime(dependencies);
  const nativeRuntime = createNativeRuntime(dependencies);
  const registryRuntime = createRegistryRuntime(dependencies);
  const subscriptionsRuntime = createSubscriptionsRuntime(dependencies);
  const httpRuntime = createHttpRuntime(dependencies);
  const websocketRuntime = createWebsocketRuntime(dependencies);
  const lifecycleRuntime = createRuntimeSlot<Awaited<ReturnType<typeof createLifecycleRuntime>>>();
  await bootPhase("runtime-recovery", () =>
    createLifecycleRuntime(dependencies, lifecycleRuntime.publish),
  );
  return Object.assign(httpRuntime.server, {
    assistant: assistantRuntime.current.assistant,
    desktop,
    observationJournal: assistantNativeRuntime.observationJournal,
    observationCoverage: assistantNativeRuntime.observationCoverage,
    tasks: tasksRuntime.current.tasks,
    automations: tasksRuntime.current.automations,
    goals: tasksRuntime.current.goals,
    stewards: stewardsRuntime.current.stewards,
    managedWorkspaces: workspacesRuntime.managed,
    social: socialRuntime.current.social,
    tunnels: mobileRuntime.tunnels,
    terminals,
    runtimeLogAccess: socialRuntime.current.runtimeLogAccess,
    conversationAccess: socialRuntime.current.conversationAccess,
    closeResources: lifecycleRuntime.current.closeResources,
  });
}

export type { HostPrivateControl, HostPrivateControlHandler } from "./server/support";
