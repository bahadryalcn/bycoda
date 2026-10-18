// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type { UserQuestionPrompt, UserQuestionReply } from "../model/userQuestion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

function renderQuestion(
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  multiSelect = false,
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: prompt(multiSelect),
        onReply,
      }),
    ),
  );
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]'),
  );
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("QuestionForm keyboard navigation", () => {
  it("shows a provider's repeated question only once and names free-entry answers", () => {
    const typed = prompt();
    typed.questions[0].header = typed.questions[0].prompt;
    typed.questions[0].options = [];
    typed.questions[0].allowCustom = true;
    act(() => root.render(createElement(QuestionForm, { prompt: typed, onReply: vi.fn() })));
    expect(container.textContent?.match(/Pick a colour/g)).toHaveLength(1);
    expect(container.querySelector("legend")?.textContent).toBe("Pick a colour");
    expect(
      container
        .querySelector('input:not([type="radio"]):not([type="checkbox"])')
        ?.getAttribute("aria-label"),
    ).toBe("Type your answer");
  });

  it("revisits an answer and sends its edited selection while preserving later answers", () => {
    const onReply = vi.fn();
    const questions = prompt();
    questions.questions.push({ ...questions.questions[0], id: "second", prompt: "Second colour" });
    act(() => root.render(createElement(QuestionForm, { prompt: questions, onReply })));
    const button = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (el) => el.textContent?.trim() === label,
      )!;
    const choice = (text: string) =>
      [...container.querySelectorAll("label")]
        .find((el) => el.textContent?.trim() === text)!
        .querySelector("input")!;
    expect(button("Back")).toBeUndefined();
    act(() => choice("Red").click());
    act(() => button("Continue").click());
    act(() => choice("Blue").click());
    act(() => button("Back").click());
    expect(choice("Red").checked).toBe(true);
    act(() => choice("Green").click());
    act(() => button("Continue").click());
    expect(choice("Blue").checked).toBe(true);
    act(() => button("Continue").click());
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"], second: ["blue"] },
    });
  });
  it("moves the highlighted option with arrow keys and selects it with Enter", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);

    expect(options[0].type).toBe("radio");
    act(() => options[0].focus());

    keyDown(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);

    keyDown(options[1], "Enter");
    expect(options[1].checked).toBe(true);

    act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"] },
    });
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "ArrowUp");
    expect(document.activeElement).toBe(options[2]);

    keyDown(options[2], "Home");
    expect(document.activeElement).toBe(options[0]);

    keyDown(options[0], "End");
    expect(document.activeElement).toBe(options[2]);
  });

  it("uses number keys to focus and select the matching option", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "3");

    expect(document.activeElement).toBe(options[2]);
    expect(options[2].checked).toBe(true);
  });

  it("toggles highlighted options for multi-select questions", () => {
    const options = renderQuestion(vi.fn(), true);
    act(() => options[0].focus());

    keyDown(options[0], "Enter");
    keyDown(options[0], "ArrowDown");
    keyDown(options[1], " ");

    expect(options[0].checked).toBe(true);
    expect(options[1].checked).toBe(true);

    keyDown(options[1], " ");
    expect(options[1].checked).toBe(false);
  });
});

it("literal Other seçimi custom alan açmadan gerçek option ID ile gönderilir", () => {
  const onReply = vi.fn();
  const typed = prompt();
  typed.questions[0].options = [{ id: "value_0", label: "Other", literal: true }];
  act(() => root.render(createElement(QuestionForm, { prompt: typed, onReply })));
  const option = container.querySelector<HTMLInputElement>(
    'input[type="radio"], input[type="checkbox"]',
  )!;
  act(() => option.click());
  expect(
    container.querySelector('textarea, input:not([type="radio"]):not([type="checkbox"])'),
  ).toBeNull();
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onReply).toHaveBeenCalledWith(7, { kind: "answered", answers: { colour: ["value_0"] } });
});

it.each([false, true])(
  "keeps the custom answer outside the scrolling options and focuses it (multiSelect=%s)",
  (multiSelect) => {
    const typed = prompt(multiSelect);
    typed.questions[0].allowCustom = true;
    act(() => root.render(createElement(QuestionForm, { prompt: typed, onReply: vi.fn() })));
    const options = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"]',
      ),
    ];
    act(() => options.at(-1)!.click());
    const input = container.querySelector<HTMLInputElement>(
      'input:not([type="radio"]):not([type="checkbox"])',
    )!;
    expect(input).not.toBeNull();
    expect(input.closest('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    act(() => options[0].click());
    if (multiSelect) {
      expect(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')).toBe(
        input,
      );
      act(() => options.at(-1)!.click());
    }
    expect(container.querySelector('input:not([type="radio"]):not([type="checkbox"])')).toBeNull();
  },
);
