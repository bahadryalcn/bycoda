// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NotePreviewParser } from "../previewBlocks";
import { NoteEditablePreview } from "./NoteEditablePreview";

const language = vi.hoisted(() => ({ prefix: "" }));
vi.mock("../../../shared/i18n", () => ({
  t: (text: string) => text,
  useT: () => {
    const prefix = language.prefix;
    return (text: string, values?: Record<string, unknown>) =>
      prefix + text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? ""));
  },
  useLocale: () => "en",
}));

it("updates memoized preview actions on a language change without changing note text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  const props = {
    value: "Retained source 漢🦀",
    viewRef: { current: null },
    rangeRef: { current: null },
    onChange,
    onSave: vi.fn(),
    onEditingChange: vi.fn(),
    onFocus: vi.fn(),
  };
  try {
    await act(async () => root.render(createElement(NoteEditablePreview, props)));
    expect(host.querySelector("[data-note-block-edit]")?.getAttribute("aria-label")).toBe(
      "Edit block: Retained source 漢🦀",
    );
    language.prefix = "Türkçe: ";
    await act(async () => root.render(createElement(NoteEditablePreview, props)));
    expect(host.querySelector("[data-note-block-edit]")?.getAttribute("aria-label")).toBe(
      "Türkçe: Edit block: Retained source 漢🦀",
    );
    expect(host.textContent).toContain(props.value);
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    language.prefix = "";
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
vi.mock("../../sessions/ui/AgentMarkdown", async () => {
  const { createElement } = await import("react");
  return {
    AgentMarkdown: ({ text }: { text: string }) =>
      createElement(
        "p",
        { "data-test-rich-markdown": "" },
        text,
        text.includes("Linked") ? createElement("a", { href: "#linked" }, "open link") : null,
      ),
  };
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
    const middle = [...host.querySelectorAll<HTMLElement>(".note-preview-content")].find((node) =>
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
    const after = [...host.querySelectorAll<HTMLElement>(".note-preview-content")].find((node) =>
      node.textContent?.includes("After."),
    )!;
    await act(async () => after.click());
    expect(host.querySelector("textarea")?.value).toBe("After.");
    const read = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Read document",
    )!;
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

it("gives each block one named keyboard stop and keeps links, pointer editing and focus independent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onFocus = vi.fn();
  const onEditingChange = vi.fn();
  function Fixture() {
    const [value, setValue] = useState("First paragraph.\n\nLinked [paragraph](#linked).");
    return createElement(NoteEditablePreview, {
      value,
      viewRef: useRef(null),
      rangeRef: useRef(null),
      onChange: setValue,
      onSave: () => {},
      onEditingChange,
      onFocus,
    });
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(createElement(Fixture)));
    // The content wrapper is neither a button nor a tab stop, so no link sits inside a button.
    expect(host.querySelector('[role="button"]')).toBeNull();
    expect(host.querySelector(".note-preview-content[tabindex]")).toBeNull();
    const pencils = [...host.querySelectorAll<HTMLButtonElement>("[data-note-block-edit]")];
    expect(pencils.map((pencil) => pencil.getAttribute("aria-label"))).toEqual([
      "Edit block: First paragraph.",
      "Edit block: Linked [paragraph](#linked).",
    ]);
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    expect(link.closest('[role="button"]')).toBeNull();

    // Activating a link neither starts editing nor is swallowed by the block.
    const linkClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.addEventListener("click", (event) => event.preventDefault());
    await act(async () => link.dispatchEvent(linkClick));
    expect(host.querySelector("textarea")).toBeNull();
    expect(onEditingChange).not.toHaveBeenCalledWith(true);

    // Pointer click-to-edit on the content still works.
    await act(async () => host.querySelector<HTMLElement>(".note-preview-content")!.click());
    expect(host.querySelector("textarea")?.value).toBe("First paragraph.");
    const read = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Read document",
    )!;
    await act(async () => read.click());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(
      host.querySelector('[data-note-block-from="0"] [data-note-block-edit]'),
    );

    // The pencil is the keyboard path and edits its own block.
    await act(async () =>
      host
        .querySelector<HTMLElement>('[aria-label="Edit block: Linked [paragraph](#linked)."]')!
        .click(),
    );
    expect(host.querySelector("textarea")?.value).toBe("Linked [paragraph](#linked).");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps every paragraph readable and editable while mounting rich renderers only for markup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const paragraphs = Array.from({ length: 250 }, (_, index) => `Note paragraph ${index}.`);
  paragraphs[42] = "هذه فقرة.";
  paragraphs[221] = "See [details][ref].";
  const value = [...paragraphs, "[ref]: https://example.com"].join("\n\n");
  try {
    await act(async () =>
      root.render(
        createElement(NoteEditablePreview, {
          value,
          viewRef: { current: null },
          rangeRef: { current: null },
          onChange: vi.fn(),
          onSave: vi.fn(),
          onEditingChange: vi.fn(),
          onFocus: vi.fn(),
        }),
      ),
    );
    const blocks = host.querySelectorAll(".note-preview-content");
    expect(blocks).toHaveLength(251);
    expect(host.querySelectorAll("[data-test-rich-markdown]")).toHaveLength(1);
    expect(blocks[42].querySelector("p")?.getAttribute("dir")).toBe("rtl");
    expect(blocks[221].textContent).toContain("[ref]: https://example.com");
    expect(blocks[249].textContent).toBe(paragraphs[249]);
    const lastPencil = host.querySelectorAll<HTMLButtonElement>("[data-note-block-edit]")[249];
    await act(async () => lastPencil.click());
    expect(host.querySelector("textarea")?.value).toBe(paragraphs[249]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
