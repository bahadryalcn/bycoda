import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AcpHandlers } from "../../core/acp";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const mock = vi.hoisted(() => ({
  handlers: {} as AcpHandlers,
  request: vi.fn(),
  respond: vi.fn(async () => undefined),
  failMode: false,
  nativeModes: true,
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
    notify = vi.fn();
  },
}));
vi.mock("../../core/child", () => ({
  spawnChild: vi.fn(),
  watchChild: vi.fn(),
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
  expect(mock.request).toHaveBeenLastCalledWith("session/prompt", expect.anything());
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
