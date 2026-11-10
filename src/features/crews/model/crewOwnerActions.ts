import { newRequestId } from "../../../shared/lib/id/requestId";
import { remoteRequest } from "../../connections/public/connections";
import type { CrewAgent } from "./crew";
import type { CrewRunView } from "./crewClient";

const NOTE_LIMIT = 11_000;

/** Specialists and advisors of this work's snapshot: the members the Host accepts an assignment for. */
export function assignableMembers(run: CrewRunView): CrewAgent[] {
  if (run.status !== "active") return [];
  return run.definition.agents.filter(
    (agent) => agent.role === "specialist" || agent.role === "advisor",
  );
}

/** Any member can receive a note; the coordinator relays it. */
export function noteMembers(run: CrewRunView): CrewAgent[] {
  return run.status === "finished" ? [] : run.definition.agents;
}

/** Blocked tasks the owner can put back in the queue while the work can still run. */
export function retryableTasks(run: CrewRunView): CrewRunView["tasks"] {
  return run.status === "finished" ? [] : run.tasks.filter((task) => task.status === "blocked");
}

export type OwnerActionPlan<P> = { ok: true; params: P } | { ok: false };

/** `crews.assign` input; the Host requires a specialist/advisor member, a title and a prompt. */
export function planAssignment(
  run: CrewRunView,
  input: { memberId: string; title: string; prompt: string; requestId: string },
): OwnerActionPlan<{
  runId: string;
  requestId: string;
  memberId: string;
  title: string;
  prompt: string;
}> {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title || !prompt || !assignableMembers(run).some((a) => a.id === input.memberId))
    return { ok: false };
  return {
    ok: true,
    params: { runId: run.id, requestId: input.requestId, memberId: input.memberId, title, prompt },
  };
}

/**
 * `crews.request` input. The Host has no owner-to-member message: owner requests go to the
 * coordinator, so the text names the member and the coordinator relays it.
 */
export function planNote(
  run: CrewRunView,
  input: { memberId: string; note: string; requestId: string },
): OwnerActionPlan<{ runId: string; requestId: string; text: string }> {
  const member = noteMembers(run).find((agent) => agent.id === input.memberId);
  const note = input.note.trim();
  if (!member || !note || note.length > NOTE_LIMIT) return { ok: false };
  const who = member.handle ? `${member.name} (@${member.handle})` : member.name;
  return {
    ok: true,
    params: {
      runId: run.id,
      requestId: input.requestId,
      text: `Owner note for crew member ${who}, id ${member.id}. Relay it to them:\n${note}`,
    },
  };
}

/** Request IDs of owner actions without a definite outcome, so an identical retry is the same request. */
const pending = new Map<string, string>();
const PENDING_LIMIT = 50;

/** The request ID for this exact action; kept until `settleOwnerRequest`, so a retry cannot duplicate. */
export function ownerRequestId(key: string): string {
  const existing = pending.get(key);
  if (existing) return existing;
  const id = newRequestId();
  pending.set(key, id);
  if (pending.size > PENDING_LIMIT) pending.delete(pending.keys().next().value as string);
  return id;
}

export function settleOwnerRequest(key: string): void {
  pending.delete(key);
}

/** Puts a blocked task back in the queue through the existing task move; the Host rejects other states. */
export function retryBlockedTask(machineId: string, taskId: string): Promise<unknown> {
  return remoteRequest(machineId, "tasks.move", { taskId, to: "queued" }, false, true);
}
