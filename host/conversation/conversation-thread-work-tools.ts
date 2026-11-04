import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SessionProviderSchema,
  SessionRuntimeModeSchema,
  ModelSettingsSchema,
} from "../../src/shared/model/host-contracts/session-commands";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks";
import type { HostGoals } from "../goals";
import type { HostAutomations } from "../automations";
import type { RuntimeLogSubjectPrincipal } from "../runtime-log-tools";
import { normalizeConversationTaskConfiguration } from "./conversation-task-tools";
import type { DelegatedRoomPrincipal } from "../assistant/room/assistant-room-delegation";

const executionSchema = z.strictObject({
  harness: SessionProviderSchema,
  model: z.string().min(1).max(200),
  modelSettings: ModelSettingsSchema.default({}),
  runtimeMode: SessionRuntimeModeSchema,
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
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Input = Record<string, unknown>;
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
    private readonly tasks: Pick<HostTasks, "list" | "save" | "startTask" | "move">,
    private readonly goals: Pick<
      HostGoals,
      "list" | "create" | "update" | "replan" | "cancel" | "delete"
    >,
    private readonly automations: Pick<
      HostAutomations,
      "list" | "save" | "delete" | "runs" | "runNow" | "stopRun"
    >,
    private readonly approve: Approve,
  ) {}

  /** Called only after exact native review and a retained delegated receipt/permit. */
  async callDelegated(action: "tasks.create" | "tasks.update", input: Input, principal: DelegatedRoomPrincipal, authorized: () => Promise<boolean>) {
    if (principal.kind !== "delegated-assistant-thread" || !(await authorized())) throw new Error("Delegated Room authority unavailable.");
    await this.store.project(principal.projectId);
    const id = typeof input.taskId === "string" ? input.taskId : "";
    if (!id) throw new Error("Task identity required.");
    const rows = await this.tasks.list(principal.projectId);
    const current = rows.find(item => item.id === id && item.projectId === principal.projectId);
    if (action === "tasks.create" && current) throw new Error("Work ID already exists. Read it again.");
    if (action === "tasks.update" && (!current || !Number.isSafeInteger(input.expectedUpdatedAt) || current.updatedAt !== input.expectedUpdatedAt)) throw new Error("Work changed. Read it again.");
    const execution = action === "tasks.create" ? executionSchema.parse(input.execution) : undefined;
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
    qualify: <T>(effect: () => Promise<T>) => Promise<T> = effect => effect(),
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
    const id = String(input.taskId ?? input.goalId ?? input.automationId ?? "");
    const current = rows.find((item) => item.id === id);
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
        if (!(await read()).some(item => item.id === id)) throw new Error("Work is not wholly in this project.");
        return page(await this.automations.runs(id));
      });
      await check();
      return result;
    }
    if (!creating && !current) throw new Error("Work is not wholly in this project.");
    if (!requestId || requestId.length > 300)
      throw new Error("Global work mutations require a stable requestId.");
    const execution = creating ? executionSchema.parse(input.execution) : undefined;
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
    if (input.expectedUpdatedAt !== undefined && current?.updatedAt !== input.expectedUpdatedAt)
      throw new Error("Work changed. Read it again.");
    const currentHash = hash(current ?? null);
    const operationHash = hash([fingerprint, currentHash]);
    const approved = await this.approve(
      {
        action,
        input: { ...input, projectId: principal.projectId, current: current ?? null },
        operationHash,
      },
      principal,
      authorized,
    );
    await check();
    if (!approved.approved || approved.operationHash !== operationHash)
      throw new Error("Native owner approval was not granted.");
    if (hash((await read()).find((item) => item.id === id) ?? null) !== currentHash)
      throw new Error("Work changed during approval. Read it again.");
    await check();
    const claimed = await this.store.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
      .run(key, JSON.stringify({ fingerprint, status: "uncertain" }));
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
      if (hash((await read()).find(item => item.id === id) ?? null) !== currentHash)
        throw new Error("Work changed during qualification. Read it again.");
      return this.execute(action, input, principal.projectId, id, current, execution);
    });
    await check();
    await this.store.db.prepare("UPDATE metadata SET value=? WHERE key=?").run(
      JSON.stringify({
        fingerprint,
        status: "completed",
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
    execution?: z.infer<typeof executionSchema>,
  ): Promise<unknown> {
    if (action.startsWith("tasks.")) {
      const task = current as Awaited<ReturnType<HostTasks["list"]>>[number] | undefined;
      if (action === "tasks.create")
        return this.tasks.save({
          ...normalizeConversationTaskConfiguration(input, id, projectId, await this.tasks.list()),
          ...execution,
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
      if (!task) throw new Error("Task not found.");
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
          ...execution,
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
            ...execution,
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
