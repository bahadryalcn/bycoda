import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processConstructions } from "../processConstruction.testSupport";
import type { HarnessEvent } from "../../core/types";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
    spawnChild: async () => undefined,
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (value: string) => void) => {
      onLine = line;
    },
    writeChild: async (_id: string, line: string) => {
      sent.push(line);
    },
  }),
);
const {
  sendClaudeTurn,
  cancelClaudeTurn,
  stopClaudeSession,
  replayClaudeSession,
  __claudeTestReset,
} = await import("./claude");

beforeEach(() => {
  processConstructions.reset();
  sent.length = 0;
  onLine = undefined;
  __claudeTestReset();
});
afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}
function emit(record: Record<string, unknown>) {
  onLine!(JSON.stringify(record));
}
async function waitFor(predicate: () => boolean, label: string) {
  await vi.waitFor(() => expect(predicate(), label).toBe(true), { timeout: 2000, interval: 5 });
}
async function startTurn(sessionId: string) {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "Inspect quota recovery",
    attachments: [],
    onEvent: (event) => events.push(event),
  });
  await waitFor(
    () =>
      parse().some(
        (message) => (message.request as Record<string, unknown>)?.subtype === "initialize",
      ),
    "initialize",
  );
  const initialize = parse().find(
    (message) => (message.request as Record<string, unknown>)?.subtype === "initialize",
  )!;
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: initialize.request_id },
  });
  await waitFor(() => parse().some((message) => message.type === "user"), "user prompt");
  return { events, turn };
}
function replay(records: Array<Record<string, unknown>>) {
  const events: HarnessEvent[] = [];
  const prompts: string[] = [];
  replayClaudeSession({
    sessionId: "s1",
    cwd: "/repo",
    runtimeMode: "supervised",
    transcript: records.map((record) => JSON.stringify(record)).join("\n"),
    onEvent: (event) => events.push(event),
    onPrompt: (text) => prompts.push(text),
  });
  return { events, prompts };
}

it("keeps the same failure in separate replayed attempts", () => {
  const error = {
    type: "assistant",
    error: "rate_limit",
    message: { content: [{ type: "text", text: "Weekly limit reached" }] },
  };
  const { events, prompts } = replay([
    { type: "user", message: { role: "user", content: "First attempt" } },
    error,
    error,
    { type: "user", message: { role: "user", content: "Second attempt" } },
    error,
  ]);
  expect(prompts).toEqual(["First attempt", "Second attempt"]);
  expect(events.filter((event) => event.type === "session.error")).toEqual([
    { type: "session.error", message: "Weekly limit reached" },
    { type: "session.error", message: "Weekly limit reached" },
  ]);
});

it("reports the same assistant, result and rejected-turn failure once per attempt", async () => {
  const { events, turn } = await startTurn("s1");
  const message = "You've hit your weekly limit";
  const outcome = turn.catch((error: unknown) => error);
  emit({
    type: "assistant",
    error: "rate_limit",
    message: { content: [{ type: "text", text: message }] },
  });
  emit({ type: "result", subtype: "success", is_error: true, result: message });
  expect(await outcome).toBeInstanceOf(Error);
  expect(events.filter((event) => event.type === "session.error")).toEqual([
    { type: "session.error", message },
  ]);
  expect(events).toContainEqual({ type: "usage.limited" });

  const retryEvents: HarnessEvent[] = [];
  const retry = sendClaudeTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "Try again",
    attachments: [],
    onEvent: (event) => retryEvents.push(event),
  });
  await waitFor(
    () => parse().filter((message) => message.type === "user").length === 2,
    "retry prompt",
  );
  emit({ type: "result", subtype: "success", is_error: true, result: message });
  await retry;
  expect(retryEvents.filter((event) => event.type === "session.error")).toEqual([
    { type: "session.error", message },
  ]);
});

it("keeps different assistant and result failures in one attempt", async () => {
  const { events, turn } = await startTurn("s1");
  const outcome = turn.catch((error: unknown) => error);
  emit({
    type: "assistant",
    error: "rate_limit",
    message: { content: [{ type: "text", text: "Weekly limit reached" }] },
  });
  emit({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors: ["Could not save conversation"],
  });
  await outcome;
  expect(events.filter((event) => event.type === "session.error")).toEqual([
    { type: "session.error", message: "Weekly limit reached" },
    { type: "session.error", message: "Could not save conversation" },
  ]);
});

it("ignores assistant failures delivered after cancellation", async () => {
  const { events, turn } = await startTurn("s1");
  await cancelClaudeTurn("s1");
  emit({
    type: "assistant",
    error: "rate_limit",
    message: { content: [{ type: "text", text: "Weekly limit reached" }] },
  });
  emit({ type: "result", subtype: "success", is_error: true, result: "Weekly limit reached" });
  await turn;
  expect(events.filter((event) => event.type === "session.error")).toEqual([]);
});
