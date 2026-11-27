import type { AssistantProfilePatch } from "../../../src/shared/model/host-contracts/assistant";
import { voiceToolCatalog } from "../../voice/voice-tools";
import type { RoomManagementAdmission, RoomManagementCall } from "./assistant-management-turn";

type Policy = Pick<AssistantProfilePatch, "permissionLevel" | "permissionProjectIds">;

/** The owner's ticked critical exclusions; a mirror that never saved them has all of them. */
export const assistantCriticalExclusions = (
  profile: Pick<AssistantProfilePatch, "criticalExclusions">,
): NonNullable<AssistantProfilePatch["criticalExclusions"]> =>
  profile.criticalExclusions ?? [
    "pushMain",
    "deleteProject",
    "deleteSession",
    "sendMessages",
    "computerUse",
    "spend",
  ];

/** Host mirrors may narrow native authority, never grant it. */
export function assistantCriticalApprovalRequired(
  profile: Pick<AssistantProfilePatch, "criticalExclusions">,
  raw: unknown,
): boolean {
  if (!raw || typeof raw !== "object") return true;
  const operation = raw as { action?: unknown; input?: Record<string, unknown> };
  const action = operation.action;
  const exclusions = assistantCriticalExclusions(profile);
  if (
    typeof action === "string" &&
    ((exclusions.includes("spend") &&
      [
        "workspace.sessions.submit",
        "sessions.message",
        "tasks.start",
        "tasks.retry",
        "tasks.review.recheck",
        "goals.create",
        "goals.replan",
        "automations.runNow",
        "crews.start",
        "crews.resume",
        "crews.member.ask",
        "sprints.plan",
      ].includes(action)) ||
      (exclusions.length > 0 &&
        [
          "commands.run",
          "commands.dispatch",
          "terminals.create",
          "terminals.write",
          "devServers.start",
          "devServers.restart",
        ].includes(action)))
  )
    return true;
  let exclusion: NonNullable<AssistantProfilePatch["criticalExclusions"]>[number] | undefined;
  if (
    action === "social.send" ||
    action === "workspace.sessions.submit" ||
    action === "sessions.message"
  )
    exclusion = "sendMessages";
  else if (action === "projects.delete") exclusion = "deleteProject";
  else if (action === "sessions.delete") exclusion = "deleteSession";
  else if (action === "desktop.act") exclusion = "computerUse";
  else if (action === "git.push" || action === "git.merge") {
    const review = operation.input?.review as
      | { targetRef?: unknown; currentBranch?: unknown }
      | undefined;
    const target = action === "git.push" ? review?.targetRef : review?.currentBranch;
    if (typeof target !== "string") return true;
    if (["main", "master", "refs/heads/main", "refs/heads/master"].includes(target))
      exclusion = "pushMain";
  }
  return exclusion !== undefined && exclusions.includes(exclusion);
}

/** Restriction only. Existing visibility, owner approval and execution gates still apply. */
export function assistantProjectMutationAllowed(
  profile: Policy,
  projectIds: readonly string[],
): boolean {
  // "ask" grants nothing standing: native authority prompts for every operation.
  if (profile.permissionLevel === undefined || profile.permissionLevel === "ask") return true;
  if (profile.permissionLevel === "watch") return false;
  if (profile.permissionLevel === "everything") return true;
  return (
    projectIds.length > 0 && projectIds.every((id) => profile.permissionProjectIds?.includes(id))
  );
}

export function roomOperationReadOnly(
  call: Pick<RoomManagementCall, "family" | "action">,
): boolean {
  return (
    voiceToolCatalog().find((tool) => tool.family === call.family && tool.action === call.action)
      ?.annotations?.readOnlyHint === true
  );
}

/** Native consent, critical exclusions and tool-specific approval never come from this mirror. */
export function assistantRoomMutationAllowed(profile: Policy, call: RoomManagementCall): boolean {
  if (roomOperationReadOnly(call)) return true;
  if (!assistantProjectMutationAllowed(profile, call.projectId ? [call.projectId] : []))
    return false;
  if (profile.permissionLevel !== "projects") return true;
  if (/^(notebook|preferences|providers|servers|organization|liveStream)\./.test(call.action))
    return false;
  if (
    [
      "crews.save",
      "crews.agent.save",
      "projects.organization.patch",
      "commands.run",
      "commands.dispatch",
      "terminals.create",
      "terminals.write",
    ].includes(call.action)
  )
    return false;
  const target = call.input.projectId;
  return target === undefined || target === call.projectId;
}

/** One Stop fence covers text and direct voice tool routes, without stopping foreign work. */
export class AssistantRoomActions {
  private controller = new AbortController();
  constructor(
    private readonly profile: () => Promise<Policy>,
    private readonly paused: () => Promise<boolean>,
  ) {}
  stop() {
    this.controller.abort();
  }
  resume() {
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }
  async allowed(call: RoomManagementCall): Promise<boolean> {
    if (roomOperationReadOnly(call)) return true;
    return (
      !this.controller.signal.aborted &&
      !(await this.paused()) &&
      assistantRoomMutationAllowed(await this.profile(), call)
    );
  }
  capture(call: RoomManagementCall, original: RoomManagementAdmission): RoomManagementAdmission {
    const source = this.controller;
    const readOnly = roomOperationReadOnly(call);
    return {
      ...original,
      signal: readOnly
        ? original.signal
        : original.signal
          ? AbortSignal.any([source.signal, original.signal])
          : source.signal,
      authorized: async () =>
        (readOnly || !source.signal.aborted) &&
        (await original.authorized()) &&
        (await this.allowed(call)),
    };
  }
}
