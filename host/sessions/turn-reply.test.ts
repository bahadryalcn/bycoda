import { describe, expect, it } from "vitest";
import { lastTurnReply } from "./turn-reply";

describe("lastTurnReply", () => {
  it("returns only the assistant text after the last user message", () => {
    const blocks = [
      { role: "user", text: "first question" },
      { role: "assistant", text: "old answer" },
      { role: "user", text: "second question" },
      { role: "assistant", text: "first part" },
      { role: "tool", text: "ran a command" },
      { role: "assistant", text: "second part" },
    ] as const;
    expect(lastTurnReply([...blocks])).toBe("first part\n\nsecond part");
  });

  it("omits plan blocks unless includePlan is set", () => {
    const blocks = [
      { role: "user", text: "plan it" },
      { role: "plan", text: "step one" },
      { role: "assistant", text: "done" },
    ] as const;
    expect(lastTurnReply([...blocks])).toBe("done");
    expect(lastTurnReply([...blocks], { includePlan: true })).toBe("step one\n\ndone");
  });

  it("skips blank text and returns an empty string when nothing was said", () => {
    expect(
      lastTurnReply([
        { role: "user", text: "hi" },
        { role: "assistant", text: "   " },
      ]),
    ).toBe("");
    expect(lastTurnReply([])).toBe("");
    expect(lastTurnReply([{ role: "assistant", text: "no user turn" }])).toBe("no user turn");
  });
});
