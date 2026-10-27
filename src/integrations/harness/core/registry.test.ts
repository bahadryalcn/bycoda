import { afterEach, describe, expect, it, vi } from "vitest";

const socialBridgeMock = vi.hoisted(() =>
  vi.fn<(_sessionId: string) => Promise<{ command: string; args: string[] } | null>>(
    async () => null,
  ),
);
const runtimeLogsBridgeMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ command: string; args: string[] } | null>>(async () => null),
);
const conversationToolsBridgeMock = vi.hoisted(() =>
  vi.fn(async () => null as { command: string; args: string[] } | null),
);
vi.mock("./conversationToolsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversationToolsBridge")>()),
  conversationToolsBridge: conversationToolsBridgeMock,
}));
vi.mock("./socialBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./socialBridge")>()),
  socialBridge: socialBridgeMock,
}));
vi.mock("./runtimeLogsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtimeLogsBridge")>()),
  runtimeLogsBridge: runtimeLogsBridgeMock,
}));
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../../features/sessions/model/models";
import type { HarnessId } from "../../../features/sessions/model/session";
import {
  HARNESS_IDLE_PARK_MS,
  harnessCapabilities,
  harnessCapabilityTable,
  bindHarnessSession,
  canCompactHarnessContext,
  canRunHarnessTextPrompt,
  runHarnessTextPrompt,
  canRewindHarnessLastTurn,
  canStopHarnessBackgroundWork,
  compactHarnessContext,
  rewindHarnessLastTurn,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  steerHarnessTurn,
  cancelHarnessTurn,
  stopHarnessBackgroundWork,
  stopHarnessSession,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";
import { claudeAdapter } from "../providers/claude/claudeAdapter";
import { codexAdapter } from "../providers/codex/codexAdapter";
import { genericAcpAdapter } from "../providers/generic-acp/genericAcpAdapter";
import { registerBuiltinHarnesses } from "./register";

function stub(id: HarnessId, extra: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
}

describe("harness registry", () => {
  it.each(["codex", "claude"] as const)(
    "prepares %s text after adding runtime and skill guidance exactly once",
    async (harness) => {
      runtimeLogsBridgeMock.mockResolvedValueOnce({
        command: "/fake/node",
        args: ["/fake/host.mjs"],
      });
      const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
      registerHarness(stub(harness, { sendTurn }));
      const prepareText = vi.fn(async (text: string, instructions?: string) => {
        const charged = [text, instructions].filter(Boolean).join("\n\n");
        expect(charged.match(/current owner settings/g)).toHaveLength(1);
        expect(charged).toContain("runtime_logs_read");
        expect(charged.match(/Owner request/g)).toHaveLength(1);
        return `${text}\nSaved context`;
      });
      await sendHarnessTurn({
        harness,
        sessionId: `late-prompt-${harness}`,
        cwd: "/tmp",
        model: `${harness}:test`,
        runtimeMode: "supervised",
        text: "Owner request",
        onEvent: vi.fn(),
        prepareText,
      });
      expect(prepareText).toHaveBeenCalledOnce();
      const sent = sendTurn.mock.calls[0][0];
      expect(sent.text).toContain("Saved context");
      expect(sent).not.toHaveProperty("prepareText");
      if (harness === "codex") expect(sent.runtimeInstructions).toContain("runtime_logs_read");
    },
  );

  it("honors cancellation while asynchronous prompt preparation is pending", async () => {
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    registerHarness(stub("claude", { sendTurn }));
    let finish!: (text: string) => void;
    const prepareText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const sending = sendHarnessTurn({
      harness: "claude",
      sessionId: "cancel-handoff-preparation",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised",
      text: "Continue",
      onEvent: vi.fn(),
      prepareText,
    });
    const rejected = expect(sending).rejects.toThrow("Turn cancelled before it started");
    await vi.waitFor(() => expect(prepareText).toHaveBeenCalledOnce());
    await cancelHarnessTurn("claude", "cancel-handoff-preparation");
    finish("Continue with context");
    await rejected;
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("rejects a Gemini model on Codex before any provider operation", async () => {
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    const compactContext = vi.fn(async () => {});
    const rewindLastTurn = vi.fn(async () => ({ submitted: false }));
    const runTextPrompt = vi.fn(async () => "unexpected");
    registerHarness(
      stub("codex", { sendTurn, steerTurn, compactContext, rewindLastTurn, runTextPrompt }),
    );
    const input = {
      harness: "codex" as const,
      sessionId: "foreign-model-guard",
      cwd: "/tmp",
      model: "antigravity:gemini-3.8-flash-high",
      runtimeMode: "supervised" as const,
      text: "Continue the same chat",
      onEvent: vi.fn(),
    };
    await expect(sendHarnessTurn(input)).rejects.toThrow('does not belong to provider "codex"');
    await expect(steerHarnessTurn(input)).rejects.toThrow('does not belong to provider "codex"');
    await expect(compactHarnessContext(input)).rejects.toThrow(
      'does not belong to provider "codex"',
    );
    await expect(rewindHarnessLastTurn(input)).rejects.toThrow(
      'does not belong to provider "codex"',
    );
    await expect(runHarnessTextPrompt({ ...input, prompt: "Recap" })).rejects.toThrow(
      'does not belong to provider "codex"',
    );
    for (const operation of [sendTurn, steerTurn, compactContext, rewindLastTurn, runTextPrompt])
      expect(operation).not.toHaveBeenCalled();
  });

  it.each(["my-private-model", "openrouter:vendor/custom-model", "codex:custom-model"])(
    "keeps valid/custom Codex models unchanged: %s",
    async (model) => {
      const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
      registerHarness(stub("codex", { sendTurn }));
      await sendHarnessTurn({
        harness: "codex",
        sessionId: `custom-model-${model}`,
        cwd: "/tmp",
        model,
        runtimeMode: "supervised",
        text: "Continue",
        onEvent: vi.fn(),
      });
      expect(sendTurn).toHaveBeenCalledOnce();
      expect(sendTurn.mock.calls[0][0].model).toBe(model);
    },
  );
  it("deduplicates in-flight Stop but retries a rejected cancellation", async () => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const sendTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelTurn = vi
      .fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    registerHarness(stub("claude", { sendTurn, cancelTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "retry-stop",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: vi.fn(),
    };
    const turn = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    const first = cancelHarnessTurn("claude", input.sessionId);
    const second = cancelHarnessTurn("claude", input.sessionId);
    const results = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledOnce());
    fail(new Error("pipe unavailable"));
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await cancelHarnessTurn("claude", input.sessionId);
    expect(cancelTurn).toHaveBeenCalledTimes(2);
    finish();
    await turn;
  });

  it("does not start queued compaction after Stop invalidates it", async () => {
    let finish!: () => void;
    const sendTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("claude", { sendTurn, compactContext }));
    const input = {
      harness: "claude" as const,
      sessionId: "stop-compact",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: vi.fn(),
    };
    const turn = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    await cancelHarnessTurn("claude", input.sessionId);
    const compaction = compactHarnessContext(input);
    const rejected = expect(compaction).rejects.toThrow("Compaction cancelled before it started");
    await cancelHarnessTurn("claude", input.sessionId);
    finish();
    await Promise.all([turn, rejected]);
    expect(compactContext).not.toHaveBeenCalled();
  });
  it("releases an idle Codex writer before allowing a queued follow-up", async () => {
    const order: string[] = [];
    let release!: () => void;
    const stopSession = vi.fn(async () => {
      order.push("release");
      if (stopSession.mock.calls.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    const sendTurn = vi.fn(async () => {
      order.push("send");
    });
    registerHarness(stub("codex", { sendTurn, stopSession }));
    const input = {
      harness: "codex" as const,
      sessionId: "writer-release",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: () => {},
    };
    const first = sendHarnessTurn(input);
    await vi.waitFor(() => expect(stopSession).toHaveBeenCalledOnce());
    const second = sendHarnessTurn(input);
    expect(sendTurn).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["send", "release", "send", "release"]);
  });

  it("keeps lightweight worktree Codex turns warm and still parks an idle writer", async () => {
    vi.useFakeTimers();
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const stopSession = vi.fn(async () => {});
    registerHarness(stub("codex", { sendTurn, stopSession }));
    const input = {
      harness: "codex" as const,
      sessionId: "lightweight-writer",
      cwd: "/tmp/worktree",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: vi.fn(),
      lightweightWorktree: true,
    };
    await sendHarnessTurn(input);
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    await sendHarnessTurn(input);
    await sendHarnessTurn(input);
    expect(sendTurn).toHaveBeenCalledTimes(3);
    expect(sendTurn.mock.calls[0][0]).not.toHaveProperty("lightweightWorktree");
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledExactlyOnceWith(input.sessionId);
  });

  it("releases a warm lightweight worktree writer on explicit ownership transfer", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => {});
    registerHarness(stub("codex", { stopSession }));
    await sendHarnessTurn({
      harness: "codex",
      sessionId: "lightweight-transfer",
      cwd: "/tmp/worktree",
      model: "codex:test",
      runtimeMode: "supervised",
      text: "hello",
      onEvent: vi.fn(),
      lightweightWorktree: true,
    });
    expect(stopSession).not.toHaveBeenCalled();
    await stopHarnessSession("codex", "lightweight-transfer");
    expect(stopSession).toHaveBeenCalledExactlyOnceWith("lightweight-transfer");
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).toHaveBeenCalledOnce();
  });

  it.each([
    "/goal",
    "/goal status",
    "/goal pause",
    "/goal clear",
    "/goal resume",
    "/goal Finish review",
    "Inspect errors",
  ])("preserves Codex command text while carrying trusted runtime guidance: %s", async (text) => {
    const bridge = { command: "/fake/node", args: ["/fake/host.mjs"] };
    socialBridgeMock.mockResolvedValueOnce(bridge);
    runtimeLogsBridgeMock.mockResolvedValueOnce(bridge);
    conversationToolsBridgeMock.mockResolvedValueOnce(bridge);
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    registerHarness(stub("codex", { sendTurn }));
    await sendHarnessTurn({
      harness: "codex",
      sessionId: "native-command-hints",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised",
      text,
      runtimeInstructions: "Existing trusted guidance.",
      onEvent: vi.fn(),
    });
    const sent = sendTurn.mock.calls[0][0];
    expect(sent.text).toBe(text);
    expect(sent.runtimeInstructions).toContain("Existing trusted guidance.");
    expect(sent.runtimeInstructions).toContain("social_policy_get");
    expect(sent.runtimeInstructions).toContain("runtime_logs_read");
    expect(sent.runtimeInstructions).toContain("conversation_tools_list");
    expect(sent.runtimeInstructions).toContain("untrusted data");
  });
  it("sends runtime hints on the first accepted turn only", async () => {
    runtimeLogsBridgeMock.mockResolvedValue({ command: "/fake/node", args: ["/fake/host.mjs"] });
    let accept = false;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      if (accept) input.onAccepted?.();
    });
    registerHarness(stub("claude", { sendTurn }));
    const send = (text: string) =>
      sendHarnessTurn({
        harness: "claude",
        sessionId: "hint-once",
        cwd: "/tmp",
        model: "claude:test",
        runtimeMode: "supervised",
        text,
        onEvent: vi.fn(),
      });
    await send("/compact");
    await send("not accepted");
    accept = true;
    await send("first");
    await send("second");
    const texts = sendTurn.mock.calls.map(([input]) => input.text);
    expect(texts[0]).toBe("/compact");
    expect(texts[1]).toContain("runtime_logs_read");
    expect(texts[2]).toContain("runtime_logs_read");
    expect(texts[3]).toContain("second");
    expect(texts[3]).not.toContain("runtime_logs_read");
    expect(texts[3]).toContain("current owner settings");
    runtimeLogsBridgeMock.mockReset().mockResolvedValue(null);
  });
  it("gives CLI-only providers runtime log access instructions without credentials", async () => {
    runtimeLogsBridgeMock.mockResolvedValueOnce({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["G:\\bycoda Host\\host.mjs"],
    });
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    registerHarness(stub("pi", { sendTurn }));
    await sendHarnessTurn({
      harness: "pi",
      sessionId: "runtime-log-hint",
      cwd: "/tmp",
      model: "pi:test",
      runtimeMode: "supervised",
      text: "Inspect errors",
      onEvent: vi.fn(),
    });
    const text = sendTurn.mock.calls[0][0].text;
    expect(text).toContain("runtime_logs_read");
    expect(text).toContain("<group> <action> --input -");
    expect(text).toContain("CLI group runtime-logs");
    expect(text).toContain("untrusted data");
    expect(text).toContain("Inspect errors");
    expect(text).not.toContain("TOKEN");
  });
  it.each<HarnessId>([
    "claude",
    "codex",
    "cursor",
    "grok",
    "opencode",
    "pi",
    "omp",
    "fx",
    "hermes",
    "antigravity",
    "acp",
  ])(
    "keeps Stop during registry preparation out of the next %s adapter invocation",
    async (harness) => {
      let finishBridge!: (value: null) => void;
      socialBridgeMock.mockImplementationOnce(
        () =>
          new Promise<null>((resolve) => {
            finishBridge = resolve;
          }),
      );
      let cancelledStartup = false;
      const cancelTurn = vi.fn(async () => {
        cancelledStartup = true;
      });
      const sendTurn = vi.fn(async (input: SendTurnInput) => {
        if (cancelledStartup) {
          cancelledStartup = false;
          return;
        }
        input.onAccepted?.();
      });
      registerHarness(stub(harness, { sendTurn, cancelTurn }));
      const input = {
        harness,
        sessionId: `bridge-stop-${harness}`,
        cwd: "/tmp",
        model: `${harness}:test`,
        runtimeMode: "supervised" as const,
        text: "first",
        onEvent: vi.fn(),
      };
      const first = sendHarnessTurn(input);
      const cancelled = expect(first).rejects.toThrow("Turn cancelled before it started");
      await vi.waitFor(() => expect(socialBridgeMock).toHaveBeenCalled());
      await cancelHarnessTurn(harness, input.sessionId);
      finishBridge(null);
      await cancelled;
      expect(sendTurn).not.toHaveBeenCalled();
      expect(cancelTurn).not.toHaveBeenCalled();
      const onAccepted = vi.fn();
      await sendHarnessTurn({ ...input, text: "second", onAccepted });
      expect(sendTurn).toHaveBeenCalledOnce();
      expect(onAccepted).toHaveBeenCalledOnce();
    },
  );

  it("holds the next send until the cancelled adapter operation finishes retiring", async () => {
    let finishTurn!: () => void;
    let finishCancel!: () => void;
    const sendTurn = vi.fn(async () => {
      if (sendTurn.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          finishTurn = resolve;
        });
      }
    });
    const cancelTurn = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishCancel = resolve;
      });
    });
    registerHarness(stub("codex", { sendTurn, cancelTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "cancel-retirement",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    const cancelling = cancelHarnessTurn("codex", input.sessionId);
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledOnce());
    finishTurn();
    const next = sendHarnessTurn({ ...input, text: "second" });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendTurn).toHaveBeenCalledOnce();
    finishCancel();
    await Promise.all([first, cancelling, next]);
    expect(sendTurn).toHaveBeenCalledTimes(2);
  });

  it("still cancels adapter startup during manual compaction", async () => {
    let finish!: () => void;
    const compactContext = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const cancelTurn = vi.fn(async () => {
      finish();
    });
    registerHarness(stub("codex", { compactContext, cancelTurn }));
    const compact = compactHarnessContext({
      harness: "codex",
      sessionId: "cancel-compact",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised",
      onEvent: vi.fn(),
    });
    await vi.waitFor(() => expect(compactContext).toHaveBeenCalledOnce());
    await cancelHarnessTurn("codex", "cancel-compact");
    await compact;
    expect(cancelTurn).toHaveBeenCalledOnce();
  });

  it("delivers an immediate follow-up after startup, without waiting for completion", async () => {
    let finish!: () => void;
    let begin!: () => void;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      await new Promise<void>((resolve) => {
        begin = resolve;
      });
      input.onAccepted?.();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const steerTurn = vi.fn(async () => {});
    registerHarness(stub("codex", { sendTurn, steerTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "early-steer",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const turn = sendHarnessTurn(input);
    const steer = steerHarnessTurn({ ...input, text: "second" });
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    expect(steerTurn).not.toHaveBeenCalled();
    begin();
    await steer;
    expect(steerTurn).toHaveBeenCalledOnce();
    finish();
    await turn;
  });

  it("cancels a follow-up waiting for startup when Stop is pressed", async () => {
    let begin!: () => void;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      await new Promise<void>((resolve) => {
        begin = resolve;
      });
      input.onEvent({ type: "turn.started", providerTurnId: "test-turn" });
    });
    const steerTurn = vi.fn(async () => {});
    const cancelTurn = vi.fn(async () => {});
    registerHarness(stub("codex", { sendTurn, steerTurn, cancelTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "cancel-early-steer",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const turn = sendHarnessTurn(input);
    const steer = steerHarnessTurn({ ...input, text: "second" });
    const rejected = expect(steer).rejects.toThrow("Follow-up cancelled");
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    await cancelHarnessTurn("codex", input.sessionId);
    begin();
    await Promise.all([turn, rejected]);
    expect(steerTurn).not.toHaveBeenCalled();
    expect(cancelTurn).toHaveBeenCalledOnce();
  });
  afterEach(() => {
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    socialBridgeMock.mockReset().mockResolvedValue(null);
    runtimeLogsBridgeMock.mockReset().mockResolvedValue(null);
    vi.useRealTimers();
  });

  it("tracks live adapters", () => {
    registerHarness(stub("cursor"));
    registerHarness(stub("codex"));
    registerHarness(stub("claude"));
    expect(isLiveHarness("cursor")).toBe(true);
    expect(isLiveHarness("codex")).toBe(true);
    expect(isLiveHarness("claude")).toBe(true);
    expect(
      listHarnesses()
        .map((a) => a.id)
        .filter((id) => id === "claude" || id === "codex" || id === "cursor")
        .sort(),
    ).toEqual(["claude", "codex", "cursor"]);
  });

  it("advertises isolated text prompt support by harness", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
      "hermes",
      "antigravity",
    ];

    expect(Object.fromEntries(ids.map((id) => [id, canRunHarnessTextPrompt(id)]))).toEqual({
      claude: true,
      codex: true,
      cursor: true,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
      hermes: false,
      antigravity: true,
    });
  });

  it("exposes the native compaction support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
      "antigravity",
    ];

    expect(Object.fromEntries(ids.map((id) => [id, canCompactHarnessContext(id)]))).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
      antigravity: false,
    });
  });
  it("advertises and dispatches compaction only when an adapter supports it", async () => {
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("codex", { compactContext }));
    registerHarness(stub("claude"));

    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("claude")).toBe(false);

    await compactHarnessContext({
      harness: "codex",
      sessionId: "compact-1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(compactContext).toHaveBeenCalledOnce();
    await expect(
      compactHarnessContext({
        harness: "claude",
        sessionId: "compact-2",
        cwd: "/tmp",
        model: "claude:sonnet",
        runtimeMode: "supervised",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("does not support manual compaction");
  });
  it("cancels an isolated text prompt through the adapter lifecycle", async () => {
    const runTextPrompt = vi.fn(() => new Promise<string>(() => undefined));
    const stopTextPrompt = vi.fn(async () => undefined);
    registerHarness(stub("claude", { runTextPrompt, stopTextPrompt }));
    const controller = new AbortController();
    const request = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "read-only question",
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toThrow("By-the-way request cancelled");
    expect(runTextPrompt).toHaveBeenCalledOnce();
    expect(stopTextPrompt).not.toHaveBeenCalled();
  });

  it("does not stop the shared text backend while another prompt is active", async () => {
    const runTextPrompt = vi.fn(() => new Promise<string>(() => undefined));
    const stopTextPrompt = vi.fn(async () => undefined);
    registerHarness(stub("claude", { runTextPrompt, stopTextPrompt }));
    const first = new AbortController();
    const second = new AbortController();
    const firstRequest = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "first",
      signal: first.signal,
    });
    const secondRequest = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "second",
      signal: second.signal,
    });
    first.abort();
    await expect(firstRequest).rejects.toThrow("By-the-way request cancelled");
    expect(stopTextPrompt).not.toHaveBeenCalled();
    second.abort();
    await expect(secondRequest).rejects.toThrow("By-the-way request cancelled");
    expect(stopTextPrompt).not.toHaveBeenCalled();
  });

  it("exposes the edit-last-turn support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = ["claude", "codex", "cursor", "grok", "opencode", "pi", "omp", "fx"];

    expect(Object.fromEntries(ids.map((id) => [id, canRewindHarnessLastTurn(id)]))).toEqual({
      claude: false,
      codex: true,
      cursor: false,
      grok: false,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
    });
  });

  it("registers Antigravity as a live fx-tier harness", () => {
    registerBuiltinHarnesses();
    expect(isLiveHarness("antigravity")).toBe(true);
    const adapter = listHarnesses().find((adapter) => adapter.id === "antigravity")!;
    expect(adapter.canSteer).toBe(false);
    expect(adapter.bindSession).toBeTypeOf("function");
    expect(adapter.refreshCatalog).toBeTypeOf("function");
    expect(adapter.generateTitle).toBeUndefined();
    expect(adapter.generateCommitMessage).toBeUndefined();
  });

  it("refreshes only the requested catalogs", async () => {
    const pi = vi.fn(async () => undefined);
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    registerHarness(stub("claude", { refreshCatalog: claude }));

    await refreshHarnessCatalogs(["claude"]);

    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("does not spawn a catalog probe twice after a live list lands", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("skips catalog refresh when no harness is in use", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    await refreshHarnessCatalogs([]);
    expect(pi).not.toHaveBeenCalled();
  });

  it("parks a live child a few minutes after the turn settles", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("cursor", { stopSession }));

    await sendHarnessTurn({
      harness: "cursor",
      sessionId: "s1",
      cwd: "/tmp",
      model: "cursor:composer-2.5",
      text: "hi",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledWith("s1");
  });
  it("serializes provider-state operations per session", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const compactContext = vi.fn(async (input: { sessionId: string }) => {
      order.push(`start:${input.sessionId}`);
      if (input.sessionId === "s1") {
        markFirstStarted();
        await firstGate;
      }
      order.push(`end:${input.sessionId}`);
    });
    registerHarness(stub("codex", { compactContext }));

    const compact1 = compactHarnessContext({
      harness: "codex",
      sessionId: "s1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await firstStarted;
    const compact2 = compactHarnessContext({
      harness: "codex",
      sessionId: "s1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    const independent = compactHarnessContext({
      harness: "codex",
      sessionId: "s2",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    await independent;
    expect(order).toEqual(["start:s1", "start:s2", "end:s2"]);
    releaseFirst();
    await Promise.all([compact1, compact2]);
    expect(order).toEqual(["start:s1", "start:s2", "end:s2", "end:s1", "start:s1", "end:s1"]);
  });

  it("binds a restored session and forwards its task panels", () => {
    const bindSession = vi.fn();
    const restoreTaskLists = vi.fn();
    registerHarness(stub("claude", { bindSession, restoreTaskLists }));
    const taskList = {
      key: "claude-tasks",
      items: [{ id: "1", text: "Write tests", status: "pending" as const }],
    };

    bindHarnessSession("claude", "s1", "sess_1", "/repo", "work", [
      { id: "b1", role: "user", text: "go" },
      { id: "b2", role: "tasks", text: "Write tests", taskList },
    ]);
    bindHarnessSession("claude", "s2", "sess_2", "/repo");

    expect(bindSession).toHaveBeenCalledWith("s1", "sess_1", "/repo", "work");
    expect(bindSession).toHaveBeenCalledWith("s2", "sess_2", "/repo", undefined);
    expect(restoreTaskLists).toHaveBeenCalledTimes(1);
    expect(restoreTaskLists).toHaveBeenCalledWith("s1", [taskList]);
  });
});

describe("stopping background work", () => {
  it("is offered only by an adapter that can stop one task by id", async () => {
    const stopBackgroundWork = vi.fn(async () => {});
    registerHarness(stub("claude", { stopBackgroundWork }));
    registerHarness(stub("codex"));

    expect(canStopHarnessBackgroundWork("claude")).toBe(true);
    expect(canStopHarnessBackgroundWork("codex")).toBe(false);

    await stopHarnessBackgroundWork("claude", "s1", "toolu_1");
    await stopHarnessBackgroundWork("claude", "s1");
    expect(stopBackgroundWork.mock.calls).toEqual([
      ["s1", "toolu_1"],
      ["s1", undefined],
    ]);
    await expect(stopHarnessBackgroundWork("codex", "s1")).rejects.toThrow(
      "cannot stop background work",
    );
  });
});

it("yetenek tablosu kayıtlı adapter metodlarından türetilir", () => {
  registerHarness(claudeAdapter);
  registerHarness(codexAdapter);
  registerHarness(genericAcpAdapter);
  for (const { id, capabilities } of harnessCapabilityTable()) {
    expect(harnessCapabilities(id)).toEqual(capabilities);
  }
  expect(harnessCapabilities("claude")).toMatchObject({
    compactContext: true,
    stopBackgroundWork: true,
  });
  expect(harnessCapabilities("acp")).toMatchObject({
    steer: false,
    compactContext: false,
    respondQuestion: false,
  });
  expect(harnessCapabilities("codex")).toMatchObject({
    rewindLastTurn: true,
    generatePrContent: true,
    telemetry: ["context", "turn.metrics", "usage.limited", "image.generated"],
  });
  expect(harnessCapabilities("acp")?.telemetry).toEqual([]);
});
