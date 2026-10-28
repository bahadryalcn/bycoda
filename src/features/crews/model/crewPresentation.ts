import { t } from "../../../shared/i18n";
import type { HostTask } from "../../tasks/model/hostTasks";
import { CREW_LIST_MESSAGE_LIMIT, type CrewAgent, type CrewRole } from "./crew";
import type { CrewRunView } from "./crewClient";
import { crewRunTitle } from "./crewRoster";

/**
 * Combined legacy status used by the rail ordering: a paused run reports "paused"
 * even while a decision, review or blocker waits for the owner. The work view uses
 * `crewExecutionState` plus `crewRunAttention` instead (CR-W04).
 */
export type CrewWorkStatus = "input" | "blocked" | "working" | "paused" | "active";

export function crewHasRunningWork(run: CrewRunView): boolean {
  return (
    run.coordinatorStatus === "running" ||
    run.tasks.some((task) => task.status === "running" || task.status === "verifying")
  );
}

/** Older hosts may omit activity; absence is not evidence that the lead stopped. */
export function crewActivityKnown(run: CrewRunView): boolean {
  return !run.coordinatorSessionId || run.coordinatorStatus !== undefined;
}

export function crewCanStop(run: CrewRunView): boolean {
  return (
    run.status !== "finished" &&
    (run.status === "active" ||
      !crewActivityKnown(run) ||
      crewHasRunningWork(run) ||
      run.tasks.some((task) => task.status === "queued"))
  );
}

export function crewWorkStatusLabel(status: CrewWorkStatus) {
  return status === "input"
    ? t("Needs decision")
    : status === "blocked"
      ? t("Blocked")
      : status === "working"
        ? t("Working")
        : status === "paused"
          ? t("Paused")
          : t("Active");
}

export function crewWorkStatus(run: CrewRunView): CrewWorkStatus {
  if (run.status === "paused") return "paused";
  if (run.messages.some((m) => !m.resolvedAt) || run.tasks.some((task) => task.status === "review"))
    return "input";
  if (run.tasks.some((task) => task.status === "blocked")) return "blocked";
  if (crewHasRunningWork(run)) return "working";
  return "active";
}

/**
 * What needs the owner, independent of execution state: a paused run can still
 * carry an open decision, a delivery awaiting review or a blocker (CR-W04).
 */
export type CrewAttention = "decision" | "review" | "blocked";

export function crewRunAttention(run: CrewRunView): CrewAttention | null {
  if (run.messages.some((m) => !m.resolvedAt)) return "decision";
  if (run.tasks.some((task) => task.status === "review")) return "review";
  if (run.tasks.some((task) => task.status === "blocked")) return "blocked";
  return null;
}

export function crewAttentionLabel(attention: CrewAttention) {
  return attention === "decision"
    ? t("Needs decision")
    : attention === "review"
      ? t("Needs review")
      : t("Blocked");
}

/** Finished work is closed; only unfinished work asks for the owner. */
export function crewOpenAttention(run: CrewRunView): CrewAttention | null {
  return run.status === "finished" ? null : crewRunAttention(run);
}

/**
 * Execution state of the run itself (CR-W04). `paused` stops new assignments; it
 * does not say that no conversation is running, so pair it with
 * `crewHasRunningWork`. `active` means scheduling is on and nothing is running.
 */
export type CrewExecutionState = "finished" | "paused" | "working" | "active";

export function crewExecutionState(run: CrewRunView): CrewExecutionState {
  if (run.status === "finished") return "finished";
  if (run.status === "paused") return "paused";
  return crewHasRunningWork(run) ? "working" : "active";
}

export function crewExecutionLabel(state: CrewExecutionState) {
  return state === "finished"
    ? t("Done")
    : state === "paused"
      ? t("Paused")
      : state === "working"
        ? t("Working")
        : t("Active");
}

export function crewProgressLabel(run: CrewRunView) {
  return run.tasks.length
    ? t("{p0}/{p1} tasks", {
        p0: run.tasks.filter((task) => task.status === "done").length,
        p1: run.tasks.length,
      })
    : run.status === "active" && run.coordinatorStatus === "running"
      ? t("Planning")
      : t("No assignments yet");
}

export function crewTaskStatusLabel(status: string) {
  return status === "verifying"
    ? t("Reviewing")
    : status === "review"
      ? t("Awaiting acceptance")
      : status === "blocked"
        ? t("Blocked")
        : status === "done"
          ? t("Done")
          : status === "queued"
            ? t("Queued")
            : status === "todo"
              ? t("To do")
              : t("Working");
}

/**
 * What the run view carries of the owner's request (CR-W01). The Host list strips
 * `launch`, so real data normally has only the title, which is the request's first
 * line shortened to 72 characters. A full prompt is shown only when the response
 * actually includes it; nothing is reconstructed.
 */
export type CrewRequestInfo =
  | { kind: "full"; text: string }
  | { kind: "first-line"; text: string }
  | { kind: "unavailable" };

export function crewRequestInfo(run: Pick<CrewRunView, "launch" | "title">): CrewRequestInfo {
  const full = run.launch?.prompt?.trim();
  if (full) return { kind: "full", text: full };
  const title = run.title?.trim();
  return title ? { kind: "first-line", text: title } : { kind: "unavailable" };
}

/** `crews.list` clips message text, so a message at the limit may be incomplete. */
export function crewMessageMayBeClipped(text: string): boolean {
  return text.length >= CREW_LIST_MESSAGE_LIMIT;
}

/** Member of this run's immutable team snapshot (`run.definition`), not the saved crew. */
export function crewRunMember(
  run: Pick<CrewRunView, "definition">,
  memberId: string | undefined,
): CrewAgent | undefined {
  return memberId ? run.definition.agents.find((agent) => agent.id === memberId) : undefined;
}

export function crewRunRoleMember(
  run: Pick<CrewRunView, "definition">,
  role: CrewRole,
): CrewAgent | undefined {
  return run.definition.agents.find((agent) => agent.role === role);
}

/**
 * The saved crew changed after this work started. The run keeps its own snapshot;
 * this only explains why the saved team can differ from the team doing the work.
 */
export function crewSavedTeamChanged(
  run: Pick<CrewRunView, "definition">,
  saved: { updatedAt: number } | undefined,
): boolean {
  return !!saved && saved.updatedAt > run.definition.updatedAt;
}

export type CrewReviewState = "reviewing" | "passed" | "changes" | "previous";

/**
 * Whether the reviewer conversation is the review running now. A running review
 * wins over the previous verdict (`taskSessionIds`); a session that is not running
 * is an earlier review of this task.
 */
export function crewTaskReview(
  task: HostTask,
  /** `taskSessionIds(task).review`, resolved by the caller that owns session routing. */
  sessionId: string | undefined,
): {
  current: boolean;
  state: CrewReviewState;
} {
  // Without a published reviewer session the routed session is the previous review.
  const current =
    task.status === "verifying" && !!sessionId && task.reviewer?.sessionId === sessionId;
  const verdict = task.verification?.review?.verdict;
  return {
    current,
    state:
      task.status === "verifying"
        ? "reviewing"
        : verdict === "pass"
          ? "passed"
          : verdict === "fail"
            ? "changes"
            : "previous",
  };
}

export function crewReviewLabel(state: CrewReviewState) {
  return state === "reviewing"
    ? t("Reviewing")
    : state === "passed"
      ? t("Passed")
      : state === "changes"
        ? t("Changes needed")
        : t("Earlier review");
}

/** Loaded-list search: title, request text, crew, status, tasks, members and open decisions. */
export function crewRunMatchesQuery(run: CrewRunView, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const attention = crewOpenAttention(run);
  return [
    crewRunTitle(run),
    run.launch?.prompt ?? "",
    run.definition.name,
    crewExecutionLabel(crewExecutionState(run)),
    attention ? crewAttentionLabel(attention) : "",
    ...run.tasks.map((task) => task.title),
    ...run.assignments.map((assignment) => assignment.title),
    ...run.definition.agents.map((agent) => agent.name),
    ...run.messages.filter((message) => !message.resolvedAt).map((message) => message.text),
  ]
    .join("\n")
    .toLocaleLowerCase()
    .includes(q);
}
