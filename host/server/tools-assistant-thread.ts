import { sessionConversationPage } from "../../src/features/agent-app/model/sessionConversation";
import { localSessionLinkFields } from "../../src/features/sessions/model/localSessionReference";
import { conversationSessionPage } from "../../src/shared/model/conversationSessionPage";
import { isRoomNotebookAction } from "../assistant/room/assistant-room-notebook";
import { callRoomPrWatch, isRoomPrWatchAction } from "../assistant/room/assistant-room-pr-watch";
import {
  isRoomWorkspaceAction,
  validateRoomWorkspaceAction,
} from "../assistant/room/assistant-room-workspace";
import { isDesktopControlConversationTool } from "../conversation/conversation-desktop-control-tools";
import {
  callModelPoolTool,
  isModelPoolConversationTool,
} from "../conversation/conversation-model-pool-source";
import { isManagementAction } from "../conversation/conversation-management-tools";
import { threadCrewAction } from "../conversation/conversation-thread-crew-tools";
import { THREAD_WORK_ACTIONS } from "../conversation/conversation-thread-work-tools";
import type { ConversationTool } from "../conversation/conversation-tools";
import { validateConversationTool } from "../conversation/conversation-tools";
import { managedDiscoveryResult, managedMcpCatalog } from "../mcp/mcp-http";
import { voiceThreadToolAllowed, voiceToolCatalog } from "../voice/voice-tools";
import type { ServerBindings } from "./bindings";
import type { HttpToolRequest } from "./http-tool-context";
export async function handleAssistantThreadTools(
  dependencies: Pick<
    ServerBindings,
    | "conversationAccess"
    | "engine"
    | "projectSessionList"
    | "localSessionReference"
    | "featureSession"
    | "assistant"
    | "roomNotebook"
    | "roomWorkspace"
    | "conversationThreadCrews"
    | "conversationThreadWork"
    | "conversationManagement"
    | "conversationDesktopControl"
    | "conversationWorkspace"
    | "conversationRuntimeReads"
    | "featureMeta"
    | "inHost"
    | "conversationDesktop"
    | "explicitSkillNames"
    | "crews"
    | "conversationStewards"
    | "conversationTaskQueue"
    | "conversationGoals"
    | "conversationProject"
    | "browserRuntime"
    | "workspace"
    | "runtimeLogs"
    | "refreshLogSources"
    | "logMonitors"
    | "deviceHost"
    | "devicePreviews"
    | "conversationPreviews"
    | "sharedBrowser"
    | "tasks"
    | "devServers"
    | "diagnostics"
  >,
  ports: {
    request: Pick<
      HttpToolRequest,
      | "conversationPrincipal"
      | "params"
      | "token"
      | "result"
      | "endResult"
      | "tokenHash"
      | "voiceBrowserOwner"
    >;
    boundPrincipal: Extract<
      NonNullable<HttpToolRequest["conversationPrincipal"]>,
      { kind: "assistant-thread" }
    >;
  },
) {
  if (ports.boundPrincipal.kind === "assistant-thread") {
    const action = String(ports.request.params.action ?? "");
    const args = ports.request.params.input as Record<string, unknown>;
    validateConversationTool(action, args);
    const authorized = async () => {
      const current = await dependencies.conversationAccess.principalForToken(ports.request.token);
      return (
        current?.kind === "assistant-thread" &&
        current.threadId === ports.boundPrincipal.threadId &&
        current.projectId === ports.boundPrincipal.projectId
      );
    };
    ports.request.result = await dependencies.engine.store.db.withAuthorization(
      dependencies.conversationAccess.authorization(ports.request.token),
      async () => {
        if (action === "tools.list")
          return {
            environmentId: dependencies.engine.store.environmentId,
            projectId: ports.boundPrincipal.projectId,
            tools: voiceToolCatalog().filter((tool) =>
              voiceThreadToolAllowed(tool.family, tool.action),
            ),
          };
        if (isModelPoolConversationTool(action))
          return callModelPoolTool(action, args, dependencies.conversationThreadWork.pool);
        if (["tools.search", "tools.describe", "tools.status"].includes(action))
          return managedDiscoveryResult(action, args, managedMcpCatalog());
        if (action === "sessions.list") {
          const { list } = await dependencies.projectSessionList(ports.boundPrincipal.projectId);
          const page = conversationSessionPage(
            list.map((row) => ({
              id: row.id,
              title: row.title,
              harness: row.harness,
              model: row.model,
              busy: row.status === "running",
              hasDraft: !!row.draft,
              updatedAt: row.updatedAt,
              lastActivityAt: row.runActivity?.lastActivityAt ?? row.lastActivityAt ?? null,
              runActivity: row.runActivity ?? null,
            })),
            args,
          );
          return {
            ...page,
            sessions: await Promise.all(
              page.sessions.map(async (row) => {
                const locator = await dependencies.localSessionReference(row.id);
                return {
                  ...row,
                  ...(locator ? localSessionLinkFields(locator, row.title) : {}),
                };
              }),
            ),
          };
        }
        if (action === "sessions.read") {
          const target = await dependencies.featureSession(String(args.sessionId));
          if (target.projectId !== ports.boundPrincipal.projectId)
            throw new Error("Conversation belongs to another project.");
          return sessionConversationPage(
            { ...target.session, busy: target.status === "running" },
            args,
            await dependencies.localSessionReference(target.session.id),
          );
        }
        if (isRoomPrWatchAction(action))
          return callRoomPrWatch(
            dependencies.assistant.tracked.prWatch,
            { action, input: args, ...ports.boundPrincipal },
            authorized,
          );
        if (isRoomNotebookAction(action))
          return dependencies.roomNotebook.call(
            action,
            args,
            {
              kind: "assistant-thread",
              threadId: ports.boundPrincipal.threadId,
              environmentId: dependencies.engine.store.environmentId,
            },
            authorized,
            String(ports.request.params.requestId),
          );
        if (isRoomWorkspaceAction(action))
          return dependencies.roomWorkspace.call(
            action,
            validateRoomWorkspaceAction(action, args, String(ports.request.params.requestId)),
            ports.boundPrincipal,
            authorized,
          );
        if (threadCrewAction(action))
          return dependencies.conversationThreadCrews.call(
            action,
            args,
            ports.boundPrincipal,
            authorized,
          );
        if (THREAD_WORK_ACTIONS.has(action))
          return dependencies.conversationThreadWork.call(
            action,
            args,
            ports.boundPrincipal,
            authorized,
            typeof ports.request.params.requestId === "string"
              ? ports.request.params.requestId
              : undefined,
          );
        if (isManagementAction(action))
          return dependencies.conversationManagement.call(
            action,
            args,
            ports.boundPrincipal,
            authorized,
          );
        if (isDesktopControlConversationTool(action))
          return dependencies.conversationDesktopControl.call(
            action,
            args,
            ports.boundPrincipal,
            (await dependencies.engine.store.project(ports.boundPrincipal.projectId)).cwd,
            authorized,
          );
        if (/^(notes|inbox)\./.test(action))
          return dependencies.conversationWorkspace.call(
            action as ConversationTool,
            args,
            ports.boundPrincipal,
            undefined,
            authorized,
          );
        if (action === "host.limits.status" || action === "shell.profiles")
          return dependencies.conversationRuntimeReads.call(
            action,
            args,
            ports.boundPrincipal,
            authorized,
          );
        throw new Error("Choose a focused session before using this conversation tool.");
      },
    );
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
    await ports.request.endResult(ports.request.result, async () => {
      if (!(await authorized())) throw new Error("Conversation authority revoked.");
    });
    return;
  }
}
