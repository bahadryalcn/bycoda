import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

type Handlers = {
  line: (line: string) => void;
  exit: (code: number | null) => void;
};

// A stand-in for agy.exe: it answers `init` after spawn and, per user line, runs
// a scripted turn. `hang` leaves a turn open so it can be cancelled.
const host = vi.hoisted(() => ({
  handlers: new Map<string, Handlers>(),
  spawns: [] as { key: string; command: string; args: string[]; cwd: string }[],
  writes: [] as { key: string; text: string }[],
  killed: [] as string[],
  hang: false,
  failStart: null as string | null,
  seq: 0,
  /** The conversation each spawn ended up in. */
  conv: new Map<string, string>(),
}));

vi.mock("../../core/child", () => ({
  spawnChild: vi.fn(async (key: string, command: string, args: string[], cwd: string) => {
    host.spawns.push({ key, command, args, cwd });
    // agy opens a new conversation unless the resume id is one it knows.
    const at = args.indexOf("--conversation");
    const resumed = at >= 0 && args[at + 1] !== "lost" ? args[at + 1] : undefined;
    host.conv.set(key, resumed ?? `conv-${++host.seq}`);
    setTimeout(() => {
      const line = host.handlers.get(key)?.line;
      if (!line) return;
      if (host.failStart) {
        line(
          JSON.stringify({
            event: "result",
            result: { conversation_id: "", status: "ERROR", error: host.failStart },
          }),
        );
        return;
      }
      line(
        JSON.stringify({
          event: "init",
          conversation_id: host.conv.get(key),
          init: { cwd, tools: [], permission_mode: "request-review" },
        }),
      );
    }, 0);
  }),
  watchChild: vi.fn((key: string, line: Handlers["line"], exit: Handlers["exit"]) => {
    host.handlers.set(key, { line, exit });
  }),
  unwatchChild: vi.fn((key: string) => {
    host.handlers.delete(key);
  }),
  killChild: vi.fn(async (key: string) => {
    host.killed.push(key);
  }),
  writeChild: vi.fn(async (key: string, text: string) => {
    host.writes.push({ key, text });
    if (host.hang) return;
    const content = JSON.parse(text).message.content as string;
    const conversation = host.conv.get(key)!;
    const emit = (value: unknown) => host.handlers.get(key)?.line(JSON.stringify(value));
    const step = (n: number, state: string, type: string, extra: object = {}) =>
      emit({
        event: "step_update",
        step_update: {
          conversation_id: conversation,
          step_index: n,
          state,
          step_type: type,
          ...extra,
        },
      });
    setTimeout(() => {
      step(0, "DONE", "user_input");
      step(1, "ACTIVE", "agent_response", { text_delta: `echo:${content}` });
      step(1, "DONE", "agent_response", {
        text_delta: "\n",
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      });
      emit({
        event: "result",
        result: { conversation_id: conversation, status: "SUCCESS", response: `echo:${content}\n` },
      });
    }, 0);
  }),
}));

const { setAdditionalDirsResolver } = await import("../../core/additionalDirs");
const stream = await import("./antigravityStream");

const BIN = { path: "C:\\agy\\bin\\agy.exe" };
const MODEL = "antigravity:gemini-3.8-flash-high";

function turn(
  text: string,
  overrides: Partial<SendTurnInput> = {},
): { input: SendTurnInput; events: HarnessEvent[] } {
  const events: HarnessEvent[] = [];
  return {
    events,
    input: {
      sessionId: "s1",
      cwd: "C:\\proj",
      model: MODEL,
      runtimeMode: "auto-accept-edits",
      text,
      onEvent: (event) => events.push(event),
      ...overrides,
    },
  };
}

const deltas = (events: HarnessEvent[]) =>
  events.flatMap((e) => (e.type === "message.delta" ? [e.text] : [])).join("");

const send = (input: SendTurnInput) => stream.sendAntigravityStreamTurn(input, BIN);

beforeEach(async () => {
  await stream.forgetAntigravityStreamSession("s1");
  host.handlers.clear();
  host.spawns.length = 0;
  host.writes.length = 0;
  host.killed.length = 0;
  host.hang = false;
  host.failStart = null;
  host.seq = 0;
  host.conv.clear();
  setAdditionalDirsResolver(() => []);
});

describe("antigravity stream-json transport", () => {
  it("spawns agy in the project folder and streams one turn", async () => {
    const { input, events } = turn("hello");
    await send(input);

    expect(host.spawns).toHaveLength(1);
    expect(host.spawns[0]).toMatchObject({ command: BIN.path, cwd: "C:\\proj" });
    expect(host.spawns[0].args).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--print=",
      "--disable-slash-commands",
      "--model",
      "gemini-3.8-flash-high",
    ]);
    expect(JSON.parse(host.writes[0].text)).toEqual({
      event: "user",
      message: { role: "user", content: "hello" },
    });
    expect(events.map((e) => e.type)).toEqual([
      "session.providerBound",
      "session.started",
      "message.delta",
      "message.delta",
      "message.completed",
      "context",
      "turn.metrics",
    ]);
    expect(events[0]).toEqual({ type: "session.providerBound", providerSessionId: "conv-1" });
    expect(deltas(events)).toBe("echo:hello\n");
  });

  it("keeps one process for the session and routes each turn to its own listener", async () => {
    const first = turn("one");
    const second = turn("two");
    await send(first.input);
    await send(second.input);

    expect(host.spawns).toHaveLength(1);
    expect(host.writes.map((w) => w.key)).toEqual([host.spawns[0].key, host.spawns[0].key]);
    expect(deltas(first.events)).toBe("echo:one\n");
    expect(deltas(second.events)).toBe("echo:two\n");
    expect(second.events.some((e) => e.type === "session.started")).toBe(false);
  });

  it("calls onAccepted once agy has recorded the user turn", async () => {
    const onAccepted = vi.fn();
    await send(turn("hi", { onAccepted }).input);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("recycles only for a change that launches differently, on the same conversation", async () => {
    await send(turn("a").input);
    // Same flags as auto-accept-edits: no restart.
    await send(turn("b", { runtimeMode: "auto" }).input);
    expect(host.spawns).toHaveLength(1);

    await send(turn("c", { runtimeMode: "full-access" }).input);
    expect(host.spawns).toHaveLength(2);
    expect(host.spawns[1].args).toContain("--dangerously-skip-permissions");
    expect(host.spawns[1].args).toEqual(expect.arrayContaining(["--conversation", "conv-1"]));
    expect(host.killed).toEqual([host.spawns[0].key]);

    // Back to a restrictive mode: the permissive process must not be reused.
    await send(turn("d", { runtimeMode: "auto-accept-edits" }).input);
    expect(host.spawns).toHaveLength(3);
    expect(host.spawns[2].args).not.toContain("--dangerously-skip-permissions");
  });

  it("restarts with the new model on the same conversation", async () => {
    await send(turn("a").input);
    await send(turn("b", { model: "antigravity:gemini-3.1-pro-low" }).input);
    expect(host.spawns[1].args).toEqual(
      expect.arrayContaining(["--model", "gemini-3.1-pro-low", "--conversation", "conv-1"]),
    );
  });

  it("passes every additional folder as its own --add-dir", async () => {
    setAdditionalDirsResolver(() => ["C:\\one", "C:\\two"]);
    await send(turn("a").input);
    const args = host.spawns[0].args;
    expect(args.filter((arg) => arg === "--add-dir")).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(["--add-dir", "C:\\one", "C:\\two"]));
  });

  it("refuses supervised mode and plan turns without starting a process", async () => {
    await expect(send(turn("x", { runtimeMode: "supervised" }).input)).rejects.toThrow(
      /Supervised mode/,
    );
    await expect(send(turn("x", { intent: "plan" }).input)).rejects.toThrow(/Plan mode/);
    expect(host.spawns).toHaveLength(0);
  });

  it("resumes a bound conversation after a restart", async () => {
    stream.bindAntigravityStreamSession("s1", "saved-conv", "C:\\proj");
    const { input, events } = turn("again");
    await send(input);
    expect(host.spawns[0].args).toEqual(expect.arrayContaining(["--conversation", "saved-conv"]));
    expect(events[0]).toEqual({ type: "session.providerBound", providerSessionId: "saved-conv" });
    expect(events.some((e) => e.type === "status")).toBe(false);
  });

  it("ignores a binding made for another folder", async () => {
    stream.bindAntigravityStreamSession("s1", "saved-conv", "C:\\elsewhere");
    await send(turn("x").input);
    expect(host.spawns[0].args).not.toContain("--conversation");
  });

  it("says so when agy quietly starts a new conversation instead of the saved one", async () => {
    stream.bindAntigravityStreamSession("s1", "lost", "C:\\proj");
    const { input, events } = turn("x");
    await send(input);
    expect(events.find((e) => e.type === "status")).toMatchObject({
      text: expect.stringContaining("could not restore"),
    });
    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: "conv-1" });
  });

  it("surfaces agy's own message when the launch is refused", async () => {
    host.failStart = "invalid model selection (--model x)";
    await expect(send(turn("x").input)).rejects.toThrow(/invalid model selection/);
    expect(host.killed).toHaveLength(1);
  });

  it("drops the saved conversation when a resumed launch is refused", async () => {
    stream.bindAntigravityStreamSession("s1", "saved-conv", "C:\\proj");
    host.failStart = "boom";
    await expect(send(turn("x").input)).rejects.toThrow(/next message starts a new one/);
    host.failStart = null;
    await send(turn("y").input);
    expect(host.spawns[1].args).not.toContain("--conversation");
  });

  it("reports a failed result as a session error and still ends the turn", async () => {
    await send(turn("x").input);
    const next = turn("y");
    host.hang = true;
    const pending = send(next.input);
    await vi.waitFor(() => expect(host.writes).toHaveLength(2));
    host.handlers.get(host.spawns[0].key)!.line(
      JSON.stringify({
        event: "result",
        result: { conversation_id: "conv-1", status: "ERROR", error: "model overloaded" },
      }),
    );
    await pending;
    expect(next.events).toContainEqual({ type: "session.error", message: "model overloaded" });
  });

  it("fails the turn and reports session.ended when agy dies mid-turn", async () => {
    await send(turn("a").input);
    host.hang = true;
    const { input, events } = turn("b");
    const pending = send(input);
    await vi.waitFor(() => expect(host.writes).toHaveLength(2));
    host.handlers.get(host.spawns[0].key)!.exit(3);
    await expect(pending).rejects.toThrow(/exited unexpectedly \(code 3\)/);
    expect(events).toContainEqual({ type: "session.ended", code: 3 });

    // The conversation survives: the next turn starts a fresh process on it.
    host.hang = false;
    await send(turn("c").input);
    expect(host.spawns[1].args).toEqual(expect.arrayContaining(["--conversation", "conv-1"]));
  });

  it("cancel kills the process, settles the turn quietly and resumes on the next send", async () => {
    await send(turn("a").input);
    host.hang = true;
    const cancelled = turn("long");
    const pending = send(cancelled.input);
    await vi.waitFor(() => expect(host.writes).toHaveLength(2));
    const oldKey = host.spawns[0].key;
    const late = host.handlers.get(oldKey)!.line;

    await stream.cancelAntigravityStreamTurn("s1");
    await pending;
    expect(host.killed).toEqual([oldKey]);

    // Output the dead process still had in flight must go nowhere.
    const before = cancelled.events.length;
    late(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 9,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "LEAK",
        },
      }),
    );
    expect(cancelled.events).toHaveLength(before);
    expect(cancelled.events).not.toContainEqual(expect.objectContaining({ type: "session.ended" }));

    host.hang = false;
    const next = turn("after");
    await send(next.input);
    expect(host.spawns).toHaveLength(2);
    expect(host.spawns[1].args).toEqual(expect.arrayContaining(["--conversation", "conv-1"]));
    expect(deltas(next.events)).toBe("echo:after\n");
    expect(deltas(cancelled.events)).not.toContain("LEAK");
  });

  it("cancel while idle leaves the warm process alone", async () => {
    await send(turn("a").input);
    await stream.cancelAntigravityStreamTurn("s1");
    expect(host.killed).toEqual([]);
    await send(turn("b").input);
    expect(host.spawns).toHaveLength(1);
  });

  it("drops a send queued behind a cancel", async () => {
    host.hang = true;
    const second = turn("second");
    const running = send(turn("first").input);
    await vi.waitFor(() => expect(host.writes).toHaveLength(1));
    const queued = send(second.input);
    await stream.cancelAntigravityStreamTurn("s1");
    await Promise.all([running, queued]);
    expect(host.writes).toHaveLength(1);
    expect(second.events).toEqual([]);
  });

  it("stop kills the process but keeps the conversation; forget drops it", async () => {
    await send(turn("a").input);
    await stream.stopAntigravityStreamSession("s1");
    expect(host.killed).toEqual([host.spawns[0].key]);
    await send(turn("b").input);
    expect(host.spawns[1].args).toEqual(expect.arrayContaining(["--conversation", "conv-1"]));

    await stream.forgetAntigravityStreamSession("s1");
    await send(turn("c").input);
    expect(host.spawns[2].args).not.toContain("--conversation");
  });

  it("does nothing for an empty prompt", async () => {
    await send(turn("   ").input);
    expect(host.spawns).toHaveLength(0);
  });
});
