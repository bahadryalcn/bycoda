import { expect, it } from "vitest";
import { cursorAskQuestionResponse } from "./cursorQuestionReply";
const questions = [
  {
    id: "q",
    prompt: "Choose",
    multiSelect: false,
    allowCustom: false,
    options: [{ id: "a", label: "Alpha" }],
  },
];

it("keeps exact Cursor option identifiers", () => {
  expect(cursorAskQuestionResponse({ kind: "answered", answers: { q: ["a"] } }, questions)).toEqual(
    { outcome: { outcome: "answered", answers: [{ questionId: "q", selectedOptionIds: ["a"] }] } },
  );
});

it("rejects unsupported notes instead of silently dropping user text", () => {
  expect(() =>
    cursorAskQuestionResponse(
      { kind: "answered", answers: { q: ["a"] }, notes: { q: "Keep it compact" } },
      questions,
    ),
  ).toThrow("Question notes are not supported");
  expect(cursorAskQuestionResponse({ kind: "skipped" }, questions)).toEqual({
    outcome: { outcome: "skipped", reason: "User skipped" },
  });
});
