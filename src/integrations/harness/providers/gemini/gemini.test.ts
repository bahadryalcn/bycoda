import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const mock = vi.hoisted(() => ({
  listeners: new Map<string, (line: string) => void>(),
  messages: [] as {
    child: string;
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
  }[],
  spawn: vi.fn(async () => undefined),
  kill: vi.fn(async (_id: string) => undefined),
  failAuth: false,
  failVerify: false,
  failModel: false,
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
vi.mock("../../core/child", () => ({
  resolveGeminiBinary: async () => ({ path: "/bin/gemini" }),
  spawnChild: mock.spawn,
  killChild: mock.kill,
  watchChild: (id: string, line: (line: string) => void) => mock.listeners.set(id, line),
  unwatchChild: (id: string) => mock.listeners.delete(id),
  writeChild: async (child: string, line: string) => {
    const message = JSON.parse(line);
    mock.messages.push({ child, ...message });
    if (message.id == null || !message.method || message.method === "session/prompt") return;
    queueMicrotask(() => {
      const error =
        (message.method === "authenticate" && mock.failAuth) ||
        (message.method === "session/new" && mock.failVerify) ||
        (message.method === "session/set_model" && mock.failModel);
      mock.listeners.get(child)?.(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          ...(error
            ? { error: { code: -32000, message: "Authentication required" } }
            : {
                result:
                  message.method === "session/new"
                    ? {
                        sessionId: "gemini-session",
                        models: {
                          availableModels: [
                            { modelId: "auto", name: "Auto" },
                            { modelId: "gemini-pro", name: "Pro" },
                          ],
                        },
                      }
                    : {},
              }),
        }),
      );
    });
  },
}));

import { discoverGeminiModels, loginGemini } from "./geminiCatalog";
import {
  sendGeminiTurn,
  cancelGeminiTurn,
  forgetGeminiSession,
  respondGeminiApproval,
} from "./gemini";

beforeEach(() => {
  mock.listeners.clear();
  mock.messages.length = 0;
  mock.spawn.mockClear();
  mock.kill.mockClear();
  mock.failAuth = mock.failVerify = mock.failModel = false;
});
afterEach(async () => {
  await forgetGeminiSession("thread");
});

const input = (
  events: HarnessEvent[],
  mode: SendTurnInput["runtimeMode"] = "supervised",
): SendTurnInput => ({
  sessionId: "thread",
  cwd: "/project",
  model: "gemini:gemini-pro",
  text: "Hello",
  runtimeMode: mode,
  onEvent: (event) => events.push(event),
});
const waitPrompt = () =>
  vi.waitFor(() => expect(mock.messages.some((m) => m.method === "session/prompt")).toBe(true));
function finishPrompt() {
  const message = mock.messages.findLast((m) => m.method === "session/prompt")!;
  mock.listeners.get(message.child)?.(
    JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn" },
    }),
  );
}

it("logs in with Google once and verifies persisted credentials in a fresh process", async () => {
  await Promise.all([loginGemini(), loginGemini()]);
  expect(mock.messages.filter((m) => m.method === "authenticate")).toHaveLength(1);
  expect(mock.messages.find((m) => m.method === "authenticate")?.params).toEqual({
    methodId: "oauth-personal",
  });
  expect(mock.spawn).toHaveBeenCalledTimes(2);
  expect(mock.kill).toHaveBeenCalledTimes(2);
  expect(mock.messages.find((m) => m.method === "session/new")?.child).not.toEqual(
    mock.messages.find((m) => m.method === "authenticate")?.child,
  );
});

it("rejects failed authentication and cleans up so the user can retry", async () => {
  mock.failAuth = true;
  await expect(loginGemini()).rejects.toThrow("Authentication required");
  expect(mock.kill).toHaveBeenCalledOnce();
  mock.failAuth = false;
  await expect(loginGemini()).resolves.toBeUndefined();
});

it("does not report success when fresh-process verification fails", async () => {
  mock.failVerify = true;
  await expect(loginGemini()).rejects.toThrow("Authentication required");
  expect(mock.kill).toHaveBeenCalledTimes(2);
});

it("discovers Gemini models without initiating authentication", async () => {
  expect(await discoverGeminiModels()).toEqual([
    { id: "gemini:auto", harness: "gemini", name: "Auto", nativeId: "auto" },
    {
      id: "gemini:gemini-pro",
      harness: "gemini",
      name: "Pro",
      nativeId: "gemini-pro",
    },
  ]);
  expect(mock.messages.some((m) => m.method === "authenticate")).toBe(false);
});

it("uses Gemini ACP model selection and streams messages", async () => {
  const events: HarnessEvent[] = [];
  const turn = sendGeminiTurn(input(events));
  await waitPrompt();
  expect(mock.spawn).toHaveBeenCalledWith(
    expect.any(String),
    "/bin/gemini",
    ["--experimental-acp"],
    "/project",
    undefined,
    "gemini",
  );
  expect(mock.messages.find((m) => m.method === "session/set_model")?.params).toEqual({
    sessionId: "gemini-session",
    modelId: "gemini-pro",
  });
  const prompt = mock.messages.find((m) => m.method === "session/prompt")!;
  mock.listeners.get(prompt.child)?.(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "gemini-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello back" },
        },
      },
    }),
  );
  finishPrompt();
  await turn;
  expect(events).toContainEqual({ type: "message.delta", text: "Hello back" });
  expect(events).toContainEqual({ type: "message.completed" });
});

it("fails before prompting when Gemini rejects a model change", async () => {
  mock.failModel = true;
  await expect(sendGeminiTurn(input([]))).rejects.toThrow();
  expect(mock.messages.some((m) => m.method === "session/prompt")).toBe(false);
});

it("waits for approval before allowing a tool in supervised mode", async () => {
  const events: HarnessEvent[] = [];
  const turn = sendGeminiTurn(input(events));
  await waitPrompt();
  const prompt = mock.messages.find((m) => m.method === "session/prompt")!;
  mock.listeners.get(prompt.child)?.(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 100,
      method: "session/request_permission",
      params: {
        sessionId: "gemini-session",
        toolCall: {
          toolCallId: "tool-1",
          title: "Run command",
          kind: "execute",
        },
        options: [
          { optionId: "yes", kind: "allow_once" },
          { optionId: "no", kind: "reject_once" },
        ],
      },
    }),
  );
  await vi.waitFor(() => expect(events.some((e) => e.type === "approval.requested")).toBe(true));
  expect(mock.messages.some((m) => m.id === 100)).toBe(false);
  respondGeminiApproval("thread", 100, "deny");
  await vi.waitFor(() =>
    expect(mock.messages.find((m) => m.id === 100)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "no" },
    }),
  );
  finishPrompt();
  await turn;
});

it("cancels a running prompt without leaving the turn waiting", async () => {
  const turn = sendGeminiTurn(input([]));
  await waitPrompt();
  await cancelGeminiTurn("thread");
  await turn;
});
