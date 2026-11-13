import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SessionProviderSchema,
  SessionRuntimeModeSchema,
  ModelSettingsSchema,
} from "../../src/shared/model/host-contracts/session-commands";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import type { HostGoals } from "../goals/goals";
import type { HostAutomations } from "../automations/automations";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import { normalizeConversationTaskConfiguration } from "./conversation-task-tools";
import type { DelegatedRoomPrincipal } from "../assistant/room/assistant-room-delegation";
import {
  assertPoolExecution,
  type ModelPoolSource,
  type PoolExecution,
} from "./conversation-model-pool-guard";

/** The voice/Room model names a pool row; explicit fields are still parsed but must match one. */
const executionSchema = z.strictObject({
  poolRowId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Id of a main-order entry from models.pool.list. Omit to use the first entry. Models outside the main order are rejected.",
    ),
  harness: SessionProviderSchema.optional(),
  model: z.string().min(1).max(200).optional(),
  providerAccountId: z.string().min(1).max(200).optional(),
  modelSettings: ModelSettingsSchema.optional(),
  runtimeMode: SessionRuntimeModeSchema.optional(),
});
const executionFields = (execution: PoolExecution) => ({
  harness: execution.harness,
  model: execution.model,
  providerAccountId: execution.providerAccountId,
  modelSettings: execution.modelSettings,
  runtimeMode: execution.runtimeMode,
});
export const THREAD_WORK_EXECUTION_SCHEMA = z.toJSONSchema(executionSchema);
export const THREAD_WORK_ACTIONS = new Set([
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.start",
  "tasks.stop",
  "tasks.retry",
  "tasks.update",
  // Reviewed task writes shared with coding sessions; same approval, versions and receipts.
  "tasks.delete",
  "tasks.transfer",
  "tasks.queue.pause",
  "tasks.review.recheck",
  "tasks.reorder",
  "goals.list",
  "goals.get",
  "goals.create",
  "goals.replan",
  "goals.cancel",
  "goals.update",
  "goals.delete",
  "automations.list",
  "automations.get",
  "automations.create",
  "automations.update",
  "automations.pause",
  "automations.resume",
  "automations.delete",
  "automations.runs",
  "automations.runNow",
  "automations.stopRun",
]);
type Task = Awaited<ReturnType<HostTasks["list"]>>[number];
function reorderSelection(rows: Task[], order: unknown) {
  if (!Array.isArray(order) || !order.length || order.length > 100) return undefined;
  const picked = order.map((entry) => rows.find((row) => row.id === entry?.taskId));
  return picked.every(Boolean) && new Set(picked.map((row) => row!.id)).size === picked.length
    ? (picked as Task[])
    : undefined;
}
function assertReorderable(tasks: Task[], order: unknown) {
  (order as { expectedUpdatedAt?: unknown }[]).forEach((entry, index) => {
    if (tasks[index].updatedAt !== entry.expectedUpdatedAt)
      throw new Error("Work changed. Read it again.");
  });
  if (tasks.some((task) => task.status !== "todo" && task.status !== "queued"))
    throw new Error("Only To do and queued tasks can be reordered.");
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Input = Record<string, unknown>;
export type ThreadWorkTrack = {
  kind: "goal" | "task" | "crew";
  id: string;
  projectId: string;
  threadId: string;
  title: string;
};
type Approve = (
  operation: { action: string; input: Input; operationHash: string },
  principal: RuntimeLogSubjectPrincipal,
  authorized: () => Promise<boolean>,
) => Promise<{ approved?: boolean; operationHash?: string }>;

/** Global voice uses its real thread grant. No synthetic coding session or inherited
 * provider authority: new execution settings are explicit and natively reviewed. */
export class ConversationThreadWorkTools {
  constructor(
    private readonly store: HostStore,
    private readonly tasks: Pick<
      HostTasks,
      "list" | "save" | "startTask" | "move" | "delete" | "transfer" | "recheckReview" | "reorder"
    >,
    private readonly goals: Pick<
      HostGoals,
      "list" | "create" | "update" | "replan" | "cancel" | "delete"
    >,
    private readonly automations: Pick<
      HostAutomations,
      "list" | "save" | "delete" | "runs" | "runNow" | "stopRun"
    >,
    private readonly approve: Approve,
    readonly pool: ModelPoolSource,
    /** Observation-only: lets the assistant report on work its thread started. */
    private readonly trackWork?: (item: ThreadWorkTrack) => Promise<void>,
  ) {}

  private async track(
    action: string,
    principal: { threadId: string; projectId: string },
    id: string,
    current: unknown,
    input: Input,
  ) {
    const row = current as { title?: string; goalId?: string; crewRunId?: string } | undefined;
    if (!this.trackWork || row?.goalId || row?.crewRunId) return;
    const kind = (
      { "tasks.create": "task", "tasks.start": "task", "goals.create": "goal" } as const
    )[action as "tasks.create"];
    if (!kind) return;
    // Tracking is best effort: the owner-approved work already happened.
    await this.trackWork({
      kind,
      id,
      projectId: principal.projectId,
      threadId: principal.threadId,
      title: String(input.title ?? row?.title ?? id),
    }).catch(() => undefined);
  }

  /** Every execution the thread principal creates must come from the owner's model pool. */
  private async resolveExecution(raw: unknown) {
    return assertPoolExecution(executionSchema.parse(raw), await this.pool());
  }

  /** Called only after exact native review and a retained delegated receipt/permit. */
  async callDelegated(
    action: "tasks.create" | "tasks.update",
    input: Input,
    principal: DelegatedRoomPrincipal,
    authorized: () => Promise<boolean>,
  ) {
    if (principal.kind !== "delegated-assistant-thread" || !(await authorized()))
      throw new Error("Delegated Room authority unavailable.");
    await this.store.project(principal.projectId);
    const id = typeof input.taskId === "string" ? input.taskId : "";
    if (!id) throw new Error("Task identity required.");
    const rows = await this.tasks.list(principal.projectId);
    const current = rows.find((item) => item.id === id && item.projectId === principal.projectId);
    if (action === "tasks.create" && current)
      throw new Error("Work ID already exists. Read it again.");
    if (
      action === "tasks.update" &&
      (!current ||
        !Number.isSafeInteger(input.expectedUpdatedAt) ||
        current.updatedAt !== input.expectedUpdatedAt)
    )
      throw new Error("Work changed. Read it again.");
    const execution =
      action === "tasks.create" ? await this.resolveExecution(input.execution) : undefined;
    if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
    const result = await this.execute(action, input, principal.projectId, id, current, execution);
    if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
    return result ?? { status: "completed", action, targetId: id };
  }

  async call(
    action: string,
    input: Input,
    principal: RuntimeLogSubjectPrincipal,
    authorized: () => Promise<boolean>,
    requestId?: string,
    qualify: <T>(effect: () => Promise<T>) => Promise<T> = (effect) => effect(),
  ): Promise<unknown> {
    if (principal.kind !== "assistant-thread" || !THREAD_WORK_ACTIONS.has(action))
      throw new Error("Unsupported thread work action.");
    const check = async () => {
      if (!(await authorized())) throw new Error("Conversation authority revoked.");
    };
    await check();
    await this.store.project(principal.projectId);
    const family = action.split(".")[0];
    const read = async () =>
      family === "tasks"
        ? (await this.tasks.list(principal.projectId)).filter(
            (item) => item.projectId === principal.projectId,
          )
        : family === "goals"
          ? (await this.goals.list()).filter(
              (item) => item.projectIds.length === 1 && item.projectIds[0] === principal.projectId,
            )
          : (await this.automations.list()).filter(
              (item) => item.projectId === principal.projectId,
            );
    // Review and errors must not reveal project state before scope admission.
    const rows = await qualify(read);
    await check();
    const reorder = action === "tasks.reorder";
    const id = reorder
      ? "reorder"
      : String(input.taskId ?? input.goalId ?? input.automationId ?? "");
    // A reorder reviews exactly the listed tasks, in the requested order.
    const lookup = (items: typeof rows) =>
      reorder
        ? reorderSelection(items as Task[], input.order)
        : items.find((item) => item.id === id);
    const current = lookup(rows);
    const page = (items: unknown[]) => {
      const offset = Number(input.offset ?? 0),
        limit = Number(input.limit ?? 30);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error("Invalid work pagination.");
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        nextOffset: offset + limit < items.length ? offset + limit : null,
      };
    };
    if (action.endsWith(".list")) return page(rows);
    const creating = action.endsWith(".create");
    if (action.endsWith(".get")) {
      if (!current) throw new Error("Work is not wholly in this project.");
      return current;
    }
    if (action === "automations.runs") {
      const result = await qualify(async () => {
        if (!(await read()).some((item) => item.id === id))
          throw new Error("Work is not wholly in this project.");
        return page(await this.automations.runs(id));
      });
      await check();
      return result;
    }
    if (!creating && !current) throw new Error("Work is not wholly in this project.");
    if (reorder) assertReorderable(current as Task[], input.order);
    if (!requestId || requestId.length > 300)
      throw new Error("Global work mutations require a stable requestId.");
    // Validated before review so the owner sees the resolved pool model, and again at effect time.
    const reviewedExecution = creating ? await this.resolveExecution(input.execution) : undefined;
    const fingerprint = hash([principal.threadId, principal.projectId, action, input]);
    const key = `voice-work:${hash([principal.threadId, principal.projectId, requestId])}`;
    const receipt = await this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
    await check();
    if (receipt) {
      const saved = JSON.parse(String(receipt.value));
      if (saved.fingerprint !== fingerprint)
        throw new Error("Work requestId was reused with changed input.");
      return saved.status === "completed"
        ? saved.result
        : {
            status: "uncertain",
            requestId,
            action,
            targetId: id,
            message:
              "Read the original work before any retry. This request will not execute again.",
          };
    }
    if (creating && current) throw new Error("Work ID already exists. Read it before retrying.");
    if (
      input.expectedUpdatedAt !== undefined &&
      (current as { updatedAt?: number } | undefined)?.updatedAt !== input.expectedUpdatedAt
    )
      throw new Error("Work changed. Read it again.");
    const currentHash = hash(current ?? null);
    const ownership = creating
      ? {
          kind:
            action.split(".")[0] === "automations"
              ? "automation"
              : action.split(".")[0] === "goals"
                ? "goal"
                : "task",
          id,
          projectId: principal.projectId,
          threadId: principal.threadId,
          state: "pending",
        }
      : undefined;
    const operationHash = hash([fingerprint, currentHash]);
    const approved = await this.approve(
      {
        action,
        input: {
          ...input,
          ...(reviewedExecution ? { execution: reviewedExecution } : {}),
          projectId: principal.projectId,
          current: current ?? null,
        },
        operationHash,
      },
      principal,
      authorized,
    );
    await check();
    if (!approved.approved || approved.operationHash !== operationHash)
      throw new Error("Native owner approval was not granted.");
    if (hash(lookup(await read()) ?? null) !== currentHash)
      throw new Error("Work changed during approval. Read it again.");
    await check();
    const claimed = await this.store.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
      .run(
        key,
        JSON.stringify({ fingerprint, status: "uncertain", ...(ownership ? { ownership } : {}) }),
      );
    if (Number(claimed.changes) !== 1) {
      const claimedReceipt = await this.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      if (!claimedReceipt || JSON.parse(String(claimedReceipt.value)).fingerprint !== fingerprint)
        throw new Error("Work requestId was reused with changed input.");
      return { status: "uncertain", action, requestId, targetId: id };
    }
    // Persist intent before effects. Any thrown/uncertain result retains the same
    // receipt across restart, never starting another provider run automatically.
    const result = await qualify(async () => {
      if (hash(lookup(await read()) ?? null) !== currentHash)
        throw new Error("Work changed during qualification. Read it again.");
      const execution = creating ? await this.resolveExecution(input.execution) : undefined;
      if (execution && execution.poolRowId !== reviewedExecution?.poolRowId)
        throw new Error("The assistant's model pool changed during approval. Review again.");
      return this.execute(action, input, principal.projectId, id, current, execution);
    });
    await check();
    await this.track(action, principal, id, current, input);
    const created = creating
      ? (lookup(await read()) as { id?: string; createdAt?: number } | undefined)
      : undefined;
    await this.store.db.prepare("UPDATE metadata SET value=? WHERE key=?").run(
      JSON.stringify({
        fingerprint,
        status: "completed",
        ...(ownership && created?.id === id && typeof created.createdAt === "number"
          ? { ownership: { ...ownership, state: "completed", entityCreatedAt: created.createdAt } }
          : ownership
            ? { ownership }
            : {}),
        result: result ?? { status: "completed", action, targetId: id },
      }),
      key,
    );
    return result ?? { status: "completed", action, targetId: id };
  }

  private async execute(
    action: string,
    input: Input,
    projectId: string,
    id: string,
    current: unknown,
    execution?: PoolExecution,
  ): Promise<unknown> {
    const exec = execution ? executionFields(execution) : {};
    if (action.startsWith("tasks.")) {
      const task = current as Awaited<ReturnType<HostTasks["list"]>>[number] | undefined;
      if (action === "tasks.create")
        return this.tasks.save({
          ...normalizeConversationTaskConfiguration(input, id, projectId, await this.tasks.list()),
          ...exec,
          expectedAbsent: true,
          id,
          projectId,
          title: input.title,
          prompt: input.prompt,
          status: input.status === "queued" ? "queued" : "todo",
          review: true,
          autoMerge: false,
          continueUntilDone: false,
          maxRunMinutes: 0,
        });
      if (action === "tasks.reorder") {
        await this.tasks.reorder((current as Task[]).map((item) => item.id));
        return { status: "completed", action, targetId: id };
      }
      if (!task) throw new Error("Task not found.");
      if (action === "tasks.delete") {
        await this.tasks.delete(id, false, task.updatedAt);
        return { deleted: true };
      }
      if (action === "tasks.transfer")
        return this.tasks.transfer(id, String(input.targetProjectId), task.updatedAt);
      if (action === "tasks.review.recheck") return this.tasks.recheckReview(id);
      if (action === "tasks.queue.pause") {
        if (task.status !== "queued" || task.sessionId || task.startedAt)
          throw new Error("Only a never-started queued task can be paused.");
        return this.tasks.move(id, "todo");
      }
      if (task.autoMerge || task.continueUntilDone)
        throw new Error("Use the owner UI for work with delivery or continuous execution enabled.");
      if (action === "tasks.start") return this.tasks.startTask(id, task);
      if (action === "tasks.stop") return this.tasks.move(id, "blocked");
      if (action === "tasks.retry") {
        if (task.status !== "blocked") throw new Error("Only blocked tasks can be retried.");
        return this.tasks.move(id, "queued", task);
      }
      const { status: _status, ...configuration } = task;
      return this.tasks.save({
        ...configuration,
        expectedConfiguration: task,
        ...normalizeConversationTaskConfiguration(input, id, projectId, await this.tasks.list()),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      });
    }
    if (action.startsWith("goals.")) {
      if (action === "goals.create")
        return this.goals.create({
          ...exec,
          expectedAbsent: true,
          id,
          title: input.title,
          prompt: input.prompt,
          projectIds: [projectId],
          leadProjectId: projectId,
          ...(input.isolate === undefined ? {} : { isolate: input.isolate }),
          autoMerge: false,
          continueUntilDone: false,
          approvePlan: true,
          manualStart: true,
          finalReview: true,
          verifyDefaults: { review: true },
          maxRunMinutes: 0,
        });
      const goal = current as Awaited<ReturnType<HostGoals["list"]>>[number];
      if (action === "goals.cancel") return this.goals.cancel(id);
      if (action === "goals.delete") {
        if (!["done", "cancelled"].includes(goal.status))
          throw new Error("Cancel this goal before deletion.");
        return this.goals.delete(id);
      }
      if (goal.autoMerge || goal.continueUntilDone || !goal.approvePlan || !goal.manualStart)
        throw new Error("Use the owner UI for this goal's execution policy.");
      if (action === "goals.replan") return this.goals.replan(id, input.feedback, goal);
      return this.goals.update(
        id,
        {
          autoMerge: false,
          continueUntilDone: false,
          maxRunningTasks: goal.maxRunningTasks ?? 0,
          maxRunMinutes: goal.maxRunMinutes,
          budget: goal.budget,
          ...(input.maxRunningTasks === undefined
            ? {}
            : { maxRunningTasks: input.maxRunningTasks }),
          ...(input.maxRunMinutes === undefined ? {} : { maxRunMinutes: input.maxRunMinutes }),
        },
        goal.updatedAt,
      );
    }
    const automation = current as Awaited<ReturnType<HostAutomations["list"]>>[number];
    if (action === "automations.delete") return this.automations.delete(id);
    if (action === "automations.runNow") return this.automations.runNow(id, automation);
    if (action === "automations.stopRun") return this.automations.stopRun(id, String(input.runId));
    const fields = [
      "name",
      "prompt",
      "scheduleKind",
      "minute",
      "time",
      "dayOfWeek",
      "maxRunMinutes",
      "maxRunsPerDay",
      "enabled",
      "isolate",
    ];
    const patch = Object.fromEntries(
      fields.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    );
    return this.automations.save({
      ...(action === "automations.create"
        ? {
            ...exec,
            expectedAbsent: true,
            minute: 0,
            time: "09:00",
            dayOfWeek: 1,
            enabled: false,
          }
        : automation),
      ...patch,
      id,
      projectId,
      ...(automation ? { expectedConfiguration: automation } : {}),
      ...(action === "automations.pause"
        ? { enabled: false }
        : action === "automations.resume"
          ? { enabled: true }
          : {}),
    });
  }
}
