import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostAssistant, type AssistantPorts } from "./assistant/service";
import { HostAssistantManualSessions } from "./assistant-manual-sessions";
import { assistantSessionRuntime } from "./assistant-session-runtime";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import { readManualSessionUsage } from "./assistant-runtime";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function setup(fullAuthority = false) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "manual-supervision-"))),
    store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const project = await store.addProject(directory, "Manual fixture"),
    turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((finish) => turns.push({ input, finish }))),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => turns.at(-1)?.finish()),
    approve: vi.fn(),
    answer: vi.fn(),
    bind: vi.fn(),
    steer: vi.fn(async () => {}),
  };
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const sessionId = (
    await engine.command({
      type: "create",
      commandId: "create-manual",
      projectId: project.id,
      workspaceMode: "current",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "supervised",
    })
  ).sessionId;
  const original = await store.session(sessionId);
  await store.save(
    {
      ...original,
      revision: original.revision + 1,
      session: {
        ...original.session,
        context: { used: 1000, window: 1000000 },
        blocks: [
          {
            id: "prior-owner",
            role: "user",
            text: "Original owner work must remain intact",
            startedAt: Date.now() - 86400000,
            turnMetrics: { inputTokens: 500000, outputTokens: 1000 },
          },
        ],
      },
    },
    { type: "fixture.context" },
  );
  const ports: AssistantPorts = {
    listProjects: async () => [{ id: project.id, path: directory, name: "Fixture" }],
    manualProjectVisible: async () => visible,
  };
  const assistant = new HostAssistant(store, ports);
  await assistant.ready;
  await assistant.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Manual fixture",
        enabled: true,
        setupComplete: true,
        autonomy: "chief",
        dailyTokenBudget: 10000000,
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
  let enabled = false,
    visible = true;
  const manual = new HostAssistantManualSessions(store, {
    enabled: async () =>
      enabled &&
      (await (fullAuthority
        ? assistant.manualSupervisionAllowed()
        : assistant.supervisionAllowed())),
    name: async () => "Manual fixture",
    visibleProject: async (id) =>
      fullAuthority ? assistant.manualProjectAllowed(id) : visible && id === project.id,
  });
  await manual.ready;
  const managed = assistantSessionRuntime(store, engine, assistant, undefined, manual);
  await managed.ready;
  ports.manual = manual;
  ports.manualUsage = (grant) => readManualSessionUsage(store, grant);
  ports.onPause = () => managed.stop();
  ports.onResume = () => managed.resume();
  ports.manageManualSession = async (input) => {
    const result = await managed.request(
      { op: "nudge", ...input },
      { kind: "chief", id: "fixture-chief" },
    );
    if (result.operation?.delivery !== "delivered") throw new Error("Uncertain manual delivery");
  };
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await managed.close();
    await assistant.close();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const candidate = async () =>
    (await manual.listCandidates("owner")).find((value) => value.sessionId === sessionId)!;
  const enroll = async () => {
    enabled = true;
    const policy = await assistant.manualPolicy();
    if (!policy.enabled)
      await assistant.request(
        {
          op: "manual.policy",
          expectedVersion: policy.version,
          enabled: true,
          projectIds: [project.id],
        },
        "owner",
      );
    return manual.enroll(
      {
        sessionId,
        sourceToken: (await candidate()).sourceToken,
        expectedVersion: (await manual.read(sessionId))?.version ?? 0,
      },
      "owner",
    );
  };
  const nudge = (supervisionId: string, requestId: string) =>
    managed.request(
      {
        op: "nudge",
        supervisionId,
        sessionId,
        requestId,
        text: "Continue only the already authorized conversation work",
        reason: "nudge",
      },
      { kind: "chief", id: "fixture-chief" },
    );
  return {
    store,
    engine,
    assistant,
    manual,
    managed,
    provider,
    project,
    sessionId,
    turns,
    candidate,
    enroll,
    nudge,
    ports,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
  };
}

it("limits transcript hydration before candidate ownership probes and rechecks visibility", async () => {
  const f = await setup();
  const original = await f.store.session(f.sessionId);
  for (let i = 0; i < 1001; i++)
    await f.store.save(
      {
        ...original,
        revision: 1,
        updatedAt: i + 1000,
        session: { ...original.session, id: `candidate-${i}`, title: `Candidate ${i}` },
      },
      {},
    );
  const read = vi.spyOn(f.store, "session");
  const candidates = await f.manual.listCandidates("owner");
  expect(candidates).toHaveLength(100);
  expect(read).toHaveBeenCalledTimes(100);
  expect(candidates.every((item) => !JSON.stringify(item).includes("500000"))).toBe(true);
  f.setVisible(false);
  expect(await f.manual.listCandidates("owner")).toEqual([]);
  read.mockRestore();
});

it("keeps every canonical owner exclusion in batched candidate reads", async () => {
  const f = await setup();
  const original = await f.store.session(f.sessionId);
  const tables = [
    "tasks",
    "goals",
    "automations",
    "automation_runs",
    "stewards",
    "crew_runs",
    "crew_run_members",
  ];
  for (const table of tables) {
    await f.store.db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY,value TEXT NOT NULL)`,
    );
    const id = `owned-${table}`;
    await f.store.save({ ...original, revision: 1, session: { ...original.session, id } }, {});
    await f.store.db
      .prepare(`INSERT INTO ${table}(id,value) VALUES(?,?)`)
      .run(id, JSON.stringify({ workerSessionId: id }));
  }
  await f.store.save(
    { ...original, revision: 1, session: { ...original.session, id: "crew-coordinator" } },
    {},
  );
  await f.store.db
    .prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)")
    .run("crews.v1", JSON.stringify({ runs: [{ coordinatorSessionId: "crew-coordinator" }] }));
  const candidates = await f.manual.listCandidates("owner");
  for (const table of tables)
    expect(candidates.find((entry) => entry.sessionId === `owned-${table}`)?.eligible).toBe(false);
  expect(candidates.find((entry) => entry.sessionId === "crew-coordinator")?.reason).toContain(
    "Crew coordinator",
  );
});

it("integrates owner enrollment, dynamic privacy, captured policy epochs and exact per-grant usage through the real core and engine", async () => {
  const f = await setup(true);
  f.setEnabled(true);
  expect((await f.assistant.request({ op: "snapshot" }, "owner")).snapshot!.manualPolicy).toEqual({
    enabled: false,
    version: 0,
    projectIds: [],
  });
  await expect(
    f.assistant.request(
      { op: "manual.policy", expectedVersion: 0, enabled: true, projectIds: [f.project.id] },
      "chief",
    ),
  ).rejects.toThrow("owner");
  await expect(
    f.assistant.request(
      { op: "manual.policy", expectedVersion: 0, enabled: true, projectIds: ["invented"] },
      "owner",
    ),
  ).rejects.toThrow("current Host");
  const policy = (
    await f.assistant.request(
      { op: "manual.policy", expectedVersion: 0, enabled: true, projectIds: [f.project.id] },
      "owner",
    )
  ).manual!.policy;
  const candidate = (
    await f.assistant.request({ op: "manual.list" }, "owner")
  ).manual!.candidates.find((value) => value.sessionId === f.sessionId)!;
  const enrolled = (
      await f.assistant.request(
        {
          op: "manual.enroll",
          sessionId: f.sessionId,
          sourceToken: candidate.sourceToken,
          expectedVersion: 0,
        },
        "owner",
      )
    ).manual!,
    grant = enrolled.grants[0];
  expect(grant.title).toBeTruthy();
  const sending = f.assistant.request(
    {
      op: "manual.nudge",
      supervisionId: grant.id,
      sessionId: f.sessionId,
      requestId: "core-manual-turn",
      text: "Continue authorized work",
      reason: "nudge",
    },
    "chief",
  );
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onAccepted?.();
  await sending;
  f.turns[0].input.onEvent({ type: "turn.metrics", inputTokens: 100, outputTokens: 20 });
  f.turns[0].finish();
  await f.engine.waitForRun(f.sessionId, (await f.store.session(f.sessionId)).runId);
  await f.assistant.tick();
  const usage = (await f.assistant.request({ op: "snapshot" }, "owner")).snapshot!.usage;
  expect(usage.observedWorkerTokens).toBe(120);
  expect(usage.reservedWorkerTokens).toBe(0);
  expect(usage.workerTokens).toBe(120);
  // Archived grants still own their late metrics; a renewed grant never adopts owner history.
  await f.assistant.request(
    { op: "manual.revoke", id: grant.id, expectedVersion: grant.version },
    "owner",
  );
  const nextCandidate = (
    await f.assistant.request({ op: "manual.list" }, "owner")
  ).manual!.candidates.find((value) => value.sessionId === f.sessionId)!;
  const renewed = (
    await f.assistant.request(
      {
        op: "manual.enroll",
        sessionId: f.sessionId,
        sourceToken: nextCandidate.sourceToken,
        expectedVersion: grant.version + 1,
      },
      "owner",
    )
  ).manual!.grants[0];
  expect(renewed.id).not.toBe(grant.id);
  const current = await f.store.session(f.sessionId),
    blocks = current.session.blocks.map((block) =>
      block.author?.kind === "assistant-manual"
        ? { ...block, turnMetrics: { inputTokens: 140, outputTokens: 20 } }
        : block,
    );
  await f.store.save(
    { ...current, revision: current.revision + 1, session: { ...current.session, blocks } },
    { type: "fixture.lateMetrics" },
  );
  await f.assistant.tick();
  expect(
    (await f.assistant.request({ op: "snapshot" }, "owner")).snapshot!.usage.workerTokens,
  ).toBe(160);
  f.setVisible(false);
  await expect(f.manual.resolveStatus(renewed.id, f.sessionId)).rejects.toThrow();
  await expect(
    f.assistant.request(
      {
        op: "manual.nudge",
        supervisionId: renewed.id,
        sessionId: f.sessionId,
        requestId: "hidden",
        text: "Hidden must refuse",
        reason: "nudge",
      },
      "chief",
    ),
  ).rejects.toThrow();
  f.setVisible(true);
  const hold = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const blocked = (f.engine as any).operations.run(f.sessionId, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const queued = f.nudge(renewed.id, "old-policy-epoch");
  await vi.waitFor(async () =>
    expect(
      await f.store.db
        .prepare("SELECT id FROM assistant_session_receipts WHERE id LIKE '%old-policy-epoch'")
        .get(),
    ).toBeTruthy(),
  );
  const off = await f.assistant.request(
    {
      op: "manual.policy",
      expectedVersion: policy.version,
      enabled: false,
      projectIds: [f.project.id],
    },
    "owner",
  );
  await f.assistant.request(
    {
      op: "manual.policy",
      expectedVersion: off.manual!.policy.version,
      enabled: true,
      projectIds: [f.project.id],
    },
    "owner",
  );
  hold.resolve();
  await blocked;
  expect((await queued).operation?.delivery).toBe("unknown");
  expect(f.turns).toHaveLength(1);
});

it("requires explicit owner policy, current backend source token and visible project without inventing a job", async () => {
  const f = await setup(),
    candidate = await f.candidate();
  expect(candidate.eligible).toBe(true);
  await expect(
    f.manual.enroll(
      { sessionId: f.sessionId, sourceToken: candidate.sourceToken, expectedVersion: 0 },
      "owner",
    ),
  ).rejects.toThrow("Enable manual");
  f.setEnabled(true);
  await expect(
    f.manual.enroll(
      { sessionId: f.sessionId, sourceToken: candidate.sourceToken, expectedVersion: 0 },
      "chief" as "owner",
    ),
  ).rejects.toThrow("captured owner");
  await expect(
    f.manual.enroll(
      { sessionId: f.sessionId, sourceToken: "0".repeat(64), expectedVersion: 0 },
      "owner",
    ),
  ).rejects.toThrow("source token");
  f.setVisible(false);
  expect(await f.manual.listCandidates("owner")).toEqual([]);
  await expect(f.enroll()).rejects.toThrow();
  f.setVisible(true);
  const grant = await f.enroll();
  expect((await f.store.session(f.sessionId)).managedBy).toMatchObject({
    assistant: true,
    supervisionId: grant.id,
  });
  expect(
    await f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='goals'").get(),
  ).toBeUndefined();
  expect((await f.manual.resolveStatus(grant.id, f.sessionId)).grant.id).toBe(grant.id);
});

it("keeps awake only a proven current manual-owned run, including a revoked grant's surviving turn, and releases for later owner work", async () => {
  const f = await setup(true),
    awake = vi.fn(async (requested) => ({ supported: true, requested, active: requested }));
  f.ports.keepAwake = awake;
  f.setEnabled(true);
  const grant = await f.enroll(),
    profile = (await f.assistant.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  // Opt-in is false even if an assistant turn is running.
  const sending = f.nudge(grant.id, "awake-manual");
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onAccepted?.();
  await sending;
  await f.assistant.tick();
  expect(awake).toHaveBeenLastCalledWith(false);
  await f.assistant.request(
    {
      op: "profile.update",
      expectedVersion: profile.version,
      patch: { keepAwakeWhileWorking: true },
    },
    "owner",
  );
  expect(awake).toHaveBeenLastCalledWith(true);
  await f.assistant.request(
    { op: "manual.revoke", id: grant.id, expectedVersion: grant.version },
    "owner",
  );
  expect(awake).toHaveBeenLastCalledWith(true);
  // Re-enrollment archives the original grant. Its live provider turn still
  // belongs to that historical grant; changing policy does not cancel it.
  await f.enroll();
  const policy = await f.assistant.manualPolicy();
  await f.assistant.request(
    {
      op: "manual.policy",
      expectedVersion: policy.version,
      enabled: false,
      projectIds: [f.project.id],
    },
    "owner",
  );
  expect(awake).toHaveBeenLastCalledWith(true);
  f.turns[0].finish();
  await f.engine.waitForRun(f.sessionId, (await f.store.session(f.sessionId)).runId);
  await f.assistant.tick();
  expect(awake).toHaveBeenLastCalledWith(false);
  const owner = await f.engine.command({
    type: "send",
    commandId: "owner-after-manual",
    sessionId: f.sessionId,
    text: "Owner's next turn",
  });
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  f.turns[1].input.onAccepted?.();
  await f.assistant.tick();
  expect(awake).toHaveBeenLastCalledWith(false);
  // A prior manual block, or a stale runId pointing at it, cannot adopt the
  // current owner's turn. A known operation receipt is required independently.
  const record = await f.store.session(f.sessionId),
    manualBlock = record.session.blocks.find((block) => block.author?.kind === "assistant-manual")!;
  const receipt = await f.store.db
    .prepare("SELECT receipt FROM receipts WHERE id=?")
    .get(manualBlock.id);
  await f.store.db.prepare("DELETE FROM assistant_session_receipts").run();
  await f.store.save(
    { ...record, revision: record.revision + 1, runId: JSON.parse(receipt!.receipt).runId },
    { type: "fixture.staleRun" },
  );
  await f.assistant.tick();
  expect(awake).toHaveBeenLastCalledWith(false);
  f.turns[1].finish();
  await f.engine.waitForRun(f.sessionId, owner.runId);
});

it("fences revoked/replaced grants, changed execution source and newly acquired canonical task ownership", async () => {
  const f = await setup();
  const grant = await f.enroll();
  await f.manual.revoke({ id: grant.id, expectedVersion: grant.version }, "owner");
  await expect(f.manual.resolveStatus(grant.id, f.sessionId, grant.version)).rejects.toThrow(
    "revoked",
  );
  const renewed = await f.enroll();
  expect(renewed.id).not.toBe(grant.id);
  await expect(f.manual.resolveStatus(grant.id, f.sessionId)).rejects.toThrow("revoked");
  expect(await f.manual.listAllForUsage()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: grant.id, active: false }),
      expect.objectContaining({ id: renewed.id, active: true }),
    ]),
  );
  const current = await f.store.session(f.sessionId);
  await f.store.save(
    {
      ...current,
      revision: current.revision + 1,
      session: { ...current.session, model: "claude:changed" },
    },
    { type: "fixture.changedModel" },
  );
  await expect(f.manual.resolveStatus(renewed.id, f.sessionId)).rejects.toThrow("identity changed");
  const latest = await f.enroll();
  await f.store.db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  await f.store.db
    .prepare("INSERT INTO tasks VALUES('canonical',?)")
    .run(JSON.stringify({ reviewer: { sessionId: f.sessionId } }));
  await expect(f.manual.resolveStatus(latest.id, f.sessionId)).rejects.toThrow("canonical");
  expect((await f.candidate()).eligible).toBe(false);
});

it("sends only through a real explicit manual grant, stamps truthful author provenance and escalates after two nudges", async () => {
  const f = await setup(),
    grant = await f.enroll();
  for (let index = 0; index < 2; index++) {
    const sending = f.nudge(grant.id, `nudge-${index}`);
    await vi.waitFor(() => expect(f.turns).toHaveLength(index + 1));
    f.turns[index].input.onAccepted?.();
    expect((await sending).operation?.delivery).toBe("delivered");
    f.turns[index].finish();
    await f.engine.waitForRun(f.sessionId, (await f.store.session(f.sessionId)).runId);
  }
  const record = await f.store.session(f.sessionId),
    authored = record.session.blocks.filter((block) => block.author?.kind === "assistant-manual");
  expect(authored).toHaveLength(2);
  expect(authored[0].author).toMatchObject({
    kind: "assistant-manual",
    supervisionId: grant.id,
    name: "Manual fixture",
  });
  expect(authored[0].author).not.toHaveProperty("jobId");
  expect(
    record.session.blocks.find((block) => block.id === "prior-owner")?.turnMetrics?.inputTokens,
  ).toBe(500000);
  expect(
    (await f.assistant.request({ op: "snapshot" }, "owner")).snapshot!.usage.workerTokens,
  ).toBeLessThan(500000);
  await expect(f.nudge(grant.id, "third-nudge")).rejects.toThrow("two-nudge limit");
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.turns).toHaveLength(2);
  f.setEnabled(false);
  await expect(f.nudge(grant.id, "disabled")).rejects.toThrow("disabled");
});

it("steers an explicitly enrolled active owner turn without cancelling it and fences later policy revocation", async () => {
  const f = await setup(),
    grant = await f.enroll();
  const receipt = await f.engine.command({
    type: "send",
    commandId: "owner-active",
    sessionId: f.sessionId,
    text: "Owner's active work",
  });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  f.turns[0].input.onAccepted?.();
  const result = await f.nudge(grant.id, "active-manual-steer");
  expect(result.operation?.delivery, undefined).toBe("delivered");
  expect(f.provider.steer).toHaveBeenCalledOnce();
  expect(f.turns).toHaveLength(1);
  expect((await f.store.session(f.sessionId)).runId).toBe(receipt.runId);
  expect(f.provider.cancel).not.toHaveBeenCalled();
  f.setEnabled(false);
  await expect(f.nudge(grant.id, "disabled-during-owner-turn")).rejects.toThrow("disabled");
  expect(f.provider.cancel).not.toHaveBeenCalled();
  f.turns[0].finish();
  await f.engine.waitForRun(f.sessionId, receipt.runId);
});

it("compacts and continues large manual histories through the same guarded runtime without creating tasks", async () => {
  for (const used of [160000, 420000]) {
    const f = await setup(),
      grant = await f.enroll(),
      current = await f.store.session(f.sessionId);
    await f.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: { ...current.session, context: { used, window: 1000000 } },
      },
      { type: "fixture.largeContext" },
    );
    f.provider.compact = vi.fn(async (input) => {
      input.onEvent({ type: "context", used: 1000, window: 1000000 });
    });
    const sending = f.nudge(grant.id, `context-${used}`);
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    f.turns[0].input.onAccepted?.();
    expect((await sending).operation).toMatchObject({
      action: used === 160000 ? "compact" : "handoff",
      delivery: "delivered",
    });
    const record = await f.store.session(f.sessionId);
    expect(record.session.blocks.find((block) => block.id === "prior-owner")?.text).toBe(
      "Original owner work must remain intact",
    );
    if (used === 160000)
      expect(
        record.session.blocks.find((block) => block.text === "/compact")?.author,
      ).toMatchObject({ kind: "assistant-manual", supervisionId: grant.id });
    else expect(f.turns[0].input.text).toContain("bycoda.manual-continuation.v1");
    expect(
      await f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),
    ).toBeUndefined();
    f.turns[0].finish();
    await f.engine.waitForRun(f.sessionId, record.runId);
  }
});

it("rechecks grant revocation after the engine queue while preserving owner drafts and approval state", async () => {
  const f = await setup(),
    grant = await f.enroll(),
    hold = Promise.withResolvers<void>(),
    entered = Promise.withResolvers<void>();
  const queue = (
    f.engine as unknown as {
      operations: { run: (id: string, work: () => Promise<void>) => Promise<void> };
    }
  ).operations.run(f.sessionId, async () => {
    entered.resolve();
    await hold.promise;
  });
  await entered.promise;
  const sending = f.nudge(grant.id, "queued-manual");
  try {
    await vi.waitFor(async () =>
      expect(
        await f.store.db.prepare("SELECT id FROM assistant_session_receipts LIMIT 1").get(),
      ).toBeTruthy(),
    );
    await f.manual.revoke({ id: grant.id, expectedVersion: grant.version }, "owner");
  } finally {
    hold.resolve();
  }
  await queue;
  expect((await sending).operation?.delivery).toBe("unknown");
  expect(f.turns).toHaveLength(0);
  const renewed = await f.enroll(),
    record = await f.store.session(f.sessionId);
  await f.store.save(
    {
      ...record,
      revision: record.revision + 1,
      session: {
        ...record.session,
        blocks: [
          ...record.session.blocks,
          { id: "owner-draft", role: "user", text: "Do not send or erase this draft", draft: true },
        ],
      },
    },
    { type: "fixture.draft" },
  );
  const result = await f.nudge(renewed.id, "owner-draft-present");
  expect(result.operation?.delivery).toBe("unknown");
  expect(
    (await f.store.session(f.sessionId)).session.blocks.find((block) => block.id === "owner-draft")
      ?.text,
  ).toBe("Do not send or erase this draft");
  expect(f.turns).toHaveLength(0);
});
