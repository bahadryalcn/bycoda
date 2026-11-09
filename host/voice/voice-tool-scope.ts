import {
  voiceGlobalToolAllowed,
  voiceThreadToolAllowed,
} from "../../src/shared/model/voiceToolScope";
import { roomManagementToolAllowed } from "../assistant/management/assistant-management-dispatch";
import { isRoomOnlyConversationAction } from "../conversation/conversation-tools";
import { voiceToolCatalog } from "./voice-tools";

/** The verified context a voice tool list or call runs in. */
export type VoiceToolScope = { projectId?: string; threadId?: string; sessionId?: string };

/** Mirrors the call path of each scope so a listed tool is never rejected at call time:
 * global thread -> `voiceGlobalToolAllowed`; project thread without a session -> the Room
 * management gate (`desktop.status` goes through the thread grant allowlist); a focused
 * session keeps its own gates except Room-only conversation actions. */
export function voiceToolAllowedInScope(
  tool: { family: string; action: string },
  scope: VoiceToolScope,
) {
  if (!scope.projectId) return voiceGlobalToolAllowed(tool.family, tool.action);
  if (scope.sessionId === undefined)
    return scope.threadId === undefined
      ? true
      : tool.family === "conversation" && tool.action === "desktop.status"
        ? voiceThreadToolAllowed(tool.family, tool.action)
        : roomManagementToolAllowed(tool.family, tool.action, scope.projectId);
  return tool.family !== "conversation" || !isRoomOnlyConversationAction(tool.action);
}

/** Global discovery also lists project tools, marked `requiresProject`, so the model can find
 * them and call them with an explicit visible project; the call path re-verifies that target. */
export function voiceToolsForScope(scope: VoiceToolScope) {
  return voiceToolCatalog().flatMap((tool) =>
    voiceToolAllowedInScope(tool, scope)
      ? [tool]
      : !scope.projectId &&
          voiceToolAllowedInScope(tool, { projectId: "explicit-project-required", threadId: "" })
        ? [{ ...tool, requiresProject: true as const }]
        : [],
  );
}
