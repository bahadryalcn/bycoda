import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks/tasks";
import { HostGoals } from "../../goals/goals";
import { HostAssistant } from "../service";
import { assistantExecutionPorts } from "../core/assistant-runtime";
import { assistantSessionRuntime } from "../sessions/assistant-session-runtime";
import {
  HostAssistantWorkerRecovery,
  readAssistantRecovery,
  writeAssistantRecovery,
} from "./assistant-worker-recovery";
import type { HostProvider } from "../../providers/providers";
import type { SendTurnInput } from "../../../src/integrations/harness/core/types";
import type { AssistantNote } from "../../../src/shared/model/host-contracts/assistant";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "assistant-recovery-"))),
    store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const project = await store.addProject(directory, "Recovery fixture"),
    clock = { now: Date.now() + 20 * 60000 },
    turns: { input: SendTurnInput; finish: () => void; fail: (reason: Error) => void }[] = [],
    notes: AssistantNote[] = [];
  writeFileSync(join(directory, "retained.txt"), "Unmerged owner and worker edits must remain.");
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((finish, fail) => {
          turns.push({ input, finish, fail });
          input.onAccepted?.();
        }),
    ),
    steer: vi.fn(async () => {}),
    cancel: vi.fn(async (id) => {
      turns.findLast((turn) => turn.input.sessionId === id)?.finish();
    }),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const tasks = new HostTasks(store, engine, () => clock.now);
  await tasks.ready;
  const goals = new HostGoals(store, engine, tasks, () => clock.now);
  await goals.ready;
  const ports = assistantExecutionPorts(store, goals, tasks);
  ports.now = () => clock.now;
  ports.chiefWake = async () => ({ actions: [], tokens: 0 });
  ports.onError = () => {};
  ports.listNotes = async () => notes;
  ports.saveNote = async (input) => {
    const old = notes.find((note) => note.id === input.id);
    const note = {
      id: input.id ?? "daily",
      title: input.title,
      body: input.body,
      tags: ["assistant"],
      createdAt: old?.createdAt ?? clock.now,
      updatedAt: (old?.updatedAt ?? clock.now) + 1,
    };
    if (old) notes.splice(notes.indexOf(old), 1, note);
    else notes.push(note);
    return note;
  };
  const service = new HostAssistant(store, ports);
  await service.ready;
  await service.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Recovery fixture",
        enabled: true,
        setupComplete: true,
        autonomy: "report",
        dailyTokenBudget: 100000000,
        execution: {
          harness: "claude",
          model: "claude:test",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  const job = (
    await service.request(
      {
        op: "jobs.create",
        title: "Retained task",
        request: "Finish the retained work",
        projectId: project.id,
        idempotencyKey: "recovery-job",
      },
      "owner",
    )
  ).job!;
  const sessionId = (
    await engine.command({
      type: "create",
      commandId: "original-create",
      projectId: project.id,
      workspaceMode: "current",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "supervised",
    })
  ).sessionId;
  const first = await engine.command({
    type: "send",
    commandId: "original-worker",
    sessionId,
    text: "Finish the existing work",
  });
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  const session = await store.session(sessionId);
  await store.save(
    {
      ...session,
      revision: session.revision + 1,
      session: { ...session.session, context: { used: 1000, window: 1000000 } },
    },
    { type: "fixture.context" },
  );
  await tasks.save({
    id: "canonical-task",
    projectId: project.id,
    title: "Retained task",
    prompt: "Finish the retained work",
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  });
  await store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.goalId',?,'$.status','running','$.sessionId',?,'$.runId',?,'$.startedAt',?) WHERE id='canonical-task'",
    )
    .run(`assistant-${job.id}`, sessionId, first.runId, Date.now());
  await store.db.prepare("INSERT INTO goals(id,value) VALUES(?,?)").run(
    `assistant-${job.id}`,
    JSON.stringify({
      id: `assistant-${job.id}`,
      title: job.title,
      prompt: job.request,
      status: "running",
      taskIds: ["canonical-task"],
      projectIds: [project.id],
      leadProjectId: project.id,
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "supervised",
      maxRunMinutes: 0,
      verifyDefaults: { review: false },
      approvePlan: true,
      isolate: false,
      createdAt: clock.now,
      updatedAt: clock.now,
    }),
  );
  await store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.goalId',?,'$.status','running','$.dispatchState','submitted','$.sessionIds',json(?),'$.taskIds',json(?)) WHERE id=?",
    )
    .run(
      `assistant-${job.id}`,
      JSON.stringify([sessionId]),
      JSON.stringify(["canonical-task"]),
      job.id,
    );
  const profile = (await service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  await service.request(
    { op: "profile.update", expectedVersion: profile.version, patch: { autonomy: "chief" } },
    "owner",
  );
  const managed = assistantSessionRuntime(store, engine, service, tasks);
  await managed.ready;
  ports.onPause = () => managed.stop();
  ports.onResume = () => managed.resume();
  ports.onJobPause = (id) => managed.pauseJob(id);
  ports.onJobResume = (id) => managed.resumeJob(id);
  ports.manageSession = async (input) => {
    const result = await managed.request(
      { op: "nudge", ...input },
      { kind: "chief", id: "fixture-chief" },
    );
    if (result.recovery) return result.recovery;
    if (result.operation?.delivery !== "delivered") throw new Error("Unknown fixture delivery");
  };
  closes.push(async () => {
    for (const turn of turns) turn.finish();
    await managed.close();
    await service.close();
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const nudge = (requestId: string, id = sessionId) =>
    managed.request(
      {
        op: "nudge",
        jobId: job.id,
        sessionId: id,
        requestId,
        text: "Continue the already authorized task",
        reason: "nudge",
      },
      { kind: "chief", id: "fixture-chief" },
    );
  return {
    store,
    engine,
    tasks,
    goals,
    service,
    managed,
    provider,
    turns,
    notes,
    job,
    project,
    sessionId,
    first,
    clock,
    directory,
    nudge,
    twoNudges: async (id = sessionId) => {
      for (let i = 0; i < 2; i++) {
        const result = await nudge(`nudge-${id}-${i}`, id);
        expect(result.operation?.delivery, JSON.stringify(result)).toBe("delivered");
      }
    },
    source: async () => {
      const record = await store.session(sessionId);
      return {
        projectId: project.id,
        executionCwd: directory,
        authorityGeneration: record.authorityGeneration,
        runId: record.runId,
      };
    },
  };
}

it.each(["owner draft", "stale command ID", "mismatched job stamp"] as const)(
  "does not exempt %s while admitting the exact supervisor steer",
  async (kind) => {
    const f = await fixture(),
      original = f.tasks.managedSessionCommand.bind(f.tasks);
    let changed = false;
    vi.spyOn(f.tasks, "managedSessionCommand").mockImplementation((input, command) =>
      original(
        {
          ...input,
          ...(kind === "mismatched job stamp" && input.author?.kind === "assistant"
            ? { author: { ...input.author, jobId: "different-job" } }
            : {}),
          recheck: async () => {
            await input.recheck();
            if (changed) return;
            const current = await f.store.session(f.sessionId),
              blocks = structuredClone(current.session.blocks);
            const block = blocks.find(
              (value) =>
                value.draft &&
                value.author?.kind === "assistant" &&
                value.author.jobId === f.job.id,
            );
            if (!block) return;
            changed = true;
            if (kind === "owner draft")
              blocks.push({
                id: "unrelated-owner-draft",
                role: "user",
                text: "Keep the owner's unsent request",
                draft: true,
              });
            else if (kind === "stale command ID") block.id = "stale-supervisor-command";
            else return; // The real engine keeps its original immutable Host authorship.
            await f.store.save(
              {
                ...current,
                revision: current.revision + 1,
                session: { ...current.session, blocks },
              },
              { type: "fixture.pendingInputRace" },
            );
          },
        },
        command,
      ),
    );
    const requestId = `draft-race-${kind}`,
      result = await f.nudge(requestId);
    expect(changed).toBe(true);
    expect(result.operation).toMatchObject({ state: "settled", delivery: "unknown" });
    expect(f.provider.steer).not.toHaveBeenCalled();
    expect((await f.nudge(requestId)).operation).toEqual(result.operation);
    expect(f.provider.steer).not.toHaveBeenCalled();
    const blocks = (await f.store.session(f.sessionId)).session.blocks;
    if (kind === "owner draft")
      expect(blocks.find((block) => block.id === "unrelated-owner-draft")).toMatchObject({
        text: "Keep the owner's unsent request",
        draft: true,
      });
    else if (kind === "stale command ID")
      expect(blocks.some((block) => block.id === "stale-supervisor-command")).toBe(true);
    else
      expect(
        blocks.some(
          (block) => block.author?.kind === "assistant" && block.author.jobId === f.job.id,
        ),
      ).toBe(true);
  },
);

it("retires the exact worker after two nudges, queues the same retained task once, launches through normal admission, then escalates without another cancellation", async () => {
  const f = await fixture();
  await f.twoNudges();
  const canonical = (await f.tasks.list(f.project.id, false))[0],
    projected = (await f.tasks.list(f.project.id))[0];
  expect(projected.assistantFollowups).toEqual({ delivered: 2, unconfirmed: 0 });
  const { assistantFollowups: _, ...withoutProjection } = projected;
  expect(withoutProjection).toEqual(canonical);
  expect(
    JSON.parse(
      String(
        (await f.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(canonical.id))!.value,
      ),
    ),
  ).not.toHaveProperty("assistantFollowups");
  expect(f.provider.steer).toHaveBeenCalledTimes(2);
  const result = await f.nudge("recover-once");
  expect(result.recovery, JSON.stringify(result)).toMatchObject({
    taskId: "canonical-task",
    state: "queued",
  });
  expect(f.provider.cancel).toHaveBeenCalledOnce();
  expect((await f.tasks.get("canonical-task"))?.status).toBe("queued");
  expect((await readAssistantRecovery(f.store, "canonical-task"))?.state).toBe("queued");
  expect(readFileSync(join(f.directory, "retained.txt"), "utf8")).toBe(
    "Unmerged owner and worker edits must remain.",
  );
  await f.tasks.tick();
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  const restarted = (await f.tasks.get("canonical-task"))!;
  expect(restarted.sessionId).not.toBe(f.sessionId);
  expect(restarted.goalId).toBe(`assistant-${f.job.id}`);
  expect(restarted.projectId).toBe(f.project.id);
  const receipt = await readAssistantRecovery(f.store, restarted.id);
  expect(restarted.ownerNotices?.some((notice) => notice.id === receipt?.operationId)).toBe(true);
  const run = await f.store.session(restarted.sessionId!);
  await f.store.save(
    {
      ...run,
      revision: run.revision + 1,
      runActivity: { runId: run.runId!, lastActivityAt: f.clock.now - 20 * 60000 },
      session: { ...run.session, context: { used: 1000, window: 1000000 } },
    },
    { type: "fixture.newStall" },
  );
  await f.service.tick();
  await f.twoNudges(restarted.sessionId);
  const second = await f.nudge("second-escalation", restarted.sessionId);
  expect(second.recovery?.state).toBe("escalated");
  expect(f.provider.cancel).toHaveBeenCalledOnce();
  expect(f.turns).toHaveLength(2);
  const snapshot = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!;
  expect(snapshot.jobs.find((job) => job.id === f.job.id)?.status).toBe("waiting");
  expect(snapshot.activity.some((event) => event.kind === "job.recoveryEscalated")).toBe(true);
  expect(f.notes.some((note) => note.body.includes("one automatic recovery"))).toBe(true);
});

it("persists an interrupted intent as unknown, holds only its exact lineage and allows explicit owner Retry after verified original retirement", async () => {
  const f = await fixture(),
    source = await f.tasks.captureAssistantRecovery({
      jobId: f.job.id,
      sessionId: f.sessionId,
      source: await f.source(),
    });
  await writeAssistantRecovery(f.store, {
    taskId: source.taskId,
    operationId: "persisted-intent",
    source,
    state: "cancelling",
    startedAt: f.clock.now,
    updatedAt: f.clock.now,
    message: "Interrupted",
    launchRequestId: "persisted-launch",
  });
  const recovered = new HostAssistantWorkerRecovery(f.store, f.tasks, {
    allowed: () => f.service.supervisionAllowed(),
    onState: (record) => f.service.recordWorkerRecovery(record),
    now: () => f.clock.now,
  });
  await recovered.ready;
  expect((await readAssistantRecovery(f.store, source.taskId))?.state).toBe("unknown");
  await f.tasks.tick();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.turns).toHaveLength(1);
  await f.tasks.cancel(source.taskId, "Owner inspected the run");
  await f.engine.waitForRun(f.sessionId, f.first.runId);
  await f.tasks.move(source.taskId, "queued");
  expect(await readAssistantRecovery(f.store, source.taskId)).toMatchObject({
    state: "ownerResolved",
    ownerResolution: { priorState: "unknown" },
  });
  expect((await f.tasks.get(source.taskId))?.status).toBe("queued");
  expect((await readAssistantRecovery(f.store, source.taskId))?.source.taskValue).toBe(
    source.taskValue,
  );
});

it("fences replacement source, questions and pause during a queued cancellation without cancelling a replacement", async () => {
  const f = await fixture();
  await f.twoNudges();
  const hold = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const blocked = (f.engine as any).operations.run(f.sessionId, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const pending = f.nudge("stop-during-cancel");
  await vi.waitFor(async () =>
    expect((await readAssistantRecovery(f.store, "canonical-task"))?.state).toBe("cancelling"),
  );
  f.managed.stop();
  hold.resolve();
  await blocked;
  expect((await pending).recovery?.state).toBe("unknown");
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.turns).toHaveLength(1);
  f.managed.resume();
  const record = await f.store.session(f.sessionId);
  await f.store.save(
    {
      ...record,
      revision: record.revision + 1,
      runId: "replacement-run",
      runActivity: { runId: "replacement-run", lastActivityAt: f.clock.now },
    },
    { type: "fixture.replaced" },
  );
  await expect(
    f.tasks.captureAssistantRecovery({
      jobId: f.job.id,
      sessionId: f.sessionId,
      source: await f.source(),
    }),
  ).rejects.toThrow("exact current worker");
  expect(f.provider.cancel).not.toHaveBeenCalled();
});

it("preserves questions, approvals, drafts and saved pauses instead of using recovery to bypass owner input", async () => {
  for (const kind of ["question", "approval", "draft", "pause"]) {
    const f = await fixture();
    await f.twoNudges();
    const record = await f.store.session(f.sessionId),
      session = { ...record.session };
    if (kind === "question")
      session.pendingQuestion = {
        requestId: "owner-question",
        questions: [{ header: "Owner", prompt: "Which credential may I use?", options: [] }],
      } as never;
    if (kind === "approval")
      session.blocks = [
        ...session.blocks,
        {
          id: "owner-approval",
          role: "assistant",
          text: "Approval required",
          approval: {
            requestId: "owner-approval",
            occurrenceId: "exact-occurrence",
            decided: false,
          },
        } as never,
      ];
    if (kind === "draft")
      session.blocks = [
        ...session.blocks,
        { id: "owner-draft", role: "user", text: "Retain the owner's unsent words", draft: true },
      ];
    await f.store.save(
      { ...record, revision: record.revision + 1, session },
      { type: "fixture.ownerInput" },
    );
    if (kind === "pause") await f.tasks.setGoalPaused(`assistant-${f.job.id}`, true);
    const attempt = f.nudge(`owner-required-${kind}`);
    if (kind === "pause") expect((await attempt).recovery?.state).toBe("unknown");
    else await expect(attempt).rejects.toThrow(/owner|approval|question/i);
    expect(f.provider.cancel).not.toHaveBeenCalled();
    expect(f.turns).toHaveLength(1);
    expect((await f.store.session(f.sessionId)).session).toMatchObject(session);
  }
});

it("retains branch metadata, unmerged edits, earlier attempts and notices in the canonical queued retry", async () => {
  const f = await fixture(),
    task = (await f.tasks.get("canonical-task"))!,
    history = [
      {
        attempt: 1,
        at: 1,
        workerSessionId: "earlier-worker",
        reviewerSessionId: "earlier-reviewer",
        workerSummary: "Prior work",
        verdict: "fail",
        note: "Preserve this verdict",
        findings: ["Retain finding"],
      },
    ],
    notices = [{ id: "owner-note", at: 1, kind: "info", message: "Keep this owner's notice" }];
  await f.store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
    JSON.stringify({
      ...task,
      branch: "retained-branch",
      worktreeCwd: f.directory,
      attemptHistory: history,
      ownerNotices: notices,
    }),
    task.id,
  );
  await f.twoNudges();
  const result = await f.nudge("retain-branch");
  expect(result.recovery?.state).toBe("queued");
  const queued = (await f.tasks.get(task.id))!;
  expect(queued.branch).toBe("retained-branch");
  expect(queued.worktreeCwd).toBe(f.directory);
  expect(queued.attemptHistory).toEqual(history);
  expect(queued.ownerNotices).toEqual(expect.arrayContaining(notices));
  expect(readFileSync(join(f.directory, "retained.txt"), "utf8")).toContain(
    "Unmerged owner and worker edits",
  );
});

it("reopens durable unknown recovery after Host disposal without a second cancellation or launch", async () => {
  const f = await fixture(),
    source = await f.tasks.captureAssistantRecovery({
      jobId: f.job.id,
      sessionId: f.sessionId,
      source: await f.source(),
    });
  await writeAssistantRecovery(f.store, {
    taskId: source.taskId,
    operationId: "restart-intent",
    source,
    state: "cancelling",
    startedAt: f.clock.now,
    updatedAt: f.clock.now,
    message: "Pending original cancellation",
    launchRequestId: "restart-launch",
  });
  f.turns[0].finish();
  await f.engine.waitForRun(f.sessionId, f.first.runId);
  await f.managed.close();
  await f.service.close();
  await f.tasks.close();
  await f.engine.close();
  await f.store.close();
  const before = f.turns.length,
    cancels = (f.provider.cancel as ReturnType<typeof vi.fn>).mock.calls.length;
  const store = new HostStore(join(f.directory, "host.db"));
  await store.ready;
  const engine = new HostEngine(store, { claude: f.provider });
  await engine.ready;
  const tasks = new HostTasks(store, engine, () => f.clock.now);
  await tasks.ready;
  closes.push(async () => {
    await tasks.close();
    await engine.close();
    await store.close();
  });
  const recovery = new HostAssistantWorkerRecovery(store, tasks, {
    allowed: async () => true,
    onState: async () => {},
    now: () => f.clock.now,
  });
  await recovery.ready;
  await tasks.tick();
  expect(await readAssistantRecovery(store, source.taskId)).toMatchObject({
    operationId: "restart-intent",
    state: "unknown",
    source: { taskValue: source.taskValue },
  });
  expect(f.turns).toHaveLength(before);
  expect(f.provider.cancel).toHaveBeenCalledTimes(cancels);
});

it("escalates a failed recovered provider run without the generic transient retry loop and settles only its actual metrics reservation", async () => {
  const f = await fixture();
  await f.twoNudges();
  expect((await f.nudge("retry-before-failure")).recovery?.state).toBe("queued");
  await f.tasks.tick();
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  const current = (await f.tasks.get("canonical-task"))!,
    receipt = (await readAssistantRecovery(f.store, current.id))!;
  f.turns[1].input.onEvent({ type: "turn.metrics", inputTokens: 100, outputTokens: 20 });
  f.turns[1].fail(new Error("Fixture provider connection failed"));
  await f.engine.waitForRun(current.sessionId!, current.runId);
  await f.tasks.tick();
  expect((await f.tasks.get(current.id))?.status).toBe("blocked");
  expect((await readAssistantRecovery(f.store, current.id))?.state).toBe("escalated");
  await f.tasks.tick();
  expect(f.turns).toHaveLength(2);
  expect(f.provider.cancel).toHaveBeenCalledOnce();
  await f.service.tick();
  const reservation = await f.store.db
    .prepare("SELECT value FROM assistant_runtime WHERE id=?")
    .get(`reservation:${receipt.operationId}:handoff`);
  expect(JSON.parse(reservation!.value).value.remaining).toBe(0);
  expect(
    (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.activity.some(
      (event) => event.kind === "job.recoveryEscalated",
    ),
  ).toBe(true);
});

it("never repeats an uncertain cancellation under the same or a fresh supervisor request", async () => {
  const f = await fixture(),
    cancel = Promise.withResolvers<void>();
  (f.provider.cancel as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    await cancel.promise;
    f.turns[0].finish();
  });
  await f.twoNudges();
  const pending = f.nudge("uncertain-cancel");
  await vi.waitFor(() => expect(f.provider.cancel).toHaveBeenCalledOnce());
  f.managed.stop();
  expect((await pending).recovery?.state).toBe("unknown");
  f.managed.resume();
  expect((await f.nudge("uncertain-cancel")).recovery?.state).toBe("unknown");
  expect((await f.nudge("fresh-request-cannot-replay")).recovery?.state).toBe("unknown");
  expect(f.provider.cancel).toHaveBeenCalledOnce();
  expect(f.turns).toHaveLength(1);
  cancel.resolve();
  await f.engine.waitForRun(f.sessionId, f.first.runId);
});

it.each(["Chief", "budget"])(
  "rechecks %s admission at delayed retry provider dispatch and parks the receipt instead of starting a replacement",
  async (mode) => {
    const f = await fixture();
    await f.twoNudges();
    expect((await f.nudge("queued-retry")).recovery?.state).toBe("queued");
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const original = f.tasks.assistantRecoveryAdmission!;
    f.tasks.assistantRecoveryAdmission = async (task, stage) => {
      if (stage?.phase === "provider") {
        entered.resolve();
        await release.promise;
      }
      await original(task, stage);
    };
    const launching = f.tasks.tick();
    await entered.promise;
    if (mode === "budget")
      // The shared fixture has already spent about 12k tokens today, which no budget at the 20k minimum
      // can be lowered below. Seed spend at the minimum so the owner lowering still crosses the cap.
      await f.store.db
        .prepare(
          "UPDATE assistant_runtime SET value=json_set(value,'$.value.total',20000) WHERE id LIKE 'usage:%'",
        )
        .run();
    const profile = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
    await f.service.request(
      {
        op: "profile.update",
        expectedVersion: profile.version,
        patch: mode === "Chief" ? { autonomy: "report" } : { dailyTokenBudget: 20000 },
      },
      "owner",
    );
    release.resolve();
    await launching;
    const pending = (await f.tasks.get("canonical-task"))!;
    await f.engine.waitForRun(pending.sessionId!, pending.runId);
    await vi.waitFor(async () =>
      expect((await readAssistantRecovery(f.store, pending.id))?.state).toBe("escalated"),
    );
    expect(f.turns).toHaveLength(1);
    expect((await readAssistantRecovery(f.store, "canonical-task"))?.state).toBe("escalated");
    expect(f.provider.cancel).toHaveBeenCalledOnce();
    const current = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.profile;
    await f.service.request(
      {
        op: "profile.update",
        expectedVersion: current.version,
        patch: { autonomy: "chief", dailyTokenBudget: profile.dailyTokenBudget },
      },
      "owner",
    );
    await f.tasks.tick();
    expect(f.turns).toHaveLength(1);
  },
);

it("admits an owner job Pause while recovery waits for the engine queue and preserves that pause in later recovery attention", async () => {
  const f = await fixture();
  await f.twoNudges();
  const hold = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const blocked = (f.engine as any).operations.run(f.sessionId, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const pending = f.nudge("owner-pause-pending");
  await vi.waitFor(async () =>
    expect((await readAssistantRecovery(f.store, "canonical-task"))?.state).toBe("cancelling"),
  );
  const job = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.jobs.find(
    (value) => value.id === f.job.id,
  )!;
  const paused = await f.service.request(
    { op: "jobs.control", id: job.id, expectedVersion: job.version, action: "pause" },
    "owner",
  );
  expect(paused.job?.status).toBe("paused");
  hold.resolve();
  await blocked;
  expect((await pending).recovery?.state).toBe("unknown");
  expect(
    (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.jobs.find(
      (value) => value.id === f.job.id,
    )?.status,
  ).toBe("paused");
  expect(f.provider.cancel).not.toHaveBeenCalled();
});

it("never revives a queued supervisor request when a job is paused then resumed before its old command reaches the engine", async () => {
  const f = await fixture();
  await f.twoNudges();
  const hold = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const blocked = (f.engine as any).operations.run(f.sessionId, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const first = f.nudge("old-job-epoch"),
    second = f.nudge("queued-old-job-epoch");
  const secondResult = second.then(
    () => "unexpected success",
    (error) => String(error),
  );
  await vi.waitFor(async () =>
    expect((await readAssistantRecovery(f.store, "canonical-task"))?.state).toBe("cancelling"),
  );
  f.managed.pauseJob(f.job.id);
  f.managed.resumeJob(f.job.id);
  hold.resolve();
  await blocked;
  expect((await first).recovery?.state).toBe("unknown");
  expect(await secondResult).toContain("newer owner job hold");
  expect(f.provider.cancel).not.toHaveBeenCalled();
});
