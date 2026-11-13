import { createHash, randomUUID } from "node:crypto";
import type { AssistantPorts } from "../assistant/service";
import type {
  RoomManagementAdmission,
  RoomManagementCall,
  RoomManagementResult,
} from "../assistant/management/assistant-management-turn";
import type { ServerBindings } from "../server/bindings";
import { roomOperationReadOnly } from "../assistant/management/assistant-permissions";
import type { RoomAutomationChildren } from "./room-children";

const uncertain = (value: unknown, depth = 0): boolean => {
  if (!value || typeof value !== "object" || depth > 4) return false;
  if (Array.isArray(value)) return value.slice(0, 100).some((item) => uncertain(item, depth + 1));
  const row = value as Record<string, unknown>;
  return (
    ["unknown", "uncertain", "outcome-unknown"].includes(String(row.state ?? row.status)) ||
    ["operation", "receipt", "result"].some((key) => uncertain(row[key], depth + 1))
  );
};

/** Launches require an exact cancellation parent; legacy callers cannot supply one. */
const detachedWork = new Set([
  "tasks.create",
  "tasks.start",
  "tasks.retry",
  "tasks.review.recheck",
  "goals.create",
  "goals.replan",
  "automations.create",
  "automations.update",
  "automations.resume",
  "automations.runNow",
  "crews.start",
  "crews.assign",
  "crews.request",
  "crews.resolve",
  "crews.resume",
  "crews.accept",
  "crews.finish",
  "crews.answer",
  "crews.member.ask",
  "sessions.submit",
  "workspace.sessions.submit",
  "commands.dispatch",
  "commands.run",
  "servers.ssh.execute",
  "terminals.create",
  "terminals.write",
  "devServers.start",
  "devServers.restart",
  "remote.call",
  "social.send",
  "social.send.propose",
]);
const socialDataWrites = new Set([
  "drafts.update",
  "replies.draft",
  "messages.draft",
  "comments.draft",
  "contacts.upsert",
  "segments.create",
  "automations.pause",
  "jobs.cancel",
]);

export type RoomAutomationSources = {
  deviceHash: string;
  workId?: string;
  occurrence?: string;
  calls: { call: RoomManagementCall; result: RoomManagementResult }[];
};

/** Uses the registered Room dispatcher; native approval remains at each tool's effect boundary. */
export function roomAutomationTools(
  ports: AssistantPorts,
  bindings: () => Pick<ServerBindings, "conversationDesktop" | "visibilityAdmission">,
  environmentId: string,
  children?: RoomAutomationChildren,
) {
  return {
    stop: async (occurrence: string) => children?.stop(occurrence),
    allowed: async (occurrence: string) =>
      children ? children.occurrenceAllowed(occurrence) : true,
    async capture(
      threadId: string,
      occurrence: string,
      authorized: () => Promise<boolean>,
      workId?: string,
    ): Promise<RoomAutomationSources> {
      const requestId = randomUUID();
      const operationHash = createHash("sha256")
        .update(JSON.stringify(["room.automation", threadId, occurrence, requestId]))
        .digest("hex");
      const dependencies = bindings();
      const captured = (await dependencies.conversationDesktop.callAssistantThread(
        "privacy.account.capture",
        { requestId, operationHash },
        { threadId, environmentId },
        authorized,
      )) as { deviceHash: string; relayId: string; envelope: unknown };
      if (!/^[a-f0-9]{64}$/.test(captured.deviceHash))
        throw new Error("Room automation native source unavailable.");
      return dependencies.visibilityAdmission.withCaptures(
        [],
        authorized,
        async (valid) => {
          if (!valid()) throw new Error("Room automation native source changed.");
          return { deviceHash: captured.deviceHash, workId, occurrence, calls: [] };
        },
        [
          {
            envelope: captured.envelope,
            expected: {
              environmentId,
              threadId,
              requestId,
              operationHash,
              relayId: captured.relayId,
            },
          },
        ],
      );
    },
    async call(
      call: RoomManagementCall,
      sources: RoomAutomationSources,
      authorized: () => Promise<boolean>,
      signal: AbortSignal,
    ) {
      if (!ports.roomManagement) throw new Error("Room tool dispatcher unavailable.");
      const owned = children?.supports(call.action);
      if (
        (call.family !== "social" && detachedWork.has(call.action) && !(children && owned)) ||
        (call.family === "social" &&
          !roomOperationReadOnly(call) &&
          !socialDataWrites.has(call.action))
      )
        return {
          value: {
            state: "unavailable",
            error:
              "This operation can outlive Room automation Stop. Original occurrence ownership and exact cancellation are required before launch.",
          },
          source: {
            environmentId,
            threadId: call.threadId,
            family: call.family,
            action: call.action,
          },
        };
      const dispatch = () =>
        ports.roomManagement!(call, {
          environmentId,
          deviceHash: sources.deviceHash,
          authorized,
          signal,
        });
      const result = children
        ? await children.withChild(call, sources, authorized, dispatch, signal)
        : await dispatch();
      if (uncertain(result.value))
        throw new Error("Room tool outcome is uncertain. Inspect the original operation.");
      sources.calls.push({ call, result });
      return result;
    },
    async disclose<T>(
      threadId: string,
      sources: RoomAutomationSources | undefined,
      authorized: () => Promise<boolean>,
      signal: AbortSignal | undefined,
      effect: (valid: () => boolean) => Promise<T>,
    ): Promise<T> {
      if (!sources?.calls.length) {
        if (signal?.aborted || !(await authorized()))
          throw new Error("Room automation authority was withdrawn.");
        return effect(() => !signal?.aborted);
      }
      if (!ports.withRoomResponseDisclosure) throw new Error("Room source disclosure unavailable.");
      const admission: RoomManagementAdmission = {
        environmentId,
        deviceHash: sources.deviceHash,
        authorized,
        signal,
      };
      return ports.withRoomResponseDisclosure(
        sources.calls.map(({ call, result }) => ({
          threadId,
          projects: [
            ...new Set([
              ...(call.projectId ? [call.projectId] : []),
              ...(result.contributorProjectIds ?? []),
              ...(result.contributorProjects ?? []).map((proof) => proof.projectId),
            ]),
          ],
          accounts: result.contributorAccounts ?? [],
          projectProofs: result.contributorProjects ?? [],
          nativeProofs: result.contributorNativeProofs ?? [],
        })),
        admission,
        async (valid) => {
          if (!valid()) throw new Error("Room source visibility changed.");
          const result = await effect(valid);
          if (!valid() || signal?.aborted || !(await authorized()))
            throw new Error("Room source visibility changed.");
          await ports.roomObservationDelivered?.(
            threadId,
            sources.calls.map(({ result }) => result),
            sources.calls.flatMap(({ result }) => result.contributorAccounts ?? []),
            valid,
            sources.calls.flatMap(({ result }) => result.contributorProjects ?? []),
            sources.calls.flatMap(({ result }) => result.contributorNativeProofs ?? []),
          );
          return result;
        },
      );
    },
  };
}
export type RoomAutomationTools = Pick<
  ReturnType<typeof roomAutomationTools>,
  "capture" | "call" | "disclose"
> &
  Partial<Pick<ReturnType<typeof roomAutomationTools>, "stop" | "allowed">>;
