import { describe, expect, it } from "vitest";
import { RUNTIME_MODES } from "../../../../features/sessions/model/session";
import type { HarnessEvent } from "../../core/types";
import {
  antigravityStreamArgs,
  antigravityStreamUserLine,
  beginStreamTurn,
  createStreamState,
  handleStreamLine,
  parseAntigravityModels,
  streamModeRefusal,
  type StreamOutcome,
} from "./antigravityStreamProtocol";

// Lines below are captured from agy 1.2.14 on Windows (ids shortened, the
// `tools` list trimmed).
const CONV = "74441d50-2a24-4fab-a8d6-b0a4c8b75739";
const DIR = "C:\\\\Users\\\\dev\\\\AppData\\\\Local\\\\Temp\\\\agyprobe";
const INIT = `{"event":"init","conversation_id":"${CONV}","init":{"model":"gemini-3.8-flash","cwd":"${DIR}","tools":["ask_permission","run_command","view_file"],"permission_mode":"request-review"}}`;
const step = (index: number, state: string, type: string, extra = "") =>
  `{"event":"step_update","step_update":{"conversation_id":"${CONV}","step_index":${index},"state":"${state}","step_type":"${type}"${extra}}}`;

function feed(lines: string[]) {
  const state = createStreamState();
  const outcomes: StreamOutcome[] = lines.map((line) => handleStreamLine(state, line));
  return { state, outcomes, events: outcomes.flatMap((o) => o.events) };
}

describe("antigravityStreamArgs", () => {
  it("always runs headless stream-json with an empty prompt", () => {
    expect(antigravityStreamArgs({ runtimeMode: "auto-accept-edits" })).toEqual([
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--print=",
      "--disable-slash-commands",
    ]);
  });

  it("adds model, resume id and one --add-dir per folder", () => {
    const args = antigravityStreamArgs({
      runtimeMode: "auto",
      model: "gemini-3.1-pro-high",
      conversationId: CONV,
      addDirs: ["C:\\a", "C:\\b c"],
    });
    expect(args.slice(6)).toEqual([
      "--model",
      "gemini-3.1-pro-high",
      "--conversation",
      CONV,
      "--add-dir",
      "C:\\a",
      "--add-dir",
      "C:\\b c",
    ]);
  });

  it("only full access skips permissions and never passes --effort or --mode", () => {
    for (const runtimeMode of RUNTIME_MODES) {
      const args = antigravityStreamArgs({ runtimeMode, model: "m" });
      expect(args.includes("--dangerously-skip-permissions")).toBe(runtimeMode === "full-access");
      expect(args).not.toContain("--effort");
      expect(args).not.toContain("--mode");
    }
  });
});

describe("streamModeRefusal", () => {
  it("refuses the modes headless agy cannot enforce", () => {
    expect(streamModeRefusal("supervised")).toMatch(/Supervised mode/);
    for (const runtimeMode of RUNTIME_MODES) {
      expect(streamModeRefusal(runtimeMode, "plan")).toMatch(/Plan mode/);
    }
  });

  it("allows the modes it can honour", () => {
    for (const runtimeMode of ["auto-accept-edits", "auto", "full-access"] as const) {
      expect(streamModeRefusal(runtimeMode)).toBeUndefined();
      expect(streamModeRefusal(runtimeMode, "chat")).toBeUndefined();
    }
  });
});

describe("antigravityStreamUserLine", () => {
  it("wraps the prompt in the user event agy reads", () => {
    expect(JSON.parse(antigravityStreamUserLine("  hello ")!)).toEqual({
      event: "user",
      message: { role: "user", content: "hello" },
    });
  });

  it("sends nothing for an empty prompt", () => {
    expect(antigravityStreamUserLine("  ")).toBeUndefined();
  });

  it("carries attachments as a path legend, not image blocks", () => {
    const line = antigravityStreamUserLine("look", [
      {
        id: "a",
        name: "notes.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 3,
        path: "C:\\x\\notes.txt",
      },
    ]);
    const content = JSON.parse(line!).message.content as string;
    expect(typeof content).toBe("string");
    expect(content).toContain("look");
    expect(content).toContain("notes.txt");
  });
});

describe("parseAntigravityModels", () => {
  const stdout = [
    "Fetching available models...",
    "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
    "gemini-3.1-pro-low\tGemini 3.1 Pro (Low)",
    "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
    "gemini-3.1-pro-low\tduplicate",
    "",
  ].join("\r\n");

  it("skips the progress line and keeps the first of a duplicate", () => {
    expect(parseAntigravityModels(stdout)).toEqual([
      {
        id: "antigravity:gemini-3.8-flash-high",
        harness: "antigravity",
        name: "Gemini 3.8 Flash (High)",
        nativeId: "gemini-3.8-flash-high",
      },
      {
        id: "antigravity:gemini-3.1-pro-low",
        harness: "antigravity",
        name: "Gemini 3.1 Pro (Low)",
        nativeId: "gemini-3.1-pro-low",
      },
      {
        id: "antigravity:claude-sonnet-4-6",
        harness: "antigravity",
        name: "Claude Sonnet 4.6 (Thinking)",
        nativeId: "claude-sonnet-4-6",
      },
    ]);
  });

  it("returns nothing for output that is not a model list", () => {
    expect(parseAntigravityModels("Please sign in to view available models.")).toEqual([]);
    expect(parseAntigravityModels("")).toEqual([]);
  });
});

describe("handleStreamLine", () => {
  it("reads the conversation id from init and the accepted user turn", () => {
    const { state, outcomes } = feed([INIT, step(0, "DONE", "user_input")]);
    expect(outcomes[0]).toEqual({ events: [], initialized: true });
    expect(outcomes[1].userAccepted).toBe(true);
    expect(state.conversationId).toBe(CONV);
  });

  it("streams text deltas, completes the message and reports context", () => {
    const { events } = feed([
      step(3, "ACTIVE", "agent_response", ',"text_delta":"BANA"'),
      step(
        3,
        "DONE",
        "agent_response",
        ',"text_delta":"NA\\n","duration_seconds":28.28,"usage":{"input_tokens":12403,"output_tokens":119,"thinking_tokens":117,"cache_read_tokens":0,"total_tokens":12522}',
      ),
    ]);
    expect(events).toEqual<HarnessEvent[]>([
      { type: "message.delta", text: "BANA" },
      { type: "message.delta", text: "NA\n" },
      { type: "message.completed" },
      { type: "context", used: 12522 },
    ]);
  });

  it("emits no message for a model call that only thought", () => {
    const { events } = feed([
      step(
        1,
        "DONE",
        "agent_response",
        ',"duration_seconds":3,"usage":{"input_tokens":12246,"output_tokens":457,"thinking_tokens":380,"cache_read_tokens":0,"total_tokens":12703}',
      ),
    ]);
    expect(events).toEqual<HarnessEvent[]>([{ type: "context", used: 12703 }]);
  });

  it("maps a file write to an edit tool with the path", () => {
    const { events } = feed([
      step(
        2,
        "ACTIVE",
        "tool",
        `,"tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"${DIR}\\\\notes.txt"}}`,
      ),
      step(
        2,
        "DONE",
        "tool",
        `,"tool_name":"write_to_file","duration_seconds":0.37,"tool_info":{"name":"write_to_file","parameters":{"TargetFile":"${DIR}\\\\notes.txt"}}`,
      ),
    ]);
    expect(events.map((e) => e.type)).toEqual(["tool.started", "tool.updated"]);
    const [started, updated] = events as Extract<
      HarnessEvent,
      { type: "tool.started" | "tool.updated" }
    >[];
    expect(started).toMatchObject({
      callId: `${CONV}:2`,
      kind: "edit",
      status: "in_progress",
      preview: { kind: "write", fileName: "notes.txt" },
    });
    expect(updated).toMatchObject({
      callId: `${CONV}:2`,
      kind: "edit",
      status: "completed",
    });
    expect(started.title).toContain("notes.txt");
  });

  it("maps a shell command with its output", () => {
    const { events } = feed([
      step(
        8,
        "ACTIVE",
        "tool",
        ',"tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo done"}}',
      ),
      step(
        8,
        "DONE",
        "tool",
        ',"tool_name":"run_command","duration_seconds":1.3,"tool_info":{"name":"run_command","parameters":{"CommandLine":"echo done"},"output":"done\\r\\n"}',
      ),
    ]);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      kind: "execute",
      title: "echo done",
    });
    expect(events[1]).toMatchObject({
      type: "tool.updated",
      status: "completed",
      detail: "done\r\n",
    });
  });

  it("maps a view_file read", () => {
    const { events } = feed([
      step(
        4,
        "DONE",
        "tool",
        `,"tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"${DIR}\\\\notes.txt"},"output":"3 lines, 11 bytes"}`,
      ),
    ]);
    // A step first seen as DONE still opens its row before closing it.
    expect(events.map((e) => e.type)).toEqual(["tool.started", "tool.updated"]);
    expect(events[0]).toMatchObject({
      kind: "read",
      title: expect.stringContaining("notes.txt"),
      preview: { kind: "read" },
    });
  });

  it("marks a denied command as failed with agy's reason", () => {
    const { events } = feed([
      step(
        4,
        "ACTIVE",
        "tool",
        ',"tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"}}',
      ),
      step(
        4,
        "ERROR",
        "tool",
        ',"tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"},"error":{"type":"TOOL_ERROR","message":"permission check failed for command \\"echo hi\\": user denied permission"}}',
      ),
    ]);
    expect(events[1]).toMatchObject({
      type: "tool.updated",
      status: "failed",
      detail: expect.stringContaining("user denied permission"),
    });
  });

  it("shows a subagent as an agent row", () => {
    const { events } = feed([
      step(
        2,
        "ACTIVE",
        "subagent",
        ',"tool_name":"invoke_subagent","subagent_info":{"subagents":[{"type_name":"self","role":"Greeter","initial_prompt":"Reply with the single word hello."}]}',
      ),
      step(
        2,
        "DONE",
        "subagent",
        ',"tool_name":"invoke_subagent","subagent_info":{"subagents":[{"type_name":"self","role":"Greeter","initial_prompt":"Reply with the single word hello.","conversation_id":"32ed0956"}]}',
      ),
    ]);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      kind: "agent",
      title: "Greeter",
    });
    expect(events[1]).toMatchObject({ type: "tool.updated", status: "completed" });
  });

  it("ends a turn on result, reports per-turn metrics and what was denied", () => {
    const { outcomes } = feed([
      step(
        1,
        "DONE",
        "agent_response",
        ',"usage":{"input_tokens":100,"output_tokens":10,"thinking_tokens":5,"cache_read_tokens":20,"total_tokens":110}',
      ),
      step(
        3,
        "DONE",
        "agent_response",
        ',"text_delta":"ok","usage":{"input_tokens":150,"output_tokens":20,"thinking_tokens":5,"cache_read_tokens":0,"total_tokens":170}',
      ),
      `{"event":"result","result":{"conversation_id":"${CONV}","status":"SUCCESS","response":"ok","duration_seconds":14,"num_turns":1,"usage":{"input_tokens":25074,"output_tokens":946,"thinking_tokens":792,"cache_read_tokens":0,"total_tokens":26020},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}`,
    ]);
    const last = outcomes[2];
    expect(last.result).toEqual({ ok: true });
    expect(last.events).toEqual<HarnessEvent[]>([
      {
        type: "turn.metrics",
        inputTokens: 250,
        outputTokens: 30,
        cacheReadTokens: 20,
      },
      {
        type: "status",
        text: expect.stringContaining("denied RunCommand"),
      },
    ]);
  });

  it("does not carry one turn's accounting into the next", () => {
    const state = createStreamState();
    handleStreamLine(
      state,
      step(
        1,
        "DONE",
        "agent_response",
        ',"usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}',
      ),
    );
    beginStreamTurn(state);
    const out = handleStreamLine(
      state,
      `{"event":"result","result":{"conversation_id":"${CONV}","status":"SUCCESS","response":"","usage":{"total_tokens":1}}}`,
    );
    expect(out.events).toEqual([]);
    expect(out.result).toEqual({ ok: true });
  });

  it("turns an ERROR result into a failed turn with agy's message", () => {
    const { outcomes } = feed([
      `{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \\"x\\" --effort \\"\\"): model x is not recognized","num_turns":0,"usage":{"total_tokens":0}}}`,
    ]);
    expect(outcomes[0].result).toEqual({
      ok: false,
      error: expect.stringContaining("model x is not recognized"),
    });
  });

  it("names the status when a non-SUCCESS result has no error text", () => {
    const { outcomes } = feed([
      `{"event":"result","result":{"conversation_id":"c","status":"CANCELLED"}}`,
    ]);
    expect(outcomes[0].result).toEqual({
      ok: false,
      error: "Antigravity ended the turn (CANCELLED).",
    });
  });

  it("ignores malformed, unknown and uninteresting lines without ending the turn", () => {
    const { outcomes, events } = feed([
      "",
      "not json",
      "{broken",
      '{"event":"mystery"}',
      '{"event":"step_update"}',
      '{"event":"step_update","step_update":{"step_index":"x"}}',
      step(4, "DONE", "system_message"),
      step(2, "DONE", "unknown"),
      step(0, "ACTIVE", "user_input"),
      '["array"]',
    ]);
    expect(events).toEqual([]);
    expect(outcomes.every((o) => !o.result && !o.userAccepted)).toBe(true);
  });
});
