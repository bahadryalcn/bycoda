import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeOutputFrame,
  getNativeOutputEventOrigin,
} from "../../core/nativeOutputDelivery.testSupport";
import {
  sent,
  onLine,
  onExit,
  killChild,
  writeChild,
  saveGeneratedImage,
  respondCodexQuestion,
  sendCodexTurn,
  stopCodexSession,
  __codexTestReset,
  parse,
  reply,
  notify,
  startTurn,
  waitFor,
  clearOnLine,
} from "./codexLive.testSupport";

describe("Codex failure recovery", () => {
  beforeEach(() => {
    sent.length = 0;
    clearOnLine();
    writeChild.mockClear();
    killChild.mockClear();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await stopCodexSession("codex-warm");
    await stopCodexSession("codex-timeout");
    __codexTestReset();
  });
  it("a rejected Codex turn does not restart the app-server", async () => {
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

  it("Codex timeout retires the old process and isolates the late notification", async () => {
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
  it("Full Access MCP typed form waits for the user's answer and sends no invalid content", async () => {
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
      () =>
        events.some((event) => event.type === "question.updated" && event.delivery === "failed"),
      "corrected form",
    );
    expect(parse().some((message) => message.id === 902 && message.result)).toBe(false);
    expect(events.some((event) => event.type === "question.resolved")).toBe(false);
    const retry = question;
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
    "MCP typed form clears the pending question during %s",
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

it("retains each Native notification origin through delayed image and ordered queue application", async () => {
  __codexTestReset();
  sent.length = 0;
  clearOnLine();
  writeChild.mockImplementation(async (_id, line) => {
    sent.push(line);
  });
  let release!: () => void;
  saveGeneratedImage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ path: "/app-data/generated-images/image.png", mimeType: "image/png", size: 8 });
      }),
  );
  const { events, turn } = await startTurn("codex-causal");
  const imageLine = JSON.stringify({
    method: "item/completed",
    params: { item: { id: "causal-image", type: "imageGeneration", result: "aW1hZ2U=" } },
  });
  const image = nativeOutputFrame("codex-causal", imageLine, () => onLine!(imageLine));
  const textLine = JSON.stringify({
    method: "item/agentMessage/delta",
    params: { itemId: "causal-text", delta: "after causal image" },
  });
  const text = nativeOutputFrame("codex-causal", textLine, () => onLine!(textLine));
  expect(image().pendingCausalWork).toBeGreaterThan(0);
  expect(text().pendingCausalWork).toBeGreaterThan(0);
  expect(events.some((e) => e.type === "message.delta" && e.text === "after causal image")).toBe(
    false,
  );
  release();
  await waitFor(
    () => events.some((e) => e.type === "message.delta" && e.text === "after causal image"),
    "causal queue",
  );
  const imageEvent = events.find((e) => e.type === "image.generated")!;
  const textEvent = events.find(
    (e) => e.type === "message.delta" && e.text === "after causal image",
  )!;
  expect(getNativeOutputEventOrigin(imageEvent)).not.toBeNull();
  expect(getNativeOutputEventOrigin(textEvent)).not.toBeNull();
  expect(getNativeOutputEventOrigin(imageEvent)).not.toBe(getNativeOutputEventOrigin(textEvent));
  await vi.waitFor(() => {
    expect(image().pendingCausalWork).toBe(0);
    expect(text().pendingCausalWork).toBe(0);
  });
  notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
  await turn;
  await stopCodexSession("codex-causal");
  __codexTestReset();
});
