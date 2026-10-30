import { requestedApproval } from "../approvalOccurrence.testSupport";
import {
  exerciseOverlappingApproval,
  exerciseApprovalActualWriteLifetime,
} from "../approvalOverlap.testSupport";
import { captureNativeOutputWork, trackNativeOutputWork } from "../../core/nativeOutputDelivery";
import {
  nativeOutputFrame,
  captureNativeOutputEvent,
  getNativeOutputEventOrigin,
} from "../../core/nativeOutputDelivery.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AcpHandlers } from "../../core/acp";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const mock = vi.hoisted(() => ({
  handlers: {} as AcpHandlers,
  request: vi.fn(),
  respond: vi.fn(
    (_id: number, _result: unknown, onActualWrite?: (actual: Promise<void>) => void) => {
      const actual = Promise.resolve();
      onActualWrite?.(actual);
      return actual;
    },
  ),
  failMode: false,
  nativeModes: true,
  onExit: undefined as ((code: number | null) => void) | undefined,
  notify: vi.fn(async () => undefined),
}));
vi.mock("../../core/acp", () => ({
  AcpClient: class {
    constructor(_id: string, handlers: AcpHandlers) {
      mock.handlers = handlers;
    }
    request = mock.request;
    respond = mock.respond;
    respondError = vi.fn();
    close = vi.fn();
    notify = mock.notify;
  },
}));
vi.mock("../../core/child", () => ({
  spawnChild: vi.fn(),
  watchChild: (_id: string, _line: (line: string) => void, exit: (code: number | null) => void) => {
    mock.onExit = exit;
  },
  killChild: vi.fn(),
  invokeProviderCommand: async () => [],
}));
import {
  sendGenericAcpTurn,
  forgetGenericAcpSession,
  bindGenericAcpSession,
} from "./genericAcpAdapter";
import { applyHarnessEvent } from "../../core/apply";
import { newSession } from "../../../../features/sessions/model/session";
import { sanitizeSessionForPersist } from "../../../../features/sessions/data/sessionStore";

const events: HarnessEvent[] = [];
const input = (intent: SendTurnInput["intent"]): SendTurnInput => ({
  sessionId: "generic-plan",
  cwd: "/repo",
  model: "acp:agent",
  runtimeMode: "full-access",
  intent,
  text: "Plan the change",
  attachments: [],
  onEvent: (event) => events.push(event),
});
beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  mock.failMode = false;
  mock.nativeModes = true;
  mock.onExit = undefined;
  mock.respond.mockReset().mockImplementation((_id, _result, onActualWrite) => {
    const actual = Promise.resolve();
    onActualWrite?.(actual);
    return actual;
  });
  mock.request.mockImplementation(async (method: string) => {
    if (method === "session/set_mode" && mock.failMode) throw new Error("mode rejected");
    if (method === "session/new")
      return {
        sessionId: "native-session",
        ...(mock.nativeModes
          ? {
              modes: {
                currentModeId: "default",
                availableModes: [{ id: "default" }, { id: "plan" }],
              },
            }
          : {}),
      };
    return {};
  });
});
afterEach(async () => {
  await forgetGenericAcpSession("generic-plan");
});

it("switches to advertised plan mode and restores the prior mode for Build", async () => {
  await sendGenericAcpTurn(input("plan"));
  expect(mock.request).toHaveBeenCalledWith(
    "session/set_mode",
    { sessionId: "native-session", modeId: "plan" },
    30_000,
  );
  await sendGenericAcpTurn(input("build"));
  expect(mock.request).toHaveBeenLastCalledWith(
    "session/prompt",
    expect.anything(),
    0,
    expect.any(Function),
  );
  expect(mock.request).toHaveBeenCalledWith(
    "session/set_mode",
    { sessionId: "native-session", modeId: "default" },
    30_000,
  );
});

it("allows only read/search permissions during planning even without native modes", async () => {
  mock.nativeModes = false;
  await sendGenericAcpTurn(input("plan"));
  for (const [id, kind] of ["read", "search", "edit", "execute", "unknown"].entries()) {
    await mock.handlers.onRequest!(id, "session/request_permission", {
      toolCall: { kind },
      options: [
        { kind: "allow_once", optionId: "yes" },
        { kind: "reject_once", optionId: "no" },
      ],
    });
    expect(mock.respond).toHaveBeenLastCalledWith(id, {
      outcome: { outcome: "selected", optionId: id < 2 ? "yes" : "no" },
    });
  }
  expect(events.some((event) => event.type === "approval.requested")).toBe(false);
  await sendGenericAcpTurn(input("build"));
  await mock.handlers.onRequest!(10, "session/request_permission", {
    toolCall: { kind: "edit" },
    options: [],
  });
  expect(events.some((event) => event.type === "approval.requested")).toBe(true);
});

it("cancels a plan permission when the safe option is absent", async () => {
  await sendGenericAcpTurn(input("plan"));
  await mock.handlers.onRequest!(1, "session/request_permission", {
    toolCall: { kind: "edit" },
    options: [{ kind: "allow_once", optionId: "yes" }],
  });
  expect(mock.respond).toHaveBeenLastCalledWith(1, { outcome: { outcome: "cancelled" } });
});

it("does not send a prompt when a native plan mode transition fails", async () => {
  mock.failMode = true;
  await expect(sendGenericAcpTurn(input("plan"))).rejects.toThrow("mode rejected");
  expect(mock.request.mock.calls.some(([method]) => method === "session/prompt")).toBe(false);
});

it("captures provider-authored plan text", async () => {
  await sendGenericAcpTurn(input("plan"));
  mock.handlers.onNotification!("session/update", {
    update: { sessionUpdate: "plan", text: "# Plan\n\n1. Build" },
  });
  expect(events).toContainEqual({ type: "plan", text: "# Plan\n\n1. Build" });
});

it.each(["completed", "failed"])(
  "persists standard ACP tool result content (%s)",
  async (status) => {
    await sendGenericAcpTurn(input("build"));
    for (const update of [
      { sessionUpdate: "tool_call", toolCallId: "T", title: "Check", status: "running" },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "T",
        status,
        content: [{ type: "content", content: { type: "text", text: "42 checks passed" } }],
      },
    ])
      mock.handlers.onNotification!("session/update", { update });
    const session = events.reduce(applyHarnessEvent, newSession("acp", "/repo"));
    expect(session.blocks.find((block) => block.role === "tool")?.tool?.detail).toBe(
      "42 checks passed",
    );
    expect(JSON.stringify(sanitizeSessionForPersist(session))).toContain("42 checks passed");
  },
);

it("suppresses session/load history and keeps prompt output", async () => {
  bindGenericAcpSession("generic-plan", "stored", "/repo");
  mock.request.mockImplementation(async (method: string) => {
    if (method === "initialize") return { agentCapabilities: { loadSession: true } };
    if (method === "session/load" || method === "session/prompt") {
      mock.handlers.onNotification!("session/update", {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: method === "session/load" ? "Already stored answer" : "Fresh answer",
          },
        },
      });
    }
    return {};
  });
  await sendGenericAcpTurn(input("build"));
  const base = newSession("acp", "/repo");
  base.blocks = [
    { id: "old", role: "assistant", text: "Already stored answer" },
    { id: "next", role: "user", text: "Continue" },
  ];
  const session = events.reduce(applyHarnessEvent, base);
  expect(session.blocks.filter((block) => block.text === "Already stored answer")).toHaveLength(1);
  expect(session.blocks.some((block) => block.text === "Fresh answer")).toBe(true);
});

it("does not prompt or create a replacement session when load fails; retry keeps live output", async () => {
  bindGenericAcpSession("generic-plan", "stored", "/repo");
  mock.request.mockImplementation(async (method: string) => {
    if (method === "initialize") return { agentCapabilities: { loadSession: true } };
    if (method === "session/load") throw new Error("load failed");
    return {};
  });
  await expect(sendGenericAcpTurn(input("build"))).rejects.toThrow("load failed");
  expect(
    mock.request.mock.calls.some(
      ([method]) => method === "session/new" || method === "session/prompt",
    ),
  ).toBe(false);
  mock.request.mockImplementation(async (method: string) => {
    if (method === "initialize") return { agentCapabilities: { loadSession: true } };
    if (method === "session/prompt")
      mock.handlers.onNotification!("session/update", {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Retry answer" },
        },
      });
    return {};
  });
  await sendGenericAcpTurn(input("build"));
  expect(events).toContainEqual({ type: "message.delta", text: "Retry answer" });
});

it("retains a permission's real write after its UI callback returns", async () => {
  const { genericAcpAdapter } = await import("./genericAcpAdapter");
  await sendGenericAcpTurn({
    ...input(undefined),
    runtimeMode: "supervised",
    onEvent: (event) => {
      captureNativeOutputEvent("generic-plan", event);
      events.push(event);
    },
  });
  const inspect = nativeOutputFrame("generic-plan", "permission", () => {
    void mock.handlers.onRequest!(777, "session/request_permission", {
      toolCall: { title: "causal permission" },
      options: [{ optionId: "yes", kind: "allow_once" }],
    });
  });
  const asked = events.find((e) => e.type === "approval.requested")!;
  const origin = getNativeOutputEventOrigin(asked);
  expect(origin).not.toBeNull();
  let release!: () => void;
  mock.respond.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  genericAcpAdapter.respondApproval!(
    "generic-plan",
    777,
    "allow",
    requestedApproval(events, 777).occurrenceId,
  );
  expect(inspect().pendingCausalWork).toBe(1);
  expect(events.some((e) => e.type === "approval.resolved")).toBe(false);
  await vi.waitFor(() => expect(typeof release).toBe("function"));
  release();
  await vi.waitFor(() => expect(events.some((e) => e.type === "approval.resolved")).toBe(true));
  expect(getNativeOutputEventOrigin(events.find((e) => e.type === "approval.resolved")!)).toBe(
    origin,
  );
  expect(inspect().pendingCausalWork).toBe(0);
});

const permissionFixture = (id: number) =>
  nativeOutputFrame("generic-plan", `permission-${id}`, () => {
    void mock.handlers.onRequest!(id, "session/request_permission", {
      toolCall: { title: "Retained permission" },
      options: [{ optionId: "yes", kind: "allow_once" }],
    });
  });

it("retires waiting approval ownership on natural child exit", async () => {
  await sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" });
  const inspect = permissionFixture(301);
  expect(inspect().pendingCausalWork).toBe(1);
  mock.onExit!(0);
  await vi.waitFor(() => expect(inspect().pendingCausalWork).toBe(0));
  expect(mock.respond).not.toHaveBeenCalled();
});

it("retires an early waiting approval when startup rejects before Live registration", async () => {
  let inspect!: ReturnType<typeof nativeOutputFrame>;
  mock.request.mockImplementation(async (method: string) => {
    if (method === "initialize") {
      inspect = permissionFixture(302);
      expect(inspect().pendingCausalWork).toBe(1);
      throw new Error("fixture initialize rejected");
    }
    return {};
  });
  await expect(
    sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" }),
  ).rejects.toThrow("fixture initialize rejected");
  expect(inspect().pendingCausalWork).toBe(0);
  expect(mock.respond).not.toHaveBeenCalled();
});

it.each([false, true])(
  "fails closed on overlapping generic ACP permissions (allow already queued: %s)",
  async (allowBeforeDuplicate) => {
    const { genericAcpAdapter } = await import("./genericAcpAdapter");
    await sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" });
    await exerciseOverlappingApproval({
      events,
      requestId: 306,
      allowBeforeDuplicate,
      ask: () =>
        nativeOutputFrame("generic-plan", "generic-overlap", () => {
          void mock.handlers.onRequest!(306, "session/request_permission", {
            toolCall: { title: "Retained permission" },
            options: [
              { optionId: "yes", kind: "allow_once" },
              { optionId: "no", kind: "reject_once" },
            ],
          });
        }),
      approve: (nonce, decision) =>
        genericAcpAdapter.respondApproval!("generic-plan", 306, decision, nonce),
      replies: () =>
        mock.respond.mock.calls.filter(([id]) => id === 306).map(([, result]) => result),
      deniedResult: { outcome: { outcome: "selected", optionId: "no" } },
    });
  },
);

it.each([false, true])(
  "retains generic ACP source ownership across a mocked-client waiter timeout (cancel first: %s)",
  async (cancelBeforeTimeout) => {
    const { genericAcpAdapter } = await import("./genericAcpAdapter");
    await sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" });
    let gate: (() => Promise<void>) | null = null;
    mock.respond.mockImplementation((_id, _result, onActualWrite) => {
      const held = gate !== null;
      const actual = trackNativeOutputWork(
        gate ? gate() : Promise.resolve(),
        captureNativeOutputWork(),
      );
      onActualWrite?.(actual);
      if (!held) return actual;
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        actual,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("mock ACP write timed out")), 15_000);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    });
    await exerciseApprovalActualWriteLifetime({
      events,
      requestId: 993,
      cancelBeforeTimeout,
      ask: () =>
        nativeOutputFrame("generic-plan", "generic-actual-write", () => {
          void mock.handlers.onRequest!(993, "session/request_permission", {
            toolCall: { title: "Retained permission" },
            options: [{ optionId: "yes", kind: "allow_once" }],
          });
        }),
      approve: (nonce) => genericAcpAdapter.respondApproval!("generic-plan", 993, "allow", nonce),
      cancel: () => genericAcpAdapter.cancelTurn!("generic-plan"),
      holdWrites: (next) => {
        gate = next;
      },
      replies: () =>
        mock.respond.mock.calls.filter(([id]) => id === 993).map(([, result]) => result),
    });
  },
);

it("natural exit keeps a removed responding approval owned until its actual write settles", async () => {
  const { genericAcpAdapter } = await import("./genericAcpAdapter");
  await sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" });
  const inspect = permissionFixture(304);
  let release!: () => void;
  mock.respond.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  genericAcpAdapter.respondApproval!(
    "generic-plan",
    304,
    "allow",
    requestedApproval(events, 304).occurrenceId,
  );
  await vi.waitFor(() => expect(typeof release).toBe("function"));
  mock.onExit!(0);
  expect(inspect().pendingCausalWork).toBe(1);
  release();
  await vi.waitFor(() => expect(inspect().pendingCausalWork).toBe(0));
});

it("natural exit keeps an in-flight cancel reply owned until its actual write settles", async () => {
  const { genericAcpAdapter } = await import("./genericAcpAdapter");
  await sendGenericAcpTurn({ ...input(undefined), runtimeMode: "supervised" });
  const inspect = permissionFixture(305);
  let release!: () => void;
  mock.respond.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const cancelling = genericAcpAdapter.cancelTurn!("generic-plan");
  await vi.waitFor(() => expect(typeof release).toBe("function"));
  mock.onExit!(0);
  expect(inspect().pendingCausalWork).toBe(1);
  release();
  await cancelling;
  await vi.waitFor(() => expect(inspect().pendingCausalWork).toBe(0));
});
