import type { HostStore } from "./store";
import { TASK_STATUSES } from "../src/features/tasks/model/hostTasks";
import {
  sprintProjectKey,
  sprintTaskKey,
  SPRINT_STORY_POINTS,
  type HostSprint,
  type SprintBoard,
  type SprintCommand,
  type SprintCreateInput,
  type SprintFields,
  type SprintIngestInput,
  type SprintLedgerEntry,
  type SprintPlanInput,
  type SprintPlanItem,
  type SprintReport,
  type SprintReportTask,
  type SprintSourceState,
  type SprintTaskSnapshot,
  type SprintTotals,
  type SprintUpdateInput,
  type SprintCompleteInput,
  type SprintGoalContext,
  type SprintGoalContextInput,
} from "../src/features/tasks/model/hostSprints";

const emptyTotals = (): SprintTotals => ({
  tasks: 0,
  points: 0,
  completedPoints: 0,
  remainingPoints: 0,
  unestimated: 0,
  deleted: 0,
});
function totals(tasks: SprintReportTask[]): SprintTotals {
  const result = emptyTotals();
  for (const task of tasks) {
    if (task.deleted) {
      result.deleted++;
      continue;
    }
    result.tasks++;
    if (task.storyPoints === null) result.unestimated++;
    const points = task.storyPoints ?? 0;
    result.points += points;
    if (task.status === "done") result.completedPoints += points;
    else result.remainingPoints += points;
  }
  return result;
}
function text(value: unknown, label: string, max = 1000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${label}.`);
}
function points(value: unknown): asserts value is number | null {
  if (
    value !== null &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100000 ||
      !Number.isInteger(value * 2))
  )
    throw new Error("Points must be a nonnegative whole or half point value.");
}
function fields(value: SprintFields): SprintFields {
  text(value.name, "sprint name", 200);
  if (value.goal !== undefined && (typeof value.goal !== "string" || value.goal.length > 10000))
    throw new Error("Invalid sprint goal.");
  if (!Array.isArray(value.projects) || !value.projects.length || value.projects.length > 100)
    throw new Error("Choose 1 to 100 sprint projects.");
  const keys = new Set<string>();
  for (const project of value.projects) {
    text(project.environmentId, "environment", 200);
    text(project.projectId, "project", 200);
    text(project.cwd, "project path", 4000);
    text(project.name, "project name", 500);
    const key = sprintProjectKey(project);
    if (keys.has(key)) throw new Error("Duplicate sprint project.");
    keys.add(key);
  }
  points(value.capacityPoints);
  if (
    !value.projectCapacities ||
    typeof value.projectCapacities !== "object" ||
    Array.isArray(value.projectCapacities)
  )
    throw new Error("Invalid project capacities.");
  for (const [key, capacity] of Object.entries(value.projectCapacities)) {
    if (!keys.has(key)) throw new Error("Capacity belongs to a project outside this sprint.");
    points(capacity);
    if (capacity === null) throw new Error("Project capacity must be a point value.");
  }
  for (const timestamp of [value.startsAt, value.endsAt])
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 0))
      throw new Error("Invalid sprint dates.");
  if (value.startsAt !== undefined && value.endsAt !== undefined && value.endsAt <= value.startsAt)
    throw new Error("Sprint end must follow its start.");
  return {
    name: value.name.trim(),
    goal: value.goal,
    projects: value.projects,
    capacityPoints: value.capacityPoints,
    projectCapacities: value.projectCapacities,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
  };
}
type Snapshot = SprintTaskSnapshot & { environmentId: string; deleted: boolean };

/** Planning metadata only. Execution remains exclusively owned by each task Host. */
export class HostSprints {
  readonly ready: Promise<void>;
  onChange?: () => void;
  constructor(
    private store: HostStore,
    private now: () => number = Date.now,
  ) {
    this.ready = store.db.exec(`
      CREATE TABLE IF NOT EXISTS sprints (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_planning (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_sources (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_task_snapshots (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_receipts (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_ledger (sequence INTEGER PRIMARY KEY AUTOINCREMENT, sprint_id TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sprint_ledger_sprint ON sprint_ledger(sprint_id,sequence);
      CREATE TABLE IF NOT EXISTS sprint_reports (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sprint_goal_contexts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }
  private async read<T>(table: string, id: string): Promise<T | undefined> {
    const row = await this.store.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }
  private async all<T>(table: string): Promise<T[]> {
    const rows = await this.store.db.prepare(`SELECT value FROM ${table} ORDER BY id`).all();
    return rows.map((row) => JSON.parse(String(row.value)) as T);
  }
  private async write(table: string, id: string, value: unknown) {
    await this.store.db
      .prepare(
        `INSERT INTO ${table}(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`,
      )
      .run(id, JSON.stringify(value));
  }
  private async command<T>(
    requestId: string,
    payload: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.ready;
    text(requestId, "request identity", 200);
    const encoded = JSON.stringify(payload);
    return this.store.transaction(async () => {
      const receipt = await this.store.db
        .prepare("SELECT payload,result FROM sprint_receipts WHERE id=?")
        .get(requestId);
      if (receipt) {
        if (receipt.payload !== encoded)
          throw new Error("Request identity was already used for different sprint changes.");
        return JSON.parse(String(receipt.result)) as T;
      }
      const result = await operation();
      await this.store.db
        .prepare("INSERT INTO sprint_receipts VALUES (?,?,?)")
        .run(requestId, encoded, JSON.stringify(result));
      this.store.afterCommit(() => this.onChange?.());
      return result;
    });
  }
  async list(): Promise<SprintBoard> {
    await this.ready;
    return this.store.db.scope(async () => ({
      sprints: await this.all<HostSprint>("sprints"),
      planning: await this.all<SprintPlanItem>("sprint_planning"),
      sources: await this.all<SprintSourceState>("sprint_sources"),
      contexts: await this.all<SprintGoalContext>("sprint_goal_contexts"),
    }));
  }
  async get(id: string): Promise<HostSprint | undefined> {
    await this.ready;
    return this.read("sprints", id);
  }
  private async current(id: string, revision: number) {
    const sprint = await this.get(id);
    if (!sprint) throw new Error("Sprint not found.");
    if (!Number.isSafeInteger(revision) || sprint.revision !== revision)
      throw new Error("Sprint changed; refresh before saving.");
    return sprint;
  }
  async create(input: SprintCreateInput): Promise<HostSprint> {
    return this.command(input.requestId, ["create", input], async () => {
      text(input.id, "sprint identity", 200);
      if (await this.get(input.id)) throw new Error("Sprint already exists.");
      const sprint: HostSprint = {
        ...fields(input),
        id: input.id,
        state: "planned",
        revision: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await this.write("sprints", sprint.id, sprint);
      return sprint;
    });
  }
  async update(id: string, input: SprintUpdateInput): Promise<HostSprint> {
    return this.command(input.requestId, ["update", id, input], async () => {
      const sprint = await this.current(id, input.expectedRevision);
      if (["completed", "archived"].includes(sprint.state))
        throw new Error("Completed sprint planning is frozen.");
      const next = {
        ...sprint,
        ...fields({
          ...sprint,
          ...input,
          goal:
            input.goal === null ? undefined : input.goal === undefined ? sprint.goal : input.goal,
          startsAt:
            input.startsAt === null
              ? undefined
              : input.startsAt === undefined
                ? sprint.startsAt
                : input.startsAt,
          endsAt:
            input.endsAt === null
              ? undefined
              : input.endsAt === undefined
                ? sprint.endsAt
                : input.endsAt,
        }),
        revision: sprint.revision + 1,
        updatedAt: this.now(),
      };
      const planning = await this.all<SprintPlanItem>("sprint_planning");
      if (
        planning.some(
          (item) =>
            item.sprintId === id &&
            !next.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(item)),
        )
      )
        throw new Error("Remove this project's tasks before removing the project.");
      await this.write("sprints", id, next);
      await this.record(id, "update");
      return next;
    });
  }
  private async requireSynced(sprint: HostSprint) {
    for (const project of sprint.projects) {
      const source = await this.read<SprintSourceState>("sprint_sources", project.environmentId);
      if (
        !source ||
        source.caughtUp === false ||
        this.now() - source.syncedAt > 60000 ||
        (source.visibleProjectIds && !source.visibleProjectIds.includes(project.projectId))
      )
        throw new Error("Refresh all sprint machines before changing its lifecycle.");
    }
  }
  async start(id: string, input: SprintCommand): Promise<HostSprint> {
    return this.command(input.requestId, ["start", id, input], async () => {
      const sprint = await this.current(id, input.expectedRevision);
      if (sprint.state !== "planned") throw new Error("Only a planned sprint can start.");
      await this.requireSynced(sprint);
      const next: HostSprint = {
        ...sprint,
        state: "active",
        startedAt: this.now(),
        updatedAt: this.now(),
        revision: sprint.revision + 1,
      };
      await this.write("sprints", id, next);
      await this.record(id, "start");
      return next;
    });
  }
  async complete(id: string, input: SprintCompleteInput): Promise<HostSprint> {
    return this.command(input.requestId, ["complete", id, input], async () => {
      const sprint = await this.current(id, input.expectedRevision);
      if (sprint.state !== "active") throw new Error("Only an active sprint can complete.");
      await this.requireSynced(sprint);
      const rollover = input.rollover;
      const items: SprintPlanItem[] = [];
      if (rollover) {
        if (
          !Array.isArray(rollover.taskKeys) ||
          rollover.taskKeys.length > 1000 ||
          new Set(rollover.taskKeys).size !== rollover.taskKeys.length
        )
          throw new Error("Invalid rollover selection.");
        const target =
          rollover.targetSprintId === null ? undefined : await this.get(rollover.targetSprintId);
        if (
          rollover.targetSprintId !== null &&
          (!target || target.id === id || !["planned", "active"].includes(target.state))
        )
          throw new Error("Choose another planned or active sprint for rollover.");
        for (const key of rollover.taskKeys) {
          const item = await this.read<SprintPlanItem>("sprint_planning", key);
          const task = await this.read<Snapshot>("sprint_task_snapshots", key);
          if (!item || item.sprintId !== id || !task || task.deleted || task.status === "done")
            throw new Error("Only unfinished sprint tasks can roll over.");
          if (
            target &&
            !target.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(item))
          )
            throw new Error("Rollover task project is outside the target sprint.");
          items.push(item);
        }
      }
      const next: HostSprint = {
        ...sprint,
        state: "completed",
        completedAt: this.now(),
        updatedAt: this.now(),
        revision: sprint.revision + 1,
      };
      await this.write("sprints", id, next);
      await this.record(id, "complete");
      await this.write("sprint_reports", id, { ...(await this.liveReport(id)), frozen: true });
      for (const item of items) {
        await this.write("sprint_planning", sprintTaskKey(item), {
          ...item,
          sprintId: rollover!.targetSprintId,
          revision: item.revision + 1,
        });
        if (rollover!.targetSprintId)
          await this.record(rollover!.targetSprintId, "scope", sprintTaskKey(item));
      }
      return next;
    });
  }
  async archive(id: string, input: SprintCommand): Promise<HostSprint> {
    return this.command(input.requestId, ["archive", id, input], async () => {
      const sprint = await this.current(id, input.expectedRevision);
      if (sprint.state !== "completed") throw new Error("Complete the sprint before archiving it.");
      const next: HostSprint = {
        ...sprint,
        state: "archived",
        updatedAt: this.now(),
        revision: sprint.revision + 1,
      };
      await this.write("sprints", id, next);
      return next;
    });
  }
  async plan(input: SprintPlanInput): Promise<SprintPlanItem> {
    return this.command(input.requestId, ["plan", input], async () => {
      text(input.environmentId, "environment", 200);
      text(input.projectId, "project", 200);
      text(input.taskId, "task", 200);
      const key = sprintTaskKey(input),
        previous = await this.read<SprintPlanItem>("sprint_planning", key);
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        (previous?.revision ?? 0) !== input.expectedRevision
      )
        throw new Error("Task planning changed; refresh before saving.");
      const source = await this.read<SprintSourceState>("sprint_sources", input.environmentId);
      const task = await this.read<Snapshot>("sprint_task_snapshots", key);
      if (
        !source ||
        source.caughtUp === false ||
        this.now() - source.syncedAt > 60000 ||
        !task ||
        task.deleted ||
        (source.visibleProjectIds && !source.visibleProjectIds.includes(input.projectId))
      )
        throw new Error("Refresh the task's machine before changing its planning.");
      if (input.sprintId !== null) {
        const target = await this.get(input.sprintId);
        if (!target || !["planned", "active"].includes(target.state))
          throw new Error("Choose a planned or active sprint.");
        if (
          !target.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(input))
        )
          throw new Error("Task project is outside this sprint.");
      }
      const storyPoints =
        input.storyPoints === undefined ? (previous?.storyPoints ?? null) : input.storyPoints;
      points(storyPoints);
      if (storyPoints !== null && !(SPRINT_STORY_POINTS as readonly number[]).includes(storyPoints))
        throw new Error("Choose a supported story point estimate.");
      const next: SprintPlanItem = {
        environmentId: input.environmentId,
        projectId: input.projectId,
        taskId: input.taskId,
        sprintId: input.sprintId,
        storyPoints,
        revision: (previous?.revision ?? 0) + 1,
      };
      await this.write("sprint_planning", key, next);
      for (const id of new Set([previous?.sprintId, next.sprintId]))
        if (id) {
          const sprint = await this.get(id);
          if (sprint && ["planned", "active"].includes(sprint.state))
            await this.record(id, previous?.sprintId === next.sprintId ? "estimate" : "scope", key);
        }
      return next;
    });
  }
  async setGoalContext(input: SprintGoalContextInput): Promise<SprintGoalContext> {
    return this.command(input.requestId, ["goal-context", input], async () => {
      text(input.environmentId, "environment", 200);
      text(input.goalId, "goal", 200);
      const key = JSON.stringify([input.environmentId, input.goalId]);
      const previous = await this.read<SprintGoalContext>("sprint_goal_contexts", key);
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision !== (previous?.revision ?? 0)
      )
        throw new Error("Goal planning context changed; refresh before saving.");
      if (input.sprintId !== null) {
        const sprint = await this.get(input.sprintId);
        if (
          !sprint ||
          !["planned", "active"].includes(sprint.state) ||
          !sprint.projects.some((project) => project.environmentId === input.environmentId)
        )
          throw new Error("Choose a planned or active sprint containing the goal's machine.");
      }
      const context: SprintGoalContext = {
        environmentId: input.environmentId,
        goalId: input.goalId,
        sprintId: input.sprintId,
        revision: (previous?.revision ?? 0) + 1,
      };
      await this.write("sprint_goal_contexts", key, context);
      if (context.sprintId) {
        const sprint = (await this.get(context.sprintId))!;
        for (const task of await this.all<Snapshot>("sprint_task_snapshots")) {
          if (
            task.environmentId !== context.environmentId ||
            task.goalId !== context.goalId ||
            task.deleted ||
            !sprint.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(task))
          )
            continue;
          const ref = {
            environmentId: task.environmentId,
            projectId: task.projectId,
            taskId: task.id,
          };
          const taskKey = sprintTaskKey(ref);
          if (await this.read<SprintPlanItem>("sprint_planning", taskKey)) continue;
          await this.write("sprint_planning", taskKey, {
            ...ref,
            sprintId: sprint.id,
            storyPoints: null,
            revision: 1,
          });
          await this.record(sprint.id, "scope", taskKey);
        }
      }
      return context;
    });
  }
  private async liveReport(id: string): Promise<SprintReport> {
    const sprint = await this.get(id);
    if (!sprint) throw new Error("Sprint not found.");
    const tasks: SprintReportTask[] = [];
    for (const item of await this.all<SprintPlanItem>("sprint_planning"))
      if (item.sprintId === id) {
        const task = await this.read<Snapshot>("sprint_task_snapshots", sprintTaskKey(item));
        tasks.push({
          ...item,
          title: task?.title ?? item.taskId,
          status: task?.status ?? "todo",
          deleted: task?.deleted ?? true,
          updatedAt: task?.updatedAt ?? 0,
        });
      }
    const rows = await this.store.db
      .prepare("SELECT sequence,value FROM sprint_ledger WHERE sprint_id=? ORDER BY sequence")
      .all(id);
    const ledger = rows.map((row) => ({
      ...JSON.parse(String(row.value)),
      sequence: Number(row.sequence),
    })) as SprintLedgerEntry[];
    const projects = Object.fromEntries(
      sprint.projects.map((project) => [
        sprintProjectKey(project),
        totals(tasks.filter((task) => sprintProjectKey(task) === sprintProjectKey(project))),
      ]),
    );
    const environments = new Set(sprint.projects.map((project) => project.environmentId));
    return {
      sprint,
      tasks,
      totals: totals(tasks),
      projects,
      ledger,
      sources: (await this.all<SprintSourceState>("sprint_sources")).filter((source) =>
        environments.has(source.environmentId),
      ),
      frozen: false,
    };
  }
  async report(id: string): Promise<SprintReport> {
    await this.ready;
    return this.store.db.scope(async () => {
      const frozen = await this.read<SprintReport>("sprint_reports", id);
      return frozen ? { ...frozen, sprint: (await this.get(id))! } : this.liveReport(id);
    });
  }
  private async record(
    id: string,
    kind: SprintLedgerEntry["kind"],
    taskKey?: string,
    at = this.now(),
  ) {
    const report = await this.liveReport(id);
    const lastAt = report.ledger.at(-1)?.at ?? 0;
    await this.store.db.prepare("INSERT INTO sprint_ledger(sprint_id,value) VALUES (?,?)").run(
      id,
      JSON.stringify({
        sprintId: id,
        at: Math.max(lastAt, at),
        effectiveAt: at,
        kind,
        taskKey,
        totals: report.totals,
        projects: report.projects,
      }),
    );
    return at < lastAt ? lastAt : undefined;
  }
  async ingest(input: SprintIngestInput): Promise<SprintSourceState> {
    await this.ready;
    text(input.environmentId, "environment", 200);
    if (input.caughtUp !== undefined && typeof input.caughtUp !== "boolean")
      throw new Error("Invalid source synchronization state.");
    if (
      !Number.isSafeInteger(input.cursor) ||
      input.cursor < 0 ||
      (input.events?.length ?? 0) > 1000 ||
      (input.snapshot?.tasks.length ?? 0) > 100000
    )
      throw new Error("Invalid bounded sprint synchronization.");
    if (
      input.visibleProjectIds !== undefined &&
      (!Array.isArray(input.visibleProjectIds) ||
        input.visibleProjectIds.length > 1000 ||
        input.visibleProjectIds.some((id) => typeof id !== "string" || !id || id.length > 200))
    )
      throw new Error("Invalid synchronization project scope.");
    return this.store.transaction(async () => {
      const previous = await this.read<SprintSourceState>("sprint_sources", input.environmentId);
      let cursor = previous?.cursor ?? 0;
      let historyGapAt = 0;
      const sourceRecord = async (
        id: string,
        kind: SprintLedgerEntry["kind"],
        key: string,
        at: number,
      ) => {
        const clampedAt = await this.record(id, kind, key, at);
        if (clampedAt !== undefined) historyGapAt = Math.max(historyGapAt, clampedAt);
      };
      const scopeChanged =
        JSON.stringify(
          previous?.visibleProjectIds === undefined
            ? "all"
            : [...previous.visibleProjectIds].sort(),
        ) !==
        JSON.stringify(
          input.visibleProjectIds === undefined ? "all" : [...input.visibleProjectIds].sort(),
        );
      const filteredPage = input.visibleProjectIds !== undefined && input.fromCursor !== undefined;
      if (
        input.fromCursor !== undefined &&
        (!Number.isSafeInteger(input.fromCursor) || input.fromCursor !== cursor)
      )
        throw new Error("Source cursor gap; reread the current synchronization cursor.");
      if (previous && scopeChanged && !input.snapshot)
        throw new Error("Read a new scoped snapshot after changing visible projects.");
      const apply = async (task: SprintTaskSnapshot, deleted: boolean, at: number) => {
        text(task.id, "task", 200);
        text(task.projectId, "project", 200);
        if (task.goalId !== undefined) text(task.goalId, "goal", 200);
        if (
          !TASK_STATUSES.includes(task.status) ||
          typeof task.title !== "string" ||
          task.title.length > 10000 ||
          !Number.isFinite(task.updatedAt)
        )
          throw new Error("Invalid source task snapshot.");
        if (input.visibleProjectIds && !input.visibleProjectIds.includes(task.projectId))
          throw new Error("Source task is outside the visible project scope.");
        const ref = {
            environmentId: input.environmentId,
            projectId: task.projectId,
            taskId: task.id,
          },
          key = sprintTaskKey(ref);
        const old = await this.read<Snapshot>("sprint_task_snapshots", key);
        await this.write("sprint_task_snapshots", key, {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          updatedAt: task.updatedAt,
          ...(task.goalId ? { goalId: task.goalId } : {}),
          environmentId: input.environmentId,
          deleted,
        });
        let plan = await this.read<SprintPlanItem>("sprint_planning", key);
        if (!plan && !deleted && task.goalId) {
          const context = await this.read<SprintGoalContext>(
            "sprint_goal_contexts",
            JSON.stringify([input.environmentId, task.goalId]),
          );
          const sprint = context?.sprintId ? await this.get(context.sprintId) : undefined;
          if (
            sprint &&
            ["planned", "active"].includes(sprint.state) &&
            sprint.projects.some((project) => sprintProjectKey(project) === sprintProjectKey(ref))
          ) {
            plan = { ...ref, sprintId: sprint.id, storyPoints: null, revision: 1 };
            await this.write("sprint_planning", key, plan);
            await sourceRecord(sprint.id, "scope", key, at);
          }
        }
        if (plan?.sprintId && (!old || old.status !== task.status || old.deleted !== deleted)) {
          const sprint = await this.get(plan.sprintId);
          if (sprint && ["planned", "active"].includes(sprint.state))
            await sourceRecord(sprint.id, "status", key, at);
        }
      };
      if (input.snapshot) {
        if (previous && input.snapshot.cursor !== cursor && !scopeChanged)
          throw new Error("Source cursor gap; replay task history before refreshing the snapshot.");
        if (!Number.isSafeInteger(input.snapshot.cursor) || input.snapshot.cursor < 0)
          throw new Error("Invalid snapshot cursor.");
        for (const task of input.snapshot.tasks) await apply(task, false, task.updatedAt);
        const present = new Set(
          input.snapshot.tasks.map((task) =>
            sprintTaskKey({
              environmentId: input.environmentId,
              projectId: task.projectId,
              taskId: task.id,
            }),
          ),
        );
        for (const old of await this.all<Snapshot>("sprint_task_snapshots")) {
          const key = sprintTaskKey({
            environmentId: old.environmentId,
            projectId: old.projectId,
            taskId: old.id,
          });
          if (
            old.environmentId === input.environmentId &&
            !old.deleted &&
            (!input.visibleProjectIds || input.visibleProjectIds.includes(old.projectId)) &&
            !present.has(key)
          )
            await apply(old, true, this.now());
        }
        cursor = input.snapshot.cursor;
      } else if (!previous) throw new Error("Read a source snapshot before importing task events.");
      let lastSequence = 0;
      for (const event of input.events ?? []) {
        if (
          !Number.isSafeInteger(event.sequence) ||
          event.sequence < 1 ||
          !Number.isFinite(event.effectiveAt) ||
          typeof event.deleted !== "boolean"
        )
          throw new Error("Invalid source event.");
        if (event.sequence <= lastSequence)
          throw new Error("Source event page must be strictly ordered.");
        lastSequence = event.sequence;
        if (event.sequence <= cursor) continue;
        if (event.sequence > input.cursor || (!filteredPage && event.sequence !== cursor + 1))
          throw new Error("Source cursor gap; synchronize the missing task events.");
        const old = await this.read<Snapshot>(
          "sprint_task_snapshots",
          sprintTaskKey({
            environmentId: input.environmentId,
            projectId: event.projectId,
            taskId: event.taskId,
          }),
        );
        const task = event.task ?? {
          id: event.taskId,
          projectId: event.projectId,
          title: old?.title ?? event.taskId,
          status: event.status,
          updatedAt: event.effectiveAt,
        };
        if (task.id !== event.taskId || task.projectId !== event.projectId)
          throw new Error("Task event identity mismatch.");
        await apply({ ...task, status: event.status }, event.deleted, event.effectiveAt);
        cursor = event.sequence;
      }
      if (filteredPage && input.cursor >= cursor) cursor = input.cursor;
      if (cursor !== input.cursor)
        throw new Error("Synchronization cursor does not match its events.");
      const state: SprintSourceState = {
        environmentId: input.environmentId,
        cursor,
        syncedAt: this.now(),
        historyAvailableFrom:
          Math.max(
            historyGapAt,
            scopeChanged && previous ? this.now() : 0,
            input.snapshot?.historyAvailableFrom ?? previous?.historyAvailableFrom ?? 0,
          ) || undefined,
        visibleProjectIds: input.visibleProjectIds,
        caughtUp: input.caughtUp !== false,
      };
      await this.write("sprint_sources", input.environmentId, state);
      this.store.afterCommit(() => this.onChange?.());
      return state;
    });
  }
}
