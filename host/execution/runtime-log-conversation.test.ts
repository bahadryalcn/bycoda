import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeLogSource } from "../../src/features/host-tools/runtimeLogTypes";
import type { RuntimeLogSubjectPrincipal } from "./runtime-log-tools";
import { callRuntimeLogAction } from "./runtime-log-conversation";
import { RuntimeLogWaiter } from "./runtime-log-wait";
import { RuntimeLogsService } from "./runtime-logs";

const SOURCE: RuntimeLogSource = {
  id: "server:terminal:t1",
  kind: "server",
  label: "terminal",
  projectId: "p",
  available: true,
};
const PRINCIPAL: RuntimeLogSubjectPrincipal = {
  kind: "session",
  projectId: "p",
  sessionId: "s1",
  provider: "codex",
};

let logs: RuntimeLogsService;
let waiter: RuntimeLogWaiter;
let response: EventEmitter & Pick<import("node:http").ServerResponse, "once" | "off">;

function deps(authorized = true) {
  return {
    runtimeLogs: logs,
    runtimeLogWaiter: waiter,
    refreshLogSources: async () => undefined,
    conversationAccess: { principalForToken: async () => (authorized ? PRINCIPAL : undefined) },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  logs = new RuntimeLogsService();
  logs.setSource(SOURCE);
  waiter = new RuntimeLogWaiter(logs, { pollMs: 250 });
  response = new EventEmitter() as typeof response;
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("conversation runtime log dispatch", () => {
  it("serves terminal reads from the terminal source of the caller's project", async () => {
    logs.add(SOURCE, { timestamp: 0, level: "info", message: "hello" });
    const result = (await callRuntimeLogAction(
      deps(),
      { response, token: "t" },
      "terminals.read",
      { terminalId: "t1" },
      PRINCIPAL,
    )) as { entries: { message: string }[] };
    expect(result.entries.map((entry) => entry.message)).toEqual(["hello"]);
  });

  it("rejects actions it does not own", async () => {
    await expect(
      callRuntimeLogAction(deps(), { response, token: "t" }, "browser.status", {}, PRINCIPAL),
    ).rejects.toThrow("Unsupported runtime log action.");
  });
});

describe("logs.wait client disconnect", () => {
  it("stops the wait when the response closes before a match", async () => {
    const pending = callRuntimeLogAction(
      deps(),
      { response, token: "t" },
      "logs.wait",
      { terminalId: "t1", contains: "never" },
      PRINCIPAL,
    ).then(
      () => "resolved",
      (error: Error) => error.name,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(response.listenerCount("close")).toBe(1);
    response.emit("close");
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe("RuntimeLogWaitStopped");
    expect(response.listenerCount("close")).toBe(0);
  });

  it("removes the close listener when the wait finishes normally", async () => {
    const pending = callRuntimeLogAction(
      deps(),
      { response, token: "t" },
      "logs.wait",
      { terminalId: "t1", timeoutSeconds: 1 },
      PRINCIPAL,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ reason: "timeout" });
    expect(response.listenerCount("close")).toBe(0);
  });
});
