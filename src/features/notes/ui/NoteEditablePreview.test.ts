// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NotePreviewParser } from "../previewBlocks";
import { NoteEditablePreview } from "./NoteEditablePreview";

vi.mock("../../../shared/i18n", () => ({ t: (text: string) => text, useLocale: () => "en" }));
vi.mock("../../sessions/ui/AgentMarkdown", async () => {
  const { createElement } = await import("react");
  return { AgentMarkdown: ({ text }: { text: string }) => createElement("p", {}, text) };
});
vi.mock("./NoteMarkdownEditor", async () => {
  const { createElement } = await import("react");
  return {
    NoteMarkdownEditor: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) =>
      createElement("textarea", {
        value,
        onInput: (event: Event) => onChange((event.target as HTMLTextAreaElement).value),
      }),
  };
});

it("keeps neighbour parse/DOM stable during block edits and maps the next selected block to current text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const parse = vi.spyOn(NotePreviewParser.prototype, "parse");
  const save = vi.fn();
  let latest = "Before.\n\nMiddle.\n\nAfter.";
  function Fixture() {
    const [value, setValue] = useState(latest),
      viewRef = useRef(null),
      rangeRef = useRef(null);
    return createElement(NoteEditablePreview, {
      value,
      viewRef,
      rangeRef,
      onChange: (next) => {
        latest = next;
        setValue(next);
      },
      onSave: save,
      onPasteImages: () => {},
      onEditingChange: () => {},
      onFocus: () => {},
    });
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(createElement(Fixture)));
    const middle = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((node) =>
      node.textContent?.includes("Middle."),
    )!;
    await act(async () => middle.click());
    const count = parse.mock.calls.length;
    const before = host.querySelector("p");
    for (const text of [
      "Longer middle.",
      "Longer middle.\n\nAnother paragraph.",
      "Final middle.",
    ]) {
      await act(async () => {
        const editor = host.querySelector("textarea")!;
        editor.value = text;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(parse.mock.calls.length).toBe(count);
    expect(host.querySelector("p")).toBe(before);
    expect(latest).toBe("Before.\n\nFinal middle.\n\nAfter.");
    const after = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((node) =>
      node.textContent?.includes("After."),
    )!;
    await act(async () => after.click());
    expect(host.querySelector("textarea")?.value).toBe("After.");
    const read = [...host.querySelectorAll("button")].find((button) => button.textContent === "Read document")!;
    await act(async () => read.click());
    expect(host.querySelector("textarea")).toBeNull();
    expect(latest).toBe("Before.\n\nFinal middle.\n\nAfter.");
    expect(save).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    parse.mockRestore();
    vi.unstubAllGlobals();
  }
});
