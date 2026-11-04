import { afterEach, describe, expect, it, vi } from "vitest";
const nativeInvoke = vi.hoisted(() =>
  vi.fn<(_command: string, _args?: unknown) => Promise<unknown>>(async () => undefined),
);
const nativeEnabled = vi.hoisted(() => vi.fn(() => false));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: nativeInvoke,
  isTauri: nativeEnabled,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

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
  defaultModelId,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../../features/sessions/model/models";
import type { HarnessId } from "../../../features/sessions/model/session";
import {
  HARNESS_IDLE_PARK_MS,
  TURN_INACTIVITY_STATUS_KEY,
  TURN_INACTIVITY_WARNING_MS,
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
  captureHarnessControlTurn,
  stopHarnessBackgroundWork,
  stopHarnessSession,
  retainedHarnessWriters,
  retireHarnessWriter,
  type HarnessAdapter,
} from "./registry";
import type { HarnessEvent, HarnessOperationContext, SendTurnInput, SteerTurnInput } from "./types";
import { createChildProcessHandle, spawnChild, killChild, type ChildProcessHandle } from "./child";
import { nativeControlTurnReceipt } from "./controlTurn";
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
  function nativeReceipts() {
    nativeEnabled.mockReturnValue(true);
    let next = 0;
    nativeInvoke.mockImplementation(async (command, raw) => {
      if (command === "skill_policy_get") return { disabledNames: [], disabledPaths: [] };
      if (command === "control_authorize_turn") {
        const args = raw as { sessionId: string };
        return {
          version: 1,
          sessionId: args.sessionId,
          turnId: `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
        };
      }
      if (command === "harness_spawn") {
        const args = raw as { sessionId: string };
        return {
          version: 1,
          backend: "native",
          sessionId: args.sessionId,
          pid: 42,
          constructionId: `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
        };
      }
      if (command === "harness_bind_turn") {
        const args = raw as {
          constructionId: string;
          controlTurn: { sessionId: string; turnId: string };
        };
        return {
          version: 1,
          bindingId: `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
          sessionId: args.controlTurn.sessionId,
          constructionId: args.constructionId,
          turnId: args.controlTurn.turnId,
        };
      }
      return undefined;
    });
  }

  it("refuses a queued follow-up after its original preparation fails without entering the provider", async () => {
    let fail!: (error: Error) => void;
    const prepareText = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    registerHarness(stub("claude", { sendTurn, steerTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "failed-source-followup",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const originalFailure = new Error("original preparation failed");
    const first = sendHarnessTurn({ ...input, prepareText });
    const failed = expect(first).rejects.toBe(originalFailure);
    await vi.waitFor(() => expect(prepareText).toHaveBeenCalledOnce());
    const followup = steerHarnessTurn({ ...input, text: "followup" });
    const refused = expect(followup).rejects.toThrow("original turn is no longer ready");
    fail(originalFailure);
    await Promise.all([failed, refused]);
    expect(sendTurn).not.toHaveBeenCalled();
    expect(steerTurn).not.toHaveBeenCalled();
  });

  it("does not let a failed cancellation poison the original turn or the next submission", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finish!: () => void;
    const failure = new Error("original cancellation is unresolved");
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const cancelTurn = vi.fn(async () => {
      throw failure;
    });
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    registerHarness(stub("claude", { sendTurn, cancelTurn, steerTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "failed-predecessor-followup",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    // The failed cancellation is reported to Stop and warned about, but never cached.
    await expect(cancelHarnessTurn("claude", input.sessionId)).rejects.toThrow(
      "original cancellation is unresolved",
    );
    const second = sendHarnessTurn({ ...input, text: "second" });
    const followup = steerHarnessTurn({ ...input, text: "follow-up for second" });
    const refused = expect(followup).rejects.toThrow("original turn is no longer ready");
    finish();
    await first;
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(2));
    finish();
    await Promise.all([second, refused]);
    expect(cancelTurn).toHaveBeenCalledOnce();
    expect(steerTurn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses a retained follow-up when a same-id adapter replaces its actual source", async () => {
    let begin!: () => void;
    let finish!: () => void;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      await new Promise<void>((resolve) => {
        begin = resolve;
      });
      input.onAccepted?.();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const originalSteer = vi.fn(async (_input: SteerTurnInput) => {});
    const replacementSteer = vi.fn(async (_input: SteerTurnInput) => {});
    registerHarness(stub("codex", { sendTurn, steerTurn: originalSteer }));
    const input = {
      harness: "codex" as const,
      sessionId: "replaced-source-followup",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    const followup = steerHarnessTurn({ ...input, text: "followup" });
    const refused = expect(followup).rejects.toThrow("original turn is no longer ready");
    registerHarness(stub("codex", { steerTurn: replacementSteer }));
    begin();
    await refused;
    expect(originalSteer).not.toHaveBeenCalled();
    expect(replacementSteer).not.toHaveBeenCalled();
    finish();
    await first;
  });

  it.each(["stop", "replace"] as const)(
    "refuses a follow-up after onReady synchronously requests %s",
    async (change) => {
      let finish!: () => void;
      const sendTurn = vi.fn(async (input: SendTurnInput) => {
        const completed = new Promise<void>((resolve) => {
          finish = resolve;
        });
        input.onAccepted?.();
        await completed;
      });
      const cancelTurn = vi.fn(async () => {
        finish();
      });
      const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
      const replacementSteer = vi.fn(async (_input: SteerTurnInput) => {});
      registerHarness(stub("claude", { sendTurn, cancelTurn, steerTurn }));
      const input = {
        harness: "claude" as const,
        sessionId: `ready-reentrant-${change}`,
        cwd: "/tmp",
        model: "claude:test",
        runtimeMode: "supervised" as const,
        text: "first",
        onEvent: vi.fn(),
      };
      const first = sendHarnessTurn(input);
      await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
      let cancellation: Promise<void> | undefined;
      const followup = steerHarnessTurn({
        ...input,
        text: "followup",
        onReady: () => {
          if (change === "stop") cancellation = cancelHarnessTurn("claude", input.sessionId);
          else registerHarness(stub("claude", { steerTurn: replacementSteer }));
        },
      });
      await expect(followup).rejects.toThrow(
        change === "stop" ? "Follow-up cancelled" : "original turn is no longer ready",
      );
      expect(steerTurn).not.toHaveBeenCalled();
      expect(replacementSteer).not.toHaveBeenCalled();
      if (change === "replace") finish();
      await Promise.all([first, cancellation]);
    },
  );

  it.each(["compact", "edit"] as const)(
    "captures %s identity before the caller mutates a queued input",
    async (kind) => {
      nativeReceipts();
      let finish!: () => void;
      const sendTurn = vi.fn(async (_input: SendTurnInput) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      const compactContext = vi.fn(async (_input: import("./types").CompactContextInput) => {});
      const rewindLastTurn = vi.fn(async (_input: import("./types").RewindLastTurnInput) => ({
        submitted: false,
      }));
      registerHarness(stub("codex", { sendTurn, compactContext, rewindLastTurn }));
      const input = {
        harness: "codex" as const,
        sessionId: `immutable-${kind}-a`,
        cwd: "/a",
        model: "codex:test",
        runtimeMode: "supervised" as const,
        text: "first",
        onEvent: vi.fn(),
      };
      const first = sendHarnessTurn(input);
      await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
      const request = { ...input, modelSettings: { effort: "low" } };
      const queued =
        kind === "compact" ? compactHarnessContext(request) : rewindHarnessLastTurn(request);
      request.sessionId = `immutable-${kind}-b`;
      request.cwd = "/b";
      request.modelSettings.effort = "high";
      finish();
      await Promise.all([first, queued]);
      const called =
        kind === "compact" ? compactContext.mock.calls[0]?.[0] : rewindLastTurn.mock.calls[0]?.[0];
      expect(called).toMatchObject({
        sessionId: input.sessionId,
        cwd: "/a",
        modelSettings: { effort: "low" },
      });
      const authorizations = nativeInvoke.mock.calls.filter(
        ([command]) => command === "control_authorize_turn",
      );
      expect(authorizations.map(([, args]) => (args as { sessionId: string }).sessionId)).toEqual([
        input.sessionId,
        input.sessionId,
      ]);
    },
  );

  it("keeps Stop before adapter entry inside the original preparation and admits a fresh turn", async () => {
    let release!: (text: string) => void;
    const prepareText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const cancelTurn = vi.fn(async (_sessionId: string, _context?: HarnessOperationContext) => {});
    registerHarness(stub("claude", { sendTurn, cancelTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "source-prepare-stop",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn({ ...input, prepareText });
    const rejected = expect(first).rejects.toThrow("Turn cancelled before it started");
    await vi.waitFor(() => expect(prepareText).toHaveBeenCalledOnce());
    await cancelHarnessTurn("claude", input.sessionId);
    expect(cancelTurn).not.toHaveBeenCalled();
    release("prepared first");
    await rejected;
    expect(sendTurn).not.toHaveBeenCalled();
    await sendHarnessTurn({ ...input, text: "fresh" });
    expect(sendTurn).toHaveBeenCalledOnce();
    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("retains every actual construction and logical alias in the captured original Stop context", async () => {
    nativeReceipts();
    let finish!: () => void;
    let entered!: SendTurnInput;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      entered = input;
      const first = createChildProcessHandle(`${input.sessionId}#first`, input.nativeControlTurn);
      const fallback = createChildProcessHandle(
        `${input.sessionId}#fallback`,
        input.nativeControlTurn,
      );
      input.onOriginalProcess?.(first);
      input.onOriginalProcess?.(fallback);
      expect(captureHarnessControlTurn(input.sessionId, fallback)).toBe(input.nativeControlTurn);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const cancelTurn = vi.fn(async (_sessionId: string, _context?: HarnessOperationContext) => {});
    registerHarness(stub("claude", { sendTurn, cancelTurn }));
    const turn = sendHarnessTurn({
      harness: "claude",
      sessionId: "actual-logical-aliases",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised",
      text: "first",
      onEvent: vi.fn(),
    });
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    await cancelHarnessTurn("claude", "actual-logical-aliases");
    const context = cancelTurn.mock.calls[0]?.[1];
    expect(context?.operation).toBe(entered.operationContext?.operation);
    expect(context?.nativeControlTurn).toBe(entered.nativeControlTurn);
    expect(context?.originalProcess).toBeUndefined();
    expect(context?.originalProcesses?.map((process) => process.sessionId)).toEqual([
      "actual-logical-aliases#first",
      "actual-logical-aliases#fallback",
    ]);
    expect(Object.isFrozen(context?.originalProcesses)).toBe(true);
    finish();
    await turn;
  });

  it("admits a real replacement writer after a seeded warm source while cleanup retains both originals", async () => {
    nativeReceipts();
    const { JsonRpcClient } = await import("./jsonRpc");
    const source = await import("../providers/turnWriter");
    const selected: ChildProcessHandle[] = [];
    let secondReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      secondReady = resolve;
    });
    let finishSecond!: () => void;
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      const prior = selected.at(-1);
      const current = createChildProcessHandle(input.sessionId, input.nativeControlTurn);
      source.observeProviderProcess(input, current, "starting");
      selected.push(current);
      if (prior) await killChild(prior);
      await spawnChild(current, "claude", [], input.cwd);
      const rpc = new JsonRpcClient(current, {});
      try {
        const writer = await source.captureRpcTurnWriter(
          current,
          rpc,
          input.nativeControlTurn,
          input.operationContext,
        )();
        await writer.notify(`startup-${selected.length}`);
        if (selected.length === 2) {
          const done = new Promise<void>((resolve) => {
            finishSecond = resolve;
          });
          secondReady();
          await done;
        }
      } finally {
        source.finishProviderOperation(input.operationContext);
        rpc.close();
      }
    });
    const cancelTurn = vi.fn(async (_sessionId: string, _context?: HarnessOperationContext) => {});
    registerHarness(stub("claude", { sendTurn, cancelTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "seeded-warm-replacement",
      cwd: "/first",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    await sendHarnessTurn(input);
    const second = sendHarnessTurn({ ...input, cwd: "/second", text: "restart" });
    await Promise.race([
      ready,
      second.then(() => {
        throw new Error("The replacement operation ended before its source was held.");
      }),
    ]);
    await cancelHarnessTurn("claude", input.sessionId);
    expect(cancelTurn.mock.calls[0]?.[1]?.originalProcesses).toEqual(selected);
    expect(selected[0]).not.toBe(selected[1]);
    const writes = nativeInvoke.mock.calls.filter(
      ([command]) => command === "harness_write_controlled",
    );
    expect(writes.map(([, raw]) => JSON.parse((raw as { line: string }).line).method)).toEqual([
      "startup-1",
      "startup-2",
    ]);
    finishSecond();
    await second;
    await killChild(selected[1]!);
  });

  it("captures a follow-up's submitted Native turn before startup awaits and never borrows the next turn", async () => {
    nativeReceipts();
    let begin!: () => void;
    let finish!: () => void;
    const sends: SendTurnInput[] = [];
    const sendTurn = vi.fn(async (input: SendTurnInput) => {
      sends.push(input);
      if (sends.length === 1) {
        await new Promise<void>((resolve) => {
          begin = resolve;
        });
        input.onAccepted?.();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
    });
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    registerHarness(stub("codex", { sendTurn, steerTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "original-submit-context",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn(input);
    const followup = { ...input, text: "follow-up", modelSettings: { effort: "low" } };
    const steer = steerHarnessTurn(followup);
    followup.sessionId = "another-followup-target";
    followup.cwd = "/changed";
    followup.text = "changed after queueing";
    followup.modelSettings.effort = "high";
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    expect(steerTurn).not.toHaveBeenCalled();
    begin();
    await steer;
    const original = steerTurn.mock.calls[0]?.[0];
    expect(original).toMatchObject({
      sessionId: input.sessionId,
      cwd: "/tmp",
      text: expect.stringMatching(/^follow-up(?:\n|$)/),
      modelSettings: { effort: "low" },
    });
    expect(original?.text).not.toContain("changed after queueing");
    expect(original?.text).toContain("bycoda skill restrictions");
    expect(original?.nativeControlTurn).toBe(sends[0]?.nativeControlTurn);
    expect(original?.operationContext?.operation).toBe(sends[0]?.operationContext?.operation);
    finish();
    await first;
    await sendHarnessTurn({ ...input, text: "second" });
    expect(sends[1]?.nativeControlTurn).not.toBe(original?.nativeControlTurn);
    expect(nativeControlTurnReceipt(original!.nativeControlTurn!).turnId).not.toBe(
      nativeControlTurnReceipt(sends[1]!.nativeControlTurn!).turnId,
    );
  });

  it("authorizes and finishes standalone compaction and edit with their own Native control", async () => {
    nativeReceipts();
    const compactContext = vi.fn(async (_input: import("./types").CompactContextInput) => {});
    const rewindLastTurn = vi.fn(async (_input: import("./types").RewindLastTurnInput) => ({
      submitted: false,
    }));
    registerHarness(stub("codex", { compactContext, rewindLastTurn }));
    const input = {
      harness: "codex" as const,
      sessionId: "standalone-native-operations",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      onEvent: vi.fn(),
    };
    await compactHarnessContext(input);
    await rewindHarnessLastTurn(input);
    const compact = compactContext.mock.calls[0]![0];
    const edit = rewindLastTurn.mock.calls[0]![0];
    expect(compact.nativeControlTurn).toBeDefined();
    expect(edit.nativeControlTurn).toBeDefined();
    expect(compact.nativeControlTurn).not.toBe(edit.nativeControlTurn);
    const finished = nativeInvoke.mock.calls.filter(
      ([command]) => command === "control_turn_finished",
    );
    expect(finished.map(([, args]) => args)).toEqual([
      { receipt: nativeControlTurnReceipt(compact.nativeControlTurn!) },
      { receipt: nativeControlTurnReceipt(edit.nativeControlTurn!) },
    ]);
  });
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

  it("remaps a foreign provider model to the provider default for every operation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    const compactContext = vi.fn(async (_input: import("./types").CompactContextInput) => {});
    const rewindLastTurn = vi.fn(async (_input: import("./types").RewindLastTurnInput) => ({
      submitted: false,
    }));
    const runTextPrompt = vi.fn(async (_input: { model?: string }) => "ok");
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
    const fallback = defaultModelId("codex");
    await sendHarnessTurn(input);
    await steerHarnessTurn(input);
    await compactHarnessContext(input);
    await rewindHarnessLastTurn(input);
    await runHarnessTextPrompt({ ...input, prompt: "Recap" });
    for (const operation of [sendTurn, steerTurn, compactContext, rewindLastTurn, runTextPrompt]) {
      expect(operation).toHaveBeenCalledOnce();
      expect((operation.mock.calls[0] as [{ model?: string }])[0].model).toBe(fallback);
    }
    // The caller's own input is never mutated.
    expect(input.model).toBe("antigravity:gemini-3.8-flash-high");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
  it("warns about a failed Stop, lets Stop retry and never fails the turn or the next one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const sendTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelTurn = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
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
    // Stop reports the failure so the caller can show it; the turn itself is unaffected.
    expect(await results).toMatchObject([
      { status: "rejected", reason: { message: "pipe unavailable" } },
      { status: "rejected", reason: { message: "pipe unavailable" } },
    ]);
    // The failure was not cached: a later Stop reaches the adapter again.
    const retry = cancelHarnessTurn("claude", input.sessionId);
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledTimes(2));
    fail(new Error("pipe unavailable again"));
    await expect(retry).rejects.toThrow("pipe unavailable again");
    finish();
    await turn;
    const replacement = sendHarnessTurn({ ...input, text: "replacement" });
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(2));
    finish();
    await replacement;
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("escalates a repeated Stop to a session stop once the first was never confirmed", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let finish!: () => void;
    const sendTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    // The provider swallows the cancel: the promise never settles.
    const cancelTurn = vi.fn(() => new Promise<void>(() => {}));
    const stopSession = vi.fn(async () => {
      finish();
    });
    registerHarness(stub("claude", { sendTurn, cancelTurn, stopSession }));
    const input = {
      harness: "claude" as const,
      sessionId: "escalate-stop",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: vi.fn(),
    };
    const turn = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    const first = cancelHarnessTurn("claude", input.sessionId);
    const firstReported = expect(first).rejects.toThrow("did not confirm Stop");
    await vi.waitFor(() => expect(cancelTurn).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    await firstReported;
    expect(stopSession).not.toHaveBeenCalled();
    // The second Stop does not wait on the same hung promise: it stops the session.
    await cancelHarnessTurn("claude", input.sessionId);
    expect(stopSession).toHaveBeenCalledOnce();
    expect(cancelTurn).toHaveBeenCalledOnce();
    await turn;
    expect(warn).toHaveBeenCalledWith(
      "[harness] turn cancellation failed",
      expect.objectContaining({ message: expect.stringContaining("stopping the session") }),
    );
    warn.mockRestore();
  });

  it("warns once when a running turn goes silent and clears the notice when the provider speaks", async () => {
    vi.useFakeTimers();
    let emit!: (event: HarnessEvent) => void;
    let finish!: () => void;
    const sendTurn = vi.fn((input: SendTurnInput) => {
      emit = input.onEvent;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    registerHarness(stub("claude", { sendTurn }));
    const onEvent = vi.fn();
    const input = {
      harness: "claude" as const,
      sessionId: "silent-turn",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent,
    };
    const notices = () =>
      onEvent.mock.calls
        .map(([event]) => event as HarnessEvent)
        .filter((event) => event.type === "status" && event.key === TURN_INACTIVITY_STATUS_KEY);
    const turn = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    emit({ type: "turn.started", providerTurnId: "t1" });
    await vi.advanceTimersByTimeAsync(TURN_INACTIVITY_WARNING_MS - 1);
    expect(notices()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(notices()).toEqual([
      { type: "status", key: TURN_INACTIVITY_STATUS_KEY, text: expect.stringContaining("claude") },
    ]);
    // Silence is reported once; the turn keeps running.
    await vi.advanceTimersByTimeAsync(TURN_INACTIVITY_WARNING_MS * 3);
    expect(notices()).toHaveLength(1);
    expect(sendTurn).toHaveBeenCalledOnce();
    // The provider speaks again: the notice row is cleared and the clock restarts.
    emit({ type: "message.delta", text: "back" });
    expect(notices()).toHaveLength(2);
    expect(notices()[1]).toEqual({ type: "status", key: TURN_INACTIVITY_STATUS_KEY, text: "" });
    await vi.advanceTimersByTimeAsync(TURN_INACTIVITY_WARNING_MS);
    expect(notices()).toHaveLength(3);
    finish();
    await turn;
    // The turn ended while the notice was up: it does not outlive the turn.
    expect(notices()).toHaveLength(4);
    expect(notices()[3].text).toBe("");
    expect(onEvent.mock.calls.map(([event]) => (event as HarnessEvent).type)).toContain(
      "message.delta",
    );
  });

  it("does not count silence while the turn waits on the user", async () => {
    vi.useFakeTimers();
    let emit!: (event: HarnessEvent) => void;
    let finish!: () => void;
    const sendTurn = vi.fn((input: SendTurnInput) => {
      emit = input.onEvent;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    registerHarness(stub("claude", { sendTurn }));
    const onEvent = vi.fn();
    const input = {
      harness: "claude" as const,
      sessionId: "waiting-turn",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent,
    };
    const notices = () =>
      onEvent.mock.calls
        .map(([event]) => event as HarnessEvent)
        .filter((event) => event.type === "status" && event.key === TURN_INACTIVITY_STATUS_KEY);
    const turn = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    emit({ type: "approval.requested", requestId: 1, title: "Run command" });
    await vi.advanceTimersByTimeAsync(TURN_INACTIVITY_WARNING_MS * 2);
    expect(notices()).toEqual([]);
    emit({ type: "approval.resolved", requestId: 1, decision: "allow" });
    await vi.advanceTimersByTimeAsync(TURN_INACTIVITY_WARNING_MS);
    expect(notices()).toHaveLength(1);
    finish();
    await turn;
  });

  it("does not admit a late Stop between original completion and route removal", async () => {
    let finish!: () => void;
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    sendTurn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelTurn = vi.fn(() => new Promise<void>(() => {}));
    registerHarness(stub("claude", { sendTurn, cancelTurn }));
    const input = {
      harness: "claude" as const,
      sessionId: "late-stop-completion-boundary",
      cwd: "/tmp",
      model: "claude:test",
      runtimeMode: "supervised" as const,
      text: "first",
      onEvent: vi.fn(),
    };
    const first = sendHarnessTurn(input);
    await vi.waitFor(() => expect(sendTurn).toHaveBeenCalledOnce());
    let cancellation: Promise<void> | undefined;
    let observed!: () => void;
    const attempted = new Promise<void>((resolve) => {
      observed = resolve;
    });
    finish();
    queueMicrotask(() => {
      cancellation = cancelHarnessTurn("claude", input.sessionId);
      observed();
    });
    await attempted;
    await first;
    expect(cancelTurn).not.toHaveBeenCalled();
    await cancellation;
    await sendHarnessTurn({ ...input, text: "second" });
    expect(sendTurn).toHaveBeenCalledTimes(2);
    expect(cancelTurn).not.toHaveBeenCalled();
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
  it("waits for idle Codex parking before allowing a queued follow-up", async () => {
    vi.useFakeTimers();
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
    await first;
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).toHaveBeenCalledOnce();
    const second = sendHarnessTurn(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendTurn).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["send", "release", "send"]);
  });

  it("reports reply end before idle parking and joins an in-progress park", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let release!: () => void;
    const stopSession = vi.fn(async () => {
      order.push("release");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const sendTurn = vi.fn(async () => {
      order.push("send");
    });
    registerHarness(stub("codex", { sendTurn, stopSession }));
    const onReplyEnded = vi.fn(() => order.push("reply-ended"));
    const input = {
      harness: "codex" as const,
      sessionId: "writer-release-deferred",
      cwd: "/tmp",
      model: "codex:test",
      runtimeMode: "supervised" as const,
      text: "hello",
      onEvent: () => {},
    };
    await sendHarnessTurn({ ...input, onReplyEnded });
    expect(order).toEqual(["send", "reply-ended"]);
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(order).toEqual(["send", "reply-ended", "release"]);
    expect(onReplyEnded).toHaveBeenCalledWith(expect.any(Number));
    // The stop is still running, so the next turn must not start a second writer.
    const second = sendHarnessTurn(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendTurn).toHaveBeenCalledOnce();
    release();
    await second;
    expect(sendTurn).toHaveBeenCalledTimes(2);
    expect(stopSession).toHaveBeenCalledOnce();
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

  it("retires a warm lightweight writer on transfer with a best-effort stop and native retire", async () => {
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
    expect(retainedHarnessWriters()).toContain("lightweight-transfer");
    await retireHarnessWriter("lightweight-transfer");
    expect(stopSession).toHaveBeenCalledOnce();
    expect(nativeInvoke).toHaveBeenCalledWith("harness_retire", {
      sessionId: "lightweight-transfer",
    });
    expect(retainedHarnessWriters()).not.toContain("lightweight-transfer");
  });

  it("retains the writer record when stop and native retire both fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stopSession = vi.fn(async (): Promise<void> => {
      throw new Error("stop failed");
    });
    registerHarness(stub("codex", { stopSession }));
    nativeInvoke.mockImplementation(async (command) => {
      if (command === "harness_retire") throw new Error("retire failed");
      return undefined;
    });
    await sendHarnessTurn({
      harness: "codex",
      sessionId: "failed-retirement",
      cwd: "/tmp/worktree",
      model: "codex:test",
      runtimeMode: "supervised",
      text: "hello",
      onEvent: vi.fn(),
      lightweightWorktree: true,
    });
    expect(retainedHarnessWriters()).toContain("failed-retirement");
    await expect(retireHarnessWriter("failed-retirement")).rejects.toThrow("stop failed");
    expect(retainedHarnessWriters()).toContain("failed-retirement");
    expect(warn).toHaveBeenCalled();
    // A second transfer retries the original writer.
    stopSession.mockResolvedValue(undefined);
    nativeInvoke.mockResolvedValue(undefined);
    await expect(retireHarnessWriter("failed-retirement")).resolves.toBeUndefined();
    expect(retainedHarnessWriters()).not.toContain("failed-retirement");
    expect(stopSession).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("retires a writer queued behind the original turn only after that turn finishes", async () => {
    let started!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stopSession = vi.fn(async () => {});
    registerHarness(
      stub("codex", {
        stopSession,
        sendTurn: async () => {
          started();
          await held;
        },
      }),
    );
    const sending = sendHarnessTurn({
      harness: "codex",
      sessionId: "queued-transfer",
      cwd: "/tmp/worktree",
      model: "codex:test",
      runtimeMode: "supervised",
      text: "original turn",
      onEvent: vi.fn(),
      lightweightWorktree: true,
    });
    const transferring = retireHarnessWriter("queued-transfer");
    await entered;
    expect(stopSession).not.toHaveBeenCalled();
    finish();
    await sending;
    await transferring;
    expect(stopSession).toHaveBeenCalledOnce();
    expect(retainedHarnessWriters()).not.toContain("queued-transfer");
    resetHarnessIdlePark();
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
    nativeEnabled.mockReset().mockReturnValue(false);
    nativeInvoke.mockReset().mockResolvedValue(undefined);
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
