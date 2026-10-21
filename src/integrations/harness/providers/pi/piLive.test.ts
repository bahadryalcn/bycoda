import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  resolveBinary: vi.fn(),
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));

vi.mock("../../core/child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: mocks.resolveBinary,
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: vi.fn(),
}));

vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(_sessionId: string, onFrame: (record: Record<string, unknown>) => void) {
      mocks.frames.push(onFrame);
    }

    request = mocks.request;
    close = mocks.close;
    pushLine = vi.fn();
    cancelRequest = vi.fn();
  },
}));

import { compactPiContext, stopPiSession, sendPiTurn, cancelPiTurn, rewindPiLastTurn } from "./pi";
import type { HarnessEvent } from "../../core/types";
import { compactOmpContext, stopOmpSession } from "../omp/omp";

describe("Pi live session", () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.request.mockReset();
    mocks.resolveBinary.mockReset();
    mocks.spawnChild.mockReset();
    mocks.killChild.mockReset();
    mocks.frames.length = 0;
    mocks.resolveBinary.mockResolvedValue({ path: "/fake/pi" });
    mocks.spawnChild.mockResolvedValue(undefined);
    mocks.killChild.mockResolvedValue(undefined);
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") {
        return {
          data: {
            sessionId: "pi_session",
            model: { contextWindow: 200_000 },
          },
        };
      }
      if (command.type === "compact") {
        return { data: { estimatedTokensAfter: 32_000 } };
      }
      return { data: {} };
    });
  });

  it("does not reuse the old context window after an OMP provider config model change", async () => {
    const events: HarnessEvent[] = [];
    await compactOmpContext({ sessionId: "pi-model-context", cwd: "/repo", model: "omp:default", runtimeMode: "supervised", onEvent: (event) => events.push(event) });
    expect(events).toContainEqual({ type: "context", used: 32_000, window: 200_000 });
    const frame = mocks.frames[0]!;
    frame({ type: "config_update", model: { provider: "new-provider", id: "new-model" } });
    frame({ type: "message_update", usage: { totalTokens: 100_000 } });
    expect(events.filter((event) => event.type === "context").at(-1)).toEqual({ type: "context", used: 100_000 });
    frame({ type: "config_update", model: { provider: "new-provider", id: "another-model", contextWindow: 400_000 } });
    frame({ type: "message_update", usage: { totalTokens: 100_000 } });
    expect(events.filter((event) => event.type === "context").at(-1)).toEqual({ type: "context", used: 100_000, window: 400_000 });
    await stopOmpSession("pi-model-context");
  });

  it("publishes the resolved Pi default model for provider usage", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state")
        return {
          data: {
            sessionId: "pi_default",
            model: { provider: "openai-codex", id: "gpt-5.4", contextWindow: 200_000 },
          },
        };
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-default",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    expect(events).toContainEqual({
      type: "session.configChanged",
      model: "pi:openai-codex/gpt-5.4",
    });
    await stopPiSession("pi-default");
  });

  it("does not publish an intermediate default when explicit model selection fails", async () => {
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state")
        return {
          data: {
            sessionId: "pi_explicit",
            model: { provider: "anthropic", id: "claude-sonnet-5", contextWindow: 200_000 },
          },
        };
      if (command.type === "set_model") throw new Error("Model unavailable");
      return { data: {} };
    });
    const events: HarnessEvent[] = [];
    await expect(
      compactPiContext({
        sessionId: "pi-explicit",
        cwd: "/repo",
        model: "pi:openai-codex/gpt-5.4",
        runtimeMode: "supervised",
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow("Model unavailable");
    expect(events.filter((event) => event.type === "session.configChanged")).toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith({
      type: "set_model",
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
    await stopPiSession("pi-explicit");
  });

  it("uses the compact RPC command and publishes the post-compact estimate", async () => {
    const events: HarnessEvent[] = [];

    await compactPiContext({
      sessionId: "pi-compact",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

    expect(mocks.request).toHaveBeenCalledWith({ type: "compact" }, 30 * 60_000);
    expect(events).toContainEqual({
      type: "context",
      used: 32_000,
      window: 200_000,
    });
    await stopPiSession("pi-compact");
  });

  it("publishes readable Ponytail status and extension notifications", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-ansi",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    frame({
      type: "extension_ui_request",
      id: "ponytail-status",
      method: "setStatus",
      statusKey: "ponytail",
      statusText:
        "\u001b[38;5;241m○\u001b[39m \u001b[38;5;244mponytail:\u001b[39m \u001b[38;5;188m⚡ FULL\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "plugin-notify",
      method: "notify",
      message: "\u001b[32mPlugin ready\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "empty-status",
      method: "setStatus",
      statusText: "\u001b[0m",
    });
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "ponytail", text: "○ ponytail: ⚡ FULL" },
      { type: "status", text: "Plugin ready" },
    ]);
    await stopPiSession("pi-ansi");
  });

  it("publishes animated extension status as one keyed slot", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-caveman",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    for (const [id, statusText] of [
      ["frame-1", "⠋ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["frame-2", "⠙ \u001b[2mcaveman level: \u001b[0mULTRA"],
      ["clear", ""],
    ]) {
      frame({
        type: "extension_ui_request",
        id,
        method: "setStatus",
        statusKey: "caveman",
        statusText,
      });
    }
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", key: "caveman", text: "⠋ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "⠙ caveman level: ULTRA" },
      { type: "status", key: "caveman", text: "" },
    ]);
    await stopPiSession("pi-caveman");
  });
  it.each(["normal", "cancel"])(
    "aktif tur arkasındaki compact %s sonucuna uyar",
    async (action) => {
      const sessionId = `pi-queued-${action}`;
      const input = {
        sessionId,
        cwd: "/repo",
        model: "pi:default",
        runtimeMode: "supervised" as const,
        onEvent: () => undefined,
      };
      const turn = sendPiTurn({ ...input, text: "hi", attachments: [] });
      for (
        let i = 0;
        i < 30 && !mocks.request.mock.calls.some(([command]) => command.type === "prompt");
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 1));
      const compact = compactPiContext(input);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (action === "cancel") await cancelPiTurn(sessionId);
      else mocks.frames[0]({ type: "agent_end" });
      await turn;
      await compact;
      expect(mocks.request.mock.calls.some(([command]) => command.type === "compact")).toBe(
        action === "normal",
      );
      // A new explicit request after an old cancellation is allowed.
      if (action === "cancel") {
        await compactPiContext(input);
        expect(
          mocks.request.mock.calls.filter(([command]) => command.type === "compact"),
        ).toHaveLength(1);
      }
      await stopPiSession(sessionId);
    },
  );

  it("rewind iptal sırasında fork göndermemeli", async () => {
    const input = {
      sessionId: "pi-rewind-cancel",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };
    await compactPiContext(input);
    let resolveMessages!: (value: unknown) => void;
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_fork_messages")
        return await new Promise((resolve) => {
          resolveMessages = resolve;
        });
      return { data: {} };
    });
    const rewind = rewindPiLastTurn(input);
    const outcome = rewind.catch((error: Error) => error.message);
    for (let i = 0; i < 30 && !resolveMessages; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await cancelPiTurn(input.sessionId);
    resolveMessages({ data: { messages: [{ entryId: "msg", text: "hi" }] } });
    expect(await outcome).toContain("Edit cancelled");
    expect(mocks.request.mock.calls.some(([command]) => command.type === "fork")).toBe(false);
    await stopPiSession(input.sessionId);
  });
});
