import {
  isAssistantObservationAction,
  validateAssistantObservationInput,
} from "../observations/assistant-observation-tools";
import { validateConversationTool } from "../../conversation/conversation-tools";
import {
  voiceGlobalToolAllowed,
  voiceThreadToolAllowed,
} from "../../../src/shared/model/voiceToolScope";
import { parseVoiceToolCall, voiceToolCatalog } from "../../voice/voice-tools";
import type {
  RoomManagementAdmission,
  RoomManagementCall,
  RoomManagementResult,
} from "./assistant-management-turn";
import { isManagementAction } from "../../conversation/conversation-management-tools";
import { THREAD_WORK_ACTIONS } from "../../conversation/conversation-thread-work-tools";
import { threadCrewAction } from "../../conversation/conversation-thread-crew-tools";
import { isRoomNotebookAction } from "../room/assistant-room-notebook";
import { isRoomWorkspaceAction } from "../room/assistant-room-workspace";
import { isRoomSessionAction } from "../room/assistant-room-session";
import {
  isGlobalRuntimeRead,
  isRuntimeManagementAction,
} from "../../conversation/conversation-management-runtime";
import { isRoomFileAction } from "../room/assistant-room-files";
import { isRoomAppRead } from "../room/assistant-room-app-reads";
import { isRoomPrWatchAction } from "../room/assistant-room-pr-watch";
import { isRoomFolderAction } from "../folders/assistant-folder-schemas";
import { isRoomDevServerAction } from "../room/assistant-room-dev-servers";
import { isRoomTerminalAction } from "../room/assistant-room-terminals";
import { isRoomBrowserAction } from "../room/assistant-room-browser";
import { AsyncLocalStorage } from "node:async_hooks";
import { unwrapRoomNativeResult } from "../native/assistant-native-library-proof";

const projectCaptures = new AsyncLocalStorage<{ open: boolean; projects: Map<string, string> }>();
/** Called only by the trusted native-scope owner while its physical effect lease is held. */
export function captureRoomProject(projectId: string, cwd: string) {
  const scope = projectCaptures.getStore();
  if (!scope?.open) return;
  const previous = scope.projects.get(projectId);
  if (!projectId || !cwd || (previous !== undefined && previous !== cwd))
    throw new Error("Room project identity changed during the operation.");
  scope.projects.set(projectId, cwd);
}
export const hasRoomProjectCapture = (projectId: string) =>
  projectCaptures.getStore()?.projects.has(projectId) === true;

const accountResultMarker = Symbol("room-account-result");
export function roomAccountResult(
  value: unknown,
  accounts: { accountId: string; version: string }[],
) {
  return { [accountResultMarker]: true as const, value, accounts };
}
const crewWrites = new Set([
  "crews.save",
  "crews.agent.save",
  "crews.start",
  "crews.assign",
  "crews.request",
  "crews.resolve",
  "crews.pause",
  "crews.stop",
  "crews.resume",
  "crews.accept",
  "crews.finish",
]);
const targetActions = new Set([
  "tools.list",
  "tools.search",
  "tools.describe",
  "tools.status",
  "sessions.list",
  "sessions.read",
]);
export function roomManagementToolAllowed(family: string, action: string, projectId?: string) {
  if (
    family === "conversation" &&
    ["remote.grants.list", "remote.call", "remote.result"].includes(action)
  )
    return !projectId;
  if (family === "conversation" && ["social.send.propose", "social.send.status"].includes(action))
    return true;
  // Owner-chosen folders: files.* with a folder id in the global Room, commands.run in both.
  if (family === "conversation" && isRoomFolderAction(action))
    return action === "files.roots" ? !projectId : true;
  if (family === "conversation" && isRoomFileAction(action) && !projectId)
    return voiceGlobalToolAllowed(family, action);
  if (
    family === "conversation" &&
    (isRoomFileAction(action) ||
      isRoomDevServerAction(action) ||
      isRoomTerminalAction(action) ||
      isRoomBrowserAction(action))
  )
    return !!projectId;
  if (family === "conversation" && isRoomSessionAction(action)) return !!projectId;
  if (family === "conversation" && isAssistantObservationAction(action)) return true;
  if (family === "conversation" && isRoomNotebookAction(action)) return true;
  if (family === "conversation" && isRoomWorkspaceAction(action)) return !!projectId;
  // Host-wide device list is the one application read that also works without a project.
  if (family === "conversation" && action === "devices.list")
    return (
      voiceGlobalToolAllowed(family, action) ||
      (!!projectId && voiceThreadToolAllowed(family, action))
    );
  if (family === "conversation" && (isRoomAppRead(action) || isRoomPrWatchAction(action)))
    return !!projectId && voiceThreadToolAllowed(family, action);
  if (!projectId) return voiceGlobalToolAllowed(family, action);
  if (family !== "conversation") return voiceThreadToolAllowed(family, action);
  return (
    (voiceThreadToolAllowed(family, action) || voiceGlobalToolAllowed(family, action)) &&
    (targetActions.has(action) ||
      threadCrewAction(action) ||
      THREAD_WORK_ACTIONS.has(action) ||
      isManagementAction(action) ||
      /^(notes|inbox)\./.test(action))
  );
}
export function roomManagementDiscovery(
  action: string,
  input: Record<string, unknown>,
  projectId?: string,
) {
  // Global discovery also lists project tools so the manager can find them; calling one
  // still requires an explicit visible projectId, which the dispatcher re-verifies.
  const catalog = voiceToolCatalog().flatMap((tool) =>
    roomManagementToolAllowed(tool.family, tool.action, projectId)
      ? [tool]
      : !projectId &&
          roomManagementToolAllowed(tool.family, tool.action, "explicit-project-required")
        ? [{ ...tool, requiresProject: true as const }]
        : [],
  );
  const id = (tool: (typeof catalog)[number]) => `${tool.family}:${tool.action}`;
  if (action === "tools.describe") {
    const wanted = input.ids as string[];
    const maxChars = Number(input.maxChars ?? 8000);
    const selected = wanted.flatMap((name) => {
      const tool = catalog.find((item) => id(item) === name);
      return tool ? [{ id: name, ...tool }] : [];
    });
    const match =
      input.cursor === undefined ? ["", "0", "0"] : /^(\d+):(\d+)$/.exec(String(input.cursor));
    if (!match) throw new Error("Invalid Room description cursor.");
    const index = Number(match[1]),
      offset = Number(match[2]);
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(offset) ||
      index < 0 ||
      offset < 0 ||
      index > selected.length ||
      (index === selected.length && offset !== 0)
    )
      throw new Error("Invalid Room description cursor.");
    if (index === selected.length)
      return {
        tools: [],
        nextCursor: null,
        missing: wanted.filter((name) => !catalog.some((tool) => id(tool) === name)),
      };
    const serialized = JSON.stringify(selected[index]);
    if (offset >= serialized.length) throw new Error("Invalid Room description cursor.");
    const end = Math.min(serialized.length, offset + maxChars);
    const nextCursor =
      end < serialized.length
        ? `${index}:${end}`
        : index + 1 < selected.length
          ? `${index + 1}:0`
          : null;
    return {
      tools: offset === 0 && end === serialized.length ? [selected[index]] : [],
      fragment:
        offset === 0 && end === serialized.length
          ? undefined
          : {
              id: selected[index].id,
              offset,
              text: serialized.slice(offset, end),
              totalChars: serialized.length,
            },
      nextCursor,
      missing: wanted.filter((name) => !catalog.some((tool) => id(tool) === name)),
    };
  }
  const query = String(input.query ?? "")
    .trim()
    .toLocaleLowerCase();
  const filtered = catalog.filter(
    (tool) =>
      (!Array.isArray(input.ids) || input.ids.includes(id(tool))) &&
      (!input.group || tool.family === input.group) &&
      (!input.family || tool.action.startsWith(`${input.family}.`)) &&
      (!query || `${tool.action} ${tool.description}`.toLocaleLowerCase().includes(query)),
  );
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid Room discovery cursor.");
  const limit = Math.min(Number(input.limit ?? 10), 20);
  return {
    tools: filtered.slice(offset, offset + limit).map((tool) => ({
      id: id(tool),
      family: tool.family,
      action: tool.action,
      description: tool.description,
      annotations: tool.annotations,
      ...("requiresProject" in tool ? { requiresProject: true } : {}),
      ...(action === "tools.status" ? { availability: "unknown" } : {}),
    })),
    total: filtered.length,
    nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
  };
}
/** New operation identity is Host-generated; references to prior receipts remain intact. */
export function roomManagementInput(
  family: string,
  action: string,
  input: Record<string, unknown>,
  requestId: string,
) {
  const result = { ...input };
  if (crewWrites.has(action) || action === "servers.ssh.save" || action === "servers.ssh.remove")
    result.operationId = requestId;
  if (["crews.start", "crews.request", "servers.ssh.execute"].includes(action))
    result.requestId = requestId;
  else if (
    !action.startsWith("crews.") &&
    !action.startsWith("servers.") &&
    action !== "commands.run.cancel" &&
    !action.endsWith(".status") &&
    !action.endsWith(".result")
  ) {
    const tool = voiceToolCatalog().find(
      (item) => item.family === family && item.action === action,
    );
    const schema = tool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    if (schema?.properties?.requestId) result.requestId = requestId;
  }
  return result;
}

/** Shared admission boundary. The caller supplies the live owner authority, never a token. */
export function createRoomManagementDispatcher(ports: {
  environmentId: string;
  thread(id: string): Promise<{ id: string; projectId?: string } | null>;
  visibleProject(
    id: string,
    threadId: string,
    admission: RoomManagementAdmission,
  ): Promise<boolean>;
  execute(call: RoomManagementCall, admission: RoomManagementAdmission): Promise<unknown>;
}) {
  return async (
    call: RoomManagementCall,
    admission: RoomManagementAdmission,
  ): Promise<RoomManagementResult> => {
    const check = async () => {
      admission.signal?.throwIfAborted();
      if (
        admission.environmentId !== ports.environmentId ||
        !admission.deviceHash ||
        !(await admission.authorized())
      )
        throw new Error("Room owner authority unavailable.");
      const thread = await ports.thread(call.threadId);
      if (
        !thread ||
        thread.id !== call.threadId ||
        (thread.projectId && thread.projectId !== call.projectId)
      )
        throw new Error("Room thread identity or target changed.");
    };
    if (
      !call.threadId ||
      !call.requestId ||
      call.requestId.length > 200 ||
      !call.input ||
      typeof call.input !== "object" ||
      Array.isArray(call.input)
    )
      throw new Error("Invalid Room management request.");
    if (call.family === "conversation") {
      if (isAssistantObservationAction(call.action))
        validateAssistantObservationInput(call.action, call.input);
      else validateConversationTool(call.action, call.input);
    } else {
      if (
        !call.projectId &&
        !(call.family === "social" && (call.accountId || call.action === "accounts.list"))
      )
        throw new Error(
          "Choose a visible project or authorized social account for this Room tool family.",
        );
      parseVoiceToolCall(call);
    }
    if (!roomManagementToolAllowed(call.family, call.action, call.projectId))
      throw new Error(
        "This Room operation requires another owner workflow or an explicit project.",
      );
    await check();
    if (call.projectId && !(await ports.visibleProject(call.projectId, call.threadId, admission)))
      throw new Error("The target project is unavailable or locked.");
    await check();
    const captured = { open: true, projects: new Map<string, string>() };
    let raw: unknown;
    try {
      raw = await projectCaptures.run(captured, () => ports.execute(call, admission));
    } finally {
      captured.open = false;
    }
    await check();
    const projectCwd = call.projectId ? captured.projects.get(call.projectId) : undefined;
    if (call.projectId && !projectCwd) throw new Error("Room project provenance is unavailable.");
    const accountResult =
      raw && typeof raw === "object" && accountResultMarker in raw
        ? (raw as ReturnType<typeof roomAccountResult>)
        : undefined;
    const nativeResult = unwrapRoomNativeResult(raw);
    const nativeRequired =
      call.family === "conversation" &&
      isAssistantObservationAction(call.action) &&
      (call.input.nativeLibrary === true || call.input.source === "native-session");
    if (
      nativeRequired &&
      (!nativeResult?.proofs.length ||
        nativeResult.proofs.some(
          (proof) =>
            proof.environmentId !== ports.environmentId || proof.threadId !== call.threadId,
        ))
    )
      throw new Error("Native library provenance is unavailable.");
    if (nativeResult && !nativeRequired) throw new Error("Unexpected Native library provenance.");
    const value = accountResult ? accountResult.value : nativeResult ? nativeResult.value : raw;
    await check();
    if (call.projectId && !(await ports.visibleProject(call.projectId, call.threadId, admission)))
      throw new Error(
        "The target project became unavailable or locked; inspect the original operation.",
      );
    await check();
    return {
      value,
      ...(nativeResult
        ? { contributorNativeProofs: nativeResult.proofs, contributorProjectIds: [] }
        : {}),
      ...(captured.projects.size
        ? {
            contributorProjects: [...captured.projects].map(([projectId, cwd]) => ({
              projectId,
              cwd,
            })),
          }
        : {}),
      ...(call.projectId &&
      call.family === "conversation" &&
      (isRoomFileAction(call.action) ||
        isRoomFolderAction(call.action) ||
        isRoomDevServerAction(call.action) ||
        isRoomTerminalAction(call.action) ||
        isRoomBrowserAction(call.action))
        ? { contributorProjectIds: [call.projectId] }
        : {}),
      ...(!call.projectId && call.family === "conversation" && isGlobalRuntimeRead(call.action)
        ? { contributorProjectIds: [] }
        : {}),
      ...(!call.projectId &&
      call.family === "conversation" &&
      (isRoomFileAction(call.action) || isRoomFolderAction(call.action))
        ? { contributorProjectIds: [] }
        : {}),
      ...(!call.projectId &&
      call.family === "conversation" &&
      ["remote.grants.list", "remote.result"].includes(call.action)
        ? { contributorProjectIds: [] }
        : {}),
      ...(call.projectId && call.family === "conversation" && isRuntimeManagementAction(call.action)
        ? { contributorProjectIds: [call.projectId] }
        : {}),
      ...(accountResult ? { contributorAccounts: accountResult.accounts } : {}),
      ...(accountResult && !call.projectId ? { contributorProjectIds: [] } : {}),
      source: {
        environmentId: ports.environmentId,
        threadId: call.threadId,
        ...(call.projectId ? { projectId: call.projectId, projectCwd } : {}),
        ...(call.accountId ? { accountId: call.accountId } : {}),
        ...(nativeResult ? { nativeLibrary: true } : {}),
        family: call.family,
        action: call.action,
      },
      ...((call.family === "runtime-logs" && !!call.projectId) ||
      (call.family === "conversation" &&
        (["tools.list", "tools.search", "tools.describe", "tools.status"].includes(call.action) ||
          (!call.projectId && ["servers.list", "servers.get"].includes(call.action)) ||
          (!!call.projectId &&
            [
              "sessions.list",
              "sessions.read",
              "notes.list",
              "notes.read",
              "notes.create",
              "notes.update",
              "notes.delete",
              "inbox.list",
              "inbox.providers.status",
              "tasks.list",
              "tasks.get",
              "goals.list",
              "goals.get",
              "automations.list",
              "automations.get",
              "automations.runs",
              "crews.list",
              "crews.schema",
            ].includes(call.action))))
        ? { contributorProjectIds: call.projectId ? [call.projectId] : [] }
        : {}),
    };
  };
}
