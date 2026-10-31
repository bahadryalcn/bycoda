// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { insertAtCaret } from "./composerTextareaEdit";

function textarea(value: string, start: number, end = start) {
  const el = document.createElement("textarea");
  el.value = value;
  el.setSelectionRange(start, end);
  return el;
}

it("inserts dictated text at the caret with word spacing and notifies draft listeners", () => {
  const el = textarea("Fix the bug", 7);
  const input = vi.fn();
  el.addEventListener("input", input);
  insertAtCaret(el, "login");
  expect(el.value).toBe("Fix the login bug");
  expect(el.selectionStart).toBe("Fix the login".length);
  expect(input).toHaveBeenCalledOnce();
});

it("appends to an empty or space-ended draft and replaces a selection", () => {
  const empty = textarea("", 0);
  insertAtCaret(empty, "Merhaba");
  expect(empty.value).toBe("Merhaba");
  const spaced = textarea("Merhaba ", 8);
  insertAtCaret(spaced, "dünya");
  expect(spaced.value).toBe("Merhaba dünya");
  const selected = textarea("Run old tests now", 4, 13);
  insertAtCaret(selected, "all");
  expect(selected.value).toBe("Run all now");
});
