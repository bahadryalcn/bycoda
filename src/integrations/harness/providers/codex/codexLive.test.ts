import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number | null, reason?: string) => void) | undefined;
const killChild = vi.fn(async () => undefined);
const writeChild = vi.fn(async (_id: string, line: string) => {
  sent.push(line);
});
const saveGeneratedImage = vi.hoisted(() =>
  vi.fn(async () => ({
    path: "/app-data/generated-images/image.png",
    mimeType: "image/png",
    size: 8,
  })),
);
const deleteGeneratedImages = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void, exit: typeof onExit) => {
    onLine = line;
    onExit = exit;
  },
  writeChild,
}));

vi.mock("../../../../platform/tauri/fs", () => ({
  saveGeneratedImage,
  deleteGeneratedImages,
}));

const {
  compactCodexContext,
  bindCodexSession,
  cancelCodexTurn,
  keepCodexQuestionOpen,
  respondCodexApproval,
  respondCodexQuestion,
  rewindCodexLastTurn,
  sendCodexTurn,
  stopCodexSession,
  __codexTestReset,
} = await import("./codex");
import type { HarnessEvent } from "../../core/types";
import {
  newSession,
  type RuntimeMode,
  type TurnIntent,
} from "../../../../features/sessions/model/session";
import { applyHarnessEvent } from "../../core/apply";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}
function notifyAsyncQuestion(id: string, turnId = "turn_1") {
  notify("item/completed", {
    threadId: "thr_1",
    turnId,
    item: {
      type: "agentMessage",
      id,
      text: "Which source?\n- Local\n- Remote",
      delivery: "async",
      questions: [{ title: "Which source?", options: ["Local", "Remote"] }],
    },
  });
}
function withoutTurnIdentity(events: HarnessEvent[]) {
  return events.filter((event) => event.type !== "turn.started");
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    resume?: boolean;
    providerAccountId?: string;
    resumeProviderAccountId?: string;
    expectResume?: boolean;
    beforeThreadReply?: () => Promise<void>;
    onAccepted?: () => void;
    controlsAgents?: boolean;
    text?: string;
    model?: string;
    resolvedModel?: string;
    skillPolicy?: { disabledNames: string[]; disabledPaths: string[] };
  } = {},
) {
  const events: HarnessEvent[] = [];
  if (options.resume) {
    bindCodexSession(sessionId, "thr_1", "/repo", options.resumeProviderAccountId);
  }
  const turn = sendCodexTurn({
    sessionId,
    cwd: "/repo",
    model: options.model ?? "codex:gpt-5.4",
    modelSettings: {},
    skillPolicy: options.skillPolicy,
    providerAccountId: options.providerAccountId,
    runtimeMode: options.runtimeMode ?? "supervised",
    controlsAgents: options.controlsAgents,
    intent: options.intent,
    text: options.text ?? "summarize the changelog",
    attachments: [],
    onAccepted: options.onAccepted,
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  if (options.skillPolicy) {
    await waitFor(() => parse().some((m) => m.method === "config/read"), "skill configuration");
    reply(parse().find((m) => m.method === "config/read")!.id as number, {
      config: { skills: { config: [{ path: "/skills/owner-off/SKILL.md", enabled: false }] } },
    });
    await waitFor(() => parse().some((m) => m.method === "skills/list"), "policy skill list");
    reply(parse().find((m) => m.method === "skills/list")!.id as number, {
      data: [
        {
          skills: [
            { name: "good-css", path: "/skills/good-css/SKILL.md", enabled: true },
            { name: "review", path: "/skills/review/SKILL.md", enabled: true },
          ],
        },
      ],
    });
  }
  const threadMethod = (options.expectResume ?? options.resume) ? "thread/resume" : "thread/start";
  await waitFor(() => parse().some((m) => m.method === threadMethod), threadMethod);
  await options.beforeThreadReply?.();
  reply(parse().find((m) => m.method === threadMethod)!.id as number, {
    thread: { id: "thr_1" },
    model: options.resolvedModel,
  });

  if (options.text?.startsWith("/goal ")) {
    await waitFor(() => parse().some((m) => m.method === "thread/goal/set"), "goal set");
    reply(parse().find((m) => m.method === "thread/goal/set")!.id as number, {
      goal: {
        objective: options.text.slice(6),
        status: "active",
        tokensUsed: 0,
      },
    });
  }
  if (options.text?.startsWith("$")) {
    await waitFor(() => parse().some((m) => m.method === "skills/list"), "skills/list");
    expect(parse().some((m) => m.method === "turn/start")).toBe(false);
    reply(parse().find((m) => m.method === "skills/list")!.id as number, {
      data: [
        {
          cwd: "/repo",
          skills: [{ name: "review", path: "/skills/review/SKILL.md", enabled: true }],
        },
      ],
    });
  }

  await waitFor(() => parse().some((m) => m.method === "turn/start"), "turn/start");
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  return { events, turn };
}

describe("codex live turn sequence", () => {
  it.each([true, false])(
    "applies current bycoda skill restrictions (%s) on resume without removing native owner disables",
    async (disabled) => {
      const { turn } = await startTurn("codex-policy", {
        resume: true,
        skillPolicy: { disabledNames: disabled ? ["good-css"] : [], disabledPaths: [] },
      });
      const params = parse().find((entry) => entry.method === "thread/resume")!.params as Record<
        string,
        unknown
      >;
      expect(params.config).toEqual({
        "skills.config": [
          { path: "/skills/owner-off/SKILL.md", enabled: false },
          ...(disabled ? [{ path: "/skills/good-css/SKILL.md", enabled: false }] : []),
        ],
      });
      expect(parse().some((entry) => entry.method === "skills/config/write")).toBe(false);
      // Replacing developer_instructions would drop Codex's built-in mode prompt.
      expect(parse().find((entry) => entry.method === "turn/start")?.params).toMatchObject({
        collaborationMode: { settings: { developer_instructions: null } },
      });
      notify("turn/completed", { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it("uses the server-resolved model for native plan mode when selection is empty", async () => {
    const { turn } = await startTurn("native-plan-model", {
      model: "",
      resolvedModel: "native-configured-model",
      intent: "plan",
    });
    expect(parse().find((m) => m.method === "turn/start")?.params).toMatchObject({
      collaborationMode: { mode: "plan", settings: { model: "native-configured-model" } },
      sandboxPolicy: { type: "readOnly" },
    });
    notify("turn/completed", { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } });
    await turn;
  });
  it("publishes aggregate parent turn metrics without including child usage", async () => {
    const { events, turn } = await startTurn("codex-usage", { resume: true });
    const usage = (threadId: string, input: number, cached: number, output: number) =>
      notify("thread/tokenUsage/updated", {
        threadId,
        turnId: "turn_1",
        tokenUsage: {
          last: { inputTokens: 1_000, cachedInputTokens: 800, outputTokens: 100 },
          total: { inputTokens: input, cachedInputTokens: cached, outputTokens: output },
        },
      });
    usage("thr_1", 11_000, 9_800, 1_100);
    usage("child_1", 100_000, 90_000, 10_000);
    usage("thr_1", 12_000, 10_600, 1_200);
    usage("thr_1", 12_000, 10_600, 1_200);
    notify("turn/completed", { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } });
    await turn;
    const metrics = events.filter((event) => event.type === "turn.metrics");
    expect(metrics).toHaveLength(3);
    expect(metrics.at(-1)).toEqual({
      type: "turn.metrics",
      inputTokens: 2_000,
      cacheReadTokens: 1_600,
      outputTokens: 200,
      cacheHitPercent: 80,
    });
  });

  it.each(["status", "pause", "clear"])(
    "handles /goal %s without starting an agent turn",
    async (action) => {
      const { turn } = await startTurn("codex-live");
      notify("turn/completed", {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "completed" },
      });
      await turn;
      const events: HarnessEvent[] = [];
      const command = sendCodexTurn({
        sessionId: "codex-live",
        cwd: "/repo",
        model: "codex:gpt-5.4",
        runtimeMode: "supervised",
        text: `/goal ${action}`,
        attachments: [],
        onEvent: (event) => events.push(event),
      });
      const method = `thread/goal/${action === "status" ? "get" : action === "pause" ? "set" : "clear"}`;
      await waitFor(() => parse().some((m) => m.method === method), method);
      reply(parse().find((m) => m.method === method)!.id as number, {
        goal: {
          objective: "Ship",
          status: action === "pause" ? "paused" : "active",
          tokensUsed: 10,
        },
      });
      await command;
      expect(parse().filter((m) => m.method === "turn/start")).toHaveLength(1);
      expect(events).toContainEqual({ type: "message.completed" });
      expect(
        events.some(
          (event) =>
            event.type === "message.delta" &&
            event.text.includes(action === "clear" ? "cleared" : "Ship"),
        ),
      ).toBe(true);
    },
  );
  it("sets a persistent goal before starting work and sends the objective as turn text", async () => {
    const { turn } = await startTurn("codex-live", {
      text: "/goal keep tests green",
    });
    const set = parse().find((m) => m.method === "thread/goal/set")!;
    expect(set.params).toEqual({
      threadId: "thr_1",
      objective: "keep tests green",
      status: "active",
    });
    const start = parse().find((m) => m.method === "turn/start")!;
    expect((start.params as { input: unknown }).input).toEqual([
      { type: "text", text: "keep tests green" },
    ]);
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it("waits for the first skill list and refreshes edited skills on the next turn", async () => {
    const { turn } = await startTurn("codex-live", {
      text: "$review inspect this",
    });
    const start = parse().find((m) => m.method === "turn/start")!;
    expect((start.params as { input: unknown[] }).input).toContainEqual({
      type: "skill",
      name: "review",
      path: "/skills/review/SKILL.md",
    });
    expect(parse().find((m) => m.method === "skills/list")!.params).toEqual({
      cwds: ["/repo"],
      forceReload: true,
    });
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    const next = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "$review again",
      attachments: [],
      onEvent: () => {},
    });
    await waitFor(
      () => parse().filter((m) => m.method === "skills/list").length === 2,
      "skills refresh",
    );
    reply(parse().filter((m) => m.method === "skills/list")[1]!.id as number, {
      data: [{ skills: [{ name: "review", path: "/new/review/SKILL.md" }] }],
    });
    await waitFor(
      () => parse().filter((m) => m.method === "turn/start").length === 2,
      "second turn",
    );
    const second = parse().filter((m) => m.method === "turn/start")[1]!;
    expect((second.params as { input: unknown[] }).input).toContainEqual({
      type: "skill",
      name: "review",
      path: "/new/review/SKILL.md",
    });
    reply(second.id as number, { turn: { id: "turn_2" } });
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_2", status: "completed" },
    });
    await next;
  });
  it("fails an unanswered startup instead of holding the session queue forever", async () => {
    vi.useFakeTimers();
    try {
      const turn = sendCodexTurn({
        sessionId: "unanswered",
        cwd: "/repo",
        model: "codex:test",
        runtimeMode: "supervised",
        text: "hello",
        attachments: [],
        onEvent: () => undefined,
      });
      const outcome = turn.catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await outcome).toContain("initialize response timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not apply the startup deadline to an accepted long running turn", async () => {
    const { turn } = await startTurn("long-running");
    vi.useFakeTimers();
    try {
      let settled = false;
      void turn.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(180_000);
      expect(settled).toBe(false);
      notify("turn/completed", {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "completed" },
      });
      await turn;
    } finally {
      vi.useRealTimers();
    }
  });
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    writeChild.mockClear();
    saveGeneratedImage.mockClear();
    deleteGeneratedImages.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await stopCodexSession("codex-live");
    __codexTestReset();
  });

  it("reports when the provider accepts a turn", async () => {
    const onAccepted = vi.fn();
    const { turn } = await startTurn("codex-live", { onAccepted });

    await waitFor(() => onAccepted.mock.calls.length === 1, "turn acceptance");
    expect(onAccepted).toHaveBeenCalledOnce();
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([
    ["Provider stdout message exceeded the 64 MiB limit; Bycoda host stopped the process."],
    [undefined],
  ])("reports the process exit reason during an active turn: %s", async (reason) => {
    const { turn } = await startTurn("codex-exit-reason");
    const failed = expect(turn).rejects.toThrow(reason ?? "Codex app-server exited (exit code 1)");
    onExit!(1, reason);
    await failed;
  });

  it("reopens a thread when app access changes its network policy", async () => {
    const first = await startTurn("codex-live", { runtimeMode: "auto" });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await first.turn;

    sent.length = 0;
    const appTurn = await startTurn("codex-live", {
      runtimeMode: "auto",
      controlsAgents: true,
      expectResume: true,
    });
    expect(parse().find((message) => message.method === "thread/resume")?.params).toMatchObject({
      sandboxPolicy: { networkAccess: true },
    });
    expect(parse().find((message) => message.method === "turn/start")?.params).toMatchObject({
      sandboxPolicy: { networkAccess: true },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await appTurn.turn;

    sent.length = 0;
    const ordinaryTurn = await startTurn("codex-live", {
      runtimeMode: "auto",
      expectResume: true,
    });
    expect(parse().find((message) => message.method === "thread/resume")?.params).toMatchObject({
      sandboxPolicy: { type: "workspaceWrite" },
    });
    expect(
      (
        parse().find((message) => message.method === "thread/resume")?.params as {
          sandboxPolicy: Record<string, unknown>;
        }
      ).sandboxPolicy,
    ).not.toHaveProperty("networkAccess");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await ordinaryTurn.turn;
  });

  it("materializes image generations before completing the turn", async () => {
    const { events, turn } = await startTurn("codex-live");

    notify("item/completed", {
      item: {
        id: "image_1",
        type: "imageGeneration",
        result: "aW1hZ2U=",
        revisedPrompt: "A clean product photo",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    expect(saveGeneratedImage).toHaveBeenCalledWith({
      data: "aW1hZ2U=",
      name: "generated-image",
    });
    expect(events).toContainEqual({
      type: "image.generated",
      itemId: "image_1",
      path: "/app-data/generated-images/image.png",
      name: "generated-image",
      mimeType: "image/png",
      size: 8,
      alt: "A clean product photo",
    });
    expect(events.reduce(applyHarnessEvent, newSession("codex", "/repo")).blocks).toMatchObject([
      {
        role: "image",
        image: {
          path: "/app-data/generated-images/image.png",
          mimeType: "image/png",
        },
      },
    ]);
  });

  it("keeps later notifications ordered after delayed image materialization", async () => {
    let release: (() => void) | undefined;
    saveGeneratedImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              path: "/app-data/generated-images/image.png",
              mimeType: "image/png",
              size: 8,
            });
        }),
    );
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", {
      item: { id: "image_1", type: "imageGeneration", result: "aW1hZ2U=" },
    });
    notify("item/agentMessage/delta", {
      itemId: "after_image",
      delta: "after image",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await Promise.resolve();

    expect(
      events.some((event) => event.type === "message.delta" && event.text === "after image"),
    ).toBe(false);
    release?.();
    await turn;
    await Promise.resolve();
    notify("item/agentMessage/delta", {
      itemId: "post_turn",
      delta: "post turn",
    });

    expect(
      events.some((event) => event.type === "message.delta" && event.text === "post turn"),
    ).toBe(true);
  });

  it("cleans up an image that finishes saving after cancellation", async () => {
    let release: (() => void) | undefined;
    saveGeneratedImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              path: "/app-data/generated-images/image.png",
              mimeType: "image/png",
              size: 8,
            });
        }),
    );
    const { turn } = await startTurn("codex-live");
    notify("item/completed", {
      item: { id: "image_1", type: "imageGeneration", result: "aW1hZ2U=" },
    });
    const cancelling = cancelCodexTurn("codex-live");
    await waitFor(
      () => parse().some((message) => message.method === "turn/interrupt"),
      "interrupt",
    );
    reply(parse().find((message) => message.method === "turn/interrupt")!.id as number, {});
    await cancelling;
    release?.();
    await turn;

    expect(deleteGeneratedImages).toHaveBeenCalledWith(["/app-data/generated-images/image.png"]);
  });

  it("does not flush queued notifications after the session stops", async () => {
    let release: (() => void) | undefined;
    saveGeneratedImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              path: "/app-data/generated-images/image.png",
              mimeType: "image/png",
              size: 8,
            });
        }),
    );
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", {
      item: { id: "image_1", type: "imageGeneration", result: "aW1hZ2U=" },
    });
    notify("item/agentMessage/delta", {
      itemId: "after_image",
      delta: "after image",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await stopCodexSession("codex-live");
    release?.();
    await turn;
    await Promise.resolve();

    expect(
      events.some((event) => event.type === "message.delta" && event.text === "after image"),
    ).toBe(false);
    expect(events.some((event) => event.type === "image.generated")).toBe(false);
    expect(deleteGeneratedImages).toHaveBeenCalledWith(["/app-data/generated-images/image.png"]);
  });

  it.each([
    { name: "fully streamed", chunks: ["Here is the ", "final answer."] },
    { name: "partially streamed", chunks: ["Here is the "] },
    { name: "completion only", chunks: [] },
  ])("emits a $name final answer once after commentary", async ({ chunks }) => {
    const { events, turn } = await startTurn("codex-live");
    const commentary = "I'll inspect the workspace first.\n\n";
    const answer = "Here is the final answer.";
    notify("item/agentMessage/delta", {
      itemId: "commentary",
      delta: commentary,
    });
    notify("item/completed", {
      item: { id: "commentary", type: "agentMessage", text: commentary },
    });
    for (const delta of chunks) {
      notify("item/agentMessage/delta", { itemId: "final", delta });
    }
    // A repeated completion must also be harmless.
    for (let i = 0; i < 2; i++) {
      notify("item/completed", {
        item: { id: "final", type: "agentMessage", text: answer },
      });
    }
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => event.text)
        .join(""),
    ).toBe(commentary + answer);
    const session = events.reduce(applyHarnessEvent, newSession("codex", "/repo"));
    expect(session.blocks).toMatchObject([
      { role: "assistant", text: commentary, streaming: false },
      { role: "assistant", text: answer, streaming: false },
    ]);
  });

  it("keeps streamed Codex updates separate when completion snapshots are omitted", async () => {
    const { events, turn } = await startTurn("codex-live");
    for (const [id, text] of [
      ["commentary_1", "Inspecting the session."],
      ["commentary_2", "Found the cause."],
      ["answer", "Fixed and verified."],
    ]) {
      notify("item/agentMessage/delta", { itemId: id, delta: text });
      notify("item/completed", { item: { id, type: "agentMessage" } });
    }
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    const session = events.reduce(applyHarnessEvent, newSession("codex", "/repo"));
    expect(
      session.blocks.filter((block) => block.role === "assistant").map((block) => block.text),
    ).toEqual(["Inspecting the session.", "Found the cause.", "Fixed and verified."]);
  });

  it("keeps completion history for separate items and preserves repeated tokens", async () => {
    const { events, turn } = await startTurn("codex-live");
    const complete = (id: string, text: string) =>
      notify("item/completed", {
        item: { id, type: "agentMessage", text },
      });
    complete("first", "Earlier commentary.\n\n");
    for (const delta of ["very ", "very ", "good."]) {
      notify("item/agentMessage/delta", { itemId: "second", delta });
    }
    complete("first", "Earlier commentary.\n\n");
    complete("second", "very very good.");
    // The same text in a different item is real new output.
    complete("third", "Earlier commentary.\n\n");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    expect(
      events.filter((event) => event.type === "message.delta").map((event) => event.text),
    ).toEqual(["Earlier commentary.\n\n", "very ", "very ", "good.", "Earlier commentary.\n\n"]);
  });

  it("deduplicates reasoning completions per item", async () => {
    const { events, turn } = await startTurn("codex-live");
    for (const [itemId, text] of [
      ["reason_1", "First thought."],
      ["reason_2", "Next thought."],
    ]) {
      notify("item/reasoning/summaryTextDelta", {
        itemId,
        summaryIndex: 0,
        delta: text,
      });
      notify("item/completed", {
        item: {
          id: itemId,
          type: "reasoning",
          summary: [{ type: "summary_text", text }],
        },
      });
    }
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    expect(
      events.filter((event) => event.type === "reasoning.delta").map((event) => event.text),
    ).toEqual(["First thought.", "Next thought."]);
  });

  it("resets text tracking between turns when an item id is reused", async () => {
    const itemId = "reused_item";
    const { events, turn } = await startTurn("codex-live");
    const text = "The answer.";
    const complete = () =>
      notify("item/completed", {
        item: { id: itemId, type: "agentMessage", text },
      });
    notify("item/agentMessage/delta", { itemId, delta: text });
    complete();
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    const nextTurn = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "Repeat the answer",
      onEvent: (event) => events.push(event),
    });
    await waitFor(() => parse().filter((m) => m.method === "turn/start").length === 2, "next turn");
    const request = parse().filter((m) => m.method === "turn/start")[1];
    reply(request.id as number, { turn: { id: "turn_2" } });
    notify("turn/started", { turn: { id: "turn_2" } });
    complete();
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await nextTurn;
    expect(
      events.filter((event) => event.type === "message.delta").map((event) => event.text),
    ).toEqual([text, text]);
  });

  it("keeps retries and HTTP fallback out of a successful turn's transcript", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { events, turn } = await startTurn("codex-live");
    const settled = vi.fn();
    void turn.then(settled);
    const beforeRetries = [...events];
    for (let attempt = 1; attempt <= 5; attempt++) {
      notify("error", {
        threadId: "thr_1",
        turnId: "turn_1",
        error: { message: `Reconnecting... ${attempt}/5` },
        willRetry: true,
      });
    }
    const fallback =
      "Falling back from WebSockets to HTTPS transport. unexpected status 404 Not Found: Unknown endpoint: GET /v1/responses, url: ws://127.0.0.1:19101/v1/responses";
    notify("warning", { threadId: "thr_1", message: fallback });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    // Retries surface only as a transient status, never as transcript events.
    const retryStatus = (event: unknown) =>
      (event as { type?: string; key?: string }).type === "status" &&
      (event as { key?: string }).key === "provider-retry";
    expect(withoutTurnIdentity(events.filter((event) => !retryStatus(event)))).toEqual(
      withoutTurnIdentity(beforeRetries),
    );
    expect(events.filter(retryStatus).at(-1)).toMatchObject({ text: "Reconnecting... 5/5" });
    expect(debug).toHaveBeenCalledTimes(6);
    expect(debug).toHaveBeenCalledWith(expect.any(String), fallback);

    notify("item/agentMessage/delta", { delta: "The answer" });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    expect(settled).toHaveBeenCalledOnce();
    const session = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/repo", "codex:gpt-5.4", "supervised"),
    );
    expect(session.blocks).toMatchObject([
      { role: "assistant", text: "The answer", streaming: false },
    ]);
  });

  it("resumes a legacy thread when the missing account resolves to default", async () => {
    const { turn } = await startTurn("codex-live", {
      resume: true,
      providerAccountId: "default",
    });
    expect(parse().some((message) => message.method === "thread/resume")).toBe(true);
    expect(parse().some((message) => message.method === "thread/start")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("continues the stored thread without requesting its image-heavy transcript", async () => {
    const { turn } = await startTurn("codex-metadata-resume", { resume: true });
    expect(parse().find((message) => message.method === "thread/resume")?.params).toMatchObject({
      threadId: "thr_1",
      excludeTurns: true,
    });
    expect(parse().find((message) => message.method === "turn/start")?.params).toMatchObject({
      threadId: "thr_1",
    });
    expect(parse().some((message) => message.method === "thread/start")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("does not resume a legacy default thread under a named account", async () => {
    const { turn } = await startTurn("codex-live", {
      resume: true,
      providerAccountId: "account-work",
      expectResume: false,
    });
    expect(parse().some((message) => message.method === "thread/start")).toBe(true);
    expect(parse().some((message) => message.method === "thread/resume")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("still surfaces a terminal failure after transport retries", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { events, turn } = await startTurn("codex-live");
    notify("error", {
      error: { message: "Reconnecting... 5/5" },
      willRetry: true,
    });
    const message = "Response stream disconnected after too many failed attempts";
    notify("error", { error: { message }, willRetry: false });
    expect(events).toContainEqual({ type: "session.error", message });
    notify("turn/completed", {
      turn: { id: "turn_1", status: "failed", error: { message } },
    });
    await turn;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/repo", "codex:gpt-5.4", "supervised"),
    );
    expect(session.blocks).toContainEqual(
      expect.objectContaining({ role: "system", text: message }),
    );
    expect(session.blocks.some((block) => block.text.includes("Reconnecting"))).toBe(false);
  });

  it.each([false, true])(
    "answers the external clock before thread setup finishes, resume=%s",
    async (resume) => {
      vi.spyOn(Date, "now").mockReturnValue(1_789_000_000_789);
      const { events, turn } = await startTurn("codex-live", {
        resume,
        beforeThreadReply: async () => {
          onLine!(
            JSON.stringify({
              id: "clock_setup",
              method: "currentTime/read",
              params: { threadId: "thr_1" },
            }),
          );
          await Promise.resolve();
        },
      });
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
      expect(parse().find((m) => m.id === "clock_setup")).toEqual({
        id: "clock_setup",
        result: { currentTimeAt: 1_789_000_000 },
      });
      expect(events.some((e) => e.type === "session.error")).toBe(false);
    },
  );

  it("shows async questions without blocking later messages and steers with the answer", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    expect(question).toMatchObject({
      callId: "async_question",
      questions: [{ id: "q1", prompt: "Which source?", allowCustom: true }],
    });
    expect(question.autoResolveAt).toBeUndefined();
    notify("item/agentMessage/delta", {
      itemId: "next",
      delta: "Still working",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      text: "Still working",
    });
    expect(parse().some((message) => message.method === "turn/steer")).toBe(false);
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Remote"] },
    });
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Remote"] },
    });
    const steer = parse().find((message) => message.method === "turn/steer")!;
    expect(steer.params).toEqual({
      threadId: "thr_1",
      expectedTurnId: "turn_1",
      input: [{ type: "text", text: "Which source?\nRemote" }],
    });
    expect(parse().filter((message) => message.method === "turn/steer")).toHaveLength(1);
    expect(events.some((event) => event.type === "question.resolved")).toBe(false);
    reply(steer.id as number, {});
    await waitFor(
      () => events.some((event) => event.type === "question.resolved"),
      "async answer acceptance",
    );
    expect(events).toContainEqual({
      type: "question.resolved",
      requestId: question.requestId,
      decision: "answered",
      reply: { kind: "answered", answers: { q1: ["Remote"] } },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("queues async and server-request questions together and ignores repeated snapshots", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_first");
    notifyAsyncQuestion("async_first");
    onLine!(
      JSON.stringify({
        id: "legacy_question",
        method: "item/tool/requestUserInput",
        params: {
          questions: [{ id: "legacy", question: "Continue?", options: null }],
        },
      }),
    );
    notifyAsyncQuestion("async_last");
    const asked = () => events.filter((event) => event.type === "question.asked");
    expect(asked()).toHaveLength(1);
    respondCodexQuestion("codex-live", asked()[0].requestId, {
      kind: "skipped",
    });
    await waitFor(() => asked().length === 2, "queued server question");
    expect(asked()[1].questions[0].id).toBe("legacy");
    respondCodexQuestion("codex-live", asked()[1].requestId, {
      kind: "skipped",
    });
    await waitFor(() => asked().length === 3, "queued async question");
    expect(parse().find((message) => message.id === "legacy_question")?.result).toEqual({
      answers: {},
    });
    expect(asked()[2].callId).toBe("async_last");
    respondCodexQuestion("codex-live", asked()[2].requestId, {
      kind: "skipped",
    });
    await waitFor(
      () => events.filter((event) => event.type === "question.resolved").length === 3,
      "question queue cleanup",
    );
    notifyAsyncQuestion("async_first");
    expect(asked()).toHaveLength(3);
    expect(parse().some((message) => message.method === "turn/steer")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("keeps an async question available when sending its answer fails", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    const answer = {
      kind: "answered" as const,
      answers: {},
      custom: { q1: "Another source" },
    };
    respondCodexQuestion("codex-live", question.requestId, answer);
    const steer = parse().find((message) => message.method === "turn/steer")!;
    onLine!(
      JSON.stringify({
        id: steer.id,
        error: { code: -32602, message: "Try again" },
      }),
    );
    await waitFor(
      () => events.some((event) => event.type === "status"),
      "failed async answer delivery",
    );
    expect(events.some((event) => event.type === "question.resolved")).toBe(false);
    expect(events).toContainEqual({
      type: "status",
      text: "Could not send your answer to Codex: Try again",
    });
    respondCodexQuestion("codex-live", question.requestId, answer);
    const retry = parse().filter((message) => message.method === "turn/steer")[1];
    expect(retry.params).toMatchObject({
      input: [{ type: "text", text: "Which source?\nAnother source" }],
    });
    reply(retry.id as number, {});
    await waitFor(
      () => events.some((event) => event.type === "question.resolved"),
      "retried async answer",
    );
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([false, true])("keeps async questions open with interaction=%s", async (interact) => {
    const { events, turn } = await startTurn("codex-live");
    vi.useFakeTimers();
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    await vi.advanceTimersByTimeAsync(60_000);
    if (interact) keepCodexQuestionOpen("codex-live", question.requestId);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.some((event) => event.type === "question.resolved")).toBe(false);
    expect(parse().some((message) => message.method === "turn/steer")).toBe(false);
    respondCodexQuestion("codex-live", question.requestId, { kind: "skipped" });
    await vi.advanceTimersByTimeAsync(0);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("keeps an async question after immediate completion and resumes with the answer", async () => {
    const onAccepted = vi.fn();
    const { events, turn } = await startTurn("codex-live", { onAccepted });
    let settled = false;
    void turn.then(() => {
      settled = true;
    });
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.some((event) => event.type === "question.resolved")).toBe(false);
    expect(settled).toBe(false);
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Remote"] },
    });
    await waitFor(
      () => parse().filter((message) => message.method === "turn/start").length === 2,
      "answer continuation",
    );
    const continuation = parse().filter((message) => message.method === "turn/start")[1];
    expect(continuation.params).toMatchObject({
      threadId: "thr_1",
      input: [{ type: "text", text: "Which source?\nRemote" }],
      model: "gpt-5.4",
    });
    expect(parse().some((message) => message.method === "turn/steer")).toBe(false);
    reply(continuation.id as number, { turn: { id: "turn_2" } });
    notify("turn/started", { turn: { id: "turn_2", status: "inProgress" } });
    // Asking again in the continuation must survive its immediate completion too.
    notifyAsyncQuestion("async_question", "turn_2");
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    const questions = events.filter((event) => event.type === "question.asked");
    expect(questions).toHaveLength(2);
    expect(questions[1].requestId).not.toBe(question.requestId);
    respondCodexQuestion("codex-live", questions[1].requestId, { kind: "skipped" });
    await turn;
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "question.resolved",
      requestId: question.requestId,
      decision: "answered",
      reply: { kind: "answered", answers: { q1: ["Remote"] } },
    });
  });

  it("waits for all queued async replies after completion and sends each answer once", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("first");
    notifyAsyncQuestion("second");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    const asked = () => events.filter((event) => event.type === "question.asked");
    respondCodexQuestion("codex-live", asked()[0].requestId, {
      kind: "answered",
      answers: { q1: ["Local"] },
    });
    respondCodexQuestion("codex-live", asked()[0].requestId, {
      kind: "answered",
      answers: { q1: ["Local"] },
    });
    await waitFor(() => asked().length === 2, "second async question");
    expect(parse().filter((message) => message.method === "turn/start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "question.resolved")).toHaveLength(1);
    respondCodexQuestion("codex-live", asked()[1].requestId, { kind: "skipped" });
    await waitFor(
      () => parse().filter((message) => message.method === "turn/start").length === 2,
      "queued answer continuation",
    );
    const continuation = parse().filter((message) => message.method === "turn/start")[1];
    expect(continuation.params).toMatchObject({
      input: [{ type: "text", text: "Which source?\nLocal" }],
    });
    reply(continuation.id as number, { turn: { id: "turn_2" } });
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await turn;
  });

  it("stops a completed turn waiting for an async answer without starting another turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("async_question");
    const question = events.find((event) => event.type === "question.asked")!;
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await cancelCodexTurn("codex-live");
    await turn;
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { q1: ["Local"] },
    });
    expect(parse().filter((message) => message.method === "turn/start")).toHaveLength(1);
    expect(parse().some((message) => message.method === "turn/interrupt")).toBe(false);
  });

  it.each(["cancel", "stop", "interrupted", "failed"])(
    "clears async questions on %s without sending a stale answer",
    async (action) => {
      const { events, turn } = await startTurn("codex-live");
      notifyAsyncQuestion("async_question");
      const question = events.find((event) => event.type === "question.asked")!;
      if (action === "cancel") {
        const cancel = cancelCodexTurn("codex-live");
        const interrupt = parse().find((message) => message.method === "turn/interrupt")!;
        reply(interrupt.id as number, {});
        await cancel;
      } else if (action === "stop") await stopCodexSession("codex-live");
      else
        notify("turn/completed", {
          turn: { id: "turn_1", status: action },
        });
      await turn;
      await waitFor(
        () => events.some((event) => event.type === "question.resolved"),
        "async question cancellation",
      );
      respondCodexQuestion("codex-live", question.requestId, {
        kind: "answered",
        answers: { q1: ["Local"] },
      });
      expect(events).toContainEqual({
        type: "question.resolved",
        requestId: question.requestId,
        decision: "cancelled",
      });
      expect(parse().some((message) => message.method === "turn/steer")).toBe(false);
    },
  );

  it("ignores async questions from a different turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    notifyAsyncQuestion("old_question", "turn_old");
    expect(events.some((event) => event.type === "question.asked")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([undefined, "plan"] as const)(
    "answers fresh clock reads without interrupting a pending question, intent=%s",
    async (intent) => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_789_000_000_789);
      const { events, turn } = await startTurn("codex-live", { intent });
      expect(parse().find((m) => m.method === "initialize")?.params).toMatchObject({
        capabilities: { experimentalApi: true },
      });
      expect(parse().find((m) => m.method === "turn/start")?.params).toMatchObject({
        collaborationMode: { mode: intent === "plan" ? "plan" : "default" },
      });
      onLine!(
        JSON.stringify({
          id: "pending_question",
          method: "item/tool/requestUserInput",
          params: {
            itemId: "q1",
            questions: [{ id: "choice", header: "Source", question: "Which source?" }],
          },
        }),
      );
      await waitFor(() => events.some((e) => e.type === "question.asked"), "question");
      const beforeClock = [...events];
      for (const [id, millis] of [
        [91, 1_789_000_000_789],
        ["clock_next", 1_789_000_005_123],
      ] as const) {
        now.mockReturnValue(millis);
        onLine!(
          JSON.stringify({
            id,
            method: "currentTime/read",
            params: { threadId: "thr_1" },
          }),
        );
        await waitFor(() => parse().some((m) => m.id === id), "external clock reply");
        expect(parse().find((m) => m.id === id)).toEqual({
          id,
          result: { currentTimeAt: Math.floor(millis / 1000) },
        });
      }
      expect(events).toEqual(beforeClock);
      expect(parse().some((m) => m.id === "pending_question")).toBe(false);
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it.each([false, true])("routes full-access escalation after resume=%s", async (resume) => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "full-access",
      resume,
    });
    for (const message of parse().filter((m) =>
      ["thread/start", "thread/resume", "turn/start"].includes(String(m.method)),
    )) {
      expect(message.params).toMatchObject({
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      });
    }
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "read_1", command: "git status --short" },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 91), "full-access response");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      decision: "accept",
    });
    expect(events.some((e) => e.type === "approval.requested")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("still waits for an explicit command decision in supervised mode", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd_1", command: "git status --short" },
      }),
    );
    await waitFor(() => events.some((e) => e.type === "approval.requested"), "approval UI");
    expect(parse().some((m) => m.id === 91)).toBe(false);
    const request = events.find((e) => e.type === "approval.requested")!;
    if (request.type !== "approval.requested") throw new Error("missing approval");
    respondCodexApproval("codex-live", request.requestId, "deny");
    await waitFor(() => parse().some((m) => m.id === 91), "denial");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      decision: "decline",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each(["allow", "deny"] as const)(
    "keeps a child approval answerable after a sibling completes: %s",
    async (decision) => {
      const { events, turn } = await startTurn("codex-live");
      const settled = vi.fn();
      void turn.then(settled);
      onLine!(
        JSON.stringify({
          id: "child_approval",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_child",
            turnId: "turn_child",
            itemId: "child_read",
            command: "cat ~/.gitconfig",
          },
        }),
      );
      const approval = events.find((event) => event.type === "approval.requested")!;
      expect(approval).toMatchObject({ callId: "child_read" });
      const before = [...events];
      notify("turn/started", {
        threadId: "thr_sibling",
        turn: { id: "turn_sibling" },
      });
      notify("item/agentMessage/delta", {
        threadId: "thr_sibling",
        delta: "Child-only text",
      });
      notify("turn/completed", {
        threadId: "thr_sibling",
        turn: { id: "turn_sibling", status: "completed" },
      });
      notify("error", {
        threadId: "thr_sibling",
        error: { message: "Child failed" },
        willRetry: false,
      });
      await Promise.resolve();
      expect(withoutTurnIdentity(events)).toEqual(withoutTurnIdentity(before));
      expect(settled).not.toHaveBeenCalled();
      respondCodexApproval("codex-live", approval.requestId, decision);
      await waitFor(
        () => parse().some((message) => message.id === "child_approval"),
        "child decision",
      );
      expect(parse().find((message) => message.id === "child_approval")?.result).toEqual({
        decision: decision === "allow" ? "accept" : "decline",
      });
      notify("turn/completed", {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "completed" },
      });
      await turn;
    },
  );

  it("clears a server-resolved child approval using its owning thread", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: "child_approval",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thr_child",
          itemId: "child_read",
          command: "cat ~/.gitconfig",
        },
      }),
    );
    const approval = events.find((event) => event.type === "approval.requested")!;
    notify("serverRequest/resolved", {
      threadId: "thr_1",
      requestId: "child_approval",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.some((event) => event.type === "approval.resolved")).toBe(false);
    notify("serverRequest/resolved", {
      threadId: "thr_child",
      requestId: "child_approval",
    });
    await waitFor(
      () => events.some((event) => event.type === "approval.resolved"),
      "child cleanup",
    );
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: approval.requestId,
      decision: "cancelled",
    });
    expect(parse().some((message) => message.id === "child_approval")).toBe(false);
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it.each(["allow", "deny"] as const)(
    "answers a child's filesystem permission request: %s",
    async (decision) => {
      const { events, turn } = await startTurn("codex-live");
      const permissions = { fileSystem: { read: ["/home/user/.gitconfig"] } };
      onLine!(
        JSON.stringify({
          id: "child_permissions",
          method: "item/permissions/requestApproval",
          params: {
            threadId: "thr_child",
            turnId: "turn_child",
            itemId: "child_read",
            permissions,
          },
        }),
      );
      const approval = events.find((event) => event.type === "approval.requested")!;
      respondCodexApproval("codex-live", approval.requestId, decision);
      await waitFor(
        () => parse().some((message) => message.id === "child_permissions"),
        "filesystem permission response",
      );
      expect(parse().find((message) => message.id === "child_permissions")?.result).toEqual(
        decision === "allow" ? { scope: "turn", permissions } : { permissions: {} },
      );
      notify("turn/completed", {
        threadId: "thr_1",
        turn: { id: "turn_1", status: "completed" },
      });
      await turn;
    },
  );

  it("advances the question queue when the server resolves a child's request", async () => {
    const { events, turn } = await startTurn("codex-live");
    for (const id of ["child_a", "child_b"]) {
      onLine!(
        JSON.stringify({
          id,
          method: "item/tool/requestUserInput",
          params: {
            threadId: id,
            questions: [{ id: "q", question: id, isOther: true, options: [] }],
          },
        }),
      );
    }
    notify("serverRequest/resolved", {
      threadId: "child_a",
      requestId: "child_a",
    });
    await waitFor(
      () => events.filter((event) => event.type === "question.asked").length === 2,
      "second child question",
    );
    const session = events.reduce(applyHarnessEvent, newSession("codex", "/repo"));
    expect(session.pendingQuestion?.questions[0].prompt).toBe("child_b");
    expect(parse().some((message) => message.id === "child_a")).toBe(false);
    respondCodexQuestion("codex-live", session.pendingQuestion!.requestId, {
      kind: "skipped",
    });
    await waitFor(
      () => parse().some((message) => message.id === "child_b"),
      "second child response",
    );
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it("fails the active turn if a child permission reply cannot be delivered", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: "child_approval",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thr_child",
          itemId: "child_read",
          command: "cat ~/.gitconfig",
        },
      }),
    );
    const approval = events.find((event) => event.type === "approval.requested")!;
    let outcome: unknown;
    void turn.catch((error) => {
      outcome = error;
    });
    writeChild.mockRejectedValueOnce(new Error("Broken pipe"));
    respondCodexApproval("codex-live", approval.requestId, "allow");
    await waitFor(() => outcome instanceof Error, "failed permission delivery");
    expect(outcome).toMatchObject({ message: "Broken pipe" });
    expect(events).toContainEqual({
      type: "session.error",
      message: "Broken pipe",
    });
  });

  it.each([undefined, "plan"] as const)(
    "waits for user input in full-access intent=%s",
    async (intent) => {
      const { events, turn } = await startTurn("codex-live", {
        runtimeMode: "full-access",
        intent,
      });
      onLine!(
        JSON.stringify({
          id: "question_rpc",
          method: "item/tool/requestUserInput",
          params: {
            itemId: "question_1",
            questions: [
              {
                id: "permission",
                header: "Access",
                question: "Read the external source?",
                isOther: true,
                isSecret: false,
                options: [
                  { label: "Accept", description: "Read the source." },
                  { label: "Decline", description: "Skip." },
                ],
              },
            ],
          },
        }),
      );
      await waitFor(() => events.some((e) => e.type === "question.asked"), "question UI");
      expect(parse().some((m) => m.id === "question_rpc")).toBe(false);
      const request = events.find((e) => e.type === "question.asked")!;
      if (request.type !== "question.asked") throw new Error("missing question");
      respondCodexQuestion("codex-live", request.requestId, {
        kind: "answered",
        answers: { permission: ["Decline"] },
      });
      await waitFor(() => parse().some((m) => m.id === "question_rpc"), "question response");
      expect(parse().find((m) => m.id === "question_rpc")?.result).toEqual({
        answers: { permission: { answers: ["Decline"] } },
      });
      expect(events).toContainEqual({
        type: "question.resolved",
        requestId: request.requestId,
        decision: "answered",
        reply: { kind: "answered", answers: { permission: ["Decline"] } },
      });
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it.each(["skip", "server", "complete", "stop", "cancel"])(
    "clears pending questions on %s",
    async (action) => {
      const { events, turn } = await startTurn("codex-live");
      onLine!(
        JSON.stringify({
          id: 91,
          method: "item/tool/requestUserInput",
          params: {
            itemId: "q1",
            questions: [
              {
                id: "q",
                question: "Which source?",
                isSecret: false,
                isOther: true,
                options: null,
              },
            ],
          },
        }),
      );
      await waitFor(() => events.some((e) => e.type === "question.asked"), "question UI");
      const request = events.find((e) => e.type === "question.asked")!;
      if (request.type !== "question.asked") throw new Error("missing question");
      if (action === "skip")
        respondCodexQuestion("codex-live", request.requestId, {
          kind: "skipped",
        });
      if (action === "server")
        notify("serverRequest/resolved", { threadId: "thr_1", requestId: 91 });
      if (action === "complete")
        notify("turn/completed", {
          turn: { id: "turn_1", status: "completed" },
        });
      if (action === "stop") await stopCodexSession("codex-live");
      if (action === "cancel") {
        const cancelled = cancelCodexTurn("codex-live");
        await waitFor(() => parse().some((m) => m.method === "turn/interrupt"), "interrupt");
        reply(parse().find((m) => m.method === "turn/interrupt")!.id as number, {});
        await cancelled;
      }
      await waitFor(() => events.some((e) => e.type === "question.resolved"), "question cleanup");
      expect(events).toContainEqual({
        type: "question.resolved",
        requestId: request.requestId,
        decision: action === "skip" ? "skipped" : "cancelled",
      });
      if (action === "skip")
        expect(parse().find((m) => m.id === 91)?.result).toEqual({
          answers: {},
        });
      else expect(parse().some((m) => m.id === 91)).toBe(false);
      respondCodexQuestion("codex-live", request.requestId, {
        kind: "answered",
        answers: {},
        custom: { q: "too late" },
      });
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
      expect(parse().filter((m) => m.id === 91)).toHaveLength(action === "skip" ? 1 : 0);
    },
  );

  it("does not collect secret answers in the transcript question UI", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            {
              id: "secret",
              question: "Enter a secret",
              isSecret: true,
              options: null,
            },
          ],
        },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 91), "unsupported secret response");
    expect(events.some((e) => e.type === "question.asked")).toBe(false);
    expect(events).toContainEqual({
      type: "status",
      text: expect.stringContaining("secret input"),
    });
    expect(parse().find((m) => m.id === 91)?.result).toEqual({ answers: {} });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("auto-approves full-access file and permission requests", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "full-access",
    });
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/fileChange/requestApproval",
        params: { itemId: "edit_1", reason: "Edit the requested file" },
      }),
    );
    const permissions = { network: { enabled: true } };
    onLine!(
      JSON.stringify({
        id: 92,
        method: "item/permissions/requestApproval",
        params: { itemId: "perm_1", permissions },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 92), "permission grant");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      decision: "accept",
    });
    expect(parse().find((m) => m.id === 92)?.result).toEqual({
      scope: "session",
      permissions,
    });
    expect(events.some((e) => e.type === "approval.requested")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("queues concurrent questions instead of hiding the first one", async () => {
    const { events, turn } = await startTurn("codex-live");
    for (const id of [91, 92])
      onLine!(
        JSON.stringify({
          id,
          method: "item/tool/requestUserInput",
          params: {
            questions: [
              {
                id: `q${id}`,
                question: `Question ${id}`,
                options: null,
                isOther: true,
              },
            ],
          },
        }),
      );
    const asked = () => events.filter((e) => e.type === "question.asked");
    expect(asked()).toHaveLength(1);
    respondCodexQuestion("codex-live", asked()[0].requestId, {
      kind: "answered",
      answers: {},
      custom: { q91: "first answer" },
    });
    await waitFor(() => asked().length === 2, "second question");
    respondCodexQuestion("codex-live", asked()[1].requestId, {
      kind: "skipped",
    });
    await waitFor(() => parse().some((m) => m.id === 92), "second reply");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      answers: { q91: { answers: ["first answer"] } },
    });
    expect(parse().find((m) => m.id === 92)?.result).toEqual({ answers: {} });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([false, true])(
    "auto-approves supported MCP confirmations in Full Access, boolean=%s",
    async (boolean) => {
      const { events, turn } = await startTurn("codex-live", {
        runtimeMode: "full-access",
      });
      onLine!(
        JSON.stringify({
          id: 91,
          method: "mcpServer/elicitation/request",
          params: {
            serverName: "example",
            mode: "form",
            message: "Read this source?",
            requestedSchema: boolean
              ? {
                  type: "object",
                  properties: { approved: { type: "boolean" } },
                  required: ["approved"],
                }
              : { type: "object", properties: {} },
          },
        }),
      );
      await waitFor(() => parse().some((m) => m.id === 91), "MCP response");
      expect(parse().find((m) => m.id === 91)?.result).toEqual({
        action: "accept",
        content: boolean ? { approved: true } : {},
        _meta: null,
      });
      expect(events.some((e) => e.type === "approval.requested")).toBe(false);
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it("keeps plan MCP confirmations explicit in Full Access", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "full-access",
      intent: "plan",
    });
    onLine!(
      JSON.stringify({
        id: 91,
        method: "mcpServer/elicitation/request",
        params: {
          serverName: "example",
          mode: "form",
          message: "Read this source?",
          requestedSchema: {
            type: "object",
            properties: { approved: { type: "boolean" } },
            required: ["approved"],
          },
        },
      }),
    );
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "plan MCP approval UI",
    );
    const approval = events.find((event) => event.type === "approval.requested")!;
    respondCodexApproval("codex-live", approval.requestId, "allow");
    await waitFor(() => parse().some((message) => message.id === 91), "MCP response");
    expect(parse().find((message) => message.id === 91)?.result).toEqual({
      action: "accept",
      content: { approved: true },
      _meta: null,
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each([false, true, undefined])(
    "waits for an explicit reply with isBlocking=%s despite autoResolutionMs",
    async (isBlocking) => {
      const { events, turn } = await startTurn("codex-live");
      vi.useFakeTimers();
      onLine!(
        JSON.stringify({
          id: 91,
          method: "item/tool/requestUserInput",
          params: {
            isBlocking,
            autoResolutionMs: 1,
            questions: [{ id: "q", question: "Choose a source", options: null }],
          },
        }),
      );
      const question = events.find((event) => event.type === "question.asked")!;
      expect(question.autoResolveAt).toBeUndefined();
      await vi.advanceTimersByTimeAsync(119_999);
      expect(parse().some((m) => m.id === 91)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(480_000);
      expect(parse().some((m) => m.id === 91)).toBe(false);
      expect(events.some((event) => event.type === "question.resolved")).toBe(false);
      respondCodexQuestion("codex-live", question.requestId, { kind: "skipped" });
      await vi.advanceTimersByTimeAsync(0);
      expect(parse().find((m) => m.id === 91)?.result).toEqual({ answers: {} });
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it("keeps an optional question open after interaction and preserves its answer", async () => {
    const { events, turn } = await startTurn("codex-live");
    vi.useFakeTimers();
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/tool/requestUserInput",
        params: {
          isBlocking: false,
          questions: [{ id: "q", question: "Choose a source", options: null }],
        },
      }),
    );
    const question = events.find((event) => event.type === "question.asked")!;
    await vi.advanceTimersByTimeAsync(60_000);
    keepCodexQuestionOpen("codex-live", question.requestId);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(parse().some((m) => m.id === 91)).toBe(false);
    const state = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/repo", "codex:gpt-5.4", "supervised"),
    );
    expect(state.pendingQuestion?.autoResolveAt).toBeUndefined();
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: {},
      custom: { q: "chosen source" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      answers: { q: { answers: ["chosen source"] } },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("advances queued optional questions only after an explicit reply", async () => {
    const { events, turn } = await startTurn("codex-live");
    vi.useFakeTimers();
    for (const id of [91, 92])
      onLine!(
        JSON.stringify({
          id,
          method: "item/tool/requestUserInput",
          params: {
            isBlocking: false,
            questions: [{ id: "q", question: `Question ${id}`, options: null }],
          },
        }),
      );
    expect(events.filter((event) => event.type === "question.asked")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(parse().some((m) => m.id === 91 || m.id === 92)).toBe(false);
    expect(events.filter((event) => event.type === "question.asked")).toHaveLength(1);
    const first = events.find((event) => event.type === "question.asked")!;
    respondCodexQuestion("codex-live", first.requestId, { kind: "skipped" });
    await vi.advanceTimersByTimeAsync(0);
    expect(parse().filter((m) => m.id === 91)).toHaveLength(1);
    expect(parse().some((m) => m.id === 92)).toBe(false);
    const questions = events.filter((event) => event.type === "question.asked");
    expect(questions).toHaveLength(2);
    expect(questions[1].autoResolveAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(parse().some((m) => m.id === 92)).toBe(false);
    respondCodexQuestion("codex-live", questions[1].requestId, {
      kind: "answered",
      answers: {},
      custom: { q: "Remote" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(parse().filter((m) => m.id === 92)).toHaveLength(1);
    expect(parse().find((m) => m.id === 92)?.result).toEqual({
      answers: { q: { answers: ["Remote"] } },
    });
    expect(
      events.reduce(applyHarnessEvent, newSession("codex", "/repo", "codex:gpt-5.4", "supervised"))
        .pendingQuestion,
    ).toBeUndefined();
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it.each(["answer", "server", "stop", "complete"])(
    "clears optional question timers on %s without a late reply",
    async (action) => {
      const { events, turn } = await startTurn("codex-live");
      vi.useFakeTimers();
      onLine!(
        JSON.stringify({
          id: 91,
          method: "item/tool/requestUserInput",
          params: {
            isBlocking: false,
            questions: [{ id: "q", question: "Choose a source", options: null }],
          },
        }),
      );
      const question = events.find((event) => event.type === "question.asked")!;
      if (action === "answer")
        respondCodexQuestion("codex-live", question.requestId, {
          kind: "skipped",
        });
      if (action === "server")
        notify("serverRequest/resolved", { threadId: "thr_1", requestId: 91 });
      if (action === "stop") await stopCodexSession("codex-live");
      if (action === "complete")
        notify("turn/completed", {
          turn: { id: "turn_1", status: "completed" },
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(240_000);
      respondCodexQuestion("codex-live", question.requestId, {
        kind: "answered",
        answers: {},
        custom: { q: "too late" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(parse().filter((m) => m.id === 91)).toHaveLength(action === "answer" ? 1 : 0);
      expect(events.filter((event) => event.type === "question.resolved")).toHaveLength(1);
      notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
      await turn;
    },
  );

  it("reports unsupported MCP forms instead of returning an empty success", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: 90,
        method: "item/tool/requestUserInput",
        params: {
          questions: [{ id: "q", question: "Choose a name", options: null }],
        },
      }),
    );
    onLine!(
      JSON.stringify({
        id: 91,
        method: "mcpServer/elicitation/request",
        params: {
          mode: "form",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string", pattern: "^[A-Z]+$" } },
            required: ["name"],
          },
        },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 91), "MCP cancel");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      action: "cancel",
      content: null,
      _meta: null,
    });
    expect(events).toContainEqual({
      type: "status",
      text: expect.stringContaining("does not support yet"),
    });
    onLine!(JSON.stringify({ id: 92, method: "future/requestApproval", params: {} }));
    await waitFor(() => parse().some((m) => m.id === 92), "protocol error");
    expect(parse().find((m) => m.id === 92)?.error).toMatchObject({
      code: -32601,
    });
    const session = events.reduce(applyHarnessEvent, {
      ...newSession("codex", "/repo", "codex:gpt-5.4", "supervised"),
      busy: true,
    });
    expect(session.busy).toBe(true);
    expect(session.pendingQuestion?.questions[0].id).toBe("q");
    respondCodexQuestion("codex-live", session.pendingQuestion!.requestId, {
      kind: "answered",
      answers: {},
      custom: { q: "chosen name" },
    });
    await waitFor(() => parse().some((m) => m.id === 90), "remaining answer");
    expect(parse().find((m) => m.id === 90)?.result).toEqual({
      answers: { q: { answers: ["chosen name"] } },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("clears server-resolved approvals without replying twice", async () => {
    const { events, turn } = await startTurn("codex-live");
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd", command: "git status" },
      }),
    );
    const request = events.find((e) => e.type === "approval.requested")!;
    notify("serverRequest/resolved", { threadId: "unrelated", requestId: 91 });
    await Promise.resolve();
    expect(events.some((e) => e.type === "approval.resolved")).toBe(false);
    notify("serverRequest/resolved", { threadId: "thr_1", requestId: 91 });
    await waitFor(() => events.some((e) => e.type === "approval.resolved"), "approval cleanup");
    expect(events).toContainEqual({
      type: "approval.resolved",
      requestId: request.requestId,
      decision: "cancelled",
    });
    respondCodexApproval("codex-live", request.requestId, "allow");
    expect(parse().some((m) => m.id === 91)).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("applies a queued access change only when that turn starts", async () => {
    const { events, turn } = await startTurn("codex-live");
    const queued = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "full-access",
      text: "Continue",
      onEvent: (event) => events.push(event),
    });
    await Promise.resolve();
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd", command: "git status" },
      }),
    );
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "current turn approval",
    );
    expect(parse().some((m) => m.id === 91)).toBe(false);
    const request = events.find((event) => event.type === "approval.requested")!;
    respondCodexApproval("codex-live", request.requestId, "deny");
    await waitFor(() => parse().some((m) => m.id === 91), "current turn decision");
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      decision: "decline",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    await waitFor(
      () => parse().filter((m) => m.method === "turn/start").length === 2,
      "queued turn",
    );
    const next = parse().filter((m) => m.method === "turn/start")[1];
    expect(next.params).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    reply(next.id as number, { turn: { id: "turn_2" } });
    notify("turn/started", { turn: { id: "turn_2" } });
    onLine!(
      JSON.stringify({
        id: 92,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd2", command: "git status" },
      }),
    );
    await waitFor(() => parse().some((m) => m.id === 92), "queued turn approval");
    expect(parse().find((m) => m.id === 92)?.result).toEqual({
      decision: "accept",
    });
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await queued;
  });

  it("stays busy after an agent message until turn/completed", async () => {
    const { events, turn } = await startTurn("codex-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    notify("item/completed", {
      item: {
        id: "msg_1",
        type: "agentMessage",
        text: "I'll inspect the changelog first.",
      },
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false);
    vi.useRealTimers();

    notify("item/started", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "git log -1",
        status: "inProgress",
      },
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(true);

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    expect(settled).toBe(true);
  });

  it("keeps plan turns read-only without surfacing approval prompts", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "auto",
      intent: "plan",
    });
    const turnStart = parse().find((message) => message.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      collaborationMode: { mode: "plan" },
    });

    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd_1", command: "git status --short" },
      }),
    );
    await waitFor(() => parse().some((message) => message.id === 91), "silent plan denial");

    expect(events.some((event) => event.type === "approval.requested")).toBe(false);
    expect(parse().find((message) => message.id === 91)?.result).toEqual({
      decision: "decline",
    });

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it("uses thread/compact/start and waits for its turn to complete", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const compact = compactCodexContext({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () => parse().some((message) => message.method === "thread/compact/start"),
      "thread/compact/start",
    );
    const request = parse().find((message) => message.method === "thread/compact/start")!;
    expect(request.params).toEqual({ threadId: "thr_1" });
    reply(request.id as number, {});

    let settled = false;
    void compact.then(() => {
      settled = true;
    });
    notify("turn/started", {
      turn: { id: "compact_1", status: "inProgress" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    notify("turn/completed", {
      turn: { id: "compact_1", status: "completed" },
    });
    await compact;
    expect(settled).toBe(true);
  });

  it("reverts before the latest user turn after compaction", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const rollback = rewindCodexLastTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () => parse().some((message) => message.method === "thread/turns/list"),
      "thread/turns/list",
    );
    const list = parse().find((message) => message.method === "thread/turns/list")!;
    expect(list.params).toEqual({
      threadId: "thr_1",
      limit: 100,
      sortDirection: "desc",
      itemsView: "summary",
    });
    reply(list.id as number, {
      data: [
        {
          id: "compact_1",
          items: [{ type: "contextCompaction", id: "compact_item" }],
        },
        {
          id: "turn_1",
          items: [{ type: "userMessage", id: "user_item" }],
        },
      ],
    });
    await waitFor(
      () => parse().some((message) => message.method === "thread/revert"),
      "thread/revert",
    );
    const request = parse().find((message) => message.method === "thread/revert")!;
    expect(request.params).toEqual({
      threadId: "thr_1",
      beforeTurnId: "turn_1",
    });
    reply(request.id as number, {});
    expect(await rollback).toEqual({ submitted: false });
  });
  it("uses the persisted provider turn boundary without listing turns", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const rollback = rewindCodexLastTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      providerTurnId: "turn_exact",
      onEvent: () => undefined,
    });
    await waitFor(
      () => parse().some((message) => message.method === "thread/revert"),
      "thread/revert",
    );
    expect(parse().some((message) => message.method === "thread/turns/list")).toBe(false);
    const request = parse().find((message) => message.method === "thread/revert")!;
    expect(request.params).toEqual({
      threadId: "thr_1",
      beforeTurnId: "turn_exact",
    });
    reply(request.id as number, {});
    await expect(rollback).resolves.toEqual({ submitted: false });
  });

  it("rejects editing when the provider exposes no user turn", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const rollback = rewindCodexLastTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () => parse().some((message) => message.method === "thread/turns/list"),
      "thread/turns/list",
    );
    const list = parse().find((message) => message.method === "thread/turns/list")!;
    reply(list.id as number, {
      data: [
        {
          id: "compact_1",
          items: [{ type: "contextCompaction", id: "compact_item" }],
        },
      ],
    });
    await expect(rollback).rejects.toThrow("Codex did not expose a user turn id to edit");
    expect(parse().some((message) => message.method === "thread/revert")).toBe(false);
  });
});

describe("codex subagents", () => {
  it("routes each child's context to its own agent, including readings before spawn metadata", async () => {
    const { events, turn } = await startTurn("s1");
    const usage = (threadId: string, used: number, window = 272_000) =>
      notify("thread/tokenUsage/updated", {
        threadId,
        tokenUsage: { last: { totalTokens: used }, modelContextWindow: window },
      });
    usage("child_a", 12_000);
    for (const [id, child] of [
      ["spawn_a", "child_a"],
      ["spawn_b", "child_b"],
    ]) {
      notify("item/started", {
        threadId: "thr_1",
        item: {
          id,
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "inProgress",
          prompt: "Review",
          agentsStates: { [child]: { status: "running" } },
        },
      });
    }
    usage("child_b", 24_000, 400_000);
    usage("child_a", 6_000);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    expect(events.filter((event) => event.type === "agent.context")).toEqual([
      { type: "agent.context", callId: "spawn_a", used: 12_000, window: 272_000 },
      { type: "agent.context", callId: "spawn_b", used: 24_000, window: 400_000 },
      { type: "agent.context", callId: "spawn_a", used: 6_000, window: 272_000 },
    ]);
    expect(events.filter((event) => event.type === "context")).toEqual([]);
  });
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    writeChild.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await stopCodexSession("s1");
    __codexTestReset();
  });

  it("mirrors a child thread's work onto the row that spawned it", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/started", {
      threadId: "thr_1",
      item: {
        id: "collab_1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        prompt: "Correctness review\n\nLook for regressions in the diff.",
        agentsStates: { thr_child: { status: "running" } },
      },
    });
    notify("item/started", {
      threadId: "thr_child",
      item: {
        id: "child_cmd",
        type: "commandExecution",
        command: "npm test",
        status: "inProgress",
      },
    });
    notify("item/completed", {
      threadId: "thr_child",
      item: {
        id: "child_msg",
        type: "agentMessage",
        text: "No regressions found.",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    // The spawn is named from its brief, not from the tool that made it.
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" &&
          event.kind === "agent" &&
          event.title === "Correctness review",
      ),
    ).toBe(true);

    const steps = events.filter((event) => event.type === "agent.step");
    expect(steps.every((step) => step.callId === "collab_1")).toBe(true);
    expect(steps.map((step) => [step.kind, step.text])).toEqual([
      ["tool", "npm test"],
      ["message", "No regressions found."],
    ]);
  });

  it("materializes images generated by child threads", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/started", {
      threadId: "thr_1",
      item: {
        id: "collab_1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        agentsStates: { thr_child: { status: "running" } },
      },
    });
    notify("item/completed", {
      threadId: "thr_child",
      item: {
        id: "child_image",
        type: "imageGeneration",
        result: "aW1hZ2U=",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    expect(events).toContainEqual({
      type: "image.generated",
      itemId: "child_image",
      path: "/app-data/generated-images/image.png",
      name: "generated-image",
      mimeType: "image/png",
      size: 8,
    });
  });

  it("banks a child's opening moves until its row is known", async () => {
    const { events, turn } = await startTurn("s1");
    notify("thread/started", {
      thread: { id: "thr_child", model: "gpt-5.6-sol" },
    });
    // Codex streams the child's first calls before the spawn item reports
    // which thread it created.
    notify("item/started", {
      threadId: "thr_child",
      item: {
        id: "child_cmd",
        type: "commandExecution",
        command: "git diff",
        status: "inProgress",
      },
    });
    expect(events.some((event) => event.type === "agent.step")).toBe(false);

    notify("item/completed", {
      threadId: "thr_1",
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "started",
        agentPath: "/root/explore-auth",
        agentThreadId: "thr_child",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    const run = events
      .reduce(applyHarnessEvent, newSession("codex", "/repo"))
      .blocks.find((block) => block.tool?.callId === "sa_1")?.agentRun;
    expect(run).toMatchObject({
      name: "Explore Auth subagent",
      model: "gpt-5.6-sol",
    });
    expect(run?.steps).toHaveLength(1);
    const steps = events.filter((event) => event.type === "agent.step");
    expect(steps.map((step) => [step.callId, step.kind, step.text])).toEqual([
      ["sa_1", "tool", "git diff"],
    ]);
  });

  it("shows one row per spawned agent, however Codex describes it", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/started", {
      threadId: "thr_1",
      item: {
        id: "collab_1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        prompt: "Correctness review",
        agentsStates: { thr_child: { status: "running" } },
      },
    });
    // The same agent, described again by the older item type.
    notify("item/completed", {
      threadId: "thr_1",
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "started",
        agentPath: "/root/explore-auth",
        agentThreadId: "thr_child",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    const rows = events.filter(
      (event) =>
        (event.type === "tool.started" || event.type === "tool.updated") && event.kind === "agent",
    );
    // One row, however many times its state is reported.
    expect([...new Set(rows.map((row) => row.callId))]).toEqual(["collab_1"]);
  });

  it("still gives a failed duplicate its own row", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/started", {
      threadId: "thr_1",
      item: {
        id: "collab_1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        status: "inProgress",
        prompt: "Correctness review",
        agentsStates: { thr_child: { status: "running" } },
      },
    });
    notify("item/completed", {
      threadId: "thr_1",
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "interrupted",
        agentThreadId: "thr_child",
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    expect(
      events.some(
        (event) =>
          event.type === "tool.updated" && event.callId === "sa_1" && event.status === "failed",
      ),
    ).toBe(true);
  });

  it("keeps a spawned agent running until its own state says otherwise", async () => {
    const { events, turn } = await startTurn("s1");
    const spawn = {
      id: "collab_1",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      prompt: "Correctness review",
      agentsStates: { thr_child: { status: "running" } },
    };
    notify("item/started", { threadId: "thr_1", item: spawn });
    // The spawn call itself returns almost immediately. The agent it started
    // has not finished, so the row must not settle here.
    notify("item/completed", {
      threadId: "thr_1",
      item: { ...spawn, status: "completed" },
    });
    const beforeWait = events.filter(
      (event) => event.type === "tool.updated" && event.callId === "collab_1",
    );
    expect(beforeWait.every((event) => event.status === "in_progress")).toBe(true);

    // Waiting on the agent is where Codex reports what became of it.
    notify("item/completed", {
      threadId: "thr_1",
      item: {
        id: "collab_2",
        type: "collabAgentToolCall",
        tool: "wait",
        status: "completed",
        receiverThreadIds: ["thr_child"],
        agentsStates: { thr_child: { status: "completed", message: "ok" } },
      },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    const last = events
      .filter(
        (event) =>
          (event.type === "tool.started" || event.type === "tool.updated") &&
          event.callId === "collab_1",
      )
      .at(-1);
    expect(last).toMatchObject({ kind: "agent", status: "completed" });
  });

  it("never leaves an agent row running once the turn is over", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/started", {
      threadId: "thr_1",
      item: {
        id: "collab_1",
        type: "collabAgentToolCall",
        tool: "spawnAgent",
        prompt: "Correctness review",
        agentsStates: { thr_child: { status: "running" } },
      },
    });
    // Codex never reports a closing state for this child.
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    const last = events
      .filter(
        (event) =>
          (event.type === "tool.started" || event.type === "tool.updated") &&
          event.callId === "collab_1",
      )
      .at(-1);
    expect(last).toMatchObject({
      kind: "agent",
      title: "Correctness review",
      status: "completed",
    });
  });

  it("keeps a child thread out of the parent's own transcript", async () => {
    const { events, turn } = await startTurn("s1");
    notify("item/completed", {
      threadId: "thr_1",
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "started",
        agentPath: "/root/explore-auth",
        agentThreadId: "thr_child",
      },
    });
    notify("item/completed", {
      threadId: "thr_child",
      item: { id: "child_msg", type: "agentMessage", text: "Child talking." },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;

    expect(
      events.some(
        (event) => event.type === "message.delta" && event.text.includes("Child talking."),
      ),
    ).toBe(false);
  });
});

describe("Codex failure recovery", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    writeChild.mockClear();
    killChild.mockClear();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await stopCodexSession("codex-warm");
    await stopCodexSession("codex-timeout");
    __codexTestReset();
  });
  it("reddedilen Codex turu app-server'ı yeniden başlatmaz", async () => {
    const { turn } = await startTurn("codex-warm");
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    const input = {
      sessionId: "codex-warm",
      cwd: "/repo",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "again",
      attachments: [],
      onEvent: () => undefined,
    };
    const rejected = sendCodexTurn(input);
    const outcome = rejected.catch((error: Error) => error.message);
    await waitFor(
      () => parse().filter((message) => message.method === "turn/start").length === 2,
      "second turn",
    );
    const second = parse().filter((message) => message.method === "turn/start")[1];
    onLine!(
      JSON.stringify({
        id: second.id,
        error: { code: -32000, message: "usage limit reached" },
      }),
    );
    expect(await outcome).toContain("usage limit reached");
    const next = sendCodexTurn(input);
    await waitFor(
      () => parse().filter((message) => message.method === "turn/start").length === 3,
      "retry turn",
    );
    expect(parse().filter((message) => message.method === "initialize")).toHaveLength(1);
    const third = parse().filter((message) => message.method === "turn/start")[2];
    reply(third.id as number, { turn: { id: "turn_3" } });
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_3", status: "completed" },
    });
    await next;
  });

  it("Codex timeout eski process'i emekliye ayırıp geç bildirimi yalıtır", async () => {
    const { turn } = await startTurn("codex-timeout");
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    const input = {
      sessionId: "codex-timeout",
      cwd: "/repo",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "again",
      attachments: [],
      onEvent: () => undefined,
    };
    killChild.mockClear();
    const oldOnLine = onLine!;
    vi.useFakeTimers();
    try {
      const outcome = sendCodexTurn(input).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await outcome).toContain("turn/start response timed out");
      expect(killChild).toHaveBeenCalledWith("codex-timeout");
    } finally {
      vi.useRealTimers();
    }
    sent.length = 0;
    const next = await startTurn("codex-timeout", { expectResume: true });
    oldOnLine(
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: "thr_1",
          turn: { id: "old-turn", status: "completed" },
        },
      }),
    );
    let completed = false;
    void next.turn.then(() => {
      completed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toBe(false);
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await next.turn;
  });
  it("Full Access MCP typed form kullanıcı yanıtını bekler ve invalid content göndermez", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "full-access",
    });
    const params = {
      threadId: "thr_1",
      mode: "form",
      serverName: "MCP",
      message: "Choose count",
      requestedSchema: {
        type: "object",
        properties: {
          count: { type: "integer", minimum: 1, maximum: 3 },
          name: { type: "string" },
        },
        required: ["count", "name"],
      },
    };
    onLine!(
      JSON.stringify({
        id: 902,
        method: "mcpServer/elicitation/request",
        params,
      }),
    );
    await waitFor(() => events.some((event) => event.type === "question.asked"), "MCP form");
    expect(parse().some((message) => message.id === 902 && message.result)).toBe(false);
    const question = events.find((event) => event.type === "question.asked")!;
    respondCodexQuestion("codex-live", question.requestId, {
      kind: "answered",
      answers: { mcp_field_0: ["__custom__"], mcp_field_1: ["__custom__"] },
      custom: { mcp_field_0: "99", mcp_field_1: "project" },
    });
    await waitFor(
      () => events.filter((event) => event.type === "question.asked").length === 2,
      "corrected form",
    );
    expect(parse().some((message) => message.id === 902 && message.result)).toBe(false);
    const retry = events.filter((event) => event.type === "question.asked")[1];
    respondCodexQuestion("codex-live", retry.requestId, {
      kind: "answered",
      answers: { mcp_field_0: ["__custom__"], mcp_field_1: ["__custom__"] },
      custom: { mcp_field_0: "2", mcp_field_1: "project" },
    });
    await waitFor(
      () => parse().some((message) => message.id === 902 && message.result),
      "MCP response",
    );
    expect(parse().find((message) => message.id === 902)?.result).toEqual({
      action: "accept",
      content: { count: 2, name: "project" },
      _meta: null,
    });
    notify("turn/completed", {
      threadId: "thr_1",
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    await stopCodexSession("codex-live");
  });

  it.each(["skip", "exit"])(
    "MCP typed form %s sırasında pending soruyu temizler",
    async (action) => {
      const { events, turn } = await startTurn("codex-live");
      const outcome = turn.catch(() => undefined);
      onLine!(
        JSON.stringify({
          id: 903,
          method: "mcpServer/elicitation/request",
          params: {
            threadId: "thr_1",
            mode: "form",
            requestedSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
        }),
      );
      await waitFor(() => events.some((event) => event.type === "question.asked"), "MCP form");
      const question = events.find((event) => event.type === "question.asked")!;
      if (action === "skip")
        respondCodexQuestion("codex-live", question.requestId, {
          kind: "skipped",
        });
      else onExit!(1);
      await waitFor(
        () => events.some((event) => event.type === "question.resolved"),
        "MCP cleanup",
      );
      if (action === "skip") {
        await waitFor(
          () => parse().some((message) => message.id === 903 && message.result),
          "MCP cancel",
        );
        expect(parse().find((message) => message.id === 903)?.result).toEqual({
          action: "cancel",
          content: null,
          _meta: null,
        });
        notify("turn/completed", {
          threadId: "thr_1",
          turn: { id: "turn_1", status: "completed" },
        });
      }
      await outcome;
      await stopCodexSession("codex-live");
    },
  );
});
