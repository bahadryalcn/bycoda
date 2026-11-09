import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnNotReadyError, type HarnessEvent } from "../../core/types";

// Record shapes captured from Claude Code 2.1.319 (`--input-format stream-json`).
const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
const writeChild = vi.fn(async (_id: string, line: string) => {
  sent.push(line);
});

beforeEach(() => processConstructions.reset());
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
    spawnChild: vi.fn(async () => undefined),
    killChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: (_id: string, line: (l: string) => void) => {
      onLine = line;
    },
    writeChild,
    readHarnessTaskOutput: vi.fn(async () => ({ text: "", truncated: false })),
  }),
);

const { cancelClaudeTurn, sendClaudeTurn, steerClaudeTurn, stopClaudeSession, __claudeTestReset } =
  await import("./claude");

const parse = () => sent.map((line) => JSON.parse(line) as Record<string, unknown>);
const users = () => parse().filter((message) => message.type === "user");
const interrupts = () =>
  parse().filter((m) => (m.request as { subtype?: string } | undefined)?.subtype === "interrupt");
const emit = (rec: Record<string, unknown>) => onLine!(JSON.stringify(rec));
/** Claude reports a lifecycle only for a message that carries its own uuid. */
const primary = () => {
  const uuid = users()[0]?.uuid;
  expect(uuid).toEqual(expect.any(String));
  return uuid as string;
};
const lifecycle = (uuid: string, state: string) =>
  emit({ type: "command_lifecycle", command_uuid: uuid, state, session_id: "sess_1" });
const reply = (text: string) => {
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({ type: "assistant", session_id: "sess_1", message: { content: [{ type: "text", text }] } });
};
const result = () => emit({ type: "result", subtype: "success", session_id: "sess_1" });

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

function send(text = "explore") {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text,
    attachments: [],
    onEvent: (event) => events.push(event),
  });
  return { events, turn };
}

async function startTurn() {
  const usersAtStart = users().length;
  const started = send();
  await waitFor(
    () => parse().some((m) => (m.request as { subtype?: string })?.subtype === "initialize"),
    "initialize",
  );
  const initialize = parse().find(
    (m) => (m.request as { subtype?: string })?.subtype === "initialize",
  )!;
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: initialize.request_id },
  });
  await waitFor(() => users().length > usersAtStart, "user prompt");
  return started;
}

const steer = (text: string) =>
  steerClaudeTurn({ sessionId: "s1", cwd: "/repo", model: "claude:claude-sonnet-5", text });

function settledFlag(turn: Promise<void>) {
  const state = { settled: false };
  void turn.then(() => (state.settled = true));
  return state;
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  writeChild.mockClear();
  __claudeTestReset();
});

afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("claude steering", () => {
  it("keeps the follow-up queued when the CLI reports no command lifecycle", async () => {
    await startTurn();
    const before = users().length;
    await expect(steer("also this")).rejects.toBeInstanceOf(TurnNotReadyError);
    expect(users()).toHaveLength(before);
  });

  it("writes an identified message that Claude folds into the running query", async () => {
    const { turn } = await startTurn();
    lifecycle(primary(), "queued");
    lifecycle(primary(), "started");
    await steer("also this");
    const written = users().at(-1)!;
    expect(written.uuid).toEqual(expect.any(String));
    expect(written.message).toMatchObject({ content: [{ type: "text", text: "also this" }] });

    lifecycle(written.uuid as string, "queued");
    lifecycle(written.uuid as string, "started");
    lifecycle(written.uuid as string, "completed");
    result();
    await turn;
  });

  it("waits for the follow-up's own query when Claude runs it after the result", async () => {
    const { events, turn } = await startTurn();
    lifecycle(primary(), "started");
    await steer("then this");
    const uuid = users().at(-1)!.uuid as string;
    lifecycle(uuid, "queued");
    const state = settledFlag(turn);

    result();
    lifecycle(primary(), "completed");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.settled).toBe(false);

    lifecycle(uuid, "started");
    reply("STEERED");
    result();
    lifecycle(uuid, "completed");
    await turn;
    expect(events).toContainEqual({ type: "message.delta", text: "STEERED" });
  });

  it("keeps the turn open when the result races the follow-up write", async () => {
    const { turn } = await startTurn();
    lifecycle(primary(), "started");
    await steer("late");
    const uuid = users().at(-1)!.uuid as string;
    const state = settledFlag(turn);
    result();
    await new Promise((r) => setTimeout(r, 20));
    expect(state.settled).toBe(false);
    lifecycle(uuid, "queued");
    lifecycle(uuid, "started");
    reply("late reply");
    result();
    await turn;
  });

  it("interrupts an unstarted follow-up after Stop and admits no message until its result", async () => {
    const { turn } = await startTurn();
    lifecycle(primary(), "started");
    await steer("after stop");
    const uuid = users().at(-1)!.uuid as string;
    lifecycle(uuid, "queued");

    await cancelClaudeTurn("s1");
    await turn;
    const interruptsAfterStop = interrupts().length;
    result(); // the interrupted primary query
    lifecycle(primary(), "cancelled");

    // Claude still runs the queued follow-up after the interrupt.
    lifecycle(uuid, "started");
    expect(interrupts()).toHaveLength(interruptsAfterStop + 1);
    await expect(send("next").turn).rejects.toBeInstanceOf(TurnNotReadyError);

    result(); // the interrupted follow-up query
    lifecycle(uuid, "cancelled");
    const usersBefore = users().length;
    const next = send("next");
    await waitFor(() => users().length > usersBefore, "next prompt");
    result();
    await next.turn;
  });
});
