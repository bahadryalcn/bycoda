import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { handleApprovalsRpc } from "./rpc-approvals";
import { handleAppearanceRpc } from "./rpc-appearance";
import { handleAssistantRpc } from "./rpc-assistant";
import { handleAssistantBuilderRpc } from "./rpc-assistant-builder";
import { handleBrowserRpc } from "./rpc-browser";
import { handleConversationRpc } from "./rpc-conversation";
import { handleCrewsRpc } from "./rpc-crews";
import { handleDesktopRpc } from "./rpc-desktop";
import { handleDevelopmentRpc } from "./rpc-development";
import { handleDevicesRpc } from "./rpc-devices";
import { handleEnvironmentRpc } from "./rpc-environment";
import { handleFilesRpc } from "./rpc-files";
import { handleGitRpc } from "./rpc-git";
import { handleInboxRpc } from "./rpc-inbox";
import { handleNativeRpc } from "./rpc-native";
import { handleNotesRpc } from "./rpc-notes";
import { handleProjectsRpc } from "./rpc-projects";
import { handleProvidersRpc } from "./rpc-providers";
import { handleResourcesRpc } from "./rpc-resources";
import { handleRuntimeLogsRpc } from "./rpc-runtime-logs";
import { handleSessionsRpc } from "./rpc-sessions";
import { handleTasksRpc } from "./rpc-tasks";
import { handleTerminalsRpc } from "./rpc-terminals";
import { handlePullRequestsRpc } from "./rpc-pull-requests";
import { handleUsageRpc } from "./rpc-usage";
import { handleActivityOwnerRpc, handleSessionLifecycleRpc } from "./rpc-account-platform";
import { handleDecisionModelsRpc } from "./rpc-decision-models";
import { handleSecretsOwnerRpc } from "./rpc-secrets";
import { handleVoiceRpc } from "./rpc-voice";
import { handlePushRpc } from "./rpc-push";
import { handleWorkspacesRpc } from "./rpc-workspaces";
import { handleDiagnosticsLogsRpc } from "./rpc-diagnostics";
import { createLogger } from "../diagnostics/logger";

const rpcLog = createLogger("host.rpc");
const SLOW_RPC_MS = 2_000;
import { handleWorktreesRpc } from "./rpc-worktrees";
type Dependencies = Pick<
  ServerBindings,
  | "engine"
  | "pullRequestWatch"
  | "managedWorkspaces"
  | "workspaceForOwnerRpc"
  | "withWorkspaceOwner"
  | "managed"
  | "tasks"
  | "workspaceOwnerDeviceId"
  | "featureClaims"
  | "nativeWorkspacesService"
  | "nativeDeliveryService"
  | "nativeBufferUploads"
  | "nativeServiceUploads"
  | "nativeServicesService"
  | "inHost"
  | "sessionService"
  | "adopt"
  | "startWorkspaceActivity"
  | "desktop"
  | "desktopDelete"
  | "remoteActivity"
  | "invalidateSessionCopies"
  | "sessionQueues"
  | "commandService"
  | "withinBeat"
  | "desktopCommandDelivery"
  | "renewRunLeases"
  | "heartbeatEffects"
  | "providerInbox"
  | "hostNotes"
  | "adoptedChanges"
  | "renewQueueLeases"
  | "runLeases"
  | "queueDrainer"
  | "queueSessionKnown"
  | "writerTransfers"
  | "hostRuns"
  | "sessionQueueService"
  | "attachmentOwnership"
  | "readSessionView"
  | "bindQuestionUpload"
  | "workspacePolicy"
  | "projectsService"
  | "scopedDesktopCall"
  | "terminalService"
  | "desktopSigningSecret"
  | "desktopControl"
  | "desktopHelper"
  | "assistant"
  | "logMonitors"
  | "refreshLogSources"
  | "featureMeta"
  | "runtimeLogs"
  | "terminalLogs"
  | "devServersService"
  | "diagnostics"
  | "mcpHub"
  | "browserRuntime"
  | "sharedBrowser"
  | "environmentService"
  | "persistenceService"
  | "voiceCloud"
  | "localVoice"
  | "voiceSetup"
  | "pushDevices"
  | "pushNotifications"
  | "approvals"
  | "providers"
  | "genericAcp"
  | "catalogs"
  | "modelsService"
  | "handoffHistory"
  | "nativeDevicesService"
  | "mobilePairing"
  | "mobileLan"
  | "mobileAccess"
  | "tunnels"
  | "workspace"
  | "conversationPreviews"
  | "heldPolls"
  | "remoteChanges"
  | "sessionSourceEpoch"
  | "projectChangeSnapshot"
  | "taskChangeEtag"
  | "gitWatches"
  | "desktopRecheckMs"
  | "desktopWatch"
  | "notesService"
  | "projectSessionList"
  | "goals"
  | "automations"
  | "social"
  | "automationsService"
  | "sprintsService"
  | "tasksService"
  | "goalsService"
  | "stewardsService"
  | "crewsService"
  | "gitService"
  | "fileService"
  | "decisionModels"
  | "conversationSecrets"
  | "accountPlatform"
>;
const handlers: Record<
  string,
  (dependencies: Dependencies, request: OwnerRpcRequest) => Promise<void>
> = {
  "workspaces.prepare": handleWorkspacesRpc,
  "workspaces.list": handleWorkspacesRpc,
  "workspaces.get": handleWorkspacesRpc,
  "workspaces.exactGitRewind.get": handleWorkspacesRpc,
  "workspaces.exactGitRewind.set": handleWorkspacesRpc,
  "workspaces.pin": handleWorkspacesRpc,
  "workspaces.delivery.review": handleWorkspacesRpc,
  "workspaces.delivery.merge": handleWorkspacesRpc,
  "workspaces.delivery.publish": handleWorkspacesRpc,
  "workspaces.storage.status": handleWorkspacesRpc,
  "workspaces.bootstrap.prepare": handleWorkspacesRpc,
  "workspaces.bootstrap.status": handleWorkspacesRpc,
  "workspaces.bootstrap.cancel": handleWorkspacesRpc,
  "workspaces.activities.start": handleWorkspacesRpc,
  "workspaces.activities.stop": handleWorkspacesRpc,
  "workspaces.activities.list": handleWorkspacesRpc,
  "workspaces.resume": handleWorkspacesRpc,
  "workspaces.finish": handleWorkspacesRpc,
  "workspaces.close": handleWorkspacesRpc,
  "workspaces.featureClaims.list": handleWorkspacesRpc,
  "workspaces.featureClaims.acquire": handleWorkspacesRpc,
  "workspaces.featureClaims.release": handleWorkspacesRpc,
  "native.turn.begin": handleNativeRpc,
  "native.turn.end": handleNativeRpc,
  "native.activity.start": handleNativeRpc,
  "native.activity.end": handleNativeRpc,
  "native.buffers.update": handleNativeRpc,
  "native.buffers.heartbeat": handleNativeRpc,
  "native.buffers.retire": handleNativeRpc,
  "native.buffers.reconcile": handleNativeRpc,
  "native.buffers.recovery.list": handleNativeRpc,
  "native.buffers.recovery.read": handleNativeRpc,
  "native.buffers.recovery.status": handleNativeRpc,
  "native.rewind.plan": handleNativeRpc,
  "native.rewind.prepare": handleNativeRpc,
  "native.rewind.apply": handleNativeRpc,
  "native.rewind.status": handleNativeRpc,
  "native.rewind.lookup": handleNativeRpc,
  "native.rewind.cancelPreparation": handleNativeRpc,
  "native.rewind.ack": handleNativeRpc,
  "workspaces.cleanup.plan": handleNativeRpc,
  "workspaces.cleanup.apply": handleNativeRpc,
  "workspaces.cleanup.status": handleNativeRpc,
  "native.buffers.delivery.apply": handleNativeRpc,
  "native.delivery.epochs.open": handleNativeRpc,
  "native.delivery.epochs.status": handleNativeRpc,
  "native.delivery.epochs.compact": handleNativeRpc,
  "native.delivery.epochs.close": handleNativeRpc,
  "native.buffers.delivery.status": handleNativeRpc,
  "native.buffers.delivery.ack": handleNativeRpc,
  "native.services.delivery.apply": handleNativeRpc,
  "native.services.delivery.status": handleNativeRpc,
  "native.services.delivery.ack": handleNativeRpc,
  "native.services.delivery.result.read": handleNativeRpc,
  "native.buffers.upload.start": handleNativeRpc,
  "native.buffers.upload.write": handleNativeRpc,
  "native.buffers.upload.commit": handleNativeRpc,
  "native.buffers.upload.status": handleNativeRpc,
  "native.buffers.upload.abort": handleNativeRpc,
  "native.services.upload.begin": handleNativeRpc,
  "native.services.upload.append": handleNativeRpc,
  "native.services.upload.commit": handleNativeRpc,
  "native.services.upload.status": handleNativeRpc,
  "native.services.upload.cancel": handleNativeRpc,
  "native.services.desktop.stop": handleNativeRpc,
  "native.services.assistant.delegation.publicKey": handleNativeRpc,
  "native.services.assistant.observations.ingest": handleNativeRpc,
  "native.services.assistant.delegation.origin": handleNativeRpc,
  "native.services.assistant.delegation.nativeChallenge": handleNativeRpc,
  "native.services.assistant.delegation.attest": handleNativeRpc,
  "native.services.assistant.delegation.issue": handleNativeRpc,
  "native.services.assistant.delegation.issue.status": handleNativeRpc,
  "native.services.assistant.delegation.challenge": handleNativeRpc,
  "native.services.assistant.delegation.call": handleNativeRpc,
  "native.services.assistant.delegation.revoke": handleNativeRpc,
  "native.services.assistant.presence.get": handleNativeRpc,
  "native.services.assistant.visibility.epoch": handleNativeRpc,
  "native.services.assistant.notification.authorize": handleNativeRpc,
  "native.services.assistant.workspace.authorize": handleNativeRpc,
  "native.services.assistant.browser.panel": handleNativeRpc,
  "native.services.assistant.visibility.revoke": handleNativeRpc,
  "native.services.assistant.visibility.reopen": handleNativeRpc,
  "native.services.assistant.presence.set": handleNativeRpc,
  "native.services.desktop.status": handleNativeRpc,
  "native.services.desktop.status.wait": handleNativeRpc,
  "native.services.runtimeLogs.bridge.describe": handleNativeRpc,
  "native.services.runtimeLogs.access.issue": handleNativeRpc,
  "native.services.runtimeLogs.terminals.append": handleNativeRpc,
  "native.services.runtimeLogs.terminals.demand": handleNativeRpc,
  "native.services.conversation.bridge.describe": handleNativeRpc,
  "native.services.conversation.access.issue": handleNativeRpc,
  "native.services.conversation.desktop.take": handleNativeRpc,
  "native.services.conversation.desktop.finish": handleNativeRpc,
  "native.services.conversation.desktop.authorize": handleNativeRpc,
  "native.services.social.bridge.describe": handleNativeRpc,
  "native.services.social.access.issue": handleNativeRpc,
  "native.services.social.native.status": handleNativeRpc,
  "native.services.social.native.enroll": handleNativeRpc,
  "native.services.social.native.register": handleNativeRpc,
  "native.services.social.native.authority": handleNativeRpc,
  "native.services.social.native.reset": handleNativeRpc,
  "native.services.workspace.format": handleNativeRpc,
  "sessions.managedTurn.begin": handleSessionsRpc,
  "sessions.managedTurn.end": handleSessionsRpc,
  "sessions.managedTurn.status": handleSessionsRpc,
  "sessions.files.revertPlan": handleSessionsRpc,
  "sessions.files.revert": handleSessionsRpc,
  "sessions.rewind.status": handleSessionsRpc,
  "sessions.rewind.plan": handleSessionsRpc,
  "sessions.rewind.apply": handleSessionsRpc,
  "sessions.rewind.undo": handleSessionsRpc,
  "sessions.list": handleSessionsRpc,
  "sessions.pin.state": handleSessionsRpc,
  "sessions.pin.apply": handleSessionsRpc,
  "sessions.pin.receipt": handleSessionsRpc,
  "sessions.update": handleSessionsRpc,
  "sessions.delete": handleSessionsRpc,
  "sessions.page": handleSessionsRpc,
  "sessions.sync": handleSessionsRpc,
  "commands.status": handleSessionsRpc,
  "sessions.desktopLive": handleSessionsRpc,
  "sessions.adopted": handleSessionsRpc,
  "sessions.runLease": handleSessionsRpc,
  "sessions.queue.get": handleSessionsRpc,
  "sessions.queue.change": handleSessionsRpc,
  "sessions.queue.claim": handleSessionsRpc,
  "sessions.queue.finish": handleSessionsRpc,
  "sessions.queue.release": handleSessionsRpc,
  "sessions.queue.lease": handleSessionsRpc,
  "sessions.syncChunk": handleSessionsRpc,
  "sessions.block": handleSessionsRpc,
  "sessions.workedTime": handleSessionsRpc,
  "sessions.get": handleSessionsRpc,
  "sessions.contextual.preview": handleSessionsRpc,
  "commands.dispatch": handleSessionsRpc,
  "sync.pull": handleSessionsRpc,
  "sync.push": handleSessionsRpc,
  "usage.sessions.read": handleSessionsRpc,
  "usage.limits.read": handleUsageRpc,
  "usage.cost.read": handleUsageRpc,
  "pullRequests.link": handlePullRequestsRpc,
  "pullRequests.unlink": handlePullRequestsRpc,
  "pullRequests.linked": handlePullRequestsRpc,
  "attachments.claim": handleSessionsRpc,
  "attachments.release": handleSessionsRpc,
  "attachments.claims": handleSessionsRpc,
  "attachments.status": handleSessionsRpc,
  "attachments.upload": handleSessionsRpc,
  "attachments.read": handleSessionsRpc,
  "projects.workspacePolicy.get": handleProjectsRpc,
  "projects.workspacePolicy.update": handleProjectsRpc,
  "projects.list": handleProjectsRpc,
  "projects.directory": handleProjectsRpc,
  "projects.browse": handleProjectsRpc,
  "projects.createDirectory": handleProjectsRpc,
  "projects.open": handleProjectsRpc,
  "projects.organization.read": handleProjectsRpc,
  "projects.organization.patch": handleProjectsRpc,
  "projects.organization.status": handleProjectsRpc,
  "terminals.list": handleTerminalsRpc,
  "terminals.create": handleTerminalsRpc,
  "terminals.read": handleTerminalsRpc,
  "terminals.write": handleTerminalsRpc,
  "terminals.interrupt": handleTerminalsRpc,
  "terminals.close": handleTerminalsRpc,
  "terminals.pty.desktop.list": handleTerminalsRpc,
  "terminals.pty.desktop.create": handleTerminalsRpc,
  "terminals.pty.desktop.attach": handleTerminalsRpc,
  "terminals.pty.desktop.read": handleTerminalsRpc,
  "terminals.pty.desktop.write": handleTerminalsRpc,
  "terminals.pty.desktop.status": handleTerminalsRpc,
  "terminals.pty.desktop.resize": handleTerminalsRpc,
  "terminals.pty.desktop.detach": handleTerminalsRpc,
  "terminals.pty.desktop.close": handleTerminalsRpc,
  "desktop.status": handleDesktopRpc,
  "desktop.stop": handleDesktopRpc,
  "desktop.request": handleDesktopRpc,
  "desktop.helper.request": handleDesktopRpc,
  "assistant.request": handleAssistantRpc,
  "conversation.desktop.take": handleConversationRpc,
  "conversation.desktop.finish": handleConversationRpc,
  "conversation.desktop.authorize": handleConversationRpc,
  "conversation.bridge.describe": handleConversationRpc,
  "conversation.access.issue": handleConversationRpc,
  "runtimeLogs.terminals.append": handleConversationRpc,
  "runtimeLogs.terminals.demand": handleConversationRpc,
  "runtimeLogs.bridge.describe": handleConversationRpc,
  "runtimeLogs.access.issue": handleConversationRpc,
  "runtimeLogs.monitors.list": handleRuntimeLogsRpc,
  "runtimeLogs.monitors.start": handleRuntimeLogsRpc,
  "runtimeLogs.monitors.stop": handleRuntimeLogsRpc,
  "runtimeLogs.read": handleRuntimeLogsRpc,
  "runtimeLogs.sources": handleRuntimeLogsRpc,
  "devServers.list": handleDevelopmentRpc,
  "devServers.details": handleDevelopmentRpc,
  "devServers.start": handleDevelopmentRpc,
  "devServers.stop": handleDevelopmentRpc,
  "devServers.kill": handleDevelopmentRpc,
  "devServers.restart": handleDevelopmentRpc,
  "devServers.logs": handleDevelopmentRpc,
  "devServers.openExternal": handleDevelopmentRpc,
  "devServers.bridgeCheck": handleDevelopmentRpc,
  "devServers.bridgeOpen": handleDevelopmentRpc,
  "devServers.bridgeRead": handleDevelopmentRpc,
  "devServers.bridgeWrite": handleDevelopmentRpc,
  "devServers.bridgeClose": handleDevelopmentRpc,
  "resources.read": handleResourcesRpc,
  "diagnostics.logs.read": handleDiagnosticsLogsRpc,
  "browser.setup": handleBrowserRpc,
  "browser.status": handleBrowserRpc,
  "browser.claim": handleBrowserRpc,
  "browser.release": handleBrowserRpc,
  "browser.open": handleBrowserRpc,
  "browser.resize": handleBrowserRpc,
  "browser.frame": handleBrowserRpc,
  "browser.input": handleBrowserRpc,
  "browser.close": handleBrowserRpc,
  "browser.annotation.start": handleBrowserRpc,
  "browser.annotation.hover": handleBrowserRpc,
  "browser.annotation.select": handleBrowserRpc,
  "browser.annotation.parent": handleBrowserRpc,
  "browser.annotation.traverse": handleBrowserRpc,
  "browser.annotation.clear": handleBrowserRpc,
  "browser.annotation.read": handleBrowserRpc,
  "browser.annotation.cancel": handleBrowserRpc,
  "environment.describe": handleEnvironmentRpc,
  "environment.persistence.status": handleEnvironmentRpc,
  "environment.persistence.recover": handleEnvironmentRpc,
  "voice.clientSecret": handleVoiceRpc,
  "push.register": handlePushRpc,
  "push.unregister": handlePushRpc,
  "push.test": handlePushRpc,
  "approvals.mirror": handleApprovalsRpc,
  "approvals.list": handleApprovalsRpc,
  "approvals.decide": handleApprovalsRpc,
  "approvals.decisions": handleApprovalsRpc,
  "voice.local.inspect": handleVoiceRpc,
  "voice.realtime.secret": handleVoiceRpc,
  "voice.cloud.status": handleVoiceRpc,
  "voice.cloud.setKey": handleVoiceRpc,
  "voice.cloud.transcribe": handleVoiceRpc,
  "voice.local.setup": handleVoiceRpc,
  "voice.local.setupStatus": handleVoiceRpc,
  "voice.local.speak": handleVoiceRpc,
  "voice.local.speechNext": handleVoiceRpc,
  "voice.local.speechCancel": handleVoiceRpc,
  "voice.local.start": handleVoiceRpc,
  "voice.local.transcribe": handleVoiceRpc,
  "secrets.owner.list": handleSecretsOwnerRpc,
  "secrets.owner.revoke": handleSecretsOwnerRpc,
  "activity.record": handleActivityOwnerRpc,
  "activity.days": handleActivityOwnerRpc,
  "activity.summary": handleActivityOwnerRpc,
  "sessions.lifecycle.get": handleSessionLifecycleRpc,
  "sessions.lifecycle.list": handleSessionLifecycleRpc,
  "sessions.lifecycle.settle": handleSessionLifecycleRpc,
  "sessions.lifecycle.unsettle": handleSessionLifecycleRpc,
  "sessions.lifecycle.configure": handleSessionLifecycleRpc,
  "sessions.taskLink.get": handleSessionLifecycleRpc,
  "sessions.taskLink.link": handleSessionLifecycleRpc,
  "sessions.taskLink.unlink": handleSessionLifecycleRpc,
  "sessions.taskLink.listForTask": handleSessionLifecycleRpc,
  "decisionModels.sources.list": handleDecisionModelsRpc,
  "decisionModels.sources.add": handleDecisionModelsRpc,
  "decisionModels.sources.update": handleDecisionModelsRpc,
  "decisionModels.sources.remove": handleDecisionModelsRpc,
  "decisionModels.sources.test": handleDecisionModelsRpc,
  "decisionModels.sources.evaluate": handleDecisionModelsRpc,
  "decisionModels.discovery.scan": handleDecisionModelsRpc,
  "decisionModels.discovery.results": handleDecisionModelsRpc,
  "decisionModels.discovery.settings.get": handleDecisionModelsRpc,
  "decisionModels.discovery.settings.set": handleDecisionModelsRpc,
  "decisionModels.manual.verify": handleDecisionModelsRpc,
  "decisionModels.firstRun.get": handleDecisionModelsRpc,
  "decisionModels.firstRun.set": handleDecisionModelsRpc,
  "decisionModels.local.hardware": handleDecisionModelsRpc,
  "decisionModels.local.recommend": handleDecisionModelsRpc,
  "decisionModels.local.plan": handleDecisionModelsRpc,
  "decisionModels.local.install": handleDecisionModelsRpc,
  "decisionModels.local.start": handleDecisionModelsRpc,
  "decisionModels.local.stop": handleDecisionModelsRpc,
  "decisionModels.local.uninstall": handleDecisionModelsRpc,
  "decisionModels.local.status": handleDecisionModelsRpc,
  "decisionModels.routing.get": handleDecisionModelsRpc,
  "decisionModels.routing.set": handleDecisionModelsRpc,
  "decisionModels.catalog.get": handleDecisionModelsRpc,
  "decisionModels.decide": handleDecisionModelsRpc,
  "voice.local.keepAlive": handleVoiceRpc,
  "voice.local.release": handleVoiceRpc,
  "providers.center.read": handleProvidersRpc,
  "providers.acp.patchMetadata": handleProvidersRpc,
  "models.list": handleProvidersRpc,
  "appearance.themeSuggestions": handleAppearanceRpc,
  "appearance.backgroundSuggestions": handleAppearanceRpc,
  "appearance.backgroundImage": handleAppearanceRpc,
  "assistant.builder.interview": handleAssistantBuilderRpc,
  "assistant.builder.avatarGenerate": handleAssistantBuilderRpc,
  "assistant.builder.avatarRead": handleAssistantBuilderRpc,
  "providers.desktop.read": handleProvidersRpc,
  "providers.desktop.patch": handleProvidersRpc,
  "providers.desktop.status": handleProvidersRpc,
  "providers.desktop.quota.refresh": handleProvidersRpc,
  generic_acp_list: handleProvidersRpc,
  generic_acp_save: handleProvidersRpc,
  generic_acp_remove: handleProvidersRpc,
  generic_acp_registry: handleProvidersRpc,
  generic_acp_install: handleProvidersRpc,
  generic_acp_cancel_install: handleProvidersRpc,
  handoff_history_save: handleProvidersRpc,
  handoff_history_read: handleProvidersRpc,
  "devices.preview.mobile.start": handleDevicesRpc,
  "devices.preview.mobile.status": handleDevicesRpc,
  "devices.preview.impact": handleDevicesRpc,
  "devices.setup": handleDevicesRpc,
  "devices.stop": handleDevicesRpc,
  "devices.status": handleDevicesRpc,
  "devices.preflight": handleDevicesRpc,
  "devices.preview": handleDevicesRpc,
  "devices.preview.status": handleDevicesRpc,
  "devices.start": handleDevicesRpc,
  "devices.list": handleDevicesRpc,
  "devices.boot": handleDevicesRpc,
  "devices.capture": handleDevicesRpc,
  "devices.control.status": handleDevicesRpc,
  "devices.control.claim": handleDevicesRpc,
  "devices.control.release": handleDevicesRpc,
  "devices.control.renew": handleDevicesRpc,
  "devices.inspect": handleDevicesRpc,
  "devices.action": handleDevicesRpc,
  "host.settings.get": handleDevicesRpc,
  "host.settings.save": handleDevicesRpc,
  "mobile.pairing.create": handleDevicesRpc,
  "mobile.pairing.status": handleDevicesRpc,
  "mobile.pairing.cancel": handleDevicesRpc,
  "host.access.read": handleDevicesRpc,
  "devices.revokeOther": handleDevicesRpc,
  "mobile.access.status": handleDevicesRpc,
  "mobile.access.enable": handleDevicesRpc,
  "mobile.access.disable": handleDevicesRpc,
  "tunnels.status": handleDevicesRpc,
  "tunnels.start": handleDevicesRpc,
  "tunnels.stop": handleDevicesRpc,
  "tunnels.credential": handleDevicesRpc,
  "devices.revokeSelf": handleDevicesRpc,
  "shell.profiles": handleProvidersRpc,
  "shell.setProfile": handleProvidersRpc,
  "shell.setProfileReviewed": handleProvidersRpc,
  "machine.changes": handleDevicesRpc,
  "events.read": handleSessionsRpc,
  "history.import.preview": handleSessionsRpc,
  "history.import.commit": handleSessionsRpc,
  "history.import.status": handleSessionsRpc,
  "history.import.cancel": handleSessionsRpc,
  "worktrees.removal.review": handleWorktreesRpc,
  "worktrees.removal.approve": handleWorktreesRpc,
  "worktrees.removal.status": handleWorktreesRpc,
  "ssh.workspace.catalog.read": handleDevicesRpc,
  "ssh.workspace.review": handleDevicesRpc,
  "ssh.workspace.approve": handleDevicesRpc,
  "ssh.workspace.status": handleDevicesRpc,
  "ssh.workspace.close.review": handleDevicesRpc,
  "ssh.workspace.close.approve": handleDevicesRpc,
  "preferences.desktop.read": handleProjectsRpc,
  "preferences.desktop.template.read": handleProjectsRpc,
  "preferences.desktop.patch": handleProjectsRpc,
  "preferences.desktop.status": handleProjectsRpc,
  "notes.list": handleNotesRpc,
  "notes.get": handleNotesRpc,
  "notes.upsert": handleNotesRpc,
  "notes.delete": handleNotesRpc,
  "inbox.provider.status": handleInboxRpc,
  "inbox.provider.request": handleInboxRpc,
  "inbox.provider.result": handleInboxRpc,
  "inbox.list": handleInboxRpc,
  "automations.list": handleTasksRpc,
  "automations.preview": handleTasksRpc,
  "automations.save": handleTasksRpc,
  "automations.delete": handleTasksRpc,
  "automations.runs": handleTasksRpc,
  "automations.runNow": handleTasksRpc,
  "sprints.list": handleTasksRpc,
  "sprints.get": handleTasksRpc,
  "sprints.create": handleTasksRpc,
  "sprints.update": handleTasksRpc,
  "sprints.start": handleTasksRpc,
  "sprints.complete": handleTasksRpc,
  "sprints.archive": handleTasksRpc,
  "sprints.plan": handleTasksRpc,
  "sprints.report": handleTasksRpc,
  "sprints.ingest": handleTasksRpc,
  "sprints.goalContext": handleTasksRpc,
  "tasks.snapshotWithCursor": handleTasksRpc,
  "tasks.events": handleTasksRpc,
  "tasks.list": handleTasksRpc,
  "tasks.save": handleTasksRpc,
  "tasks.move": handleTasksRpc,
  "tasks.start": handleTasksRpc,
  "tasks.reorder": handleTasksRpc,
  "tasks.retarget": handleTasksRpc,
  "tasks.review.recheck": handleTasksRpc,
  "tasks.notes.read": handleTasksRpc,
  "tasks.notes.resolve": handleTasksRpc,
  "tasks.delete": handleTasksRpc,
  "goals.list": handleTasksRpc,
  "goals.create": handleTasksRpc,
  "goals.final-review.recheck": handleTasksRpc,
  "tasks.preflight": handleTasksRpc,
  "tasks.evaluation.save": handleTasksRpc,
  "goals.approve": handleTasksRpc,
  "goals.update": handleTasksRpc,
  "goals.replan": handleTasksRpc,
  "goals.cancel": handleTasksRpc,
  "goals.delete": handleTasksRpc,
  "stewards.list": handleTasksRpc,
  "stewards.save": handleTasksRpc,
  "stewards.delete": handleTasksRpc,
  "stewards.runNow": handleTasksRpc,
  "stewards.decline": handleTasksRpc,
  "crews.active.list": handleCrewsRpc,
  "crews.member.ask": handleCrewsRpc,
  "crews.list": handleCrewsRpc,
  "crews.schema": handleCrewsRpc,
  "crews.inspect": handleCrewsRpc,
  "crews.save": handleCrewsRpc,
  "crews.delete": handleCrewsRpc,
  "crews.deleteRun": handleCrewsRpc,
  "crews.agent.save": handleCrewsRpc,
  "crews.agent.delete": handleCrewsRpc,
  "crews.pools.list": handleCrewsRpc,
  "crews.pools.save": handleCrewsRpc,
  "crews.pools.delete": handleCrewsRpc,
  "crews.start": handleCrewsRpc,
  "crews.get": handleCrewsRpc,
  "crews.assign": handleCrewsRpc,
  "crews.request": handleCrewsRpc,
  "crews.resolve": handleCrewsRpc,
  "crews.respond": handleCrewsRpc,
  "crews.answer": handleCrewsRpc,
  "crews.pause": handleCrewsRpc,
  "crews.stop": handleCrewsRpc,
  "crews.resume": handleCrewsRpc,
  "crews.accept": handleCrewsRpc,
  "crews.finish": handleCrewsRpc,
  "git.diff": handleGitRpc,
  "git.branches": handleGitRpc,
  "git.switch": handleGitRpc,
  "git.createBranch": handleGitRpc,
  "git.worktrees": handleGitRpc,
  "git.worktreeCreate": handleGitRpc,
  "git.index": handleGitRpc,
  "git.fileDiff": handleGitRpc,
  "git.action": handleGitRpc,
  "files.read": handleFilesRpc,
  "files.list": handleFilesRpc,
  "files.index": handleFilesRpc,
  "workspace.run": handleFilesRpc,
  "files.search": handleFilesRpc,
  "files.searchContent": handleFilesRpc,
  "files.create": handleFilesRpc,
  "files.write": handleFilesRpc,
};
export async function dispatchOwnerRpc(
  dependencies: Dependencies,
  request: OwnerRpcRequest,
): Promise<void> {
  const method = request.input.method;
  const handler =
    typeof method === "string" && Object.hasOwn(handlers, method) ? handlers[method] : undefined;
  if (!handler) throw new Error("Unsupported host method");
  // Only the desktop app sends this heartbeat; it is how the Host recognizes the desktop principal.
  if (method === "sessions.desktopLive") dependencies.approvals.noteDesktop(request.tokenHash);
  const startedAt = performance.now();
  try {
    await handler(dependencies, request);
  } catch (error) {
    // Method and error identity only; params and results can hold prompts or credentials.
    const code = (error as { code?: unknown } | null)?.code;
    rpcLog.warn("handler failed", {
      method: String(method),
      error: error instanceof Error ? error.name : "UnknownError",
      code: typeof code === "string" || typeof code === "number" ? code : undefined,
      ms: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
  const ms = Math.round(performance.now() - startedAt);
  if (ms >= SLOW_RPC_MS) rpcLog.warn("slow call", { method: String(method), ms });
}
