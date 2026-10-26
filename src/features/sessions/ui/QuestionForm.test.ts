// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import type { UserQuestionPrompt, UserQuestionReply } from "../model/userQuestion";
import { discardQuestionDraft } from "../model/questionDrafts";

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
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      "Type your answer",
    );
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
    act(() => button("Next").click());
    act(() => choice("Blue").click());
    act(() => button("Back").click());
    expect(choice("Red").checked).toBe(true);
    act(() => choice("Green").click());
    act(() => button("Next").click());
    expect(choice("Blue").checked).toBe(true);
    act(() => button("Send answer").click());
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
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(input).not.toBeNull();
    expect(input.closest('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    act(() => options[0].click());
    if (multiSelect) {
      expect(container.querySelector("textarea")).toBe(input);
      act(() => options.at(-1)!.click());
    }
    expect(container.querySelector("textarea")).toBeNull();
  },
);

describe("question delivery and ownership", () => {
  function render(typed: UserQuestionPrompt, onReply = vi.fn(), draftScope?: string) {
    act(() => root.render(createElement(QuestionForm, { prompt: typed, onReply, draftScope })));
    return onReply;
  }

  it("reports only provider-confirmed waiting and continuation behavior", () => {
    const typed = prompt();
    render(typed);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Question open");
    render({ ...typed, behavior: "blocking" });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Waiting for your answer");
    render({ ...typed, behavior: "nonBlocking" });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Work may continue while this question is open",
    );
  });

  it("sends once, preserves the answer on a known failure, and allows an explicit retry", () => {
    const typed = prompt();
    const onReply = render(typed);
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    const submit = () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    act(() => {
      submit();
      submit();
    });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(container.querySelector('button[type="submit"]')?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Sending answer…");
    expect(container.querySelector('button[type="button"]')?.getAttribute("aria-busy")).not.toBe("true");
    render({ ...typed, delivery: "failed" }, onReply);
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your answer is kept");
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Send again");
    act(() => submit());
    expect(onReply).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Sending answer…");
    // A synchronous validation rejection can batch sending/failed updates so
    // the delivery value stays failed while the authoritative snapshot changes.
    render({ ...typed, delivery: "failed" }, onReply);
    act(() => submit());
    expect(onReply).toHaveBeenCalledTimes(3);
  });

  it("holds an answer when a callback throws without a confirmed pre-dispatch failure", () => {
    const typed = prompt();
    const onReply = render(
      typed,
      vi.fn(() => {
        throw new Error("Uncertain callback outcome");
      }),
    );
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    const submit = () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    act(() => submit());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be confirmed",
    );
    act(() => submit());
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
  });

  it("retains an uncertain local dispatch after remount until a provider failure permits retry", () => {
    const typed = prompt();
    const scope = "uncertain-remount";
    const onReply = vi.fn(() => {
      throw new Error("Unknown dispatch outcome");
    });
    render(typed, onReply, scope);
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    const submit = () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    act(() => submit());
    act(() => root.render(null));
    render(typed, onReply, scope);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be confirmed",
    );
    act(() => submit());
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
    render({ ...typed, delivery: "failed" }, onReply, scope);
    act(() => submit());
    expect(onReply).toHaveBeenCalledTimes(2);
    discardQuestionDraft(scope, typed);
  });

  it.each(["unknown", "queued"] as const)(
    "holds a %s answer without offering another send",
    (delivery) => {
      const typed = prompt();
      const onReply = render(typed);
      act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
      render({ ...typed, delivery }, onReply);
      expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
        true,
      );
      act(() =>
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(onReply).not.toHaveBeenCalled();
      expect(container.textContent).toContain(
        delivery === "unknown" ? "could not be confirmed" : "waiting to continue",
      );
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
        delivery === "unknown" ? "Connection issue" : "Waiting",
      );
    },
  );

  it.each(["cancel", "decline", "skip"] as const)(
    "keeps %s progress on the initiating control after remount and recovers only on confirmed failure",
    (dismissAction) => {
      const typed = { ...prompt(), dismissAction };
      const scope = `pending-dismiss-${dismissAction}`;
      const onReply = render(typed, vi.fn(), scope);
      const dismiss = () => container.querySelector<HTMLButtonElement>('button[type="button"]')!;
      act(() => {
        dismiss().focus();
        dismiss().click();
      });
      expect(onReply).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(dismiss());
      expect(dismiss().getAttribute("aria-busy")).toBe("true");
      expect(dismiss().getAttribute("aria-disabled")).toBe("true");
      expect(container.querySelector('button[type="submit"]')?.getAttribute("aria-busy")).not.toBe("true");
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        dismissAction === "cancel" ? "Cancelling…" : "Sending…",
      );
      act(() => root.render(null));
      render(typed, onReply, scope);
      expect(dismiss().getAttribute("aria-busy")).toBe("true");
      act(() => dismiss().click());
      expect(onReply).toHaveBeenCalledTimes(1);
      render({ ...typed, delivery: "unknown" }, onReply, scope);
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      render({ ...typed, delivery: "failed" }, onReply, scope);
      expect(dismiss().disabled).toBe(false);
      act(() => dismiss().click());
      expect(onReply).toHaveBeenCalledTimes(2);
      discardQuestionDraft(scope, typed);
    },
  );

  it("cancels the entire provider question instead of treating cancellation as a skipped field", () => {
    const typed = prompt();
    typed.questions.push({ ...typed.questions[0], id: "another", prompt: "Another choice?" });
    typed.dismissAction = "cancel";
    const onReply = render(typed);
    const cancel = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Cancel question",
    )!;
    act(() => cancel.click());
    expect(onReply).toHaveBeenCalledWith(7, { kind: "skipped" });
  });

  it("skips only the current field when supported and keeps that choice after a failed send", () => {
    const typed = prompt();
    typed.dismissAction = "skip";
    typed.questions.push({ ...typed.questions[0], id: "another", prompt: "Another choice?" });
    const onReply = render(typed);
    const button = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === label,
      )!;
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    act(() => button("Next").click());
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    act(() => button("Skip").click());
    expect(onReply).toHaveBeenLastCalledWith(7, { kind: "answered", answers: { colour: ["red"] } });
    render({ ...typed, delivery: "failed" }, onReply);
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(false);
    act(() => button("Skip").click());
    expect(onReply).toHaveBeenCalledTimes(2);
    expect(onReply).toHaveBeenLastCalledWith(7, { kind: "answered", answers: { colour: ["red"] } });
  });

  it("restores an unfinished answer after changing sessions and remounting", () => {
    const typed = prompt();
    render(typed, vi.fn(), "draft-session-a");
    act(() => container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
    render(typed, vi.fn(), "draft-session-b");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(false);
    act(() => root.render(null));
    render(typed, vi.fn(), "draft-session-a");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
    discardQuestionDraft("draft-session-a", typed);
    discardQuestionDraft("draft-session-b", typed);
  });
});
