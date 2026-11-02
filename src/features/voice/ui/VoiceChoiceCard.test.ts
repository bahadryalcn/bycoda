// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceChoiceCard } from "./VoiceChoiceCard";
import { AssistantOwnerQuestionSchema } from "../../../shared/model/assistantOwnerQuestions";
import {
  ownerQuestionDraftScope,
  ownerQuestionPrompt,
} from "../../assistant/model/assistantOwnerQuestions";
import type { VoiceChoice } from "../model/voiceChoices";
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await act(async () => close());
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("keeps a malformed retained draft visible without crashing or sending an answer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const question = AssistantOwnerQuestionSchema.parse({
    id: "retained-voice-choice",
    version: 1,
    jobId: null,
    threadId: "thread",
    ownerMessageId: "owner",
    projectIds: [],
    origin: "voice-proposal",
    sourceToken: "a".repeat(64),
    status: "open",
    createdAt: 1,
    updatedAt: 1,
    prompt: {
      requestId: 1,
      occurrenceId: "canonical-occurrence",
      behavior: "nonBlocking",
      questions: [
        {
          id: "q",
          prompt: "Which result?",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "a", label: "First" },
            { id: "b", label: "Second" },
          ],
        },
      ],
    },
  });
  const key = ownerQuestionDraftScope("host", question);
  localStorage.setItem(key, "{broken");
  const choice: VoiceChoice = {
    id: question.id,
    kind: "single",
    prompt: ownerQuestionPrompt(question),
    ownerQuestion: { question, environmentId: "host" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    reply = vi.fn();
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
  await act(async () => root.render(createElement(VoiceChoiceCard, { choice, onReply: reply })));
  expect(container.textContent).toContain("question draft");
  expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(reply).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBe("{broken");
});
