import { AsyncLocalStorage } from "node:async_hooks";
import { bindSessionWork } from "../work/session-adapter";
import { forEachAsync } from "../async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import { readCrewRun } from "./crew-scheduler-projection";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { defaultCrewPolicy, type CrewDefinition } from "../../src/features/crews/model/crew";
import { DELEGATION_PARENT_KEY } from "../../src/shared/model/host-contracts/delegation";
const stores: HostStore[] = [];
afterEach(async () => {
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});
async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject("/crew-fixture", "Crew fixture");
  const session = {
    session: {
      runtimeMode: "supervised",
      harness: "codex",
      model: "codex:fixture",
      modelSettings: {},
      title: "Coordinator",
      blocks: [],
    },
    projectId: project.id,
    status: "idle",
    runId: undefined as string | undefined,
  };
  vi.spyOn(store, "session").mockResolvedValue(
    session as Awaited<ReturnType<HostStore["session"]>>,
  );
  const rows: HostTask[] = [];
  const sourceRows: HostTask[] = [];
  const tasks = {
    list: () => [...rows, ...sourceRows],
    reserveCrewExecution: vi.fn(async (id: string, runId: string) => {
      sourceRows.find((task) => task.id === id)!.crewExecutionId = runId;
    }),
    startTask: vi.fn(async (id: string) => sourceRows.find((task) => task.id === id)!),
    tick: vi.fn(async () => {
      for (const task of sourceRows.filter((entry) => entry.status === "queued")) {
        const run = await service.startRun(
          task.projectId,
          task.crewDefinitionId!,
          task.prompt,
          task.crewExecutionId!,
          task.runtimeMode,
          undefined,
          false,
          task.id,
        );
        task.status = "running";
        task.sessionId = run.coordinatorSessionId;
      }
    }),
    save: vi.fn((task) => {
      const row = { ...task, status: "queued" as const, updatedAt: 1 };
      (String(task.id).startsWith("crew-") ? sourceRows : rows).push(row);
      return task;
    }),
    acceptCrewTask: vi.fn((id) => {
      const task = rows.find((t) => t.id === id)!;
      task.status = "done";
      return task;
    }),
  };
  type Admission = Parameters<HostEngine["withCommandAdmission"]>[0];
  const admissions = new AsyncLocalStorage<Admission>();
  const physicalRuns = new Map<string, boolean>();
  const effect = vi.fn<
    (input: Record<string, unknown>) => { sessionId: string } | Promise<{ sessionId: string }>
  >(() => ({ sessionId: "coordinator" }));
  let nextRun = 0;
  let acceptanceFailure: string | undefined;
  const hiddenReceipts = new Set<string>();
  const receiptStatus = store.receiptStatus.bind(store);
  vi.spyOn(store, "receiptStatus").mockImplementation(async (id, options) =>
    hiddenReceipts.has(id) ? undefined : receiptStatus(id, options),
  );
  const engine = {
    command: vi.fn(async (input: Record<string, unknown>) => {
      const admission = admissions.getStore();
      if (input.type !== "cancel")
        await admission?.check({ phase: "command", sessionId: String(input.sessionId ?? "") });
      if (input.type === "create") {
        const commandId = String(input.commandId);
        const previous = await store.receiptStatus(commandId);
        if (previous) return previous;
        const created = await effect(input);
        const receipt = { commandId, sessionId: created.sessionId, revision: 0 };
        await store.recordReceipt(JSON.stringify(input), receipt);
        return receipt;
      }
      if (input.type === "send") {
        const commandId = String(input.commandId);
        const previous = await store.receiptStatus(commandId);
        if (previous) return previous;
        const sessionId = String(input.sessionId);
        const runId = `fixture-run-${++nextRun}`;
        const receipt = { commandId, sessionId, runId, revision: nextRun };
        await store.recordReceipt(JSON.stringify(input), receipt);
        const current = await store.session(sessionId);
        current.runId = runId;
        // Host acceptance is durable before callbacks or provider effects. A lost
        // callback leaves recovery to the persisted receipt, never a fresh send.
        if (acceptanceFailure) {
          const message = acceptanceFailure;
          acceptanceFailure = undefined;
          physicalRuns.set(`${sessionId}:${runId}`, true);
          hiddenReceipts.add(commandId);
          throw new Error(message);
        }
        physicalRuns.set(`${sessionId}:${runId}`, true);
        await admission?.onAccepted?.(receipt);
        await admission?.check({ phase: "provider", sessionId, runId });
        physicalRuns.set(`${sessionId}:${runId}`, false);
        current.status = "running";
        try {
          await effect(input);
          return receipt;
        } finally {
          physicalRuns.set(`${sessionId}:${runId}`, true);
          if (current.runId === runId) current.status = "idle";
        }
      }
      if (input.type === "cancel") {
        // Cancelling one receipt never retires another physical turn.
        if (
          typeof input.runId === "string" &&
          physicalRuns.has(`${String(input.sessionId)}:${input.runId}`)
        ) {
          const current = await store.session(String(input.sessionId));
          if (current.runId === input.runId) current.status = "idle";
        }
        return { sessionId: String(input.sessionId), runId: input.runId };
      }
      return effect(input);
    }),
    updateSession: vi.fn(),
    waitForRun: vi.fn(async (sessionId: string, runId: string) => {
      if (physicalRuns.get(`${sessionId}:${runId}`) !== true)
        throw new Error("Exact run has not retired.");
    }),
    withCommandAdmission: <T>(admission: Admission, action: () => Promise<T>) =>
      admissions.run(admission, action),
  };
  const models = async () => ({
    models: {
      codex: [{ id: "codex:fixture", harness: "codex" as const, name: "Fixture" }],
      claude: [{ id: "claude:fixture", harness: "claude" as const, name: "Review fixture" }],
    },
    errors: {},
  });
  const service = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    models,
    () => 1000,
  );
  const makeAgent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
    id,
    name: id,
    role,
    instructions: "",
    selection: "fixed" as const,
    candidates: [
      {
        id,
        harness: role === "reviewer" ? ("claude" as const) : ("codex" as const),
        model: role === "reviewer" ? "claude:fixture" : "codex:fixture",
        modelSettings: {},
        capabilities: {},
      },
    ],
  });
  const definition: CrewDefinition = {
    id: "crew",
    name: "Crew",
    projectId: project.id,
    agents: [
      makeAgent("lead", "coordinator"),
      makeAgent("worker", "specialist"),
      makeAgent("reviewer", "reviewer"),
    ],
    policy: { ...defaultCrewPolicy },
    updatedAt: 0,
  };
  await service.save(definition);
  const principal = { projectId: project.id, sessionId: "lead-session" };
  const start = async () =>
    await service.startRun(project.id, "crew", "Build it", "run", "supervised", principal);
  const assign = async (id = "assignment") =>
    await service.assign(
      project.id,
      {
        runId: "run",
        requestId: id,
        memberId: "worker",
        title: "Feature",
        prompt: "Implement feature",
      },
      principal,
    );
  return {
    store,
    service,
    tasks,
    rows,
    sourceRows,
    engine,
    effect,
    interruptAcceptance: (message: string) => {
      acceptanceFailure = message;
    },
    reconcileAcknowledgement: () => hiddenReceipts.clear(),
    work: bindSessionWork(store, engine as unknown as HostEngine).work,
    project,
    principal,
    start,
    assign,
    definition,
    models,
  };
}
describe("host crews", () => {
  it("links legacy start to one scheduler-admitted task and retains its original request receipt", async () => {
    const f = await setup();
    const first = await f.start();
    const second = await f.start();
    expect(first.sourceTaskId).toBe("crew-run");
    expect(second.id).toBe(first.id);
    expect(f.sourceRows).toHaveLength(1);
    expect(f.sourceRows[0]).toMatchObject({
      crewDefinitionId: "crew",
      crewExecutionId: "run",
      projectId: f.project.id,
    });
    expect(f.tasks.startTask).toHaveBeenCalledOnce();
    await expect(
      f.service.startRun(
        f.project.id,
        "crew",
        "Different request",
        "run",
        "supervised",
        f.principal,
      ),
    ).rejects.toThrow("different input");
    expect(f.sourceRows).toHaveLength(1);
  });

  it("preserves a delegated approval's source occurrence and refuses reused or missing identities", async () => {
    const f = await setup();
    const definition = (await f.service.list(f.project.id)).definitions[0]!;
    await f.service.save(
      {
        ...f.definition,
        policy: { ...f.definition.policy, delegateApprovals: true },
      },
      definition.updatedAt,
    );
    await f.start();
    await f.assign();
    f.rows[0].sessionId = "worker-session";
    const occurrenceA = "12345678-1234-4123-8123-123456789abc";
    const occurrenceB = "abcdef12-1234-4123-9123-123456789abc";
    const approval = { requestId: 7, occurrenceId: occurrenceB };
    vi.mocked(f.store.session).mockImplementation(
      () =>
        ({
          projectId: f.project.id,
          runId: "worker-run",
          status: "running",
          session: { blocks: [{ id: "permission", approval }] },
        }) as ReturnType<HostStore["session"]>,
    );
    const input = {
      runId: "run",
      sessionId: "worker-session",
      targetRunId: "worker-run",
      requestId: "original-command",
      approvalId: 7,
      decision: "deny",
    };
    f.engine.command.mockClear();
    await expect(f.service.call("crews.respond", input, f.project.id)).rejects.toThrow(
      "request changed",
    );
    await expect(
      f.service.call(
        "crews.respond",
        { ...input, approvalOccurrenceId: occurrenceA },
        f.project.id,
      ),
    ).rejects.toThrow("no longer pending");
    expect(f.engine.command).not.toHaveBeenCalled();
    await f.service.call(
      "crews.respond",
      { ...input, approvalOccurrenceId: occurrenceB },
      f.project.id,
    );
    expect(f.engine.command).toHaveBeenCalledExactlyOnceWith({
      type: "approve",
      commandId: "original-command",
      sessionId: "worker-session",
      runId: "worker-run",
      requestId: 7,
      approvalOccurrenceId: occurrenceB,
      decision: "deny",
    });
    approval.occurrenceId = occurrenceA;
    await expect(
      f.service.call(
        "crews.respond",
        { ...input, requestId: "another-command", approvalOccurrenceId: occurrenceB },
        f.project.id,
      ),
    ).rejects.toThrow("no longer pending");
    expect(f.engine.command).toHaveBeenCalledTimes(1);
  });
  it("keeps bounded previous conversation identities while redacting attempt prose", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    f.rows[0].attemptHistory = Array.from({ length: 25 }, (_, index) => ({
      attempt: index,
      at: index * 100,
      workerSessionId: `worker-${index}`,
      reviewerSessionId: `reviewer-${index}`,
      verdict: "pass" as const,
      workerSummary: "private worker prose",
      note: "private review prose",
      findings: ["private finding"],
      workspaceFingerprint: "private fingerprint",
    }));
    const task = (await f.service.list(f.project.id)).runs[0].tasks[0];
    expect(task.attemptHistory).toHaveLength(20);
    expect(task.attemptHistory?.at(-1)).toMatchObject({
      attempt: 24,
      at: 2400,
      workerSessionId: "worker-24",
      reviewerSessionId: "reviewer-24",
      verdict: "pass",
      workerSummary: "",
      note: "",
      findings: [],
    });
    expect(JSON.stringify(task)).not.toContain("private");
    expect(f.rows[0].attemptHistory[24].workerSummary).toBe("private worker prose");
  });
  it("replays an assignment after pause without creating duplicate work", async () => {
    const f = await setup();
    await f.start();
    const assignment = await f.assign();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    expect(await f.assign()).toEqual(assignment);
    expect(f.rows).toHaveLength(1);
    await expect(f.assign("another")).rejects.toThrow("not active");
  });
  it("rejects actions authenticated for a different project", async () => {
    const f = await setup();
    await f.start();
    await expect(
      f.service.call("crews.stop", { runId: "run" }, f.project.id, {
        ...f.principal,
        projectId: "foreign",
      }),
    ).rejects.toThrow("another project");
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("keeps finished work immutable to new requests while replaying an existing request", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "existing", text: "Question" },
      f.project.id,
    );
    await f.service.call("crews.resolve", { runId: "run", requestId: "existing" }, f.project.id);
    const assignment = await f.assign();
    f.rows[0]!.status = "review";
    f.rows[0]!.verification = {
      review: { verdict: "pass", note: "Checked", sessionId: "review-session" },
    };
    await f.service.call(
      "crews.accept",
      { runId: "run", taskId: assignment.taskId },
      f.project.id,
      f.principal,
    );
    await f.service.call("crews.finish", { runId: "run" }, f.project.id);
    await expect(
      f.service.call(
        "crews.request",
        { runId: "run", requestId: "late", text: "New question" },
        f.project.id,
      ),
    ).rejects.toThrow("finished");
    expect(
      await f.service.call(
        "crews.request",
        { runId: "run", requestId: "existing", text: "Question" },
        f.project.id,
      ),
    ).toMatchObject({ id: "existing" });
  });
  it("preserves concurrent requests and treats a repeated request ID as one request", async () => {
    const f = await setup();
    await f.start();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        f.service.call(
          "crews.request",
          { runId: "run", requestId: `request-${index}`, text: `Question ${index}` },
          f.project.id,
          f.principal,
        ),
      ),
    );
    await Promise.all(
      [0, 1].map(() =>
        f.service.call(
          "crews.request",
          { runId: "run", requestId: "same", text: "Question" },
          f.project.id,
          f.principal,
        ),
      ),
    );
    expect((await f.service.list(f.project.id)).runs[0].messages).toHaveLength(9);
  });
  it("does not turn a transient coordinator read failure into a missing-session pause", async () => {
    const f = await setup();
    await f.start();
    vi.mocked(f.store.session).mockRejectedValueOnce(new Error("Database temporarily unavailable"));
    await expect(f.service.tick()).rejects.toThrow("Database temporarily unavailable");
    const run = (await f.service.list(f.project.id)).runs[0];
    expect(run.status).toBe("active");
    expect(run.error).toBeUndefined();
  });
  it.each(["idle", "interrupted"] as const)(
    "resumes %s planning with one durable continuation without repeating it",
    async (status) => {
      const f = await setup();
      await f.start();
      const coordinator = await f.store.session("lead-session");
      vi.mocked(f.store.session).mockResolvedValue({ ...coordinator, status });
      await f.service.call("crews.pause", { runId: "run" }, f.project.id);
      f.engine.command.mockClear();
      await f.service.call("crews.resume", { runId: "run" }, f.project.id);
      await f.service.tick();
      expect(f.engine.command).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "send",
          sessionId: "lead-session",
          text: expect.stringContaining("Resume crew work"),
        }),
      );
      expect(f.engine.command).toHaveBeenCalledTimes(1);
      await f.service.call("crews.resume", { runId: "run" }, f.project.id);
      await f.service.tick();
      expect(f.engine.command).toHaveBeenCalledTimes(1);
    },
  );
  it("resumes an uncertain pending delivery with its original receipt identity", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "first", text: "Need help" },
      f.project.id,
    );
    f.interruptAcceptance("Unknown delivery");
    await f.service.tick();
    const original = f.engine.command.mock.calls.at(-1)?.[0];
    const pending = (await readCrewRun(f.store, "run"))!.pendingDelivery;
    expect((await f.work.list())[0]).toMatchObject({ state: "unknown", reserved: true });
    const calls = f.engine.command.mock.calls.length;
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    expect((await readCrewRun(f.store, "run"))!.pendingDelivery).toEqual(pending);
    f.reconcileAcknowledgement();
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toEqual(original);
    expect((await readCrewRun(f.store, "run"))!.notifications).toEqual({ "request:first": "sent" });
  });
  it("retains Stop work when the initial coordinator send completes late", async () => {
    const f = await setup();
    let release!: () => void;
    let started!: () => void;
    const sent = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.effect.mockImplementation(async (input) => {
      if (input.type === "send") {
        started();
        await sent;
      }
      return { sessionId: "coordinator" };
    });
    const starting = f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    await sending;
    await f.service.call("crews.stop", { runId: "launch-run" }, f.project.id);
    const receipt = (await f.work.list())[0]!.receipt!;
    await expect(f.engine.waitForRun(receipt.sessionId, receipt.runId)).rejects.toThrow(
      "Exact run has not retired.",
    );
    release();
    await starting;
    await expect(f.engine.waitForRun(receipt.sessionId, receipt.runId)).resolves.toBeUndefined();
    expect((await f.service.list(f.project.id)).runs[0]).toMatchObject({
      status: "paused",
      coordinatorSessionId: "coordinator",
    });
    expect(f.engine.command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cancel",
        sessionId: "coordinator",
        runId: receipt.runId,
      }),
    );
  });
  it("does not send an initial coordinator prompt if paused while preparing the session", async () => {
    const f = await setup();
    let release!: () => void;
    let started!: () => void;
    const prepared = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.engine.updateSession.mockImplementationOnce(async () => {
      started();
      await prepared;
    });
    const starting = f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    await preparing;
    await f.service.call("crews.stop", { runId: "launch-run" }, f.project.id);
    release();
    await starting;
    expect(f.engine.command.mock.calls.some(([command]) => command.type === "send")).toBe(false);
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
    await f.service.call("crews.resume", { runId: "launch-run" }, f.project.id);
    expect(f.engine.command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "send",
        text: expect.stringContaining("Owner request:\nStart"),
      }),
    );
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("preserves independent crew saves across awaited actor reads", async () => {
    const f = await setup();
    await Promise.all([
      f.service.save({ ...f.definition, id: "first", name: "First" }),
      f.service.save({ ...f.definition, id: "second", name: "Second" }),
    ]);
    expect((await f.service.list(f.project.id)).definitions.map((item) => item.id).sort()).toEqual([
      "crew",
      "first",
      "second",
    ]);
  });
  it("forwards owner member directives and requires reconciliation before acceptance", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const task = f.rows[0]!;
    task.sessionId = "member";
    task.status = "review";
    task.verification = { review: { verdict: "pass", note: "Pass", sessionId: "reviewer" } };
    await f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    await f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    expect((await f.service.list(f.project.id)).runs[0]!.messages).toHaveLength(1);
    await expect(
      f.service.call("crews.accept", { runId: "run", taskId: task.id }, f.project.id, f.principal),
    ).rejects.toThrow("directives");
    await f.service.call(
      "crews.resolve",
      { runId: "run", requestId: "owner:owner-change" },
      f.project.id,
      f.principal,
    );
    await f.service.call(
      "crews.accept",
      { runId: "run", taskId: task.id },
      f.project.id,
      f.principal,
    );
  });
  it("does not let a coordinator grant itself approval authority", async () => {
    const f = await setup();
    const definition = (await f.service.list(f.project.id)).definitions[0]!;
    await expect(
      (async () =>
        await f.service.save(
          { ...definition, policy: { ...definition.policy, delegateApprovals: true } },
          definition.updatedAt,
          f.principal,
        ))(),
    ).rejects.toThrow("Only the owner");
    await f.start();
    await expect(
      f.service.call("crews.respond", { runId: "run" }, f.project.id, f.principal),
    ).rejects.toThrow("not granted");
  });
  it("serializes overlapping writes while allowing disjoint assignments", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const first = f.rows[0]!;
    first.status = "running";
    first.crewScopes = ["src/backend"];
    const second = {
      ...first,
      id: "second",
      status: "queued" as const,
      crewScopes: ["src/backend/api.ts"],
    };
    const canStart = (f.tasks as unknown as HostTasks).crewCanStart!;
    expect(await canStart(second)).toBe(false);
    expect(await canStart({ ...second, crewScopes: ["src/ui"] })).toBe(true);
  });
  it("holds ordinary direct work behind crew leases but allows isolated work", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const first = f.rows[0]!;
    first.status = "running";
    first.crewScopes = ["src/backend"];
    const ordinary = {
      ...first,
      id: "ordinary",
      crewRunId: undefined,
      crewScopes: undefined,
      status: "queued" as const,
    };
    const canStart = (f.tasks as unknown as HostTasks).crewCanStart!;
    expect(await canStart(ordinary)).toBe(false);
    first.status = "verifying";
    expect(await canStart(ordinary)).toBe(false);
    expect(await canStart({ ...ordinary, isolate: true })).toBe(true);
    first.status = "review";
    expect(await canStart(ordinary)).toBe(true);
    first.status = "running";
    first.crewRunId = undefined;
    expect(await canStart(ordinary)).toBe(true);
  });
  it("delivers large request batches in full and retries only the pending batch", async () => {
    const f = await setup();
    await f.start();
    const texts = [0, 1, 2].map((i) => `request-body-${i} ${"x".repeat(11000)} end-${i}`);
    for (const [i, text] of texts.entries())
      await f.service.call(
        "crews.request",
        {
          runId: "run",
          requestId: `large-${i}`,
          text,
        },
        f.project.id,
        f.principal,
      );
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[0]!),
    });
    expect((await f.service.list(f.project.id)).runs[0]!.notifications).toEqual({
      "request:large-0": "sent",
    });
    f.interruptAcceptance("delivery uncertain");
    await f.service.tick();
    const failed = f.engine.command.mock.calls.at(-1)?.[0];
    const callsBeforeRecovery = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(callsBeforeRecovery);
    f.reconcileAcknowledgement();
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toEqual(failed);
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[1]!),
    });
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[2]!),
    });
    expect((await f.service.list(f.project.id)).runs[0]!.notifications).toEqual({
      "request:large-0": "sent",
      "request:large-1": "sent",
      "request:large-2": "sent",
    });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    for (const [command] of f.engine.command.mock.calls)
      expect(
        (
          command as unknown as {
            text: string;
          }
        ).text.length,
      ).toBeLessThanOrEqual(20000);
  });
  it("keeps immutable definition snapshots and rejects foreign/global agent writes", async () => {
    const f = await setup();
    await f.start();
    const original = (await f.service.list(f.project.id)).definitions[0]!;
    await f.service.save({ ...original, name: "Changed" }, original.updatedAt);
    expect((await f.service.list(f.project.id)).runs[0]!.definition.name).toBe("Crew");
    await expect(
      (async () =>
        await f.service.save(
          { ...f.definition, id: "global", projectId: undefined },
          undefined,
          f.principal,
        ))(),
    ).rejects.toThrow("project");
    await expect(
      f.service.call("crews.assign", { runId: "run" }, f.project.id, {
        ...f.principal,
        sessionId: "foreign",
      }),
    ).rejects.toThrow("coordinator");
  });
  it("deduplicates concurrent requests and uses an independent selected reviewer", async () => {
    const f = await setup();
    await f.start();
    const [a, b] = await Promise.all([f.assign(), f.assign()]);
    expect(a.taskId).toBe(b.taskId);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]!.reviewerConfig?.harness).toBe("claude");
    expect(f.rows[0]!.autoMerge).toBe(false);
    expect(f.rows[0]!.isolate).toBe(false);
    await expect(
      f.service.assign(
        f.project.id,
        {
          runId: "run",
          requestId: "assignment",
          memberId: "worker",
          title: "Different",
          prompt: "Different",
        },
        f.principal,
      ),
    ).rejects.toThrow("different input");
  });
  it("ignores legacy crew cost limits for parallel submissions", async () => {
    const f = await setup();
    await f.start();
    const results = await Promise.allSettled([f.assign("first"), f.assign("second")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(
      (await f.service.list(f.project.id)).runs[0]!.assignments[0]!.estimatedCost,
    ).toBeUndefined();
  });
  it("requires independent review before acceptance and resolves member requests", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const task = f.rows[0]!;
    task.status = "review";
    await expect(
      f.service.call("crews.accept", { runId: "run", taskId: task.id }, f.project.id, f.principal),
    ).rejects.toThrow("Independent review");
    task.verification = {
      review: { verdict: "pass", note: "Checked", sessionId: "review-session" },
    };
    await f.service.call(
      "crews.accept",
      { runId: "run", taskId: task.id },
      f.project.id,
      f.principal,
    );
    task.sessionId = "worker-session";
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "image", text: "Need an image specialist" },
      f.project.id,
      { ...f.principal, sessionId: "worker-session" },
    );
    await expect(
      f.service.call("crews.finish", { runId: "run" }, f.project.id, f.principal),
    ).rejects.toThrow("resolve");
    await f.service.call(
      "crews.resolve",
      { runId: "run", requestId: "image" },
      f.project.id,
      f.principal,
    );
    await f.service.call("crews.finish", { runId: "run" }, f.project.id, f.principal);
  });
  it("reuses a durable event delivery ID across an uncertain send", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "resource", text: "Need help" },
      f.project.id,
      f.principal,
    );
    f.interruptAcceptance("transport interrupted");
    await f.service.tick();
    const pending = (await readCrewRun(f.store, "run"))?.pendingDelivery;
    expect(pending?.commandId).toBeTruthy();
    const work = (await f.work.list())[0]!;
    expect(work.source.occurrence).toBe(pending!.commandId);
    expect(work).toMatchObject({ state: "unknown", reserved: true });
    const attempts = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(attempts);
    expect((await readCrewRun(f.store, "run"))?.pendingDelivery).toEqual(pending);
    f.reconcileAcknowledgement();
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(attempts);
    expect((await f.work.get(work.id)).receipt).toBeTruthy();
    expect((await readCrewRun(f.store, "run"))?.notifications).toEqual({
      "request:resource": "sent",
    });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
  });
  it("preserves Stop work and new requests when an in-flight delivery settles", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "first", text: "Need help" },
      f.project.id,
      f.principal,
    );
    let release!: () => void;
    let started!: () => void;
    const delivered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.effect.mockImplementationOnce(async () => {
      started();
      await delivered;
      return { sessionId: "coordinator" };
    });
    const tick = f.service.tick();
    await sending;
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "second", text: "New request" },
      f.project.id,
      f.principal,
    );
    release();
    await tick;
    const run = (await f.service.list(f.project.id)).runs[0]!;
    expect(run.status).toBe("paused");
    expect(run.messages.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(run.notifications).toEqual({ "request:first": "sent" });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    await f.service.tick();
    await f.service.tick();
    expect((await readCrewRun(f.store, "run"))?.notifications).toEqual({
      "request:first": "sent",
      "request:second": "sent",
    });
    const sends = f.engine.command.mock.calls.filter(([command]) => command.type === "send");
    expect(sends).toHaveLength(3);
    expect(sends.filter(([command]) => command.commandId === sends[0]![0].commandId)).toHaveLength(
      1,
    );
    expect(sends.at(-1)![0].text).toContain("New request");
  });
  it("holds paused work in the existing scheduler and rejects forged tool evidence", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id, f.principal);
    expect(await (f.tasks as unknown as HostTasks).crewCanStart!(f.rows[0]!)).toBe(false);
    await expect(f.assign("new")).rejects.toThrow("not active");
    const d = (await f.service.list(f.project.id)).definitions[0]!;
    d.agents[1]!.candidates[0]!.capabilities["image-generation"] = {
      state: "available",
      observedAt: 1000,
      source: "host probe",
    };
    const saved = await f.service.save(d, d.updatedAt);
    expect(saved.agents[1]!.candidates[0]!.capabilities["image-generation"]?.state).toBe("unknown");
  });
});
describe("crew deletion", () => {
  it("lets only the owner delete a crew without active work and keeps run snapshots", async () => {
    const f = await setup();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.start();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Stop");
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    f.sourceRows[0]!.status = "done";
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    const view = await f.service.list(f.project.id);
    expect(view.definitions).toEqual([]);
    expect(view.runs[0]!.definition.name).toBe("Crew");
  });
  it("refuses a crew that open tasks still use", async () => {
    const f = await setup();
    f.rows.push({ id: "task", crewDefinitionId: "crew", status: "todo" } as never);
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Tasks");
  });
  it("does not recreate a deleted crew from a stale editor", async () => {
    const f = await setup();
    const saved = (await f.service.list(f.project.id)).definitions[0]!;
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    await expect((async () => await f.service.save(saved, saved.updatedAt))()).rejects.toThrow(
      "deleted",
    );
  });
  it("lets only the owner remove a library agent", async () => {
    const f = await setup();
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "saved", projectId: f.project.id } },
      f.project.id,
    );
    await expect(
      f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id);
    expect((await f.service.list(f.project.id)).agents).toEqual([]);
  });
  describe("conversation member asks", () => {
    async function askFixture() {
      const f = await setup();
      Object.assign(f.tasks, {
        taskIndex: async (ids?: readonly string[]) =>
          new Map(f.rows.filter((row) => !ids || ids.includes(row.id)).map((row) => [row.id, row])),
      });
      await f.service.call(
        "crews.agent.save",
        { agent: { ...f.definition.agents[1]!, id: "expert", handle: "expert" } },
        f.project.id,
      );
      const ask = (input: Record<string, unknown>, principal = f.principal) =>
        f.service.call(
          "crews.member.ask",
          { requestId: "ask-1", handle: "expert", prompt: "Fix it", ...input },
          f.project.id,
          principal,
        ) as Promise<{ taskId: string; reused: boolean }>;
      const parentOf = (index: number) =>
        JSON.parse(
          (f.rows[index] as unknown as { modelSettings: Record<string, string> }).modelSettings[
            DELEGATION_PARENT_KEY
          ]!,
        ) as { parentSessionId: string };
      return { ...f, ask, parentOf };
    }
    it("queues an own-project ask with the calling session as parent and its mode", async () => {
      const f = await askFixture();
      const result = await f.ask({});
      expect(result.reused).toBe(false);
      expect(f.parentOf(0).parentSessionId).toBe("lead-session");
      expect(f.rows[0]).toMatchObject({ runtimeMode: "supervised", review: false });
    });
    it("refuses delegating for another session or from another project", async () => {
      const f = await askFixture();
      await expect(f.ask({ parentSessionId: "other-session" })).rejects.toThrow(
        "calling conversation",
      );
      await expect(
        f.ask({}, { projectId: "elsewhere", sessionId: "lead-session" }),
      ).rejects.toThrow("another project");
      expect(f.rows).toHaveLength(0);
    });
    it("replays one operation and rejects a changed one", async () => {
      const f = await askFixture();
      const first = await f.ask({});
      const again = await f.ask({});
      expect(again).toMatchObject({ taskId: first.taskId, reused: true });
      expect(f.rows).toHaveLength(1);
      await expect(f.ask({ prompt: "Other" })).rejects.toThrow("reused with different input");
    });
    it("stops at revoked authority", async () => {
      const f = await askFixture();
      await expect(
        f.store.db.withAuthorization(
          async () => false,
          () => f.ask({}),
        ),
      ).rejects.toThrow();
      expect(f.rows).toHaveLength(0);
    });
    it("gives a Room ask no calling conversation to delegate from", async () => {
      const f = await askFixture();
      await expect(
        f.service.callReviewedAssistantThread(
          "crews.member.ask",
          { requestId: "r", handle: "expert", prompt: "x", parentSessionId: "lead-session" },
          { kind: "assistant-thread", projectId: f.project.id, threadId: "thread" } as never,
          "a".repeat(64),
        ),
      ).rejects.toThrow("no calling conversation");
    });
    it("lists only the calling project's active members", async () => {
      const f = await setup();
      Object.assign(f.tasks, { taskIndex: async () => new Map() });
      expect(await f.service.call("crews.active.list", {}, f.project.id, f.principal)).toEqual({
        items: [],
      });
    });
  });
  it("lists a short work title without exposing the launch prompt", async () => {
    const f = await setup();
    await f.service.startRun(
      f.project.id,
      "crew",
      "Mobile sign-in\nUse the design system",
      "run",
      "supervised",
    );
    const [run] = (await f.service.list(f.project.id)).runs;
    expect(run).toMatchObject({ title: "Mobile sign-in", launch: undefined });
  });
  it("keeps library groups and shares host-wide profiles with other projects", async () => {
    const f = await setup();
    const other = await f.store.addProject("/crew-fixture-mobile", "Mobile fixture");
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "ui", groups: ["UI", "UI", "Mobile"] } },
      f.project.id,
    );
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "local", projectId: f.project.id } },
      f.project.id,
    );
    const shared = (await f.service.list(other.id)).agents;
    expect(shared.map((agent) => agent.id)).toEqual(["ui"]);
    expect(shared[0]!.groups).toEqual(["UI", "Mobile"]);
    // A crew member remembers the profile it came from; the library never edits it.
    const member = { ...shared[0]!, id: "ui-copy", source: { id: "ui", updatedAt: 1000 } };
    const saved = await f.service.save({
      ...f.definition,
      id: "mobile",
      projectId: other.id,
      agents: [...f.definition.agents, member],
    });
    expect(saved.agents.find((agent) => agent.id === "ui-copy")).toMatchObject({
      groups: ["UI", "Mobile"],
      source: { id: "ui", updatedAt: 1000 },
    });
  });
  it("discovers library groups with bounded summaries and keeps foreign projects hidden", async () => {
    const f = await setup();
    const other = await f.store.addProject("/foreign-crew", "Foreign");
    for (const [id, projectId] of [
      ["shared", undefined],
      ["local", f.project.id],
      ["foreign", other.id],
    ] as const)
      await f.service.call(
        "crews.agent.save",
        {
          agent: {
            ...f.definition.agents[1]!,
            id,
            projectId,
            groups: ["Mobile"],
            instructions: "Private instructions",
          },
        },
        f.project.id,
      );
    const call = async (action: string, input = {}) =>
      await f.service.call(action, input, f.project.id, f.principal);
    const first = await call("crews.agents.list", {
      group: "Mobile",
      role: "specialist",
      limit: 1,
    });
    expect(first).toMatchObject({
      total: 2,
      offset: 0,
      nextOffset: 1,
      items: [{ id: "shared", candidateCount: 1 }],
    });
    expect(JSON.stringify(first)).not.toContain("instructions");
    expect(await call("crews.agents.list", { scope: "project", search: "LOCAL" })).toMatchObject({
      total: 1,
      items: [{ id: "local" }],
    });
    expect(await call("crews.agent.get", { agentId: "shared" })).toMatchObject({
      instructions: "",
    });
    await expect(call("crews.agent.get", { agentId: "foreign" })).rejects.toThrow("not available");
    await expect(call("crews.agents.list", { limit: 101 })).rejects.toThrow("bounded");
    await expect(call("crews.agents.list", { offset: -1 })).rejects.toThrow("bounded");
  });
  it("discovers definitions and run summaries without exposing prompts or snapshots", async () => {
    const f = await setup();
    const other = await f.store.addProject("/foreign-definition", "Foreign");
    await f.service.save({ ...f.definition, id: "global", projectId: undefined });
    await f.service.save({ ...f.definition, id: "foreign", projectId: other.id });
    const call = async (action: string, input = {}) =>
      await f.service.call(action, input, f.project.id, f.principal);
    expect(await call("crews.definitions.list", { scope: "global" })).toMatchObject({
      total: 1,
      items: [{ id: "global", memberCount: 3 }],
    });
    expect(await call("crews.definition.get", { definitionId: "crew" })).toMatchObject({
      agents: [{ instructions: "" }, { instructions: "" }, { instructions: "" }],
    });
    await expect(call("crews.definition.get", { definitionId: "foreign" })).rejects.toThrow(
      "not available",
    );
    await f.start();
    const runs = await call("crews.runs.list", {
      definitionId: "crew",
      status: "active",
      search: "Build",
    });
    expect(runs).toMatchObject({
      total: 1,
      items: [{ id: "run", definitionId: "crew", taskCount: 0 }],
    });
    expect(JSON.stringify(runs)).not.toContain("launch");
    expect(JSON.stringify(runs)).not.toContain("instructions");
    expect(await call("crews.runs.list", { status: "finished" })).toMatchObject({
      total: 0,
      items: [],
    });
  });
});
describe("crew work deletion", () => {
  it("stops queued retries without trying to discard their retained work", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    f.rows[0].sessionId = "earlier-worker";
    f.rows[0].startedAt = 10;
    const cancel = vi.fn(async (id: string) => {
      f.rows.find((task) => task.id === id)!.status = "blocked";
    });
    const move = vi.fn();
    Object.assign(f.tasks, { cancel, move });
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    expect(cancel).toHaveBeenCalledWith(f.rows[0].id, "Stopped by you.");
    expect(move).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ status: "blocked", sessionId: "earlier-worker" });
  });
  it("refuses deleting a revision that resumed during conversation checks", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    f.sourceRows.splice(0);
    const run = (await f.service.list(f.project.id)).runs[0];
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checking = new Promise<void>((resolve) => {
      started = resolve;
    });
    const original = await f.store.session("lead-session");
    vi.mocked(f.store.session).mockImplementationOnce(async () => {
      started();
      await held;
      return original;
    });
    const deleting = f.service.call(
      "crews.deleteRun",
      { runId: "run", expectedUpdatedAt: run.updatedAt },
      f.project.id,
    );
    const failed = expect(deleting).rejects.toThrow("changed");
    await checking;
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    release();
    await failed;
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("still stops peers and the coordinator when one assignment cannot stop", async () => {
    const f = await setup();
    await f.start();
    await f.assign("first");
    await f.assign("second");
    f.rows[0].status = "running";
    f.rows[1].status = "running";
    const move = vi.fn(async (id: string, status: HostTask["status"]) => {
      if (id === f.rows[0].id) throw new Error("Provider unavailable");
      const task = f.rows.find((task) => task.id === id)!;
      task.status = status;
      return task;
    });
    Object.assign(f.tasks, { move });
    vi.mocked(f.store.session).mockResolvedValue({
      projectId: f.project.id,
      status: "running",
      runId: "lead-run",
    } as Awaited<ReturnType<HostStore["session"]>>);
    f.engine.command.mockClear();

    await expect(f.service.call("crews.stop", { runId: "run" }, f.project.id)).rejects.toThrow(
      "some conversations could not be stopped",
    );

    expect(move).toHaveBeenCalledWith(f.rows[1].id, "blocked");
    expect(f.engine.command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel", sessionId: "lead-session", runId: "lead-run" }),
    );
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
  });
  it("stop removes queued assignments and cancels running ones", async () => {
    const f = await setup();
    await f.start();
    await f.assign("first");
    await f.assign("second");
    f.rows[1].status = "running";
    const move = vi.fn(async (id: string, status: HostTask["status"]) => {
      const task = f.rows.find((task) => task.id === id)!;
      task.status = status;
      return task;
    });
    Object.assign(f.tasks, { move });
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    expect(move).toHaveBeenCalledWith(f.rows[0].id, "todo");
    expect(move).toHaveBeenCalledWith(f.rows[1].id, "blocked");
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
  });
  it("requires owner, current revision and stopped work while preserving crew and tasks", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const input = async () => ({
      runId: "run",
      expectedUpdatedAt: (await f.service.list(f.project.id)).runs[0].updatedAt,
    });
    await expect(
      f.service.call("crews.deleteRun", await input(), f.project.id, f.principal),
    ).rejects.toThrow("Only the owner");
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).rejects.toThrow(
      "Stop work",
    );
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    f.sourceRows.splice(0);
    await expect(
      f.service.call(
        "crews.deleteRun",
        { ...(await input()), expectedUpdatedAt: -1 },
        f.project.id,
      ),
    ).rejects.toThrow("changed");
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).rejects.toThrow(
      "pending assignments",
    );
    f.rows[0].status = "blocked";
    await expect(f.service.call("crews.deleteRun", await input(), "wrong-project")).rejects.toThrow(
      "does not belong",
    );
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).resolves.toEqual({
      deleted: true,
    });
    expect((await f.service.list(f.project.id)).runs).toHaveLength(0);
    expect((await f.service.list(f.project.id)).definitions.some((d) => d.id === "crew")).toBe(
      true,
    );
    expect(f.rows).toHaveLength(1);
  });
  it("rejects live conversations and source-task references", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    f.sourceRows.splice(0);
    const input = {
      runId: "run",
      expectedUpdatedAt: (await f.service.list(f.project.id)).runs[0].updatedAt,
    };
    vi.mocked(f.store.session).mockReturnValue({
      projectId: f.project.id,
      status: "running",
    } as ReturnType<HostStore["session"]>);
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "running conversations",
    );
    vi.mocked(f.store.session).mockImplementation(() => {
      throw new Error("Database read failed");
    });
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "Database read failed",
    );
    vi.mocked(f.store.session).mockReturnValue({ status: "idle" } as ReturnType<
      HostStore["session"]
    >);
    f.rows.push({ id: "source", crewExecutionId: "run", status: "done" } as HostTask);
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "task still owns",
    );
  });
});

describe("crew access mode", () => {
  const launchMode = (f: Awaited<ReturnType<typeof setup>>) =>
    (
      f.engine.command.mock.calls as unknown as Array<[{ type: string; runtimeMode?: string }]>
    ).find(([input]) => input.type === "create")?.[0].runtimeMode;
  it("starts an owner crew with the saved policy access mode", async () => {
    const f = await setup();
    const saved = (await f.service.call("crews.list", {}, f.project.id)) as {
      definitions: CrewDefinition[];
    };
    const current = saved.definitions.find((d) => d.id === f.definition.id)!;
    await f.service.save(
      { ...current, policy: { ...current.policy, runtimeMode: "auto-accept-edits" } },
      current.updatedAt,
    );
    await f.service.call(
      "crews.start",
      { definitionId: "crew", prompt: "Go", requestId: "r1" },
      f.project.id,
    );
    expect(launchMode(f)).toBe("auto-accept-edits");
  });
  it("defaults an owner crew to supervised access", async () => {
    const f = await setup();
    await f.service.call(
      "crews.start",
      { definitionId: "crew", prompt: "Go", requestId: "r2" },
      f.project.id,
    );
    expect(launchMode(f)).toBe("supervised");
  });
  it("keeps an explicit task mode over the crew policy", async () => {
    const f = await setup();
    const saved = (await f.service.call("crews.list", {}, f.project.id)) as {
      definitions: CrewDefinition[];
    };
    const current = saved.definitions.find((d) => d.id === f.definition.id)!;
    await f.service.save(
      { ...current, policy: { ...current.policy, runtimeMode: "full-access" } },
      current.updatedAt,
    );
    await f.service.startRun(f.project.id, "crew", "Go", "r3", "auto");
    expect(launchMode(f)).toBe("auto");
  });
});
describe("host crews coordinator reconciliation", () => {
  it("pauses an active run whose coordinator was stopped outside Crews", async () => {
    const f = await setup();
    await f.start();
    const coordinator = await f.store.session("lead-session");
    vi.mocked(f.store.session).mockResolvedValue({ ...coordinator, status: "interrupted" });
    await f.service.tick();
    const run = (await f.service.list(f.project.id)).runs[0];
    expect(run.status).toBe("paused");
    expect(run.error).toContain("stopped outside Crews");
  });
  it("reports a run that already lost its coordinator as paused on read", async () => {
    const f = await setup();
    await f.start();
    vi.mocked(f.store.session).mockRejectedValue(new Error("Session not found on this machine"));
    const run = (await f.service.list(f.project.id)).runs[0];
    expect(run.status).toBe("paused");
    expect(run.error).toContain("deleted");
    expect((await readCrewRun(f.store, "run"))?.status).toBe("paused");
  });
  it("keeps an idle healthy run active on read", async () => {
    const f = await setup();
    await f.start();
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
});
describe("host crews resume after external coordinator loss", () => {
  const creates = (f: Awaited<ReturnType<typeof setup>>) =>
    (f.engine.command.mock.calls as unknown as Array<[{ type: string; commandId?: string }]>)
      .map(([input]) => input)
      .filter((input) => input.type === "create");
  it("clears a deleted coordinator and resumes with a fresh, distinct launch", async () => {
    const f = await setup();
    await f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    const firstCommandId = creates(f)[0].commandId;
    expect(firstCommandId).toMatch(/^work-[a-f0-9]{64}$/);
    vi.mocked(f.store.session).mockRejectedValue(new Error("Session not found on this machine"));
    const lost = (await f.service.list(f.project.id)).runs[0];
    expect(lost).toMatchObject({ status: "paused" });
    expect((await readCrewRun(f.store, "launch-run"))?.coordinatorSessionId).toBeUndefined();
    let created = 0;
    f.effect.mockImplementation((...args: unknown[]) => ({
      sessionId: (args[0] as { type?: string }).type === "create" ? `fresh-${++created}` : "x",
    }));
    vi.mocked(f.store.session).mockResolvedValue({
      projectId: f.project.id,
      status: "idle",
      runId: "fixture-run",
      session: {
        runtimeMode: "supervised",
        harness: "codex",
        model: "codex:fixture",
        modelSettings: {},
        blocks: [],
      },
    } as Awaited<ReturnType<HostStore["session"]>>);
    await f.service.call("crews.resume", { runId: "launch-run" }, f.project.id);
    const run = await readCrewRun(f.store, "launch-run");
    expect(run).toMatchObject({ status: "active", coordinatorSessionId: "fresh-1" });
    expect(run?.error).toBeUndefined();
    expect(creates(f).at(-1)?.commandId).toMatch(/^work-[a-f0-9]{64}$/);
    expect(creates(f).at(-1)?.commandId).not.toBe(firstCommandId);
  });
  it("resumes an externally stopped coordinator once, without launching a second", async () => {
    const f = await setup();
    await f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    const coordinator = await f.store.session("coordinator");
    vi.mocked(f.store.session).mockResolvedValue({ ...coordinator, status: "interrupted" });
    await f.service.tick();
    expect((await readCrewRun(f.store, "launch-run"))?.status).toBe("paused");
    f.engine.command.mockClear();
    await f.service.call("crews.resume", { runId: "launch-run" }, f.project.id);
    const run = await readCrewRun(f.store, "launch-run");
    expect(run).toMatchObject({ status: "active", coordinatorSessionId: "coordinator" });
    expect(run?.error).toBeUndefined();
    expect(run?.pendingDelivery?.text).toContain("Resume crew work");
    expect(creates(f)).toHaveLength(0);
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "send", sessionId: "coordinator" }),
    );
  });
});
