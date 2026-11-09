// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import { discardQuestionDraft } from "../model/questionDrafts";
import type { UserQuestionPrompt } from "../model/userQuestion";

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => {
  act(() => root.render(null));
});

it("retains notes through remount and option changes without replacing selection", async () => {
  const prompt: UserQuestionPrompt = {
    requestId: 9182,
    questions: [
      {
        id: "q",
        prompt: "Choose",
        multiSelect: false,
        allowCustom: true,
        options: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      },
    ],
  };
  const onReply = vi.fn();
  const render = () =>
    act(() =>
      root.render(createElement(QuestionForm, { prompt, draftScope: "notes-test", onReply })),
    );
  render();
  expect(container.querySelector("textarea")).toBeNull();
  act(() => container.querySelector<HTMLInputElement>('input[value="a"]')!.click());
  expect(container.querySelector("textarea")).toBeNull();
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Add a note")!
      .click(),
  );
  const field = container.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Keep the compact layout",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => root.render(null));
  render();
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "Keep the compact layout",
  );
  act(() => container.querySelector<HTMLInputElement>('input[value="b"]')!.click());
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onReply).toHaveBeenCalledWith(9182, {
    kind: "answered",
    answers: { q: ["b"] },
    notes: { q: "Keep the compact layout" },
  });
  discardQuestionDraft("notes-test", prompt);
});

it.each([false, true])(
  "keeps schema-only and typed choices free of note fields (typed=%s)",
  (typed) => {
    const prompt: UserQuestionPrompt = {
      requestId: typed ? 9184 : 9183,
      questions: [
        {
          id: "q",
          prompt: "Choose",
          multiSelect: false,
          allowCustom: typed,
          preserveCustomWhitespace: typed,
          options: [{ id: "a", label: "Alpha", literal: true }],
        },
      ],
    };
    act(() => root.render(createElement(QuestionForm, { prompt, onReply: vi.fn() })));
    act(() => container.querySelector<HTMLInputElement>('input[value="a"]')!.click());
    expect(container.textContent).not.toContain("Additional note (optional)");
  },
);
