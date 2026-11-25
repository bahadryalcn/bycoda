// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MOD } from "../../../platform/tauri/platform";
import { saveKeybindingOverride } from "../../settings/model/settings";
import type { Block } from "../model/session";
import { requestTranscriptJump } from "../model/transcriptJump";
import { TranscriptFind } from "./TranscriptFind";

function typeFind(container: HTMLElement, query: string) {
  const field = container.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("reads missing history only for an active query, retries failures and waits for the whole result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finish!: (value: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const blocks: Block[] = [{ id: "new", role: "user", text: "recent" }];
  const render = (page?: string) =>
    act(async () =>
      root.render(
        createElement(TranscriptFind, {
          blocks: [...blocks],
          visible: true,
          focused: true,
          sessionId: "history",
          onNavigate: () => true,
          historyPage: page,
          loadHistory: load,
        }),
      ),
    );
  const status = () => container.querySelector('[role="status"]')?.textContent;
  try {
    await render("20");
    await act(async () => container.querySelector("button")!.click());
    expect(load).not.toHaveBeenCalled();
    await act(async () => typeFind(container, "needle"));
    expect(status()).toBe("Searching…");
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => finish(0));
    expect(status()).toBe("Search failed");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Retry"]')!.click(),
    );
    expect(load).toHaveBeenCalledTimes(2);
    blocks.unshift({ id: "old", role: "assistant", text: "needle in old page" });
    await act(async () => finish(1));
    await render(undefined);
    expect(status()).toBe("1 of 1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps one read across keystrokes and stops fetching when the conversation is hidden or Find closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const readBlock = vi.fn(() => Promise.resolve());
  const preview: Block = {
    id: "large",
    role: "assistant",
    text: "preview",
    remoteContent: { revision: 3, bytes: 100000 },
  };
  let release!: (added: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        release = resolve;
      }),
  );
  const render = (visible: boolean, page?: string, full = false) =>
    act(async () =>
      root.render(
        createElement(TranscriptFind, {
          blocks: [
            full ? { ...preview, text: "secret only in full", remoteContent: undefined } : preview,
          ],
          visible,
          focused: visible,
          onNavigate: () => true,
          sessionId: "remote",
          historyPage: page,
          loadHistory: load,
          loadBlock: readBlock,
        }),
      ),
    );
  try {
    await render(true, "p1");
    await act(async () => container.querySelector("button")!.click());
    await act(async () => typeFind(container, "s"));
    await act(async () => typeFind(container, "secret"));
    expect(load).toHaveBeenCalledTimes(1);
    await render(false, "p1");
    await act(async () => release(20));
    await render(false, "p2");
    expect(load).toHaveBeenCalledTimes(1);
    await render(true, "p2");
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close find"]')!.click(),
    );
    await act(async () => release(20));
    await render(true);
    expect(readBlock).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click());
    expect(readBlock).toHaveBeenCalledExactlyOnceWith("large", 3);
    await render(true, undefined, true);
    expect(container.querySelector("[role=status]")?.textContent).toBe("1 of 1");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}

it("keeps one keyboard binding across streamed renders and reads the latest navigation callback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const previous = vi.fn(() => true);
  const latest = vi.fn(() => true);
  try {
    const draw = (onNavigate: typeof latest) =>
      act(async () =>
        root.render(
          createElement(TranscriptFind, {
            blocks: [],
            visible: true,
            focused: true,
            onNavigate,
          }),
        ),
      );
    await draw(previous);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    add.mockClear();
    remove.mockClear();
    await draw(latest);
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    expect(remove.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(latest).toHaveBeenCalledWith(null);
    expect(previous).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    add.mockRestore();
    remove.mockRestore();
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "keeps find bindings and mouse access with a header trigger: %s",
  async (inHeader) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    localStorage.clear();
    const container = document.createElement("div");
    const header = document.createElement("div");
    document.body.append(header, container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(TranscriptFind, {
            blocks: [],
            visible: true,
            focused: true,
            triggerContainer: inHeader ? header : undefined,
            onNavigate: () => true,
          }),
        ),
      );
      const launcher = () =>
        (inHeader ? header : container).querySelector<HTMLButtonElement>("button")!;
      if (inHeader) expect(container.querySelector("button")).toBeNull();
      expect(launcher().title).toBe("");
      expect(await tooltipText(launcher())).toBe(`Find in conversation${MOD.replace(/\+$/, "")}F`);
      await act(async () => {
        saveKeybindingOverride("Editor: Find", { shortcut: "Control+Option+Shift+KeyM" });
      });
      expect(await tooltipText(launcher())).toMatch(/M$/);
      await act(async () => {
        saveKeybindingOverride("Editor: Find", { disabled: true });
      });
      expect(await tooltipText(launcher())).toBe("Find in conversation");
      await act(async () => launcher().click());
      if (inHeader) expect(launcher().getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector('[role="search"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Next match"]')).not.toBeNull();
      const close = container.querySelector<HTMLButtonElement>('[aria-label="Close find"]')!;
      await act(async () => close.click());
      expect(await tooltipText(launcher())).toBe("Find in conversation");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      header.remove();
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  },
);

it("adopts a cross-session jump in one pass: query, open find and the matching block", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const blocks: Block[] = [
    { id: "a1", role: "assistant", text: "needle one" },
    { id: "a2", role: "assistant", text: "needle two" },
    { id: "a3", role: "assistant", text: "needle three" },
  ];
  const onNavigate = vi.fn(() => true);
  try {
    await act(async () =>
      root.render(
        createElement(TranscriptFind, {
          blocks,
          visible: true,
          focused: true,
          sessionId: "jump-session",
          onNavigate,
        }),
      ),
    );
    expect(container.querySelector('[role="search"]')).toBeNull();
    await act(async () => requestTranscriptJump("jump-session", "a2", "needle"));
    expect(container.querySelector('[role="search"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("needle");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("2 of 3");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
