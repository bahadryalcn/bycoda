import type { z } from "zod";
import { newRequestId } from "../../../shared/lib/id/requestId";
import type {
  CrewsMemberAskParamsSchema,
  CrewsMemberAskResultSchema,
} from "../../../shared/model/host-contracts/crews";
import { remoteRequest } from "../../connections/public/connections";

export type CrewMemberAskTarget = { machineId: string; projectId: string };
/** `@member` request: exactly one of `memberId` (library id) or `handle`. */
export type CrewMemberAskParams = Omit<
  z.input<typeof CrewsMemberAskParamsSchema>,
  "projectId" | "requestId"
>;
export type CrewMemberAskResult = z.output<typeof CrewsMemberAskResultSchema>;

/** Request IDs of asks without a definite outcome, so an identical retry reuses its task. */
const pending = new Map<string, string>();
const PENDING_LIMIT = 50;

/**
 * Runs one library member in its own conversation on the project's host. The result's
 * `taskId` identifies the task; its session appears under `parentSessionId` once the
 * Host scheduler starts it. A failed or uncertain call keeps its request ID: asking the
 * same thing again returns the existing task (`reused`) instead of starting a second.
 */
export async function askCrewMember(
  target: CrewMemberAskTarget,
  params: CrewMemberAskParams,
): Promise<CrewMemberAskResult> {
  const key = JSON.stringify([target.machineId, target.projectId, params]);
  const requestId = pending.get(key) ?? newRequestId();
  pending.delete(key);
  pending.set(key, requestId);
  if (pending.size > PENDING_LIMIT) pending.delete(pending.keys().next().value as string);
  const result = await remoteRequest<CrewMemberAskResult>(
    target.machineId,
    "crews.member.ask",
    { ...params, projectId: target.projectId, requestId },
    false,
    true,
  );
  pending.delete(key);
  return result;
}
