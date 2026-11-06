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
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

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

import { defaultModelId, resetHarnessModelOverlays } from "../../../features/sessions/model/models";
import type { HarnessId } from "../../../features/sessions/model/session";
import {
  compactHarnessContext,
  generateHarnessTitle,
  registerHarness,
  resetHarnessIdlePark,
  runHarnessTextPrompt,
  sendHarnessTurn,
  steerHarnessTurn,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";

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

describe("harness registry: reserved delegation keys", () => {
  afterEach(() => {
    nativeEnabled.mockReset().mockReturnValue(false);
    nativeInvoke.mockReset().mockResolvedValue(undefined);
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    socialBridgeMock.mockReset().mockResolvedValue(null);
    runtimeLogsBridgeMock.mockReset().mockResolvedValue(null);
    vi.useRealTimers();
  });

  it("never hands bycoda's reserved delegation keys to an adapter, on any operation", async () => {
    const reserved = {
      effort: "high",
      crossSubagents: JSON.stringify([{ harness: "claude", model: "claude:opus-5-5" }]),
      crossAdvisor: JSON.stringify({ harness: "claude", model: "claude:sonnet-5" }),
      delegationParent: JSON.stringify({
        parentSessionId: "p",
        runId: "r",
        kind: "subagent",
        model: "codex:gpt-6.1-sol",
        startedAt: 1,
      }),
    };
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    const steerTurn = vi.fn(async (_input: SteerTurnInput) => {});
    const compactContext = vi.fn(async (_input: import("./types").CompactContextInput) => {});
    const runTextPrompt = vi.fn(async (_input: { modelSettings?: Record<string, string> }) => "ok");
    const generateTitle = vi.fn(async (_input: { modelSettings?: Record<string, string> }) => null);
    registerHarness(
      stub("codex", { sendTurn, steerTurn, compactContext, runTextPrompt, generateTitle }),
    );
    const base = {
      harness: "codex" as const,
      sessionId: "reserved-keys",
      cwd: "/tmp",
      model: defaultModelId("codex"),
      runtimeMode: "supervised" as const,
      text: "Continue",
      modelSettings: { ...reserved },
      onEvent: vi.fn(),
    };
    await sendHarnessTurn(base);
    await steerHarnessTurn(base);
    await compactHarnessContext(base);
    await runHarnessTextPrompt({ ...base, prompt: "Recap" });
    await generateHarnessTitle("codex", {
      ...base,
      prompt: "Name this",
    } as unknown as Parameters<typeof generateHarnessTitle>[1]);
    const seen = [
      sendTurn.mock.calls[0][0],
      steerTurn.mock.calls[0][0],
      compactContext.mock.calls[0][0],
      runTextPrompt.mock.calls[0][0],
      generateTitle.mock.calls[0][0],
    ];
    for (const input of seen) {
      expect(input.modelSettings).toEqual({ effort: "high" });
    }
    // The caller's own settings object is never stripped in place.
    expect(base.modelSettings).toHaveProperty("crossAdvisor");
  });
});
