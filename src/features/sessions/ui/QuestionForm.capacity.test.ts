// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import {
  discardQuestionDraft,
  readQuestionDraft,
  reserveQuestionDraft,
  resolveQuestionDraft,
  writeQuestionDraft,
} from "../model/questionDrafts";
import type { UserQuestionPrompt } from "../model/userQuestion";

let node: HTMLDivElement;
let root: Root;
const owned: [string, UserQuestionPrompt][] = [];
const prompt = (id: number): UserQuestionPrompt => ({
  requestId: id,
  callId: `capacity-${id}`,
  questions: [
    {
      id: "answer",
      prompt: "Your answer",
      allowCustom: true,
      multiSelect: false,
      options: [],
      preserveCustomWhitespace: true,
    },
  ],
});
function keep(id: number, text: string) {
  const value = prompt(id),
    scope = `capacity-${id}`;
  owned.push([scope, value]);
  expect(
    writeQuestionDraft(scope, value, { step: 0, answers: {}, custom: { answer: text } }).ok,
  ).toBe(true);
  return { value, scope };
}
function render(value: UserQuestionPrompt, scope: string, onReply = vi.fn(), strict = false) {
  const form = createElement(QuestionForm, {
    prompt: value,
    draftScope: scope,
    parentSessionId: scope,
    onReply,
  });
  act(() => root.render(strict ? createElement(StrictMode, null, form) : form));
  return onReply;
}
function input(text: string) {
  const field = node.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  for (const [scope, value] of owned.splice(0)) resolveQuestionDraft(scope, value);
  vi.unstubAllGlobals();
});

it("keeps the oldest exact answer when a 65th form is blocked, then admits it after explicit discard", () => {
  const first = keep(0, "  İ😀\r\n\t ");
  for (let i = 1; i < 64; i++) keep(i, `retained-${i}`);
  const next = prompt(64),
    scope = "capacity-64";
  owned.push([scope, next]);
  const reply = render(next, scope);
  expect(node.querySelector("textarea")!.readOnly).toBe(true);
  input("must not enter bounded storage");
  act(() =>
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(reply).not.toHaveBeenCalled();
  expect(node.querySelector("textarea")!.value).toBe("");
  expect(readQuestionDraft(first.scope, first.value)?.custom.answer).toBe("  İ😀\r\n\t ");
  act(() => {
    expect(discardQuestionDraft("capacity-1", prompt(1)).ok).toBe(true);
  });
  expect(node.querySelector("textarea")!.readOnly).toBe(false);
  input("new admitted answer");
  expect(readQuestionDraft(scope, next)?.custom.answer).toBe("new admitted answer");
  act(() => root.render(null));
  render(first.value, first.scope);
  expect(readQuestionDraft(first.scope, first.value)?.custom.answer).toBe("  İ😀\r\n\t ");
});

it("restores the actual controlled DOM value after an oversized Unicode paste is refused", () => {
  const saved = keep(100, "original 😀");
  render(saved.value, saved.scope);
  const field = input("😀".repeat(300_000));
  expect(field.value).toBe("original 😀");
  expect(readQuestionDraft(saved.scope, saved.value)?.custom.answer).toBe("original 😀");
  expect(node.textContent).toContain("Your previous answer is kept.");
  input("replacement");
  expect(readQuestionDraft(saved.scope, saved.value)?.custom.answer).toBe("replacement");
});

it("reserves a StrictMode form once and frees its untouched slot on unmount", () => {
  for (let i = 200; i < 263; i++) keep(i, "saved");
  const value = prompt(263),
    scope = "capacity-263";
  owned.push([scope, value]);
  render(value, scope, vi.fn(), true);
  expect(node.querySelector("textarea")!.readOnly).toBe(false);
  const overflow = prompt(264);
  owned.push(["capacity-264", overflow]);
  expect(reserveQuestionDraft("capacity-264", overflow, "capacity-264")).toMatchObject({
    ok: false,
    reason: "capacity",
  });
  act(() => root.render(null));
  const admitted = reserveQuestionDraft("capacity-264", overflow, "capacity-264");
  expect(admitted.ok).toBe(true);
  if (admitted.ok) admitted.value.release();
});

it("records uncertainty on the original lease when dispatch synchronously unmounts then throws", () => {
  const saved = keep(500, "  original 😀\r\n ");
  const reply = vi.fn(() => {
    flushSync(() => root.render(null));
    throw new Error("transport threw after the view retired");
  });
  render(saved.value, saved.scope, reply);
  act(() =>
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(reply).toHaveBeenCalledTimes(1);
  expect(readQuestionDraft(saved.scope, saved.value)).toMatchObject({
    delivery: "unknown",
    custom: { answer: "  original 😀\r\n " },
  });
  render(saved.value, saved.scope, reply);
  expect(node.textContent).toContain("Connection issue");
  expect(node.querySelector('[aria-busy="true"]')).toBeNull();
  act(() =>
    node
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(reply).toHaveBeenCalledTimes(1);
});
