import { afterEach, expect, it, vi } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostLimits } from "../limits";
import { launchSessionRun, type SessionRunSpec } from "../sessions/sessionRuns";
import { bindSessionWork, readSessionWorkReceipt, SessionWorkAdapter } from "./session-adapter";
import { AssistantTurnPolicyDeferredError } from "../assistant/core/assistant-turn-policy";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it.each(["resume", "restart", "owner stop", "changed configuration", "active preparation"])(
  "retains exact created session after pre-send pause: %s",
  async (scenario) => {
    const { store, engine, project, turns, waitForTurnStart } = await setup();
    let runtime = new SessionWorkAdapter(store, engine);
    let allowed = true;
    let release!: () => void;
    let updating!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      updating = resolve;
    });
    const update = engine.updateSession.bind(engine);
    const spy = vi.spyOn(engine, "updateSession").mockImplementation(async (...args) => {
      const result = await update(...args);
      updating();
      await held;
      return result;
    });
    const spec: SessionRunSpec = {
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Prepare once",
      prompt: "Read only.",
      workspaceMode: "current",
      work: { kind: "automation", id: "prepared", occurrence: "original" },
    };
    const launch = () =>
      runtime.launch(spec.work!, {
        engine,
        spec,
        admitted: () => allowed,
        launch: (accepted) =>
          launchSessionRun(store, engine, { ...accepted, work: undefined }, () => allowed),
      });
    const pending = launch();
    await entered;
    allowed = false;
    release();
    const deferred = await pending;
    spy.mockRestore();
    expect(deferred).toMatchObject({ sessionId: expect.any(String), deferred: true });
    expect(turns).toHaveLength(0);
    const original = (await runtime.work.list())[0]!;
    expect(original).toMatchObject({ state: "waiting", reserved: false, dispatchStarted: false });
    if (scenario === "owner stop") await runtime.work.stop(original.id);
    if (scenario === "changed configuration") spec.model = "codex:changed";
    if (scenario === "active preparation") {
      await engine.command({
        type: "send",
        commandId: "foreign-send",
        sessionId: deferred.sessionId!,
        text: "Other turn",
      });
      await waitForTurnStart();
    }
    if (scenario === "restart") runtime = new SessionWorkAdapter(store, engine);
    allowed = true;
    spec.resumeSessionId = deferred.sessionId;
    const result = await launch();
    expect(await runtime.work.list()).toHaveLength(1);
    if (scenario === "resume" || scenario === "restart") {
      await waitForTurnStart();
      expect(result.sessionId).toBe(deferred.sessionId);
      expect(result.runId).toBeTruthy();
      expect(turns).toHaveLength(1);
    } else expect(result.runId).toBeUndefined();
    expect((await runtime.work.get(original.id)).payload).toEqual(original.payload);
  },
);

it("keeps an ambiguous pre-receipt launch reserved across restart", async () => {
  const { store, engine, project, turns } = await setup();
  let runtime = new SessionWorkAdapter(store, engine);
  const spec: SessionRunSpec = {
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Unknown",
    prompt: "Read only.",
    workspaceMode: "current",
    work: { kind: "automation", id: "unknown", occurrence: "original" },
  };
  const dispatch = vi.fn(async () => ({ error: "Missing ACK" }));
  const launch = () =>
    runtime.launch(spec.work!, { engine, spec, admitted: () => true, launch: dispatch });
  await launch();
  expect((await runtime.work.list())[0]).toMatchObject({
    state: "unknown",
    reserved: true,
    dispatchStarted: true,
  });
  runtime = new SessionWorkAdapter(store, engine);
  await launch();
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(turns).toHaveLength(0);
  expect((await runtime.work.list())[0]).toMatchObject({ state: "unknown", reserved: true });
});

it("distinguishes absent Work from an existing unacknowledged occurrence", async () => {
  const { store, engine, project } = await setup();
  const runtime = bindSessionWork(store, engine);
  const source = { kind: "goal.planner" as const, id: "goal", occurrence: "original" };
  expect(await readSessionWorkReceipt(store, source)).toEqual({ exists: false });
  await runtime.launch(source, {
    engine,
    spec: {
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Plan",
      prompt: "Plan",
      workspaceMode: "current",
    },
    admitted: () => false,
    launch: async () => {
      throw new Error("Must not launch");
    },
  });
  expect(await readSessionWorkReceipt(store, source)).toEqual({ exists: true });
  expect(await runtime.work.list()).toHaveLength(1);
});

it.each(["restart", "owner stop", "changed configuration", "unknown retirement"])(
  "retains original deferred receipt across %s",
  async (scenario) => {
    const { store, engine, project, turns, waitForTurnStart } = await setup();
    let runtime = new SessionWorkAdapter(store, engine);
    let allowed = true;
    const spec: SessionRunSpec = {
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Deferred work",
      prompt: "Read only.",
      workspaceMode: "current",
      author: { kind: "task", id: "deferred-task", name: "Deferred work", reason: "kickoff" },
      work: { kind: "task.worker", id: "deferred-task", occurrence: "original" },
    };
    const launch = () =>
      runtime.launch(spec.work!, {
        engine,
        spec,
        admitted: () => allowed,
        launch: (accepted) =>
          launchSessionRun(store, engine, { ...accepted, work: undefined }, () => allowed),
      });
    engine.beforeProviderTurn = async () => {
      allowed = false;
      throw new AssistantTurnPolicyDeferredError();
    };
    const receipt = await launch();
    await engine.waitForRun(receipt.sessionId!, receipt.runId!);
    const original = (await runtime.work.list())[0]!;
    expect(turns).toHaveLength(0);
    if (scenario === "owner stop") await runtime.work.stop(original.id);
    const retirement =
      scenario === "unknown retirement"
        ? vi.spyOn(engine, "waitForRun").mockRejectedValue(new Error("Retirement unknown"))
        : undefined;
    try {
      await launch();
      expect(await runtime.work.get(original.id)).toMatchObject({ receipt });
      expect(await runtime.work.list()).toHaveLength(1);
      allowed = true;
      engine.beforeProviderTurn = undefined;
      if (scenario === "changed configuration") spec.model = "codex:changed";
      // A fresh adapter has no callbacks or in-memory successor history.
      runtime = new SessionWorkAdapter(store, engine);
      const next = await launch();
      if (scenario === "restart") {
        await waitForTurnStart();
        expect(next.sessionId).not.toBe(receipt.sessionId);
        expect(await runtime.work.list()).toHaveLength(2);
        const restarted = new SessionWorkAdapter(store, engine);
        runtime = restarted;
        expect(await launch()).toEqual(next);
        expect(await runtime.work.list()).toHaveLength(2);
      } else {
        expect(turns).toHaveLength(0);
        expect(await runtime.work.list()).toHaveLength(1);
      }
      expect((await runtime.work.get(original.id)).receipt).toEqual(receipt);
    } finally {
      retirement?.mockRestore();
    }
  },
);

it("rechecks Work stop intent between session creation and provider dispatch", async () => {
  const { store, engine, project, turns } = await setup();
  const runtime = bindSessionWork(store, engine);
  const command = engine.command.bind(engine);
  vi.spyOn(engine, "command").mockImplementation(async (input) => {
    const receipt = await command(input);
    if (typeof input === "object" && input !== null && "type" in input && input.type === "create") {
      const work = (await runtime.work.list())[0]!;
      await runtime.work.stop(work.id);
    }
    return receipt;
  });
  const result = await launchSessionRun(store, engine, {
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Stop before send",
    prompt: "Read only.",
    workspaceMode: "current",
    work: { kind: "automation", id: "stopped", occurrence: "first" },
  });
  expect(result.runId).toBeUndefined();
  expect(turns).toHaveLength(0);
  expect((await runtime.work.list())[0]?.stopRequested).toBe(true);
});

it("queues an automation behind a task and resumes the same durable occurrence", async () => {
  const { store, engine, project, turns, waitForTurnStart } = await setup();
  const runtime = bindSessionWork(store, engine);
  await new HostLimits(store).save({ maxRunningTasks: 1 });
  const spec: SessionRunSpec = {
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Work",
    prompt: "Read only.",
    workspaceMode: "current",
    work: { kind: "automation", id: "automation", occurrence: "first" },
  };
  const first = await launchSessionRun(store, engine, spec);
  await waitForTurnStart();
  const snapshot = await store.session(first.sessionId!);
  expect(
    snapshot.session.blocks
      .filter((block) => block.role === "user")
      .every((block) => /^[A-Za-z0-9_-]{1,128}$/.test(block.id)),
  ).toBe(true);
  const second = {
    ...spec,
    work: { kind: "steward" as const, id: "steward", occurrence: "first" },
  };
  expect(await launchSessionRun(store, engine, second)).toEqual({
    deferred: true,
    wait: { code: "capacity", message: "Waiting for a free work slot." },
  });
  expect(turns).toHaveLength(1);
  const queued = (await runtime.work.list()).find((work) => work.source.id === "steward")!;
  turns[0]!.finish();
  await engine.waitForRun(first.sessionId!, first.runId!);
  const next = await launchSessionRun(store, engine, second);
  expect(next.runId).toBeTruthy();
  expect((await runtime.work.get(queued.id)).receipt).toEqual(next);
  expect((await runtime.work.list()).filter((work) => work.source.id === "steward")).toHaveLength(
    1,
  );
});

it("composes producer admission and Work receipt persistence", async () => {
  const { store, engine, project } = await setup();
  bindSessionWork(store, engine);
  const observed: string[] = [];
  const launch = () =>
    launchSessionRun(store, engine, {
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Work",
      prompt: "Read only.",
      workspaceMode: "current",
      work: { kind: "automation", id: "automation", occurrence: "first" },
    });
  const result = await engine.withCommandAdmission(
    {
      check: async () => {
        observed.push("producer");
      },
      onAccepted: async (receipt) => {
        if (receipt.runId) observed.push("receipt");
      },
    },
    launch,
  );
  expect(result.runId).toBeTruthy();
  expect(observed).toContain("producer");
  expect(observed).toContain("receipt");
});
