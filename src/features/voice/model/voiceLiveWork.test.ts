import { describe, expect, it } from "vitest";
import { voiceLiveWorkSuggestion } from "./voiceLiveWork";
import { currentExecutionTools } from "../../sessions/public/commandInspection";
import type { Session } from "../../sessions/public/session";

const blocks: Session["blocks"] = [
  { id: "old", role: "user", text: "Old request" },
  { id: "old-tool", role: "tool", text: "" },
  { id: "new", role: "user", text: "Run tests" },
  { id: "command", role: "tool", text: "" },
  { id: "draft", role: "user", text: "Unsubmitted draft", draft: true },
];

describe("voice live work", () => {
  it("surfaces only the current turn and keeps the suggestion key stable across output", () => {
    const session = { id: "session", busy: true, blocks };
    expect(currentExecutionTools(blocks).tools.map(({ id }) => id)).toEqual(["command"]);
    expect(voiceLiveWorkSuggestion(session, [])).toBe("turn:session:new");
    expect(voiceLiveWorkSuggestion({ ...session, blocks: blocks.slice(0, 3) }, [])).toBeUndefined();
    expect(voiceLiveWorkSuggestion({ ...session, busy: false }, [])).toBeUndefined();
  });

  it("uses the actual running observation and ignores finished calls", () => {
    const task = { id: "request", name: "Test", target: "Project", projectPath: "", startedAt: 0 };
    expect(voiceLiveWorkSuggestion(undefined, [{ ...task, state: "running" }])).toBe(
      "activity:request",
    );
    expect(voiceLiveWorkSuggestion(undefined, [{ ...task, state: "returned" }])).toBeUndefined();
  });
});
