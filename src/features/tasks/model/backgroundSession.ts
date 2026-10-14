import { remoteRequest } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import type { HostTask } from "./hostTasks";
import type { BoardTask } from "./taskClient";
import { sessionDisplayTitle, sessionNeedsInput } from "../../sessions/model/session";

/** A host session a task or background automation started, as the views that
 * list it can point at it. */
export type BackgroundSessionTarget = {
  machineId: string;
  /** How this desktop addresses the project: `remote://` on another machine,
   * a plain path on this computer's own host. */
  cwd: string;
  /** The host's ID for the project folder. */
  projectId: string;
  sessionId: string;
};

/** Keep navigation available while old hosts omit the current session fields.
 * A running review takes precedence over the previous verification result. */
export function taskSessionIds(task: HostTask): {
  worker?: string;
  review?: string;
} {
  const available = (id: string | undefined) => (id?.trim() ? id : undefined);
  const attempts = [...(task.attemptHistory ?? [])].reverse();
  const latestNote = [...(task.reviewNotes ?? [])]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((note) => available(note.sessionId) || note.sessionIds?.some(available));
  return {
    worker:
      available(task.sessionId) ??
      available(task.blockedTakeover?.previousSessionId) ??
      attempts.map((entry) => available(entry.workerSessionId)).find(Boolean),
    review:
      available(task.status === "verifying" ? task.reviewer?.sessionId : undefined) ??
      available(task.verification?.review?.sessionId) ??
      available(task.reviewer?.sessionId) ??
      attempts.map((entry) => available(entry.reviewerSessionId)).find(Boolean) ??
      available(latestNote?.sessionId) ??
      [...(latestNote?.sessionIds ?? [])].reverse().map(available).find(Boolean),
  };
}

/** Sessions retain the host project's binding even when an isolated task runs
 * in a worktree. The host session supplies its actual working copy on adoption. */
export function taskBackgroundSessionTarget(
  task: Pick<BoardTask, "machineId" | "cwd" | "projectId">,
  sessionId: string,
): BackgroundSessionTarget {
  if (!sessionId.trim()) throw new Error("This session is no longer available.");
  return {
    machineId: task.machineId,
    cwd: task.cwd,
    projectId: task.projectId,
    sessionId,
  };
}

/** What the read-only summary of a session on this computer's host shows. */
export type BackgroundSessionSummary = {
  title: string;
  status: string;
  /** The last thing the agent said; empty when it has said nothing yet. */
  reply: string;
  /** The last note the host added, e.g. why the turn failed. */
  note: string;
};

export function backgroundSessionSummary(host: HostSession): BackgroundSessionSummary {
  const { blocks, harness, title } = host.session;
  const last = (role: string) =>
    [...blocks]
      .reverse()
      .find((block) => block.role === role && block.text.trim())
      ?.text.trim() ?? "";
  return {
    title: sessionDisplayTitle(title, harness),
    status:
      host.status === "running"
        ? sessionNeedsInput(host.session)
          ? "Waiting for input"
          : "Running"
        : host.status === "interrupted"
          ? "Interrupted"
          : "Idle",
    reply: last("assistant"),
    note: last("system"),
  };
}

export async function loadBackgroundSessionSummary(
  target: Pick<BackgroundSessionTarget, "machineId" | "sessionId">,
): Promise<BackgroundSessionSummary> {
  const host = await remoteRequest<HostSession | null>(target.machineId, "sessions.get", {
    sessionId: target.sessionId,
  });
  if (!host) throw new Error("This session is no longer available.");
  return backgroundSessionSummary(host);
}
