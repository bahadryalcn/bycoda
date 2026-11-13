import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import type { RoomManagementCall } from "../assistant/management/assistant-management-turn";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type {
  HostAutomation,
  HostAutomationRun,
} from "../../src/features/automations/model/hostAutomations";
import { RoomAutomationSessionChildren } from "./room-session-children";
import { RoomAutomationCommandChildren } from "./room-command-children";
import { RoomAutomationTerminalChildren } from "./room-terminal-children";
import { RoomAutomationSshChildren } from "./room-ssh-children";

type Child = {
  requestId: string;
  hash: string;
  workId: string;
  occurrence: string;
  threadId: string;
  kind: "task" | "goal" | "automation" | "automation-run";
  id: string;
  projectId: string;
  state: "pending" | "bound";
  created: boolean;
  createdAt?: number;
  linked?: boolean;
  workInvocationId?: string;
  generation?: number;
  plannerRequestId?: string;
  plannerRevision?: number;
  runIds: string[];
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const crewContinuations = new Set([
  "crews.assign",
  "crews.request",
  "crews.resolve",
  "crews.resume",
  "crews.accept",
  "crews.finish",
  "crews.answer",
  "crews.member.ask",
]);
const actions = new Set([
  "tasks.create",
  "tasks.start",
  "tasks.retry",
  "tasks.review.recheck",
  "goals.create",
  "goals.replan",
  "automations.create",
  "automations.resume",
  "automations.update",
  "automations.runNow",
  "crews.start",
  ...crewContinuations,
]);

/** Durable cancellation parents belong to the original Room Work, never merely its thread. */
export class RoomAutomationChildren {
  private readonly context = new AsyncLocalStorage<{
    requestId: string;
    authorized: () => Promise<boolean>;
  }>();
  private readonly stopped = new Set<string>();
  private readonly sessions: RoomAutomationSessionChildren;
  private readonly commands: RoomAutomationCommandChildren;
  private readonly terminals: RoomAutomationTerminalChildren;
  private readonly ssh: RoomAutomationSshChildren;
  constructor(
    private readonly store: HostStore,
    private readonly services: () => Pick<
      ServerBindings,
      | "tasks"
      | "goals"
      | "automations"
      | "engine"
      | "terminals"
      | "conversationDesktop"
      | "assistant"
      | "assistantPorts"
    >,
  ) {
    this.sessions = new RoomAutomationSessionChildren(
      store,
      (parent) => this.active(parent),
      () => services().engine,
    );
    this.commands = new RoomAutomationCommandChildren(store, (parent) => this.active(parent));
    this.terminals = new RoomAutomationTerminalChildren(
      store,
      (parent) => this.active(parent),
      () => services().terminals,
    );
    this.ssh = new RoomAutomationSshChildren(
      store,
      (parent) => this.active(parent),
      () => services(),
    );
  }
  sessionAllowed(sessionId: string, runId: string | undefined, requestId: string) {
    return this.sessions.allowed(sessionId, runId, requestId);
  }
  supports(action: string) {
    return (
      actions.has(action) ||
      [
        "sessions.submit",
        "commands.run",
        "terminals.create",
        "terminals.write",
        "servers.ssh.execute",
      ].includes(action)
    );
  }
  private async rows(): Promise<Child[]> {
    await this.store.ready;
    const values = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-child:%'")
      .all();
    return values.map((row) => JSON.parse(String(row.value)) as Child);
  }
  private async write(value: Child) {
    await this.store.db
      .prepare(
        "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(`room-child:${value.requestId}`, JSON.stringify(value));
  }
  private async readEntity(
    kind: Child["kind"],
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const table = kind === "task" ? "tasks" : kind === "goal" ? "goals" : "automations";
    const row = await this.store.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id);
    return row ? (JSON.parse(String(row.value)) as Record<string, unknown>) : undefined;
  }
  private async generation(id: string) {
    return Number(
      (
        await this.store.db
          .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
          .get(id)
      )?.generation ?? 0,
    );
  }
  private async creationProven(child: Child, createdAt: number) {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM metadata WHERE key LIKE 'voice-work:%' AND json_extract(value,'$.ownership.id')=?",
      )
      .all(child.id);
    return rows.some((row) => {
      const value = JSON.parse(String(row.value)) as {
        ownership?: {
          kind: string;
          threadId: string;
          projectId: string;
          state: string;
          entityCreatedAt?: number;
        };
      };
      const owner = value.ownership;
      return (
        owner?.kind === child.kind &&
        owner.threadId === child.threadId &&
        owner.projectId === child.projectId &&
        owner.state === "completed" &&
        owner.entityCreatedAt === createdAt
      );
    });
  }
  private async completedResult(child: Child): Promise<Record<string, unknown> | undefined> {
    const key = `voice-work:${digest([child.threadId, child.projectId, child.requestId])}`;
    const row = await this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
    if (!row) return undefined;
    const receipt = JSON.parse(String(row.value)) as { status?: string; result?: unknown };
    return receipt.status === "completed" && receipt.result && typeof receipt.result === "object"
      ? (receipt.result as Record<string, unknown>)
      : undefined;
  }
  async active(child: Pick<Child, "occurrence" | "workId">): Promise<boolean> {
    if (this.stopped.has(child.occurrence)) return false;
    if (
      await this.store.db
        .prepare("SELECT 1 FROM metadata WHERE key=?")
        .get(`room-child-stop:${child.occurrence}`)
    )
      return false;
    const row = await this.store.db
      .prepare("SELECT value FROM room_work_invocations WHERE work_id=?")
      .get(child.workId);
    if (!row) return false;
    const parent = JSON.parse(String(row.value)) as { stopped?: boolean };
    return !parent.stopped;
  }
  async withChild<T>(
    call: RoomManagementCall,
    parent: { workId?: string; occurrence?: string; deviceHash?: string },
    authorized: () => Promise<boolean>,
    effect: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (call.action === "servers.ssh.execute") {
      if (!signal) throw new Error("Room SSH Stop signal is unavailable.");
      return this.ssh.withChild(call, parent, signal, authorized, effect);
    }
    if (["terminals.create", "terminals.write"].includes(call.action))
      return this.terminals.withChild(call, parent, authorized, effect);
    if (call.action === "commands.run") {
      if (!signal) throw new Error("Room command Stop signal is unavailable.");
      return this.commands.withChild(call, parent, signal, authorized, effect);
    }
    if (call.action === "sessions.submit")
      return this.sessions.withChild(call, parent, authorized, effect);
    if (!actions.has(call.action)) return effect();
    if (!parent.workId || !parent.occurrence || !call.projectId)
      throw new Error("Room child requires its original Work occurrence and explicit project.");
    const kind: Child["kind"] =
      call.action.startsWith("tasks.") || call.action.startsWith("crews.")
        ? "task"
        : call.action.startsWith("goals.")
          ? "goal"
          : call.action === "automations.runNow"
            ? "automation-run"
            : "automation";
    const created = call.action.endsWith(".create") || call.action === "crews.start";
    const field = kind === "task" ? "taskId" : kind === "goal" ? "goalId" : "automationId";
    let id =
      call.action === "crews.start"
        ? `crew-${call.requestId}`
        : created
          ? `room-${digest([parent.workId, call.requestId]).slice(0, 40)}`
          : String(call.input[field] ?? "");
    if (crewContinuations.has(call.action)) {
      const row = await this.store.db
        .prepare("SELECT payload FROM crew_runs_v2 WHERE run_id=? AND project_id=?")
        .get(String(call.input.runId ?? ""), call.projectId);
      const run = row ? (JSON.parse(String(row.payload)) as { sourceTaskId?: string }) : undefined;
      if (!run?.sourceTaskId)
        throw new Error("Room Crew continuation requires its canonical source Task.");
      id = run.sourceTaskId;
    }
    if (created && call.action !== "crews.start") call.input[field] = id;
    const hash = digest(call);
    const key = `room-child:${call.requestId}`;
    let child = await this.store.transaction(async () => {
      const previous = await this.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get(key);
      if (previous)
        throw new Error(
          "Room child already has an original operation; inspect it instead of replaying.",
        );
      if (!(await authorized()))
        throw new Error("Room automation was stopped before child intent.");
      const current = await this.readEntity(kind, id);
      if (created ? !!current : !current) throw new Error("Room child target identity changed.");
      const currentTaskGeneration =
        current && kind === "task" ? await this.generation(id) : undefined;
      const linked =
        current &&
        crewContinuations.has(call.action) &&
        (await this.rows()).some(
          (item) =>
            item.kind === "task" &&
            item.id === id &&
            item.workId === parent.workId &&
            item.occurrence === parent.occurrence &&
            item.state === "bound" &&
            item.createdAt === current.createdAt &&
            item.workInvocationId === current.workInvocationId &&
            item.generation === currentTaskGeneration,
        );
      if (
        crewContinuations.has(call.action) &&
        (!linked || current?.crewExecutionId !== call.input.runId)
      )
        throw new Error("Room cannot continue another occurrence's Crew.");
      if (
        current &&
        kind === "task" &&
        !linked &&
        !["todo", "blocked", "review", "done"].includes(String(current.status))
      )
        throw new Error("Room cannot take over an already queued or running task.");
      if (
        current &&
        kind === "goal" &&
        ["planning", "running", "reviewing"].includes(String(current.status))
      )
        throw new Error("Room cannot take over an active epic.");
      if (current && kind === "automation") {
        const owned = (await this.rows()).some(
          (item) =>
            item.kind === "automation" &&
            item.created &&
            item.id === id &&
            item.createdAt === current.createdAt &&
            item.occurrence === parent.occurrence,
        );
        if (!owned)
          throw new Error(
            "Room may resume only an automation created by this original occurrence; runNow retains one run instead.",
          );
      }
      const value: Child = {
        requestId: call.requestId,
        hash,
        workId: parent.workId!,
        occurrence: parent.occurrence!,
        threadId: call.threadId,
        kind,
        id,
        projectId: call.projectId!,
        state: "pending",
        created,
        createdAt: current?.createdAt as number | undefined,
        ...(linked
          ? {
              linked: true,
              generation: currentTaskGeneration,
              workInvocationId: current?.workInvocationId as string | undefined,
            }
          : {}),
        runIds: [],
      };
      await this.write(value);
      return value;
    }, "critical");
    let result!: T;
    let dispatchFailed = false;
    let dispatchError: unknown;
    try {
      result = await this.context.run({ requestId: child.requestId, authorized }, async () => {
        if (!(await this.active(child)) || !(await authorized()))
          throw new Error("Room automation was stopped before child dispatch.");
        return effect();
      });
    } catch (error) {
      dispatchFailed = true;
      dispatchError = error;
    }
    try {
      // Native may have committed before a lost reply. Bind only exact persisted identity, never retry dispatch.
      const current = await this.readEntity(child.kind, child.id);
      if (
        current &&
        typeof current.createdAt === "number" &&
        (child.createdAt === undefined || child.createdAt === current.createdAt)
      ) {
        const row = await this.store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
        child = row ? (JSON.parse(String(row.value)) as Child) : child;
        if (child.state === "pending") {
          const result = await this.completedResult(child);
          const crewProof =
            child.kind === "task" &&
            child.id === `crew-${child.requestId}` &&
            current.crewExecutionId === child.requestId &&
            (await this.creationProven(child, current.createdAt));
          const linkedProof =
            child.linked &&
            child.workInvocationId === current.workInvocationId &&
            child.generation === (await this.generation(child.id));
          if (
            !linkedProof &&
            !crewProof &&
            (!result ||
              (child.kind === "automation-run"
                ? !child.runIds.includes(String(result.id))
                : result.id !== child.id || result.createdAt !== current.createdAt))
          )
            throw new Error("Room child receipt is unproven; original intent remains held.");
        }
        if (
          child.state === "bound" &&
          child.kind === "task" &&
          (child.generation !== (await this.generation(child.id)) ||
            child.workInvocationId !== current.workInvocationId)
        )
          throw new Error("Room child task was adopted by a later owner generation.");
        child = {
          ...child,
          state: "bound",
          createdAt: current.createdAt,
          ...(child.kind === "task"
            ? {
                generation: await this.generation(child.id),
                workInvocationId: current.workInvocationId as string | undefined,
              }
            : {}),
          ...(child.kind === "goal"
            ? {
                plannerRequestId: current.plannerRequestId as string | undefined,
                plannerRevision: current.updatedAt as number | undefined,
              }
            : {}),
        };
        await this.write(child);
        if (!(await this.active(child))) await this.stopChild(child);
      }
    } catch (error) {
      if (dispatchFailed)
        throw new AggregateError(
          [dispatchError, error],
          "Room child dispatch and receipt recovery failed.",
        );
      throw error;
    }
    if (dispatchFailed) throw dispatchError;
    return result;
  }
  private async pendingAllowed(child: Child) {
    const context = this.context.getStore();
    return (
      child.state === "bound" ||
      (context?.requestId === child.requestId && (await context.authorized()))
    );
  }
  async taskAllowed(task: HostTask): Promise<boolean> {
    for (let child of await this.rows()) {
      let matches = child.kind === "task" && child.id === task.id;
      if (
        matches &&
        child.state === "bound" &&
        (task.projectId !== child.projectId ||
          child.createdAt !== task.createdAt ||
          child.generation !== (await this.generation(task.id)) ||
          child.workInvocationId !== task.workInvocationId)
      )
        continue;
      if (child.kind === "goal" && task.goalId === child.id) {
        const goal = await this.readEntity("goal", child.id);
        matches =
          !!goal &&
          goal.createdAt === child.createdAt &&
          goal.plannerRequestId === child.plannerRequestId &&
          Array.isArray(goal.taskIds) &&
          goal.taskIds.includes(task.id);
      }
      if (
        (child.kind === "automation" || child.kind === "automation-run") &&
        task.automationId === child.id
      ) {
        const automation = await this.readEntity("automation", child.id);
        matches =
          !!automation &&
          automation.createdAt === child.createdAt &&
          (child.kind === "automation" || child.runIds.includes(task.automationRunId ?? ""));
        if (matches)
          matches = !!(await this.store.db
            .prepare(
              "SELECT 1 FROM automation_runs WHERE id=? AND automation_id=? AND json_extract(value,'$.taskId')=?",
            )
            .get(task.automationRunId ?? "", child.id, task.id));
      }
      if (child.kind === "task" && task.crewRunId) {
        const run = await this.store.db
          .prepare("SELECT payload FROM crew_runs_v2 WHERE run_id=? AND project_id=?")
          .get(task.crewRunId, task.projectId);
        const value = run
          ? (JSON.parse(String(run.payload)) as {
              sourceTaskId?: string;
              assignments?: { taskId: string }[];
            })
          : undefined;
        const root =
          value?.sourceTaskId === child.id ? await this.readEntity("task", child.id) : undefined;
        matches ||=
          !!root &&
          root.createdAt === child.createdAt &&
          root.workInvocationId === child.workInvocationId &&
          (await this.generation(child.id)) === child.generation &&
          root.crewExecutionId === task.crewRunId &&
          !!value?.assignments?.some((assignment) => assignment.taskId === task.id);
      }
      if (!matches) continue;
      if (
        task.projectId !== child.projectId ||
        !(await this.active(child)) ||
        !(await this.pendingAllowed(child))
      )
        return false;
      if (
        child.kind === "task" &&
        child.id === task.id &&
        child.state === "pending" &&
        this.context.getStore()?.requestId === child.requestId
      ) {
        child = {
          ...child,
          state: "bound",
          createdAt: task.createdAt,
          generation: await this.generation(task.id),
          workInvocationId: task.workInvocationId,
        };
        await this.write(child);
      }
      if (child.kind === "task" && child.id === task.id && child.state === "bound") {
        if (
          child.createdAt !== task.createdAt ||
          child.generation !== (await this.generation(task.id)) ||
          child.workInvocationId !== task.workInvocationId
        )
          return false;
      }
    }
    return true;
  }
  async goalAllowed(id: string): Promise<boolean> {
    const rows = (await this.rows()).filter((child) => child.kind === "goal" && child.id === id);
    for (let child of rows) {
      const current = await this.readEntity("goal", id);
      if (!current || (child.createdAt !== undefined && child.createdAt !== current.createdAt))
        continue;
      if (
        child.state === "bound" &&
        child.plannerRequestId !== current.plannerRequestId &&
        this.context.getStore()?.requestId !== child.requestId
      ) {
        if (
          child.plannerRequestId !== undefined ||
          child.plannerRevision !== current.updatedAt ||
          current.status !== "planning"
        )
          continue;
        child = { ...child, plannerRequestId: current.plannerRequestId as string | undefined };
        await this.write(child);
      }
      if (!(await this.active(child)) || !(await this.pendingAllowed(child))) return false;
      if (
        this.context.getStore()?.requestId === child.requestId &&
        typeof current.createdAt === "number"
      ) {
        child = {
          ...child,
          state: "bound",
          createdAt: current.createdAt,
          plannerRequestId: current.plannerRequestId as string | undefined,
          plannerRevision: current.updatedAt as number | undefined,
        };
        await this.write(child);
      }
    }
    return true;
  }
  async automationAllowed(automation: HostAutomation, run: HostAutomationRun): Promise<boolean> {
    for (let child of await this.rows()) {
      if (child.id !== automation.id || !["automation", "automation-run"].includes(child.kind))
        continue;
      if (child.createdAt !== undefined && child.createdAt !== automation.createdAt) continue;
      if (child.kind === "automation-run" && !child.runIds.includes(run.id)) {
        if (this.context.getStore()?.requestId !== child.requestId) continue;
        child = { ...child, runIds: [...child.runIds, run.id] };
        await this.write(child);
      }
      if (
        automation.projectId !== child.projectId ||
        !(await this.active(child)) ||
        !(await this.pendingAllowed(child))
      )
        return false;
    }
    return true;
  }
  async occurrenceAllowed(occurrence: string): Promise<boolean> {
    const row = await this.store.db
      .prepare("SELECT value FROM automation_runs WHERE id=?")
      .get(occurrence);
    if (!row) return true;
    const run = JSON.parse(String(row.value)) as HostAutomationRun;
    const owner = await this.store.db
      .prepare("SELECT automation_id FROM automation_runs WHERE id=?")
      .get(occurrence);
    const automation = owner
      ? await this.readEntity("automation", String(owner.automation_id))
      : undefined;
    return !automation || this.automationAllowed(automation as unknown as HostAutomation, run);
  }
  private async stopChild(child: Child): Promise<void> {
    if (
      child.state !== "bound" &&
      !(child.kind === "automation-run" && child.createdAt !== undefined && child.runIds.length)
    )
      return;
    const current = await this.readEntity(child.kind, child.id);
    if (!current || current.createdAt !== child.createdAt) return;
    const dependencies = this.services();
    if (child.kind === "task") {
      const task = current as unknown as HostTask;
      if (task.projectId !== child.projectId) return;
      if (
        (await this.generation(child.id)) !== child.generation ||
        task.workInvocationId !== child.workInvocationId
      )
        return;
      if (["queued", "running", "verifying"].includes(task.status))
        await this.store.db.withAuthorization(
          async () => {
            const fresh = await this.readEntity("task", child.id);
            return (
              !!fresh &&
              fresh.createdAt === child.createdAt &&
              fresh.workInvocationId === child.workInvocationId &&
              (await this.generation(child.id)) === child.generation
            );
          },
          () => dependencies.tasks.move(child.id, "blocked", undefined, child.generation),
        );
    } else if (child.kind === "goal") {
      if (current.plannerRequestId !== child.plannerRequestId) {
        if (
          child.plannerRequestId !== undefined ||
          child.plannerRevision !== current.updatedAt ||
          current.status !== "planning"
        )
          return;
        child = { ...child, plannerRequestId: current.plannerRequestId as string | undefined };
        await this.write(child);
      }
      if (["done", "cancelled"].includes(String(current.status))) return;
      await this.store.db.withAuthorization(
        async () => {
          const fresh = await this.readEntity("goal", child.id);
          return (
            !!fresh &&
            fresh.createdAt === child.createdAt &&
            fresh.plannerRequestId === child.plannerRequestId
          );
        },
        () => dependencies.goals.cancel(child.id),
      );
    } else {
      for (const run of await dependencies.automations.runs(child.id))
        if (
          (child.kind === "automation" || child.runIds.includes(run.id)) &&
          ["pending", "running"].includes(run.status)
        )
          await dependencies.automations.stopRun(child.id, run.id);
    }
  }
  async stop(occurrence: string): Promise<void> {
    this.stopped.add(occurrence);
    await this.store.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
      .run(`room-child-stop:${occurrence}`, JSON.stringify({ occurrence }));
    const errors: unknown[] = [];
    for (const child of (await this.rows()).filter((item) => item.occurrence === occurrence)) {
      try {
        await this.stopChild(child);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.sessions.stop(occurrence);
    } catch (error) {
      errors.push(error);
    }
    await this.commands.stop(occurrence);
    try {
      await this.terminals.stop(occurrence);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.ssh.stop(occurrence);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new Error("Room child Stop is incomplete; original child receipts remain held.");
  }
  async stopAll(): Promise<void> {
    const occurrences = new Set([
      ...(await this.rows()).map((child) => child.occurrence),
      ...(await this.sessions.occurrences()),
      ...(await this.commands.occurrences()),
      ...(await this.terminals.occurrences()),
      ...(await this.ssh.occurrences()),
    ]);
    for (const occurrence of occurrences) this.stopped.add(occurrence);
    await this.store.transaction(async () => {
      for (const occurrence of occurrences)
        await this.store.db
          .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)")
          .run(`room-child-stop:${occurrence}`, JSON.stringify({ occurrence }));
    }, "critical");
    const errors: unknown[] = [];
    for (const occurrence of occurrences) {
      try {
        await this.stop(occurrence);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new Error(
        "Room Stop retains children with unproven retirement; other owned occurrences were fenced.",
      );
  }
  async recover(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.sessions.recover();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.terminals.recover();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.ssh.recover();
    } catch (error) {
      errors.push(error);
    }
    for (let child of await this.rows()) {
      try {
        if (child.state === "pending") {
          const current = await this.readEntity(child.kind, child.id);
          const result = await this.completedResult(child);
          const crew =
            current &&
            child.kind === "task" &&
            child.id === `crew-${child.requestId}` &&
            current.crewExecutionId === child.requestId &&
            typeof current.createdAt === "number" &&
            (await this.creationProven(child, current.createdAt));
          const matchingResult =
            current &&
            result &&
            (child.kind === "automation-run"
              ? child.runIds.includes(String(result.id))
              : result.id === child.id &&
                result.createdAt === current.createdAt &&
                (child.kind !== "task" || result.workInvocationId === current.workInvocationId) &&
                (child.kind !== "goal" || result.plannerRequestId === current.plannerRequestId));
          if (
            current &&
            typeof current.createdAt === "number" &&
            (crew || matchingResult) &&
            (child.createdAt === undefined || child.createdAt === current.createdAt)
          ) {
            child = {
              ...child,
              state: "bound",
              createdAt: current.createdAt,
              ...(child.kind === "task"
                ? {
                    generation: await this.generation(child.id),
                    workInvocationId: current.workInvocationId as string | undefined,
                  }
                : {}),
              ...(child.kind === "goal"
                ? {
                    plannerRequestId: current.plannerRequestId as string | undefined,
                    plannerRevision: current.updatedAt as number | undefined,
                  }
                : {}),
            };
            await this.write(child);
          }
        }
        if (!(await this.active(child))) await this.stop(child.occurrence);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new Error("Room child recovery retains unproven original receipts.");
  }
}
