// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { resetSessionsStore, setSessions } from "../../../features/sessions/model/sessionsStore";
import { useOrchestratorBinding, type OrchestratorBindingDeps } from "./useOrchestratorBinding";
import type { OrchestrationHost } from "../../../features/orchestration/model/orchestration";
import { createChildProcessHandle } from "../../../integrations/harness/core/child";
import {
  beginNativeControlTurn,
  nativeControlTurnReceipt,
  type NativeControlInvoke,
} from "../../../integrations/harness/core/controlTurn";
import { registerHarness, type HarnessAdapter } from "../../../integrations/harness/core/registry";
import { readApprovalIntent } from "../../../features/sessions/model/approvalIntents";
import {
  beginParentInputClosure,
  captureParentInputs,
} from "../../../features/sessions/data/parentInputClosure";

const sync = vi.hoisted(() => vi.fn());
const ports = vi.hoisted(() => ({
  bind: vi.fn(),
  invoke: vi.fn(async () => {}),
  stop: vi.fn(),
  captureProcess: vi.fn(),
  killProcess: vi.fn(),
}));
async function controlledProcess(sessionId: string) {
  const receipt = { version: 1 as const, sessionId, turnId: crypto.randomUUID() };
  const originalInvoke = ports.invoke;
  const invoke: NativeControlInvoke = async <T>(command: string, args?: Record<string, unknown>) =>
    (command === "control_authorize_turn" ? receipt : await originalInvoke(command, args)) as T;
  const control = await beginNativeControlTurn(sessionId, "/fixture", false, invoke);
  return {
    handle: createChildProcessHandle(sessionId, control),
    receipt: nativeControlTurnReceipt(control),
  };
}
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { bind: ports.bind, sync },
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: ports.invoke,
}));
vi.mock("../../../integrations/harness/core/child", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../integrations/harness/core/child")>()),
  captureChildProcess: ports.captureProcess,
  killChild: ports.killProcess,
}));
vi.mock("../../../integrations/harness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../integrations/harness")>()),
  stopHarnessSession: ports.stop,
}));

const deps: OrchestratorBindingDeps = {
  tabs: [],
  activeTabId: "",
  setTabs: vi.fn(),
  setActiveTabId: vi.fn(),
  orchestrationRuns: [],
  setHistory: vi.fn(),
  setStoredLinkedSessions: vi.fn(),
  checkOpenWorktreeFiles: vi.fn(),
  submitSession: () => false,
  onStop: vi.fn(),
  flushHarnessEvents: vi.fn(),
};
function Harness() {
  useOrchestratorBinding(deps);
  return null;
}
afterEach(() => {
  resetSessionsStore([]);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  ports.stop.mockReset();
  ports.captureProcess.mockReset();
  ports.killProcess.mockReset();
});

async function mounted(session: ReturnType<typeof newSession>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([session]);
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  return {
    host: ports.bind.mock.calls.at(-1)![0] as OrchestrationHost,
    close: async () => {
      await act(async () => root.unmount());
    },
  };
}
const occurrenceA = "7e1c4dc0-6f53-4aa8-b8d8-000000000001";
const occurrenceB = "7e1c4dc0-6f53-4aa8-b8d8-000000000002";
function approvalWorker(id: string) {
  return {
    ...newSession("claude", "/fixture"),
    id,
    blocks: [
      {
        id: "original-approval",
        role: "approval" as const,
        text: "Original request",
        approval: { requestId: 7, occurrenceId: occurrenceA },
      },
    ],
  };
}
function nativeAdapter() {
  const approve = vi.fn();
  registerHarness({
    id: "claude",
    name: "Fixture",
    live: true,
    respondApproval: approve,
    sendTurn: async () => {},
    cancelTurn: async () => {},
    stopSession: async () => {},
    forgetSession: async () => {},
    bindSession: () => {},
  } as HarnessAdapter);
  return approve;
}

it("syncs initially, coalesces store updates, ignores text frames and cancels on cleanup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = {
    ...newSession("claude", "/project"),
    blocks: [{ id: "a", role: "assistant" as const, text: "Hi", streaming: true }],
  };
  resetSessionsStore([session]);
  sync.mockClear();
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () =>
      setSessions([{ ...session, blocks: [{ ...session.blocks[0], text: "Hi there" }] }]),
    );
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      setSessions([{ ...session, title: "Renamed" }]);
      setSessions([{ ...session, title: "Renamed again" }]);
    });
    expect(sync).toHaveBeenCalledTimes(2);
    await act(async () => {
      setSessions([{ ...session, title: "Queued before disposal" }]);
      root.unmount();
    });
    expect(sync).toHaveBeenCalledTimes(2);
    setSessions([session]);
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});

it("retains a renderer-reload orphan as unknown instead of acknowledging a session-only kill", async () => {
  ports.captureProcess.mockReturnValue(undefined);
  const f = await mounted({ ...newSession("claude", "/fixture"), id: "orphan" });
  try {
    await expect(f.host.stop("orphan")).rejects.toThrow("original process cannot be verified");
    expect(ports.stop).not.toHaveBeenCalled();
    expect(ports.killProcess).not.toHaveBeenCalled();
    expect(ports.invoke).not.toHaveBeenCalledWith("control_turn_finished", expect.anything());
    expect(ports.invoke).not.toHaveBeenCalledWith("harness_kill", expect.anything());
  } finally {
    await f.close();
  }
});

it("uses the original accepted handle after provider cleanup and never recaptures a kill target", async () => {
  const controlled = await controlledProcess("original-worker");
  const original = controlled.handle;
  ports.captureProcess.mockReturnValue(original);
  ports.stop.mockImplementation(async () => {
    ports.captureProcess.mockReturnValue(undefined);
  });
  ports.killProcess.mockResolvedValue(undefined);
  const f = await mounted({ ...newSession("claude", "/fixture"), id: "original-worker" });
  try {
    await f.host.stop("original-worker");
    expect(ports.captureProcess.mock.invocationCallOrder[0]).toBeLessThan(
      ports.stop.mock.invocationCallOrder[0],
    );
    expect(ports.killProcess).toHaveBeenCalledExactlyOnceWith(original);
    expect(ports.invoke).toHaveBeenCalledWith("control_turn_finished", {
      receipt: controlled.receipt,
    });
    expect(ports.invoke).not.toHaveBeenCalledWith("harness_kill", expect.anything());
  } finally {
    await f.close();
  }
});

it("does not kill or acknowledge a replacement that arrived during the original stop", async () => {
  const original = createChildProcessHandle("worker-race");
  ports.captureProcess.mockReturnValue(original);
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  ports.stop.mockReturnValueOnce(held);
  const f = await mounted({ ...newSession("claude", "/fixture"), id: "worker-race" });
  try {
    const stopping = f.host.stop("worker-race").catch((error: Error) => error);
    expect(ports.stop).toHaveBeenCalledOnce();
    ports.captureProcess.mockReturnValue(createChildProcessHandle("worker-race"));
    finish();
    expect(await stopping).toEqual(
      expect.objectContaining({ message: expect.stringContaining("process changed") }),
    );
    expect(ports.killProcess).not.toHaveBeenCalled();
    expect(ports.invoke).not.toHaveBeenCalledWith("control_turn_finished", expect.anything());
  } finally {
    finish();
    await f.close();
  }
});

it("uses the actual approval intent and Parent actor for an exact delegated nonce, retaining its unknown result", async () => {
  const approve = nativeAdapter();
  const session = approvalWorker("delegated-original");
  const f = await mounted(session);
  try {
    expect(f.host.respondApproval(session.id, 7, "allow", occurrenceB)).toBe(false);
    expect(f.host.respondApproval(session.id, 7, "allow", undefined as never)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(f.host.respondApproval(session.id, 7, "allow", occurrenceA)).toBe(true);
    expect(approve).toHaveBeenCalledExactlyOnceWith(session.id, 7, "allow", occurrenceA);
    expect(readApprovalIntent(session, 7)).toMatchObject({
      phase: "unconfirmed",
      callback: "void",
      providerAck: "unproved",
      repeatBlocked: true,
    });
    expect(f.host.respondApproval(session.id, 7, "deny", occurrenceA)).toBe(false);
    const capture = await captureParentInputs("delegated-original-cut");
    try {
      const actors = capture.snapshots.filter((entry) => entry.kind === "approval-decision");
      expect(JSON.stringify(actors)).toContain('"providerAck":"unproved"');
      expect(JSON.stringify(actors)).toContain(session.id);
      expect(JSON.stringify(actors)).toContain(occurrenceA);
    } finally {
      capture.release();
    }
    expect(approve).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});

it("keeps delegated approval ingress blocked by the real shared Parent gate and retries only the same original after release", async () => {
  const approve = nativeAdapter();
  const session = approvalWorker("delegated-closed");
  const f = await mounted(session);
  const gate = beginParentInputClosure("delegated-logical-cut", { owner: {}, timeoutMs: 1000 });
  try {
    await gate.capture;
    expect(f.host.respondApproval(session.id, 7, "deny", occurrenceA)).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    gate.release();
    expect(f.host.respondApproval(session.id, 7, "deny", occurrenceA)).toBe(true);
    expect(approve).toHaveBeenCalledExactlyOnceWith(session.id, 7, "deny", occurrenceA);
  } finally {
    gate.release();
    await f.close();
  }
});
