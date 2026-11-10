import type { CrewRunView } from "./crewClient";

export type CrewTimelineKind =
  | "created"
  | "assigned"
  | "started"
  | "review"
  | "review-failed"
  | "review-passed"
  | "accepted"
  | "blocked"
  | "request"
  | "resolved"
  | "paused"
  | "finished";

export type CrewTimelineEvent = {
  id: string;
  at: number;
  kind: CrewTimelineKind;
  /** The snapshot member the event is about; absent for the owner and the run itself. */
  memberId?: string;
  taskId?: string;
  /** Task title or message text. */
  text?: string;
  /** The Host stores no exact time for this event; `at` is the task's or run's last update. */
  approximate?: boolean;
};

// Same-millisecond events keep their story order.
const ORDER: Record<CrewTimelineKind, number> = {
  created: 0,
  assigned: 1,
  request: 2,
  started: 3,
  review: 4,
  "review-failed": 5,
  "review-passed": 6,
  accepted: 7,
  blocked: 8,
  resolved: 9,
  paused: 10,
  finished: 11,
};

/**
 * The ordered history of one work, derived only from what the run view carries: run and task
 * timestamps, review attempts and messages. The Host keeps no event log, so assignment time is
 * the task's creation, and review, blocked, paused and finished moments are marked approximate.
 */
export function crewRunTimeline(run: CrewRunView): CrewTimelineEvent[] {
  const events: CrewTimelineEvent[] = [{ id: "created", at: run.createdAt, kind: "created" }];
  const agents = run.definition.agents;
  const coordinatorId = agents.find((agent) => agent.role === "coordinator")?.id;
  const reviewerId = agents.find((agent) => agent.role === "reviewer")?.id;
  const memberOfTask = new Map(run.assignments.map((a) => [a.taskId, a.memberId]));
  const memberOfSession = new Map<string, string>();
  if (run.coordinatorSessionId && coordinatorId)
    memberOfSession.set(run.coordinatorSessionId, coordinatorId);
  for (const task of run.tasks) {
    const member = memberOfTask.get(task.id);
    if (task.sessionId && member) memberOfSession.set(task.sessionId, member);
    if (task.reviewer?.sessionId && reviewerId)
      memberOfSession.set(task.reviewer.sessionId, reviewerId);
  }
  for (const task of run.tasks) {
    const memberId = memberOfTask.get(task.id);
    const base = { memberId, taskId: task.id, text: task.title };
    events.push({ ...base, id: `assigned:${task.id}`, at: task.createdAt, kind: "assigned" });
    if (task.startedAt !== undefined)
      events.push({ ...base, id: `started:${task.id}`, at: task.startedAt, kind: "started" });
    for (const attempt of task.attemptHistory ?? [])
      events.push({
        ...base,
        id: `attempt:${task.id}:${attempt.attempt}:${attempt.at}`,
        at: attempt.at,
        kind: attempt.verdict === "pass" ? "review-passed" : "review-failed",
        memberId: reviewerId,
      });
    if (task.status === "review")
      events.push({
        ...base,
        id: `review:${task.id}`,
        at: task.updatedAt,
        kind: "review",
        approximate: true,
      });
    if (task.status === "blocked")
      events.push({
        ...base,
        id: `blocked:${task.id}`,
        at: task.updatedAt,
        kind: "blocked",
        approximate: true,
      });
    if (task.status === "done")
      events.push({
        ...base,
        id: `accepted:${task.id}`,
        at: task.completedAt ?? task.updatedAt,
        kind: "accepted",
        approximate: task.completedAt === undefined,
      });
  }
  for (const message of run.messages) {
    const memberId = memberOfSession.get(message.from);
    const task = message.taskId
      ? run.tasks.find((entry) => entry.id === message.taskId)
      : undefined;
    const base = { memberId, taskId: message.taskId, text: message.text };
    events.push({ ...base, id: `request:${message.id}`, at: message.createdAt, kind: "request" });
    if (message.resolvedAt !== undefined)
      events.push({
        ...base,
        id: `resolved:${message.id}`,
        at: message.resolvedAt,
        kind: "resolved",
        text: task?.title ?? message.text,
      });
  }
  if (run.status === "paused")
    events.push({ id: "paused", at: run.updatedAt, kind: "paused", approximate: true });
  if (run.status === "finished")
    events.push({ id: "finished", at: run.updatedAt, kind: "finished", approximate: true });
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event.at - b.event.at || ORDER[a.event.kind] - ORDER[b.event.kind] || a.index - b.index,
    )
    .map(({ event }) => event);
}
