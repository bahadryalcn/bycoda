import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  lines: [] as string[],
  onLine: undefined as ((line: string) => void) | undefined,
  bridge: vi.fn(async (_sessionId: string) => null),
  kill: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("../../core/socialBridge", () => ({
  socialBridge: mock.bridge,
  socialCliHint: () => "",
  socialAcpServers: () => [],
}));
vi.mock("../../core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: mock.kill,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    mock.onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    mock.lines.push(line);
  },
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
}));

const codex = await import("./codex");
const registry = await import("../../core/registry");
const frames = () => mock.lines.map((line) => JSON.parse(line));
function reply(method: string, value: unknown) {
  const frame = frames().findLast((frame) => frame.method === method);
  mock.onLine!(JSON.stringify({ id: frame.id, result: value }));
}
async function waitFor(method: string) {
  await vi.waitFor(() => expect(frames().some((frame) => frame.method === method)).toBe(true));
}
async function handshake(resume = false) {
  await waitFor("initialize");
  reply("initialize", {});
  const method = resume ? "thread/resume" : "thread/start";
  await waitFor(method);
  reply(method, { thread: { id: "thr_cancel_test" } });
}
function input(sessionId: string, onAccepted = vi.fn()) {
  return {
    harness: "codex" as const,
    sessionId,
    cwd: "/repo",
    model: "codex:gpt-5.4",
    runtimeMode: "supervised" as const,
    text: "Safe mocked prompt",
    onEvent: vi.fn(),
    onAccepted,
  };
}
function complete(id: string) {
  mock.onLine!(
    JSON.stringify({
      method: "turn/completed",
      params: {
        threadId: "thr_cancel_test",
        turn: { id, status: "completed" },
      },
    }),
  );
}

describe("Codex native commands and cancellation ownership", () => {
  beforeEach(() => {
    mock.lines.length = 0;
    mock.onLine = undefined;
    mock.kill.mockClear();
    mock.bridge.mockReset().mockResolvedValue(null);
    codex.__codexTestReset();
    registry.resetHarnessIdlePark();
    registry.registerHarness({
      id: "codex",
      live: true,
      sendTurn: codex.sendCodexTurn,
      steerTurn: codex.steerCodexTurn,
      cancelTurn: codex.cancelCodexTurn,
      stopSession: codex.stopCodexSession,
      forgetSession: codex.forgetCodexSession,
      bindSession: codex.bindCodexSession,
      respondApproval: codex.respondCodexApproval,
    });
  });
  afterEach(async () => {
    await codex.forgetCodexSession("cancel-test");
    registry.resetHarnessIdlePark();
    codex.__codexTestReset();
  });

  it.each([
    { text: "/goal", method: "thread/goal/get", params: {} },
    { text: "/goal status", method: "thread/goal/get", params: {} },
    { text: "/goal pause", method: "thread/goal/set", params: { status: "paused" } },
    { text: "/goal clear", method: "thread/goal/clear", params: {} },
  ])(
    "executes $text without a model turn despite runtime instructions",
    async ({ text, method, params }) => {
      const request = input("cancel-test");
      const run = codex.sendCodexTurn({
        ...request,
        text,
        runtimeInstructions: "Trusted policy and log guidance.",
      });
      await handshake();
      await waitFor(method);
      expect(frames().find((frame) => frame.method === method).params).toEqual({
        threadId: "thr_cancel_test",
        ...params,
      });
      reply(method, { goal: { objective: "Finish review", status: "active", tokensUsed: 42 } });
      await run;
      expect(frames().some((frame) => frame.method === "turn/start")).toBe(false);
      expect(request.onAccepted).toHaveBeenCalledOnce();
      expect(request.onEvent).toHaveBeenCalledWith({ type: "message.completed" });
    },
  );

  it.each([
    { text: "/goal Finish review", prompt: "Finish review", objective: "Finish review" },
    {
      text: "/goal resume",
      prompt: "Continue working toward the active goal.",
      objective: undefined,
    },
  ])(
    "executes $text and adds guidance only to the model prompt",
    async ({ text, prompt, objective }) => {
      const request = input("cancel-test");
      const run = codex.sendCodexTurn({
        ...request,
        text,
        runtimeInstructions: "Trusted policy and log guidance.",
      });
      await handshake();
      await waitFor("thread/goal/set");
      expect(frames().find((frame) => frame.method === "thread/goal/set").params).toEqual({
        threadId: "thr_cancel_test",
        status: "active",
        ...(objective ? { objective } : {}),
      });
      expect(frames().some((frame) => frame.method === "turn/start")).toBe(false);
      reply("thread/goal/set", { goal: { objective: "Finish review", status: "active" } });
      await waitFor("turn/start");
      expect(frames().find((frame) => frame.method === "turn/start").params.input).toEqual([
        { type: "text", text: `Trusted policy and log guidance.\n\n${prompt}` },
      ]);
      reply("turn/start", { turn: { id: "turn_goal" } });
      complete("turn_goal");
      await run;
      expect(request.onAccepted).toHaveBeenCalledOnce();
    },
  );

  it.each(["Inspect this change", "$review inspect this change"])(
    "keeps ordinary prompt and skill inputs with guidance: %s",
    async (text) => {
      const run = codex.sendCodexTurn({
        ...input("cancel-test"),
        text,
        runtimeInstructions: "Trusted policy and log guidance.",
      });
      await handshake();
      await waitFor("skills/list");
      reply("skills/list", {
        data: [
          {
            cwd: "/repo",
            skills: [{ name: "review", path: "/repo/.agents/skills/review/SKILL.md" }],
          },
        ],
      });
      await waitFor("turn/start");
      expect(frames().find((frame) => frame.method === "turn/start").params.input).toEqual([
        { type: "text", text: `Trusted policy and log guidance.\n\n${text}` },
        ...(text.startsWith("$review")
          ? [{ type: "skill", name: "review", path: "/repo/.agents/skills/review/SKILL.md" }]
          : []),
      ]);
      expect(frames().some((frame) => frame.method.startsWith("thread/goal/"))).toBe(false);
      reply("turn/start", { turn: { id: "turn_prompt" } });
      complete("turn_prompt");
      await run;
    },
  );

  it("delivers the next prompt after Stop during deferred social bridge lookup", async () => {
    let finishBridge!: (value: null) => void;
    mock.bridge.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          finishBridge = resolve;
        }),
    );
    const first = registry.sendHarnessTurn(input("cancel-test"));
    const cancelled = expect(first).rejects.toThrow("Turn cancelled before it started");
    await vi.waitFor(() => expect(mock.bridge).toHaveBeenCalledOnce());
    await registry.cancelHarnessTurn("codex", "cancel-test");
    finishBridge(null);
    await cancelled;
    expect(frames()).toHaveLength(0);

    const accepted = vi.fn();
    const next = registry.sendHarnessTurn(input("cancel-test", accepted));
    await handshake();
    await waitFor("turn/start");
    reply("turn/start", { turn: { id: "turn_next" } });
    complete("turn_next");
    await next;
    expect(frames().filter((frame) => frame.method === "turn/start")).toHaveLength(1);
    expect(accepted).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "stops a pending turn/start and suppresses late acceptance; notified ID=%s",
    async (notifiedId) => {
      const accepted = vi.fn();
      const request = input("cancel-test", accepted);
      const run = registry.sendHarnessTurn(request);
      await handshake();
      await waitFor("turn/start");
      const oldOnLine = mock.onLine!;
      const startId = frames().find((frame) => frame.method === "turn/start").id;
      if (notifiedId) {
        oldOnLine(
          JSON.stringify({
            method: "turn/started",
            params: {
              threadId: "thr_cancel_test",
              turn: { id: "turn_stopped", status: "inProgress" },
            },
          }),
        );
      }
      const cancelling = registry.cancelHarnessTurn("codex", "cancel-test");
      if (notifiedId) {
        await waitFor("turn/interrupt");
        expect(frames().find((frame) => frame.method === "turn/interrupt").params).toEqual({
          threadId: "thr_cancel_test",
          turnId: "turn_stopped",
        });
        reply("turn/interrupt", {});
      }
      await cancelling;
      expect(mock.kill).toHaveBeenCalledTimes(notifiedId ? 0 : 1);
      oldOnLine(JSON.stringify({ id: startId, result: { turn: { id: "turn_stopped" } } }));
      await run;
      expect(accepted).not.toHaveBeenCalled();

      // A cancelled startup owns its transport; late frames cannot settle its replacement.
      mock.lines.length = 0;
      const nextAccepted = vi.fn();
      const next = registry.sendHarnessTurn(input("cancel-test", nextAccepted));
      if (!notifiedId) await handshake(true);
      await waitFor("turn/start");
      reply("turn/start", { turn: { id: "turn_next" } });
      await vi.waitFor(() => expect(nextAccepted).toHaveBeenCalledOnce());
      if (!notifiedId) {
        oldOnLine(
          JSON.stringify({
            method: "turn/completed",
            params: {
              threadId: "thr_cancel_test",
              turn: { id: "turn_stopped", status: "completed" },
            },
          }),
        );
        let settled = false;
        void next.then(() => {
          settled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
      }
      complete("turn_next");
      await next;
      expect(nextAccepted).toHaveBeenCalledOnce();
    },
  );

  it("cancels adapter startup before thread identity without consuming a later prompt", async () => {
    const accepted = vi.fn();
    const run = registry.sendHarnessTurn(input("cancel-test", accepted));
    await waitFor("initialize");
    reply("initialize", {});
    await waitFor("thread/start");
    await registry.cancelHarnessTurn("codex", "cancel-test");
    reply("thread/start", { thread: { id: "thr_cancel_test" } });
    await run;
    expect(frames().some((frame) => frame.method === "turn/start")).toBe(false);
    expect(accepted).not.toHaveBeenCalled();

    const nextAccepted = vi.fn();
    const next = registry.sendHarnessTurn(input("cancel-test", nextAccepted));
    await waitFor("turn/start");
    reply("turn/start", { turn: { id: "turn_next" } });
    complete("turn_next");
    await next;
    expect(nextAccepted).toHaveBeenCalledOnce();
  });

  it("cancels a warm adapter before its scheduled turn starts", async () => {
    const first = codex.sendCodexTurn(input("cancel-test"));
    await handshake();
    await waitFor("turn/start");
    reply("turn/start", { turn: { id: "turn_first" } });
    complete("turn_first");
    await first;
    mock.lines.length = 0;

    const accepted = vi.fn();
    const cancelled = codex.sendCodexTurn(input("cancel-test", accepted));
    await codex.cancelCodexTurn("cancel-test");
    await cancelled;
    expect(frames().some((frame) => frame.method === "turn/start")).toBe(false);
    expect(accepted).not.toHaveBeenCalled();
    const next = codex.sendCodexTurn(input("cancel-test", accepted));
    await waitFor("turn/start");
    reply("turn/start", { turn: { id: "turn_next" } });
    complete("turn_next");
    await next;
    expect(accepted).toHaveBeenCalledOnce();
  });
});
