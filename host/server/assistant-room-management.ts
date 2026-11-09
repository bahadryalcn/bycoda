import {
  assistantModelPoolSource,
  callModelPoolTool,
  isModelPoolConversationTool,
} from "../conversation/conversation-model-pool-source";
import { createHash } from "node:crypto";
import { sessionConversationPage } from "../../src/features/agent-app/model/sessionConversation";
import { conversationSessionPage } from "../../src/shared/model/conversationSessionPage";
import {
  createRoomManagementDispatcher,
  hasRoomProjectCapture,
  roomAccountResult,
  roomManagementDiscovery,
} from "../assistant/management/assistant-management-dispatch";
import { workspaceOperationJson } from "../assistant/native/assistant-workspace-owner";
import { verifyWorkspaceReceipt } from "../assistant/native/assistant-workspace-receipt";
import { describeWorkspaceTransfer } from "../assistant/native/assistant-workspace-transfer";
import { isAssistantObservationAction } from "../assistant/observations/assistant-observation-tools";
import { isRoomBrowserAction } from "../assistant/room/assistant-room-browser";
import { isRoomDevServerAction } from "../assistant/room/assistant-room-dev-servers";
import { isRoomFileAction, isRoomFileWrite } from "../assistant/room/assistant-room-files";
import { isRoomInboxAction } from "../assistant/room/assistant-room-inbox";
import { isRoomNotebookAction } from "../assistant/room/assistant-room-notebook";
import { validateRoomOrganization } from "../assistant/room/assistant-room-organization";
import {
  isRoomSessionAction,
  validateRoomSessionAction,
} from "../assistant/room/assistant-room-session";
import {
  isRoomTerminalAction,
  isRoomTerminalWrite,
} from "../assistant/room/assistant-room-terminals";
import {
  isRoomWorkspaceAction,
  validateRoomWorkspaceAction,
} from "../assistant/room/assistant-room-workspace";
import { isGlobalRuntimeRead } from "../conversation/conversation-management-runtime";
import {
  isManagementAction,
  managementPage,
  type GlobalManagementPrincipal,
} from "../conversation/conversation-management-tools";
import { type PreviewPresentation } from "../conversation/conversation-preview";
import { threadCrewAction } from "../conversation/conversation-thread-crew-tools";
import { THREAD_WORK_ACTIONS } from "../conversation/conversation-thread-work-tools";
import type { ConversationTool } from "../conversation/conversation-tools";
import { runtimeLogToolQuery } from "../execution/runtime-log-tools";
import { hostInbox } from "../notes/host-notes";
import { prepareVoiceToolDispatch } from "../voice/voice-tools";
import type { createAssistantRoomRuntime } from "./assistant-room";
import type { ServerBindings } from "./bindings";
type Ports = Pick<
  ReturnType<typeof createAssistantRoomRuntime>,
  "roomRemote" | "executeRoomSocialSend" | "executeRoomObservation" | "roomInbox"
>;
export function registerRoomManagement(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "conversationDesktop"
    | "roomResourceReceipts"
    | "social"
    | "assistantPorts"
    | "assistant"
    | "visibilityAdmission"
    | "withNativeObservationScope"
    | "nativeObservationGeneration"
    | "nativeVoiceLeases"
    | "retireNativeVoiceGenerations"
    | "nativeAdmissionOwner"
    | "observationJournal"
    | "observationHostPages"
    | "observationNativePages"
    | "observationProjectPages"
    | "observationPages"
    | "withNativeSessionScope"
    | "withRoomProjectScope"
    | "roomVisibleProject"
    | "executeAccountSocial"
    | "roomNotebook"
    | "conversationAccess"
    | "runtimeLogAccess"
    | "socialTransport"
    | "refreshLogSources"
    | "runtimeLogs"
    | "conversationManagementRuntime"
    | "globalServerManagement"
    | "globalAssistantManagement"
    | "roomBrowser"
    | "roomTerminals"
    | "roomFiles"
    | "roomDevServers"
    | "roomSessions"
    | "assistantWorkspaceOwner"
    | "roomWorkspace"
    | "workspaceTransferSource"
    | "projectSessionList"
    | "featureSession"
    | "localSessionReference"
    | "conversationThreadCrews"
    | "conversationThreadWork"
    | "conversationManagement"
    | "conversationWorkspace"
    | "roomProjectNotes"
    | "tasks"
    | "goals"
    | "automations"
  >,
  ports: Ports,
) {
  dependencies.assistantPorts.roomManagement = createRoomManagementDispatcher({
    environmentId: dependencies.engine.store.environmentId,
    thread: (id) => dependencies.assistant.threadBinding(id),
    visibleProject: dependencies.roomVisibleProject,
    execute: async (call, admission) => {
      const authorized = async () => {
        if (admission.signal?.aborted || !(await admission.authorized())) return false;
        const thread = await dependencies.assistant.threadBinding(call.threadId);
        return (
          !!thread &&
          thread.id === call.threadId &&
          (!thread.projectId || thread.projectId === call.projectId)
        );
      };
      const value = await dependencies.engine.store.db.withAuthorization(authorized, async () => {
        if (
          call.family === "conversation" &&
          ["remote.grants.list", "remote.call", "remote.result"].includes(call.action)
        ) {
          if (
            call.projectId ||
            (await dependencies.assistant.globalRoomBinding())?.id !== call.threadId
          )
            throw new Error("Remote operations require the original Global Room.");
          return ports.roomRemote.call(
            call.action,
            call.input,
            { threadId: call.threadId, environmentId: dependencies.engine.store.environmentId },
            call.requestId,
            authorized,
          );
        }
        if (
          call.family === "conversation" &&
          ["social.send.propose", "social.send.status"].includes(call.action)
        )
          return ports.executeRoomSocialSend(call, admission, authorized);
        if (call.family === "conversation" && isAssistantObservationAction(call.action))
          return ports.executeRoomObservation(call, admission, authorized);
        if (
          call.family === "social" &&
          !call.projectId &&
          !call.accountId &&
          call.action === "accounts.list"
        ) {
          const result = await dependencies.social.listAssistantAccountsWithProof(
            call.threadId,
            admission.deviceHash,
            call.input,
          );
          return roomAccountResult(result.value, result.accounts);
        }
        if (call.family === "social" && !call.projectId && call.accountId)
          return dependencies.executeAccountSocial(
            { ...call, accountId: call.accountId },
            admission.deviceHash,
            authorized,
            true,
          );
        if (call.family === "conversation" && isRoomNotebookAction(call.action))
          return dependencies.roomNotebook.call(
            call.action,
            call.input,
            {
              kind: "assistant-thread",
              threadId: call.threadId,
              environmentId: dependencies.engine.store.environmentId,
            },
            authorized,
            call.requestId,
          );
        if (call.family !== "conversation") {
          if (call.projectId && call.family === "social")
            throw new Error(
              "Project Room social disclosure requires explicit combined account and project authority.",
            );
          if (!call.projectId) throw new Error("Choose a visible project for this Room tool.");
          const delegated = await prepareVoiceToolDispatch(call, {
            authorized,
            environmentId: dependencies.engine.store.environmentId,
            deviceHash: admission.deviceHash,
            threadIdentity: (id) => dependencies.assistant.threadBinding(id),
            sessionIdentity: async () => {
              throw new Error("Room tools do not borrow sessions.");
            },
            issuers: {
              conversation: dependencies.conversationAccess,
              social: dependencies.social,
              "runtime-logs": dependencies.runtimeLogAccess,
            },
          });
          try {
            if (call.family === "social") {
              const principal = await dependencies.social.principalForToken(delegated.token);
              if (!principal) throw new Error("Room social authority unavailable.");
              const socialAuthorized = dependencies.social.authorization(delegated.token);
              const socialCheck =
                typeof socialAuthorized === "function" ? socialAuthorized : socialAuthorized.check;
              return await dependencies.engine.store.db.withAuthorization(
                {
                  check: async () => (await authorized()) && (await socialCheck()),
                  prepare: async () => {
                    const prepared =
                      typeof socialAuthorized === "function"
                        ? socialAuthorized
                        : await socialAuthorized.prepare();
                    return async () => (await authorized()) && (await prepared());
                  },
                },
                () =>
                  dependencies.socialTransport.rpc(
                    principal,
                    "social.tools.call",
                    delegated.params,
                  ),
              );
            }
            const principal = await dependencies.runtimeLogAccess.principalForToken(
              delegated.token,
            );
            if (!principal) throw new Error("Room log authority unavailable.");
            await dependencies.refreshLogSources();
            const query = runtimeLogToolQuery(call.action, call.input, principal);
            return await dependencies.withRoomProjectScope(call, authorized, async () => {
              const result =
                call.action === "sources" || call.action === "runtimeLogs.sources"
                  ? dependencies.runtimeLogs.sources(query)
                  : dependencies.runtimeLogs.read(query);
              if (!(await dependencies.runtimeLogAccess.principalForToken(delegated.token)))
                throw new Error("Room log authority revoked.");
              return result;
            });
          } finally {
            delegated.release();
          }
        }
        if (!call.projectId) {
          const principal: GlobalManagementPrincipal = {
            kind: "assistant-thread",
            threadId: call.threadId,
            environmentId: dependencies.engine.store.environmentId,
          };
          if (isGlobalRuntimeRead(call.action))
            return dependencies.conversationManagementRuntime.call(
              call.action as import("../conversation/conversation-management-runtime").RuntimeManagementAction,
              call.input,
              principal,
              authorized,
            );
          if (isModelPoolConversationTool(call.action))
            return callModelPoolTool(
              call.action,
              call.input,
              assistantModelPoolSource(dependencies.assistant),
            );
          if (
            ["tools.list", "tools.search", "tools.describe", "tools.status"].includes(call.action)
          )
            return roomManagementDiscovery(call.action, call.input);
          if (call.action === "servers.ssh.execute" && call.input.requestId !== call.requestId)
            throw new Error("SSH operation identity changed.");
          if (
            [
              "servers.list",
              "servers.get",
              "servers.ssh.execute",
              "servers.ssh.status",
              "servers.ssh.cancel",
            ].includes(call.action)
          )
            return dependencies.conversationDesktop.callAssistantThread(
              call.action,
              call.input,
              principal,
              authorized,
            );
          if (call.action === "servers.ssh.save" || call.action === "servers.ssh.remove") {
            if (
              call.input.operationId !== call.requestId ||
              typeof call.input.expectedInventoryRevision !== "string" ||
              !/^[a-f0-9]{64}$/.test(call.input.expectedInventoryRevision)
            )
              throw new Error("Server operation identity or inventory revision is missing.");
            return dependencies.globalServerManagement.call(
              call.action,
              { requestId: call.requestId, serverInput: call.input },
              principal,
              authorized,
            );
          }
          if (!isManagementAction(call.action))
            throw new Error("This global Room operation is unavailable.");
          if (
            ![
              "preferences.read",
              "preferences.status",
              "providers.status",
              "providers.operation.status",
              "projects.organization.read",
            ].includes(call.action) &&
            call.input.requestId !== call.requestId
          )
            throw new Error("Management operation identity changed.");
          return dependencies.globalAssistantManagement.call(
            call.action,
            call.input,
            principal,
            authorized,
          );
        }
        const principal = {
          kind: "assistant-thread" as const,
          threadId: call.threadId,
          projectId: call.projectId,
          provider: "assistant" as const,
        };
        let effectValid = () => true;
        const effectAuthorized = async () => effectValid() && (await authorized()) && effectValid();
        const qualifyEffect = <T>(effect: () => Promise<T>) =>
          dependencies.withRoomProjectScope(call, authorized, async (valid) => {
            effectValid = valid;
            try {
              return await effect();
            } finally {
              effectValid = () => true;
            }
          });
        if (isRoomBrowserAction(call.action))
          return dependencies.withRoomProjectScope(call, authorized, async (valid, captured) => {
            const current = async () => valid() && (await authorized()) && valid();
            return dependencies.roomBrowser.call(
              call.action,
              call.input,
              {
                environmentId: dependencies.engine.store.environmentId,
                projectId: call.projectId!,
                projectCwd: captured.projectCwd,
                threadId: call.threadId,
                deviceHash: admission.deviceHash,
              },
              call.requestId,
              current,
              undefined,
              async () =>
                (await dependencies.conversationDesktop.callAssistantThread(
                  "ui.tools.open",
                  { tab: "browser", projectHost: true },
                  {
                    threadId: call.threadId,
                    environmentId: dependencies.engine.store.environmentId,
                    projectId: call.projectId!,
                    targetProjectCwd: captured.projectCwd,
                    targetDeviceHash: captured.deviceHash,
                  },
                  current,
                )) as PreviewPresentation,
            );
          });
        if (
          isRoomFileAction(call.action) ||
          isRoomDevServerAction(call.action) ||
          isRoomTerminalAction(call.action)
        ) {
          const project = await dependencies.engine.store.project(call.projectId);
          const source = { ...principal, projectCwd: project.cwd };
          const input =
            isRoomFileWrite(call.action) ||
            isRoomTerminalWrite(call.action) ||
            ["devServers.start", "devServers.stop", "devServers.restart"].includes(call.action)
              ? { ...call.input, requestId: call.requestId }
              : call.input;
          const qualify = <T>(effect: () => Promise<T>) =>
            dependencies.withRoomProjectScope(call, authorized, async (valid, captured) => {
              if (captured.projectCwd !== source.projectCwd)
                throw new Error("Room resource project changed during review.");
              effectValid = valid;
              try {
                return await effect();
              } finally {
                effectValid = () => true;
              }
            });
          if (isRoomTerminalAction(call.action))
            return dependencies.roomTerminals.call(
              call.action,
              input,
              {
                ...source,
                environmentId: dependencies.engine.store.environmentId,
                deviceHash: admission.deviceHash,
              },
              effectAuthorized,
              qualify,
            );
          return isRoomFileAction(call.action)
            ? dependencies.roomFiles.call(call.action, input, source, effectAuthorized, qualify)
            : dependencies.roomDevServers.call(
                call.action,
                input,
                source,
                effectAuthorized,
                qualify,
              );
        }
        if (isRoomSessionAction(call.action)) {
          const input = validateRoomSessionAction(call.action, call.input, call.requestId);
          return dependencies.roomSessions.call(
            call.action,
            input,
            principal,
            effectAuthorized,
            qualifyEffect,
          );
        }
        if (
          call.action === "workspace.operation.status" ||
          call.action === "projects.organization.status"
        ) {
          const organizationStatus =
            call.action === "projects.organization.status"
              ? (validateRoomOrganization(call.action, call.input, call.requestId) as {
                  requestId: string;
                  originalInput?: Record<string, unknown>;
                })
              : undefined;
          if (organizationStatus && !organizationStatus.originalInput)
            throw new Error(
              "Inspect the original organization patch with its exact originalInput.",
            );
          const input = validateRoomWorkspaceAction(
            "workspace.operation.status",
            organizationStatus
              ? {
                  operationId: organizationStatus.requestId,
                  action: "organization.patch",
                  originalInput: organizationStatus.originalInput,
                }
              : call.input,
            call.requestId,
          ) as { operationId: string; action: string; originalInput: Record<string, unknown> };
          return dependencies.withRoomProjectScope(call, authorized, async (valid, source) => {
            const current = async () => valid() && (await authorized()) && valid();
            const owner = await dependencies.assistantWorkspaceOwner.lookup(
              dependencies.engine.store.environmentId,
              call.threadId,
              input.operationId,
            );
            if (!owner) return { state: "unknown" };
            const operationHash = createHash("sha256")
              .update(
                workspaceOperationJson({
                  action: input.action as typeof owner.action,
                  targetProjectCwd: source.projectCwd,
                  originalInput: input.originalInput,
                }),
                "utf8",
              )
              .digest("hex");
            if (
              owner.projectId !== call.projectId ||
              owner.targetProjectCwd !== source.projectCwd ||
              owner.action !== input.action ||
              owner.operationHash !== operationHash
            )
              throw new Error("Workspace original request identity changed.");
            if (
              owner.targetDeviceHash !== source.deviceHash ||
              owner.installationId !== source.installationId
            )
              throw new Error("Reconnect the original desktop device to inspect this request.");
            const captured = (await dependencies.conversationDesktop.callAssistantThread(
              "workspace.operation.status",
              input,
              {
                threadId: call.threadId,
                environmentId: dependencies.engine.store.environmentId,
                projectId: call.projectId,
                targetProjectCwd: source.projectCwd,
                targetDeviceHash: owner.targetDeviceHash,
              },
              current,
            )) as { relayId: string; envelope: unknown };
            return verifyWorkspaceReceipt(
              dependencies.nativeAdmissionOwner,
              captured,
              {
                environmentId: dependencies.engine.store.environmentId,
                threadId: call.threadId,
                projectId: call.projectId!,
                targetCwd: source.projectCwd,
                operationId: input.operationId,
                action: input.action,
                originalInput: input.originalInput,
              },
              current,
              source,
            );
          });
        }
        if (call.action === "workspace.sessions.submit.status") {
          const input = validateRoomWorkspaceAction(call.action, call.input, call.requestId);
          return dependencies.withRoomProjectScope(call, authorized, () =>
            dependencies.roomWorkspace.call(call.action, input, principal, authorized),
          );
        }
        if (call.action === "projects.organization.read") {
          const input = validateRoomOrganization(call.action, call.input, call.requestId);
          return dependencies.withRoomProjectScope(call, authorized, async (valid, source) =>
            dependencies.conversationDesktop.callAssistantThread(
              "organization.read",
              input,
              {
                threadId: call.threadId,
                environmentId: dependencies.engine.store.environmentId,
                projectId: call.projectId,
                targetProjectCwd: source.projectCwd,
                targetDeviceHash: source.deviceHash,
              },
              async () => valid() && (await authorized()) && valid(),
            ),
          );
        }
        if (isRoomWorkspaceAction(call.action) || call.action === "projects.organization.patch") {
          const action =
            call.action === "projects.organization.patch" ? "organization.patch" : call.action;
          const input =
            call.action === "projects.organization.patch"
              ? validateRoomOrganization(call.action, call.input, call.requestId)
              : validateRoomWorkspaceAction(action, call.input, call.requestId);
          return describeWorkspaceTransfer(
            await dependencies.roomWorkspace.call(
              action,
              input,
              principal,
              effectAuthorized,
              (effect) =>
                dependencies.withRoomProjectScope(call, authorized, async (valid, source) => {
                  effectValid = valid;
                  try {
                    return await dependencies.workspaceTransferSource.run(
                      { valid, source },
                      effect,
                    );
                  } finally {
                    effectValid = () => true;
                  }
                }),
            ),
          );
        }
        if (isModelPoolConversationTool(call.action))
          return callModelPoolTool(
            call.action,
            call.input,
            assistantModelPoolSource(dependencies.assistant),
          );
        if (["tools.list", "tools.search", "tools.describe", "tools.status"].includes(call.action))
          return roomManagementDiscovery(call.action, call.input, call.projectId);
        if (
          (call.action.startsWith("preferences.") || call.action.startsWith("providers.")) &&
          isManagementAction(call.action)
        ) {
          if (
            !call.action.endsWith(".status") &&
            call.action !== "preferences.read" &&
            call.input.requestId !== call.requestId
          )
            throw new Error("Management operation identity changed.");
          return dependencies.globalAssistantManagement.call(
            call.action,
            call.input,
            {
              kind: "assistant-thread",
              threadId: call.threadId,
              environmentId: dependencies.engine.store.environmentId,
            },
            authorized,
          );
        }
        if (call.action === "sessions.list")
          return dependencies.withRoomProjectScope(call, authorized, async () => {
            const { list } = await dependencies.projectSessionList(call.projectId!);
            return conversationSessionPage(
              list.map((row) => ({ ...row, busy: row.status === "running" })),
              call.input,
            );
          });
        if (call.action === "sessions.read")
          return dependencies.withRoomProjectScope(call, authorized, async () => {
            const target = await dependencies.featureSession(String(call.input.sessionId));
            if (target.projectId !== call.projectId)
              throw new Error("Conversation belongs to another project.");
            return sessionConversationPage(
              { ...target.session, busy: target.status === "running" },
              call.input,
              await dependencies.localSessionReference(target.session.id),
            );
          });
        if (threadCrewAction(call.action)) {
          if (call.input.operationId !== undefined && call.input.operationId !== call.requestId)
            throw new Error("Crew operation identity changed.");
          return dependencies.conversationThreadCrews.call(
            call.action,
            call.input,
            principal,
            effectAuthorized,
            qualifyEffect,
          );
        }
        if (THREAD_WORK_ACTIONS.has(call.action))
          return dependencies.conversationThreadWork.call(
            call.action,
            call.input,
            principal,
            effectAuthorized,
            call.requestId,
            qualifyEffect,
          );
        if (isManagementAction(call.action)) {
          if (
            call.input.requestId !== undefined &&
            call.input.requestId !== call.requestId &&
            !call.action.endsWith(".status")
          )
            throw new Error("Management operation identity changed.");
          if (call.action === "history.import.status")
            throw new Error("Choose a real focused session for history import status.");
          return dependencies.conversationManagement.call(
            call.action,
            call.input,
            principal,
            effectAuthorized,
            qualifyEffect,
          );
        }
        if (call.action === "notes.list" || call.action === "notes.read")
          return dependencies.withRoomProjectScope(call, authorized, () =>
            dependencies.conversationWorkspace.call(
              call.action as ConversationTool,
              call.input,
              principal,
              undefined,
              authorized,
            ),
          );
        if (["notes.create", "notes.update", "notes.delete"].includes(call.action))
          return dependencies.roomProjectNotes.call(
            call.action,
            { requestId: call.requestId, noteInput: call.input },
            principal,
            effectAuthorized,
            qualifyEffect,
          );
        if (call.action === "inbox.list")
          return dependencies.withRoomProjectScope(call, authorized, async () => {
            const result = hostInbox(
              {
                sessions: (await dependencies.projectSessionList(call.projectId!)).list,
                tasks: await dependencies.tasks.list(),
                goals: await dependencies.goals.list(),
                automations: await dependencies.automations.list(),
                threads: [],
              },
              call.projectId,
            );
            return {
              ...managementPage(result.items, call.input),
              scope: result.scope,
              socialIncluded: false,
              externalProviderInboxAvailable: false,
            };
          });
        if (call.action === "inbox.providers.status")
          return dependencies.withRoomProjectScope(call, authorized, async () => {
            return {
              state: "unknown",
              supportedProviders: ["github", "jira"],
              credentialsChecked: false,
              reason:
                "Provider discovery verifies the current Native account and saved visibility. Supply an explicit provider to inbox.providers.list; keep its accountProof for follow-up operations.",
            };
          });
        if (isRoomInboxAction(call.action))
          return dependencies.withRoomProjectScope(call, authorized, async (valid, source) =>
            ports.roomInbox.call(
              call.action,
              call.input,
              {
                environmentId: dependencies.engine.store.environmentId,
                threadId: call.threadId,
                projectId: call.projectId!,
                projectCwd: source.projectCwd,
                deviceHash: source.deviceHash,
              },
              call.requestId,
              async () => valid() && (await authorized()) && valid(),
            ),
          );
        if (call.action.startsWith("inbox."))
          throw new Error(
            "Project Room inbox remote transport requires a qualified owner workflow.",
          );
        throw new Error("This project Room operation is unavailable in text turns.");
      });
      if (call.projectId && !hasRoomProjectCapture(call.projectId)) {
        // These return public schemas or application-wide metadata, never a
        // project read. A missing fence on project data must not be repaired by
        // attaching a later cwd after the data has already been read.
        const metadataOnly = [
          "models.pool.list",
          "tools.list",
          "tools.search",
          "tools.describe",
          "tools.status",
          "preferences.read",
          "preferences.patch",
          "preferences.status",
          "providers.status",
          "providers.quota.refresh",
          "providers.operation.status",
        ].includes(call.action);
        if (!metadataOnly)
          throw new Error("Room project data was not captured under its source permit.");
        await dependencies.withRoomProjectScope(call, authorized, async () => undefined);
      }
      return value;
    },
  });
}
