import { taskStopText } from "../../src/shared/model/taskStopSummary";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostGoal } from "../../src/features/tasks/model/hostGoals";
import type { HostAutomation } from "../../src/features/automations/model/hostAutomations";
import type { SocialThread } from "../../src/features/social/model/social";

// Kept apart from host-notes.ts: the storage worker loads that file as raw Node source,
// which cannot resolve the extensionless imports taskStopText pulls in.
export type HostInboxItem = {
  id: string;
  kind: "session" | "task" | "goal" | "automation" | "social";
  resourceId: string;
  projectId?: string;
  title: string;
  detail: string;
  updatedAt: number;
  sessionId?: string;
  status?: string;
};
/** Attention queue from host-owned work. External issue-provider inboxes remain desktop-owned. */
export function hostInbox(
  data: {
    sessions: HostSessionSummary[];
    tasks: HostTask[];
    goals: HostGoal[];
    automations: HostAutomation[];
    threads: SocialThread[];
  },
  projectId?: string,
) {
  const items: HostInboxItem[] = [];
  for (const session of data.sessions)
    if (session.needsInput || session.status === "interrupted")
      items.push({
        id: `session:${session.id}`,
        kind: "session",
        resourceId: session.id,
        sessionId: session.id,
        projectId: session.projectId,
        title: session.title,
        detail: session.needsInput ? "Approval or answer needed" : "Session interrupted",
        updatedAt: session.updatedAt,
        status: session.status,
      });
  for (const task of data.tasks)
    if (task.status === "blocked" || task.status === "review")
      items.push({
        id: `task:${task.id}`,
        kind: "task",
        resourceId: task.id,
        projectId: task.projectId,
        sessionId: task.sessionId,
        title: task.title,
        detail:
          taskStopText(task) ??
          task.mergeError ??
          (task.status === "review" ? "Review ready" : "Task blocked"),
        updatedAt: task.updatedAt,
        status: task.status,
      });
  for (const goal of data.goals)
    if (goal.status === "awaiting-approval" || goal.status === "blocked")
      items.push({
        id: `goal:${goal.id}`,
        kind: "goal",
        resourceId: goal.id,
        projectId: goal.leadProjectId,
        sessionId: goal.plannerSessionId,
        title: goal.title,
        detail: goal.error ?? goal.planError ?? "Plan approval needed",
        updatedAt: goal.updatedAt,
        status: goal.status,
      });
  for (const automation of data.automations)
    if (automation.needsInput || automation.lastRunStatus === "failed")
      items.push({
        id: `automation:${automation.id}`,
        kind: "automation",
        resourceId: automation.id,
        projectId: automation.projectId,
        sessionId: automation.lastSessionId,
        title: automation.name,
        detail: automation.lastRunError ?? "Automation needs input",
        updatedAt: automation.updatedAt,
        status: automation.lastRunStatus,
      });
  for (const thread of data.threads)
    items.push({
      id: `social:${thread.id}`,
      kind: "social",
      resourceId: thread.id,
      projectId: thread.projectId,
      title: thread.kind === "message" ? "Social message" : "Social comment",
      detail:
        thread.reviewReason ??
        thread.events.filter((event) => event.direction === "inbound").at(-1)?.text ??
        "",
      updatedAt: thread.lastInboundAt,
      status: thread.kind,
    });
  return {
    items: items
      .filter((item) => !projectId || item.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 300),
    scope: "host-attention" as const,
    externalProviderInboxAvailable: false,
  };
}
