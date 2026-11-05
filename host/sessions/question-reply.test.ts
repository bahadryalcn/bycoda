import { describe, expect, it } from "vitest";
import { parseQuestionReply } from "./question-reply";

describe("parseQuestionReply", () => {
  it("retains notes on answered replies", () => {
    expect(
      parseQuestionReply({
        kind: "answered",
        answers: { q: ["yes"] },
        notes: { q: "Keep current API" },
      }),
    ).toEqual({
      kind: "answered",
      answers: { q: ["yes"] },
      notes: { q: "Keep current API" },
    });
  });

  it("rejects malformed notes", () => {
    expect(() =>
      parseQuestionReply({
        kind: "answered",
        answers: {},
        notes: { q: 5 },
      }),
    ).toThrow("Invalid question notes");
  });
});
