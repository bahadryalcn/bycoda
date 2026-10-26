import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { RemoteMachine } from "../../src/features/connections/model/protocol";
import {
  sprintProjectKey,
  sprintTaskKey,
  type HostSprint,
  type SprintCreateInput,
  type SprintUpdateInput,
  type SprintCommand,
  type SprintCompleteInput,
  type SprintPlanInput,
  type SprintPlanItem,
  type SprintIngestInput,
  type SprintSourceState,
  type SprintTaskSnapshot,
  type SprintSourceEvent,
  type SprintReport,
  type SprintReportTask,
  type SprintTotals,
  type SprintLedgerEntry,
} from "../../src/features/tasks/model/hostSprints";

/** Fictitious paired Hosts for browser acceptance. No user data, SQLite or provider calls. */
export class SprintFixture {
  private sprints = new Map<string, HostSprint>();
  private planning = new Map<string, SprintPlanItem>();
  private sources = new Map<string, SprintSourceState>();
  private snapshots = new Map<string, SprintTaskSnapshot & { deleted?: boolean }>();
  private histories = new Map<string, SprintSourceEvent[]>();
  private previous = new Map<string, Map<string, string>>();
  private ledger: SprintLedgerEntry[] = [];
  private frozen = new Map<string, SprintReport>();
  private receipts = new Map<string, { payload: string; value: unknown }>();
  constructor(
    private machines: RemoteMachine[],
    private taskRows: () => Record<string, HostTask[]>,
  ) {}
  private compact(task: HostTask): SprintTaskSnapshot {
    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      updatedAt: task.updatedAt,
      goalId: task.goalId,
    };
  }
  private history(machineId: string) {
    const events = this.histories.get(machineId) ?? [];
    const previous = this.previous.get(machineId) ?? new Map<string, string>();
    const present = new Set<string>();
    for (const row of this.taskRows()[machineId] ?? []) {
      const task = this.compact(row),
        key = JSON.stringify([task.projectId, task.id]),
        encoded = JSON.stringify(task);
      present.add(key);
      if (previous.get(key) !== encoded)
        events.push({
          sequence: events.length + 1,
          projectId: task.projectId,
          taskId: task.id,
          status: task.status,
          effectiveAt: Date.now(),
          deleted: false,
          task,
        });
      previous.set(key, encoded);
    }
    for (const [key, encoded] of previous)
      if (!present.has(key)) {
        const task = JSON.parse(encoded) as SprintTaskSnapshot;
        events.push({
          sequence: events.length + 1,
          projectId: task.projectId,
          taskId: task.id,
          status: task.status,
          effectiveAt: Date.now(),
          deleted: true,
          task,
        });
        previous.delete(key);
      }
    this.previous.set(machineId, previous);
    this.histories.set(machineId, events);
    return events;
  }
  private total(tasks: SprintReportTask[]): SprintTotals {
    const totals: SprintTotals = {
      tasks: 0,
      points: 0,
      completedPoints: 0,
      remainingPoints: 0,
      unestimated: 0,
      deleted: 0,
    };
    for (const task of tasks) {
      if (task.deleted) {
        totals.deleted++;
        continue;
      }
      totals.tasks++;
      totals.points += task.storyPoints ?? 0;
      if (task.storyPoints === null) totals.unestimated++;
      if (task.status === "done") totals.completedPoints += task.storyPoints ?? 0;
      else totals.remainingPoints += task.storyPoints ?? 0;
    }
    return totals;
  }
  private report(id: string): SprintReport {
    if (this.frozen.has(id))
      return structuredClone({ ...this.frozen.get(id)!, sprint: this.sprints.get(id)! });
    const sprint = this.sprints.get(id);
    if (!sprint) throw new Error("Sprint not found.");
    const tasks = [...this.planning.values()]
      .filter((item) => item.sprintId === id)
      .map((item) => {
        const task = this.snapshots.get(sprintTaskKey(item));
        return {
          ...item,
          title: task?.title ?? item.taskId,
          status: task?.status ?? "todo",
          deleted: task?.deleted ?? false,
          updatedAt: task?.updatedAt ?? 0,
        } satisfies SprintReportTask;
      });
    return structuredClone({
      sprint,
      tasks,
      totals: this.total(tasks),
      projects: Object.fromEntries(
        sprint.projects.map((project) => [
          sprintProjectKey(project),
          this.total(tasks.filter((task) => sprintProjectKey(task) === sprintProjectKey(project))),
        ]),
      ),
      sources: [...this.sources.values()].filter((source) =>
        sprint.projects.some((project) => project.environmentId === source.environmentId),
      ),
      ledger: this.ledger.filter((entry) => entry.sprintId === id),
      frozen: false,
    });
  }
  private record(id: string, kind: SprintLedgerEntry["kind"], taskKey?: string) {
    const report = this.report(id);
    this.ledger.push({
      sequence: this.ledger.length + 1,
      sprintId: id,
      at: Date.now(),
      kind,
      taskKey,
      totals: report.totals,
      projects: report.projects,
    });
  }
  private current(id: string, revision: number) {
    const sprint = this.sprints.get(id);
    if (!sprint || sprint.revision !== revision)
      throw new Error("Sprint changed; refresh before saving.");
    return sprint;
  }
  async rpc(method: string, machineId: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "tasks.snapshotWithCursor") {
      const events = this.history(machineId);
      return {
        tasks: (this.taskRows()[machineId] ?? []).map((task) => this.compact(task)),
        cursor: events.length,
        historyAvailableFrom: Date.now() - 86400000,
      };
    }
    if (method === "tasks.events") {
      const all = this.history(machineId),
        after = Number(params.after ?? 0),
        limit = Number(params.limit ?? 500);
      const events = all.filter((event) => event.sequence > after).slice(0, limit);
      return {
        events,
        cursor: events.at(-1)?.sequence ?? after,
        hasMore: all.length > (events.at(-1)?.sequence ?? after),
      };
    }
    if (method === "sprints.list")
      return structuredClone({
        sprints: [...this.sprints.values()],
        planning: [...this.planning.values()],
        sources: [...this.sources.values()],
      });
    if (method === "sprints.get") return structuredClone(this.sprints.get(String(params.id)));
    if (method === "sprints.report") return this.report(String(params.id));
    const input = params.input as Record<string, unknown>;
    if (method === "sprints.ingest") {
      const value = input as unknown as SprintIngestInput;
      const apply = (task: SprintTaskSnapshot, deleted = false) => {
        const key = sprintTaskKey({
          environmentId: value.environmentId,
          projectId: task.projectId,
          taskId: task.id,
        });
        const old = this.snapshots.get(key);
        this.snapshots.set(key, { ...task, deleted });
        const item = this.planning.get(key),
          sprint = item?.sprintId ? this.sprints.get(item.sprintId) : undefined;
        if (
          sprint &&
          ["planned", "active"].includes(sprint.state) &&
          old &&
          (old.status !== task.status || !!old.deleted !== deleted)
        )
          this.record(sprint.id, "status", key);
      };
      value.snapshot?.tasks.forEach((task) => apply(task));
      for (const event of value.events ?? [])
        apply(
          event.task ?? {
            id: event.taskId,
            projectId: event.projectId,
            title: event.taskId,
            status: event.status,
            updatedAt: event.effectiveAt,
          },
          event.deleted,
        );
      const source: SprintSourceState = {
        environmentId: value.environmentId,
        cursor: value.cursor,
        syncedAt: Date.now(),
        visibleProjectIds: value.visibleProjectIds,
        caughtUp: value.caughtUp !== false,
        historyAvailableFrom:
          value.snapshot?.historyAvailableFrom ??
          this.sources.get(value.environmentId)?.historyAvailableFrom,
      };
      this.sources.set(value.environmentId, source);
      return structuredClone(source);
    }
    if (!input) throw new Error("Fixture sprint input required.");
    const receiptKey = String(input.requestId),
      payload = JSON.stringify([method, params]);
    const receipt = this.receipts.get(receiptKey);
    if (receipt) {
      if (receipt.payload !== payload) throw new Error("Request identity mismatch.");
      return structuredClone(receipt.value);
    }
    let result: unknown;
    const id = String(params.id);
    if (method === "sprints.create") {
      const value = input as unknown as SprintCreateInput;
      const sprint: HostSprint = {
        ...value,
        state: "planned",
        revision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sprints.set(sprint.id, sprint);
      result = sprint;
    } else if (method === "sprints.update") {
      const value = input as unknown as SprintUpdateInput;
      const sprint = this.current(id, value.expectedRevision);
      const next: HostSprint = {
        ...sprint,
        ...value,
        goal: value.goal === null ? undefined : value.goal === undefined ? sprint.goal : value.goal,
        startsAt:
          value.startsAt === null
            ? undefined
            : value.startsAt === undefined
              ? sprint.startsAt
              : value.startsAt,
        endsAt:
          value.endsAt === null
            ? undefined
            : value.endsAt === undefined
              ? sprint.endsAt
              : value.endsAt,
        revision: sprint.revision + 1,
        updatedAt: Date.now(),
      };
      this.sprints.set(id, next);
      this.record(id, "update");
      result = next;
    } else if (method === "sprints.plan") {
      const value = input as unknown as SprintPlanInput,
        key = sprintTaskKey(value),
        previous = this.planning.get(key);
      if ((previous?.revision ?? 0) !== value.expectedRevision)
        throw new Error("Task planning changed; refresh.");
      if (!this.snapshots.has(key))
        throw new Error("Refresh the task's machine before changing its planning.");
      const next: SprintPlanItem = {
        ...value,
        storyPoints:
          value.storyPoints === undefined ? (previous?.storyPoints ?? null) : value.storyPoints,
        revision: (previous?.revision ?? 0) + 1,
      };
      this.planning.set(key, next);
      for (const target of new Set([previous?.sprintId, next.sprintId]))
        if (target && ["planned", "active"].includes(this.sprints.get(target)!.state))
          this.record(target, previous?.sprintId === next.sprintId ? "estimate" : "scope", key);
      result = next;
    } else if (["sprints.start", "sprints.complete", "sprints.archive"].includes(method)) {
      const value = input as unknown as SprintCommand,
        sprint = this.current(id, value.expectedRevision),
        now = Date.now();
      const next: HostSprint = {
        ...sprint,
        state:
          method === "sprints.start"
            ? "active"
            : method === "sprints.complete"
              ? "completed"
              : "archived",
        revision: sprint.revision + 1,
        updatedAt: now,
        ...(method === "sprints.start"
          ? { startedAt: now }
          : method === "sprints.complete"
            ? { completedAt: now }
            : {}),
      };
      this.sprints.set(id, next);
      if (method === "sprints.start") this.record(id, "start");
      if (method === "sprints.complete") {
        this.record(id, "complete");
        this.frozen.set(id, { ...this.report(id), frozen: true });
        const rollover = (input as unknown as SprintCompleteInput).rollover;
        for (const key of rollover?.taskKeys ?? []) {
          const item = this.planning.get(key)!;
          this.planning.set(key, {
            ...item,
            sprintId: rollover!.targetSprintId,
            revision: item.revision + 1,
          });
        }
      }
      result = next;
    } else if (method === "sprints.goalContext")
      result = { ...input, revision: Number(input.expectedRevision ?? 0) + 1 };
    else throw new Error(`Unexpected sprint fixture RPC ${method}`);
    this.receipts.set(receiptKey, { payload, value: structuredClone(result) });
    return structuredClone(result);
  }
}
