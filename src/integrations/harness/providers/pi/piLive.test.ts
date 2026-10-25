import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  resolveBinary: vi.fn(),
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  acquireHarnessBridge: vi.fn(),
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
  acquireHarnessBridge: mocks.acquireHarnessBridge,
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
import {
  bindSession,
  cancelTurn,
  compactContext,
  forgetSession,
  sendTurn,
  stopSession,
} from "./piFamily";
import { OMP_FLAVOR, PI_FLAVOR } from "./piFlavor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    mocks.acquireHarnessBridge.mockResolvedValue(() => undefined);
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

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "cancels %s binary preparation before launch and preserves a replacement",
    async (flavor) => {
      const binary = deferred<{ path: string }>();
      mocks.resolveBinary.mockReturnValueOnce(binary.promise);
      const sessionId = `${flavor.id}-held-binary`;
      const events: HarnessEvent[] = [];
      const input = {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised" as const,
        onEvent: (event: HarnessEvent) => events.push(event),
      };
      const work = sendTurn(flavor, { ...input, text: "never sent", attachments: [] });
      const rejected = expect(work).rejects.toThrow("startup cancelled");
      await vi.waitFor(() => expect(mocks.resolveBinary).toHaveBeenCalledTimes(1));
      await stopSession(flavor, sessionId);
      await rejected; // Cancellation settles before the resolver is released.
      expect(mocks.spawnChild).not.toHaveBeenCalled();
      try {
        await compactContext(flavor, { ...input, onEvent: () => undefined });
        const kills = mocks.killChild.mock.calls.length;
        binary.resolve({ path: "/late/pi" });
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.spawnChild).toHaveBeenCalledTimes(1);
        expect(mocks.killChild).toHaveBeenCalledTimes(kills);
        expect(events).toEqual([]);
        expect(mocks.request.mock.calls.some(([command]) => command.type === "prompt")).toBe(false);
      } finally {
        binary.resolve({ path: "/late/pi" });
        await stopSession(flavor, sessionId);
      }
    },
  );

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "cancels %s pending spawn without registering late state or killing its replacement",
    async (flavor) => {
      const launched = deferred<void>();
      mocks.spawnChild.mockReturnValueOnce(launched.promise);
      const sessionId = `${flavor.id}-held-spawn`;
      const events: HarnessEvent[] = [];
      const input = {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised" as const,
        onEvent: (event: HarnessEvent) => events.push(event),
      };
      const work = sendTurn(flavor, { ...input, text: "never sent", attachments: [] });
      const rejected = expect(work).rejects.toThrow("startup cancelled");
      await vi.waitFor(() => expect(mocks.spawnChild).toHaveBeenCalledTimes(1));
      await cancelTurn(flavor, sessionId);
      await rejected;
      try {
        await compactContext(flavor, { ...input, onEvent: () => undefined });
        const kills = mocks.killChild.mock.calls.length;
        launched.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.killChild).toHaveBeenCalledTimes(kills);
        expect(
          mocks.request.mock.calls.filter(([command]) => command.type === "get_state"),
        ).toHaveLength(1);
        expect(events).toEqual([]);
      } finally {
        launched.resolve();
        await stopSession(flavor, sessionId);
      }
    },
  );

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "cancels %s requests queued behind an earlier stop before preparation begins",
    async (flavor) => {
      const kill = deferred<void>();
      mocks.killChild.mockReturnValueOnce(kill.promise);
      const sessionId = `${flavor.id}-held-stop`;
      const firstStop = stopSession(flavor, sessionId);
      const work = sendTurn(flavor, {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised",
        onEvent: () => undefined,
        text: "never sent",
        attachments: [],
      });
      const rejected = expect(work).rejects.toThrow("startup cancelled");
      const secondStop = stopSession(flavor, sessionId);
      await rejected;
      expect(mocks.resolveBinary).not.toHaveBeenCalled();
      kill.resolve();
      await Promise.all([firstStop, secondStop]);
      expect(mocks.spawnChild).not.toHaveBeenCalled();
    },
  );

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "shares one %s startup between concurrent same-session requests",
    async (flavor) => {
      const state = deferred<Record<string, unknown>>();
      mocks.request.mockReturnValueOnce(state.promise);
      const sessionId = `${flavor.id}-shared-startup`;
      const input = {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised" as const,
        onEvent: () => undefined,
      };
      const first = compactContext(flavor, input);
      const second = compactContext(flavor, input);
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
      expect(mocks.spawnChild).toHaveBeenCalledTimes(1);
      state.resolve({ data: { sessionId: "shared-native" } });
      await Promise.all([first, second]);
      expect(
        mocks.request.mock.calls.filter(([command]) => command.type === "compact"),
      ).toHaveLength(2);
      await stopSession(flavor, sessionId);
    },
  );

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "does not restart a cancelled %s resume as a fresh session",
    async (flavor) => {
      const state = deferred<Record<string, unknown>>();
      mocks.request.mockReturnValueOnce(state.promise);
      const sessionId = `${flavor.id}-held-resume`;
      bindSession(flavor, sessionId, "resume-native", "/repo");
      const events: HarnessEvent[] = [];
      const input = {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised" as const,
        onEvent: (event: HarnessEvent) => events.push(event),
      };
      const work = sendTurn(flavor, { ...input, text: "never sent", attachments: [] });
      const rejected = expect(work).rejects.toThrow("startup cancelled");
      await vi.waitFor(() =>
        expect(mocks.request).toHaveBeenCalledWith({ type: "get_state" }, 45_000),
      );
      await forgetSession(flavor, sessionId);
      await rejected;
      state.resolve({ data: { sessionId: "stale-resume" } });
      await Promise.resolve();
      expect(mocks.spawnChild).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
      await compactContext(flavor, input);
      expect(mocks.spawnChild).toHaveBeenCalledTimes(2);
      expect(mocks.spawnChild.mock.calls[0][2]).toContain(flavor.resumeFlag);
      expect(mocks.spawnChild.mock.calls[1][2]).not.toContain(flavor.resumeFlag);
      await stopSession(flavor, sessionId);
    },
  );

  it.each([PI_FLAVOR, OMP_FLAVOR])("retains genuine %s resume failure fallback", async (flavor) => {
    const sessionId = `${flavor.id}-resume-failure`;
    bindSession(flavor, sessionId, "invalid-resume", "/repo");
    mocks.request.mockRejectedValueOnce(new Error("Unknown native session"));
    await compactContext(flavor, {
      sessionId,
      cwd: "/repo",
      model: `${flavor.id}:default`,
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    expect(mocks.spawnChild).toHaveBeenCalledTimes(2);
    expect(mocks.spawnChild.mock.calls[0][2]).toContain(flavor.resumeFlag);
    expect(mocks.spawnChild.mock.calls[1][2]).not.toContain(flavor.resumeFlag);
    await stopSession(flavor, sessionId);
  });

  it.each([PI_FLAVOR, OMP_FLAVOR])(
    "cancels %s restricted skill preparation and its isolated probe",
    async (flavor) => {
      const catalog = deferred<Record<string, unknown>>();
      mocks.request.mockReturnValueOnce(catalog.promise);
      const sessionId = `${flavor.id}-held-skills`;
      const events: HarnessEvent[] = [];
      const work = sendTurn(flavor, {
        sessionId,
        cwd: "/repo",
        model: `${flavor.id}:default`,
        runtimeMode: "supervised",
        onEvent: (event) => events.push(event),
        text: "never sent",
        attachments: [],
        skillPolicy: { disabledNames: ["fixture-disabled"], disabledPaths: [] },
      });
      const rejected = expect(work).rejects.toThrow("startup cancelled");
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
      const probe = mocks.spawnChild.mock.calls[0][0];
      expect(probe).toMatch(/^bycoda-.*-skills-/);
      const killed = deferred<void>();
      mocks.killChild.mockImplementation((id: string) =>
        id === probe ? killed.promise : Promise.resolve(),
      );
      let stopped = false;
      const stop = stopSession(flavor, sessionId).then(() => {
        stopped = true;
      });
      try {
        await rejected;
        await vi.waitFor(() => expect(mocks.killChild).toHaveBeenCalledWith(probe));
        expect(stopped).toBe(false);
      } finally {
        killed.resolve();
        await stop;
      }
      catalog.resolve({ data: { commands: [] } });
      await Promise.resolve();
      expect(mocks.spawnChild).toHaveBeenCalledTimes(1);
      expect(events).toEqual([]);
    },
  );

  it("does not reuse the old context window after an OMP provider config model change", async () => {
    const events: HarnessEvent[] = [];
    await compactOmpContext({
      sessionId: "pi-model-context",
      cwd: "/repo",
      model: "omp:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    expect(events).toContainEqual({ type: "context", used: 32_000, window: 200_000 });
    const frame = mocks.frames[0]!;
    frame({ type: "config_update", model: { provider: "new-provider", id: "new-model" } });
    frame({ type: "message_update", usage: { totalTokens: 100_000 } });
    expect(events.filter((event) => event.type === "context").at(-1)).toEqual({
      type: "context",
      used: 100_000,
    });
    frame({
      type: "config_update",
      model: { provider: "new-provider", id: "another-model", contextWindow: 400_000 },
    });
    frame({ type: "message_update", usage: { totalTokens: 100_000 } });
    expect(events.filter((event) => event.type === "context").at(-1)).toEqual({
      type: "context",
      used: 100_000,
      window: 400_000,
    });
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
