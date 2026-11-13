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

import {
  defaultModelId,
  nativeModelId,
  resetHarnessModelOverlays,
} from "../../../features/sessions/model/models";
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
import { providerTurnInput } from "./providerInput";

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
  it.each([true, false])(
    "fresh Codex spawn grant ready=%s controls first-turn hints and notice",
    async (ready) => {
      nativeInvoke.mockImplementation(async (command, args) => {
        if (command === "harness_conversation_tools_bridge") {
          const request = args as { checkReady?: boolean; prepareSpawn?: boolean };
          if (request.checkReady) return { ready: request.prepareSpawn === true && ready };
        }
        return undefined;
      });
      const onEvent = vi.fn();
      registerHarness(
        stub("codex", {
          sendTurn: async (input) => {
            expect(input.text).toBe("First message");
            expect(
              input.runtimeInstructions?.includes("Host delegation is unavailable this turn"),
            ).toBe(!ready);
            input.onAccepted?.();
          },
        }),
      );
      await sendHarnessTurn({
        harness: "codex",
        sessionId: `fresh-spawn-${ready}`,
        cwd: "/tmp",
        model: defaultModelId("codex"),
        runtimeMode: "supervised",
        text: "First message",
        modelSettings: { crossSubagents: "auto" },
        onEvent,
      });
      expect(
        onEvent.mock.calls.filter(([event]) => event.key === "delegation-unavailable"),
      ).toHaveLength(ready ? 0 : 1);
    },
  );
  it("maps only same-account Claude choices to native settings", () => {
    const input = {
      harness: "claude",
      providerAccountId: "work",
      modelSettings: {
        subagentModel: "old",
        advisor: "old",
        crossSubagents: JSON.stringify([
          { harness: "claude", model: "claude:sonnet-5", providerAccountId: "work" },
        ]),
        crossAdvisor: JSON.stringify({
          harness: "claude",
          model: "claude:opus-5",
          providerAccountId: "other",
        }),
      },
    };
    expect(providerTurnInput(input, nativeModelId).modelSettings).toEqual({
      subagentModel: "claude-sonnet-5",
      subagentPolicy: "force",
      advisor: "off",
    });
    expect(input.modelSettings.advisor).toBe("old");
  });
  it("keeps native subagents inside the owner's selection", () => {
    const modelSettings = {
      advisor: "opus",
      subagentModel: "haiku",
      subagentPolicy: "force",
      crossAdvisor: "null",
      crossSubagents: "[]",
    };
    expect(
      providerTurnInput({ harness: "claude", modelSettings }, nativeModelId).modelSettings,
    ).toEqual({
      // Off: no native subagents at all.
      advisor: "off",
      subagentModel: "off",
    });
    const turn = (selection: unknown[]) =>
      providerTurnInput(
        {
          harness: "claude",
          modelSettings: { ...modelSettings, crossSubagents: JSON.stringify(selection) },
        },
        nativeModelId,
      ).modelSettings;
    // One same-account Claude model among others: native runs are forced onto it.
    expect(
      turn([
        { harness: "codex", model: "codex:gpt" },
        { harness: "claude", model: "claude:haiku" },
      ]),
    ).toEqual({ advisor: "off", subagentModel: "haiku", subagentPolicy: "force" });
    // No Claude model, two Claude models, or another account: native cannot honor it.
    for (const selection of [
      [{ harness: "codex", model: "codex:gpt" }],
      [
        { harness: "claude", model: "claude:haiku" },
        { harness: "claude", model: "claude:sonnet" },
      ],
      [{ harness: "claude", model: "claude:haiku", providerAccountId: "other" }],
    ])
      expect(turn(selection)).toEqual({ advisor: "off", subagentModel: "off" });
  });
  it("turns other providers' native subagents off whenever a subagent selection is set", () => {
    const codex = (modelSettings: Record<string, string>) =>
      providerTurnInput({ harness: "codex", modelSettings }, nativeModelId).modelSettings;
    const selection = JSON.stringify([{ harness: "codex", model: "codex:gpt-6.1-terra" }]);
    expect(codex({ effort: "high", crossSubagents: selection })).toEqual({
      effort: "high",
      nativeSubagents: "off",
    });
    expect(codex({ crossSubagents: "[]" })).toEqual({ nativeSubagents: "off" });
    // No selection saved: Codex keeps its own behavior.
    expect(codex({ effort: "high" })).toEqual({ effort: "high" });
    for (const harness of [
      "grok",
      "opencode",
      "antigravity",
      "cursor",
      "fx",
      "hermes",
      "pi",
      "omp",
      "acp",
    ])
      expect(
        providerTurnInput({ harness, modelSettings: { crossSubagents: selection } }, nativeModelId)
          .modelSettings,
      ).toEqual({ nativeSubagents: "off" });
  });
  it("passes the exact unified Claude model to the actual turn adapter", async () => {
    const sendTurn = vi.fn(async (_input: SendTurnInput) => {});
    registerHarness(stub("claude", { sendTurn }));
    await sendHarnessTurn({
      harness: "claude",
      sessionId: "claude-delegation",
      cwd: "/tmp",
      model: defaultModelId("claude"),
      runtimeMode: "supervised",
      text: "Continue",
      onEvent: vi.fn(),
      providerAccountId: "work",
      modelSettings: {
        crossSubagents: JSON.stringify([
          { harness: "claude", model: "claude:sonnet-5", providerAccountId: "work" },
        ]),
      },
    });
    expect(sendTurn.mock.calls[0][0].modelSettings).toEqual({
      subagentModel: "claude-sonnet-5",
      subagentPolicy: "force",
    });
  });
  it("announces delegation fallback once, only after the adapter accepts", async () => {
    const onEvent = vi.fn();
    const notices = () =>
      onEvent.mock.calls.filter(([event]) => event.key === "delegation-unavailable");
    registerHarness(
      stub("codex", {
        sendTurn: async (input: SendTurnInput) => {
          expect(notices()).toHaveLength(0);
          input.onAccepted?.();
          input.onEvent({ type: "turn.started" });
          expect(notices()).toHaveLength(1);
        },
      }),
    );
    await sendHarnessTurn({
      harness: "codex",
      sessionId: "accepted-delegation-notice",
      cwd: "/tmp",
      model: defaultModelId("codex"),
      runtimeMode: "supervised",
      text: "Continue",
      modelSettings: { crossSubagents: "auto" },
      onEvent,
    });
    expect(notices()).toHaveLength(1);
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
      const { nativeSubagents, ...rest } = input.modelSettings ?? {};
      expect(rest).toEqual({ effort: "high" });
      // Codex turns carry only the derived native-subagent switch, never the selection.
      expect([undefined, "off"]).toContain(nativeSubagents);
    }
    expect(sendTurn.mock.calls[0][0].modelSettings?.nativeSubagents).toBe("off");
    // The caller's own settings object is never stripped in place.
    expect(base.modelSettings).toHaveProperty("crossAdvisor");
  });
});
