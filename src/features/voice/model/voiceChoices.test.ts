import { expect, it } from "vitest";
import { parseVoiceChoice, spokenVoiceChoice, validVoiceChoiceReply } from "./voiceChoices";
const choice = () =>
  parseVoiceChoice({
    question: "Which project?",
    options: [
      { id: "one", label: "upstream" },
      { id: "two", label: "clinic" },
    ],
  });
it("matches spoken ordinals and labels but leaves ambiguous speech to the model", () => {
  expect(spokenVoiceChoice(choice(), "the second one")).toEqual({
    kind: "answered",
    answers: { choice: ["two"] },
  });
  expect(spokenVoiceChoice(choice(), "Upstream")).toEqual({
    kind: "answered",
    answers: { choice: ["one"] },
  });
  expect(spokenVoiceChoice(choice(), "maybe both later")).toBeUndefined();
});
it("rejects duplicate options and replies that do not belong to the active card", () => {
  expect(() =>
    parseVoiceChoice({
      question: "Question",
      options: [
        { id: "a", label: "A" },
        { id: "a", label: "Again" },
      ],
    }),
  ).toThrow();
  expect(
    validVoiceChoiceReply(choice(), { kind: "answered", answers: { choice: ["other-project"] } }),
  ).toBe(false);
  expect(
    validVoiceChoiceReply(choice(), { kind: "answered", answers: { choice: ["one", "two"] } }),
  ).toBe(false);
  expect(validVoiceChoiceReply(choice(), { kind: "skipped" })).toBe(true);
});
