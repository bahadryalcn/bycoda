import { describe, expect, it } from "vitest";
import { discardQuestionDraft, readQuestionDraft, writeQuestionDraft } from "./questionDrafts";
import type { UserQuestionPrompt } from "./userQuestion";

const prompt: UserQuestionPrompt = {
  requestId: 1,
  callId: "question-1",
  providerTurnId: "turn-1",
  questions: [
    { id: "scope", prompt: "Which scope?", allowCustom: true, multiSelect: false, options: [] },
  ],
};
const draft = { step: 0, answers: {}, custom: { scope: "Keep this unfinished answer" } };

describe("question drafts", () => {
  it("keeps an unfinished answer scoped to the owning session and question", () => {
    writeQuestionDraft("owner", prompt, draft);
    expect(readQuestionDraft("owner", prompt)).toEqual(draft);
    expect(readQuestionDraft("other-session", prompt)).toBeUndefined();
    expect(readQuestionDraft(undefined, prompt)).toBeUndefined();
    expect(readQuestionDraft("owner", { ...prompt, providerTurnId: "next-turn" })).toBeUndefined();
    expect(readQuestionDraft("owner", { ...prompt, callId: "question-2" })).toBeUndefined();
    expect(
      readQuestionDraft("owner", {
        ...prompt,
        questions: [{ ...prompt.questions[0], prompt: "A different question with the same ID?" }],
      }),
    ).toBeUndefined();
    discardQuestionDraft("owner", prompt);
    expect(readQuestionDraft("owner", prompt)).toBeUndefined();
  });

  it("does not retain unscoped answers and bounds retained questions", () => {
    writeQuestionDraft(undefined, prompt, draft);
    expect(readQuestionDraft(undefined, prompt)).toBeUndefined();
    for (let requestId = 100; requestId <= 164; requestId++) {
      writeQuestionDraft("bounded", { ...prompt, requestId }, draft);
    }
    expect(readQuestionDraft("bounded", { ...prompt, requestId: 100 })).toBeUndefined();
    expect(readQuestionDraft("bounded", { ...prompt, requestId: 164 })).toEqual(draft);
    for (let requestId = 101; requestId <= 164; requestId++) {
      discardQuestionDraft("bounded", { ...prompt, requestId });
    }
  });
});
