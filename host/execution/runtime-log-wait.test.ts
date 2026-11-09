import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeLogSource } from "../../src/features/host-tools/runtimeLogTypes";
import { graphemes } from "../../src/shared/lib/text/truncate";
import type { RuntimeLogSubjectPrincipal } from "./runtime-log-tools";
import {
  LOG_WAIT_TOOL_DESCRIPTION,
  LOG_WAIT_TOOL_SCHEMA,
  RuntimeLogWaitStopped,
  RuntimeLogWaiter,
  isLogWaitTool,
  logWaitMaxTimeoutSeconds,
  parseLogWaitInput,
  prepareLogWait,
  type LogWaitResult,
} from "./runtime-log-wait";
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
let clock = 0;

/** Advances the injected clock and the fake timers together, one poll interval at a time. */
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    clock += 250;
    await vi.advanceTimersByTimeAsync(250);
  }
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function track(promise: Promise<LogWaitResult>) {
  const outcome: { result?: LogWaitResult; error?: unknown; settled: boolean } = {
    settled: false,
  };
  promise.then(
    (result) => Object.assign(outcome, { result, settled: true }),
    (error) => Object.assign(outcome, { error, settled: true }),
  );
  return outcome;
}

function start(
  waiter: RuntimeLogWaiter,
  input: Record<string, unknown>,
  options: {
    isAuthorized?: () => Promise<boolean>;
    signal?: AbortSignal;
    principal?: RuntimeLogSubjectPrincipal;
  } = {},
) {
  return track(
    waiter.wait({
      prepared: prepareLogWait(input, options.principal ?? PRINCIPAL),
      isAuthorized: options.isAuthorized ?? (async () => true),
      signal: options.signal,
    }),
  );
}

function line(message: string, details?: unknown) {
  return logs.add(SOURCE, { timestamp: 0, level: "info", message, details });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  logs = new RuntimeLogsService();
  logs.setSource(SOURCE);
});

afterEach(() => {
  // Every wait must release its timer when it settles or is cancelled.
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("logs.wait input contract", () => {
  it("accepts exactly one of sourceId or terminalId and maps terminalId to the terminal source", () => {
    expect(parseLogWaitInput({ terminalId: "t1" })).toMatchObject({
      sourceId: "server:terminal:t1",
      timeoutMs: 30_000,
    });
    expect(parseLogWaitInput({ sourceId: "browser:x" })).toMatchObject({
      sourceId: "browser:x",
    });
    expect(() => parseLogWaitInput({})).toThrow("Pass exactly one of sourceId or terminalId.");
    expect(() => parseLogWaitInput({ sourceId: "a", terminalId: "t1" })).toThrow(
      "Pass exactly one of sourceId or terminalId.",
    );
  });

  it("rejects malformed identifiers, unknown fields and non-objects", () => {
    expect(() => parseLogWaitInput({ terminalId: "t 1" })).toThrow("Invalid terminal ID.");
    expect(() => parseLogWaitInput({ terminalId: "x".repeat(129) })).toThrow(
      "Invalid terminal ID.",
    );
    expect(() => parseLogWaitInput({ sourceId: "   " })).toThrow("Invalid log source ID.");
    expect(() => parseLogWaitInput({ sourceId: "a\0b" })).toThrow("Invalid log source ID.");
    expect(() => parseLogWaitInput({ terminalId: "t1", regex: "x" })).toThrow(
      "Unknown or protected logs.wait field.",
    );
    expect(() => parseLogWaitInput(["t1"])).toThrow("logs.wait input must be an object.");
  });

  it("enforces the bounds on contains, idleSeconds, timeoutSeconds and after", () => {
    expect(() => parseLogWaitInput({ terminalId: "t1", contains: "" })).toThrow("1 to 200");
    expect(() => parseLogWaitInput({ terminalId: "t1", contains: "x".repeat(201) })).toThrow(
      "1 to 200",
    );
    expect(
      parseLogWaitInput({ terminalId: "t1", contains: "x".repeat(200) }).contains,
    ).toHaveLength(200);
    for (const idleSeconds of [0, 121, 1.5, "5"])
      expect(() => parseLogWaitInput({ terminalId: "t1", idleSeconds })).toThrow("idleSeconds");
    expect(parseLogWaitInput({ terminalId: "t1", idleSeconds: 120 }).idleMs).toBe(120_000);
    for (const timeoutSeconds of [0, 51, 2.5])
      expect(() => parseLogWaitInput({ terminalId: "t1", timeoutSeconds })).toThrow(
        "timeoutSeconds",
      );
    expect(parseLogWaitInput({ terminalId: "t1", timeoutSeconds: 50 }).timeoutMs).toBe(50_000);
    expect(() => parseLogWaitInput({ terminalId: "t1", after: -1 })).toThrow("Invalid log cursor.");
    expect(() => parseLogWaitInput({ terminalId: "t1", after: 1.5 })).toThrow(
      "Invalid log cursor.",
    );
  });

  it("caps timeoutSeconds by the calling provider's MCP tool deadline", () => {
    // Claude and Codex get a 300 s bycoda-conversation deadline; ACP providers keep 50 s.
    expect(logWaitMaxTimeoutSeconds("claude")).toBe(240);
    expect(logWaitMaxTimeoutSeconds("codex")).toBe(240);
    expect(logWaitMaxTimeoutSeconds("grok")).toBe(240);
    for (const provider of ["cursor", "opencode", "assistant"])
      expect(logWaitMaxTimeoutSeconds(provider)).toBe(50);
    expect(parseLogWaitInput({ terminalId: "t1", timeoutSeconds: 240 }, 240).timeoutMs).toBe(
      240_000,
    );
    expect(() => parseLogWaitInput({ terminalId: "t1", timeoutSeconds: 240 })).toThrow(
      "timeoutSeconds",
    );
    const claude = { ...PRINCIPAL, provider: "claude" };
    const cursor = { ...PRINCIPAL, provider: "cursor" };
    expect(
      prepareLogWait({ terminalId: "t1", timeoutSeconds: 240 }, claude).request.timeoutMs,
    ).toBe(240_000);
    expect(() => prepareLogWait({ terminalId: "t1", timeoutSeconds: 240 }, cursor)).toThrow(
      "timeoutSeconds must be an integer from 1 to 50.",
    );
    expect(LOG_WAIT_TOOL_SCHEMA.properties.timeoutSeconds.maximum).toBe(240);
    expect(LOG_WAIT_TOOL_DESCRIPTION).toContain("at most 240 in Claude Code, Codex and Grok");
  });

  it("exports a schema and a guard for the conversation registration", () => {
    expect(LOG_WAIT_TOOL_SCHEMA.additionalProperties).toBe(false);
    expect(isLogWaitTool("logs.wait")).toBe(true);
    expect(isLogWaitTool("logs.read")).toBe(false);
  });
});

describe("logs.wait results", () => {
  it("returns matched with the line, the tail and a cursor at the matching entry", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", contains: "ready" });
    line("booting");
    const ready = line("Server Ready on 3000");
    line("third");
    await advance(250);
    expect(call.result).toMatchObject({
      reason: "matched",
      matchedLine: "Server Ready on 3000",
      newLines: 2,
      cursor: ready.cursor,
      tail: ["booting", "Server Ready on 3000"],
    });
    expect(call.result?.exitCode).toBeUndefined();
  });

  it("returns exited with the exit code recorded in entry details", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1" });
    line("done", { exitCode: 2, stream: "pty" });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "exited", exitCode: 2, signal: null });
  });

  it("returns exited with the signal when the process was killed", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1" });
    line("killed", { exitCode: null, signal: "SIGTERM" });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "exited", exitCode: null, signal: "SIGTERM" });
  });

  it("drains the last lines of a closed source, then reports exited without an exit code", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1" });
    line("last words");
    logs.setSource({ ...SOURCE, available: false, reason: "The terminal has closed." });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "exited", newLines: 1, tail: ["last words"] });
    expect(call.result).not.toHaveProperty("exitCode");
  });

  it("reports exited when the source is evicted from the store", async () => {
    const small = new RuntimeLogsService({ maxSources: 1 });
    small.setSource(SOURCE);
    const waiter = new RuntimeLogWaiter(small, { now: () => clock });
    const call = track(
      waiter.wait({
        prepared: prepareLogWait({ terminalId: "t1" }, PRINCIPAL),
        isAuthorized: async () => true,
      }),
    );
    await advance(250);
    expect(call.settled).toBe(false);
    small.setSource({ ...SOURCE, id: "server:terminal:t2" });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "exited", newLines: 0 });
  });

  it("keeps waiting for a source that has not appeared yet and times out", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "missing", timeoutSeconds: 1 });
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "timeout", newLines: 0, tail: [] });
  });

  it("reports exited at once for a source that is already closed", async () => {
    logs.setSource({ ...SOURCE, available: false });
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1" });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "exited", newLines: 0 });
  });

  it("returns idle after silence that follows a new line", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", idleSeconds: 2 });
    line("tick");
    await advance(1750);
    expect(call.settled).toBe(false);
    await advance(500);
    expect(call.result).toMatchObject({ reason: "idle", newLines: 1, tail: ["tick"] });
  });

  it("returns idle after the start when no line ever arrives", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", idleSeconds: 1 });
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "idle", newLines: 0 });
  });

  it("restarts the idle clock when a new line arrives", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", idleSeconds: 2 });
    await advance(1500);
    line("late");
    await advance(1500);
    expect(call.settled).toBe(false);
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "idle", newLines: 1 });
  });

  it("returns timeout with the cursor at the end when nothing happens", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    line("before");
    const end = logs.read().cursor;
    const call = start(waiter, { terminalId: "t1", timeoutSeconds: 1 });
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "timeout", newLines: 0, cursor: end });
  });
});

describe("logs.wait cursors", () => {
  it("reads only output produced after the wait started by default", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    line("old one");
    line("old two");
    const call = start(waiter, { terminalId: "t1", contains: "old", timeoutSeconds: 1 });
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "timeout", newLines: 0 });
  });

  it("reads the backlog when after is given explicitly", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    line("old one");
    const call = start(waiter, { terminalId: "t1", contains: "old", after: 0 });
    await advance(250);
    expect(call.result).toMatchObject({ reason: "matched", matchedLine: "old one", cursor: 1 });
  });

  it("clamps a cursor that is ahead of the store to its end", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    line("existing");
    const call = start(waiter, { terminalId: "t1", after: 999, contains: "fresh" });
    line("fresh");
    await advance(250);
    expect(call.result).toMatchObject({ reason: "matched", matchedLine: "fresh", cursor: 2 });
  });

  it("continues from the matching cursor without skipping later lines", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", contains: "b" });
    line("a");
    line("b");
    const c = line("c");
    await advance(250);
    expect(call.result).toMatchObject({ reason: "matched", matchedLine: "b", newLines: 2 });
    const cursor = call.result!.cursor;
    expect(cursor).toBe(2);
    expect(logs.read({ after: cursor }).entries.map((entry) => entry.message)).toEqual(["c"]);

    const next = start(waiter, { terminalId: "t1", after: cursor, contains: "c" });
    await advance(250);
    expect(next.result).toMatchObject({ reason: "matched", matchedLine: "c", cursor: c.cursor });
  });

  it("keeps the cursor across a timeout so output after it is not lost", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const first = start(waiter, { terminalId: "t1", timeoutSeconds: 1 });
    await advance(1000);
    const cursor = first.result!.cursor;
    line("arrived later");
    const second = start(waiter, { terminalId: "t1", after: cursor, timeoutSeconds: 1 });
    await advance(1000);
    expect(second.result).toMatchObject({
      reason: "timeout",
      newLines: 1,
      tail: ["arrived later"],
    });
  });
});

describe("logs.wait matching and scope", () => {
  it("matches plain case-insensitive substrings, not regular expressions", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const regex = start(waiter, { terminalId: "t1", contains: "a.*b", timeoutSeconds: 1 });
    const paren = start(waiter, { terminalId: "t1", contains: "(" });
    line("axxb");
    line("f(x)");
    line("READY now");
    await advance(1000);
    expect(paren.result).toMatchObject({ reason: "matched", matchedLine: "f(x)" });
    expect(regex.result).toMatchObject({ reason: "timeout" });
  });

  it("matches case-insensitively", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", contains: "READY" });
    line("Ready!");
    await advance(250);
    expect(call.result).toMatchObject({ reason: "matched", matchedLine: "Ready!" });
  });

  it("does not see another project's source", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(
      waiter,
      { terminalId: "t1", contains: "secret", timeoutSeconds: 1 },
      {
        principal: { ...PRINCIPAL, projectId: "q" },
      },
    );
    line("secret");
    await advance(1000);
    expect(call.result).toMatchObject({ reason: "timeout", newLines: 0 });
  });

  it("truncates long lines to 500 graphemes and keeps only the last 40 in the tail", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", timeoutSeconds: 1 });
    for (let i = 0; i < 44; i++) line(`line-${i}`);
    line(`${"x".repeat(1000)}`);
    await advance(1000);
    expect(call.result?.newLines).toBe(45);
    expect(call.result?.tail).toHaveLength(40);
    expect(call.result?.tail[0]).toBe("line-5");
    const last = call.result!.tail.at(-1)!;
    expect(graphemes(last)).toHaveLength(500);
    expect(last.endsWith("…")).toBe(true);
  });

  it("truncates a long matched line too", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(waiter, { terminalId: "t1", contains: "needle" });
    line(`${"y".repeat(800)}needle`);
    await advance(250);
    expect(graphemes(call.result!.matchedLine!)).toHaveLength(500);
  });
});

describe("logs.wait authority and cancellation", () => {
  it("stops when the caller's authority is revoked mid-wait", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    let allowed = true;
    const call = start(waiter, { terminalId: "t1" }, { isAuthorized: async () => allowed });
    await advance(500);
    expect(call.settled).toBe(false);
    allowed = false;
    await advance(1000);
    expect(call.error).toBeInstanceOf(RuntimeLogWaitStopped);
    expect(call.error).toMatchObject({ code: "authority" });
  });

  it("stops when the authority check throws", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const call = start(
      waiter,
      { terminalId: "t1" },
      {
        isAuthorized: async () => {
          throw new Error("store unavailable");
        },
      },
    );
    await advance(250);
    expect(call.error).toMatchObject({ code: "authority" });
  });

  it("stops promptly and clears its timer when the request is cancelled", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const controller = new AbortController();
    const call = start(waiter, { terminalId: "t1" }, { signal: controller.signal });
    await advance(500);
    controller.abort();
    await advance(0);
    expect(call.error).toMatchObject({ code: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start when the request is already cancelled", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const controller = new AbortController();
    controller.abort();
    const call = start(waiter, { terminalId: "t1" }, { signal: controller.signal });
    await advance(0);
    expect(call.error).toMatchObject({ code: "cancelled" });
  });
});

describe("logs.wait concurrency caps", () => {
  it("limits waits per session and frees the slot when a wait ends", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock });
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const waits = controllers
      .slice(0, 4)
      .map((controller) => start(waiter, { terminalId: "t1" }, { signal: controller.signal }));
    const rejected = start(waiter, { terminalId: "t1" }, { signal: controllers[4].signal });
    await advance(0);
    expect(rejected.error).toBeInstanceOf(Error);
    expect((rejected.error as Error).message).toMatch(/This session already runs 4 log waits/);

    const otherController = new AbortController();
    const otherSession = start(
      waiter,
      { terminalId: "t1" },
      {
        principal: { ...PRINCIPAL, sessionId: "s2" },
        signal: otherController.signal,
      },
    );
    expect(otherSession.settled).toBe(false);

    controllers[0].abort();
    await advance(0);
    expect(waits[0].error).toMatchObject({ code: "cancelled" });
    const retryController = new AbortController();
    const retry = start(waiter, { terminalId: "t1" }, { signal: retryController.signal });
    await advance(0);
    expect(retry.error).toBeUndefined();
    expect(retry.settled).toBe(false);

    for (const controller of [...controllers.slice(1), otherController, retryController])
      controller.abort();
    await advance(0);
    expect(otherSession.error).toMatchObject({ code: "cancelled" });
    expect(retry.error).toMatchObject({ code: "cancelled" });
  });

  it("limits total waits per Host across sessions", async () => {
    const waiter = new RuntimeLogWaiter(logs, { now: () => clock, maxTotal: 2 });
    const controller = new AbortController();
    const first = start(waiter, { terminalId: "t1" }, { signal: controller.signal });
    const second = start(
      waiter,
      { terminalId: "t1" },
      {
        principal: { ...PRINCIPAL, sessionId: "s2" },
        signal: controller.signal,
      },
    );
    const third = start(
      waiter,
      { terminalId: "t1" },
      {
        principal: { ...PRINCIPAL, sessionId: "s3" },
      },
    );
    await advance(0);
    expect((third.error as Error).message).toMatch(/This Host already runs 2 log waits/);
    controller.abort();
    await advance(0);
    expect(first.error).toMatchObject({ code: "cancelled" });
    expect(second.error).toMatchObject({ code: "cancelled" });
  });
});
