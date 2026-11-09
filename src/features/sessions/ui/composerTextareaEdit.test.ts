// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { insertAtCaret, insertDictatedText } from "./composerTextareaEdit";

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

it("replaces a live dictation preview in place with each update and the final text", () => {
  const el = textarea("Fix bug", 3);
  const run = {};
  insertDictatedText(el, "the", false, run);
  expect(el.value).toBe("Fix the bug");
  insertDictatedText(el, "the login", false, run);
  expect(el.value).toBe("Fix the login bug");
  insertDictatedText(el, "the logout", true, run);
  expect(el.value).toBe("Fix the logout bug");
  // The final text is ordinary text: the next phrase is inserted at the caret.
  insertDictatedText(el, "page", true, run);
  expect(el.value).toBe("Fix the logout page bug");
});

it("removes a preview whose final text is empty and keeps edited or foreign previews", () => {
  const el = textarea("Hello", 5);
  const run = {};
  insertDictatedText(el, "uh", false, run);
  insertDictatedText(el, "", true, run);
  expect(el.value).toBe("Hello");
  insertDictatedText(el, "world", false, run);
  // The owner edits the preview: it stays, and the update goes to the caret.
  el.value = "Hello World";
  el.setSelectionRange(11, 11);
  insertDictatedText(el, "world again", true, run);
  expect(el.value).toBe("Hello World world again");
  // A preview left by a cancelled run is never replaced by a new run.
  insertDictatedText(el, "left", false, run);
  insertDictatedText(el, "new", true, {});
  expect(el.value).toBe("Hello World world again left new");
});
