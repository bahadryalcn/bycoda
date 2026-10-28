import { describe, expect, it } from "vitest";
import { newSession } from "../../../../features/sessions/model/session";
import { MAX_TOOL_DETAIL_CHARS, applyHarnessEvent } from "../../core/apply";
import type { HarnessEvent } from "../../core/types";
import { mapCodexNotification, type CodexCommandOutputState } from "./codexProtocol";

const delta = (state: CodexCommandOutputState, itemId: string, text: string): HarnessEvent[] =>
  mapCodexNotification("item/commandExecution/outputDelta", { itemId, delta: text }, undefined, state)
    .events;

describe("Codex command output accumulation (CMD-02)", () => {
  it("emits the accumulated output so earlier chunks survive replacement", () => {
    const state: CodexCommandOutputState = new Map();
    const events = [
      ...mapCodexNotification("item/started", {
        item: { type: "commandExecution", id: "i1", command: "ls", status: "inProgress" },
      }).events,
      ...delta(state, "i1", "a\n"),
      ...delta(state, "i1", "b\n"),
      ...delta(state, "i1", "b\n"),
    ];
    const tool = events.reduce(applyHarnessEvent, newSession("codex", "/repo")).blocks[0].tool;
    expect(tool?.detail).toBe("a\nb\nb");
  });

  it("keeps whitespace-only and repeated chunks verbatim in the accumulator", () => {
    const state: CodexCommandOutputState = new Map();
    delta(state, "i1", "x");
    delta(state, "i1", "\n");
    delta(state, "i1", "x");
    expect(state.get("i1")?.text).toBe("x\nx");
  });

  it("lets the completed aggregate replace the stream and drops the accumulator", () => {
    const state: CodexCommandOutputState = new Map();
    let session = newSession("codex", "/repo");
    for (const event of delta(state, "i1", "partial")) session = applyHarnessEvent(session, event);
    const done = mapCodexNotification(
      "item/completed",
      {
        item: {
          type: "commandExecution",
          id: "i1",
          command: "ls",
          status: "completed",
          aggregatedOutput: "final output",
        },
      },
      undefined,
      state,
    ).events;
    for (const event of done) session = applyHarnessEvent(session, event);
    expect(session.blocks[0].tool?.detail).toBe("final output");
    expect(state.has("i1")).toBe(false);
  });

  it("keeps the tail within the core cap and reports the drop", () => {
    const state: CodexCommandOutputState = new Map();
    delta(state, "i1", "H".repeat(MAX_TOOL_DETAIL_CHARS));
    const [event] = delta(state, "i1", "TAIL");
    expect(state.get("i1")?.text).toHaveLength(MAX_TOOL_DETAIL_CHARS);
    expect(state.get("i1")?.text.endsWith("TAIL")).toBe(true);
    expect(event).toMatchObject({ type: "tool.updated", detailTruncated: true });
    const tool = [event].reduce(applyHarnessEvent, newSession("codex", "/repo")).blocks[0].tool;
    expect(tool?.outputTruncated).toBe(true);
    expect(tool?.detail?.endsWith("TAIL")).toBe(true);
  });

  it("clears every accumulator when the turn ends or aborts", () => {
    for (const method of ["turn/completed", "turn/aborted"]) {
      const state: CodexCommandOutputState = new Map();
      delta(state, "i1", "a");
      mapCodexNotification(method, { turn: { id: "t1", status: "completed" } }, undefined, state);
      expect(state.size).toBe(0);
    }
  });

  it("keeps separate calls apart", () => {
    const state: CodexCommandOutputState = new Map();
    delta(state, "i1", "one");
    delta(state, "i2", "two");
    expect(state.get("i1")?.text).toBe("one");
    expect(state.get("i2")?.text).toBe("two");
  });
});
