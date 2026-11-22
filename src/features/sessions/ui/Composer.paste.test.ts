// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { copyMessage, messageFilesFromClipboard } from "../../../platform/tauri/clipboard";
import { clearComposerDraft, setComposerAttachments } from "../model/draftCache";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...original,
    invoke: (command: string, args?: unknown) =>
      command === "write_attachment"
        ? Promise.resolve(`/attachments/${(args as { name: string }).name}`)
        : command === "read_file_base64" && (args as { path: string }).path === "/saved/shot.png"
          ? Promise.resolve("YWJj")
          : original.invoke(command, args),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

it("copies attachments from the selection menu and restores them after cutting with Ctrl+Z", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sessionId = "attachment-cut-undo";
  setComposerAttachments(sessionId, [
    { id: "image", name: "shot.png", mimeType: "image/png", kind: "image", size: 3, data: "YWJj" },
    { id: "file", name: "report.txt", mimeType: "text/plain", kind: "file", size: 3, data: "YWJj" },
  ]);
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          sessionId,
          focused: true,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "Keep [image1] and [file1]",
          hideTopBar: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );
    const textarea = container.querySelector("textarea")!;
    const original = textarea.value;
    textarea.focus();
    textarea.setSelectionRange(4, original.length);
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 20, 300, 40));
    await act(async () => {
      textarea.dispatchEvent(new Event("select"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const copy = document.querySelector<HTMLButtonElement>(
      '[data-selection-menu] button[aria-label="Copy"]',
    );
    expect(copy).not.toBeNull();
    await act(async () => copy!.click());
    expect(write).toHaveBeenCalledOnce();
    expect(textarea.value).toBe(original);
    write.mockClear();
    await act(async () =>
      textarea.dispatchEvent(new Event("cut", { bubbles: true, cancelable: true })),
    );
    expect(write).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("Keep");
    expect(container.querySelector('[aria-label="Remove shot.png"]')).toBeNull();
    const html = await (await write.mock.calls[0][0][0].getType("text/html")).text();
    expect(messageFilesFromClipboard({ getData: () => html })?.map((file) => file.name)).toEqual([
      "shot.png",
      "report.txt",
    ]);
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(textarea.value).toBe(original);
    expect(container.querySelector('[aria-label="Remove shot.png"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Remove report.txt"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    clearComposerDraft(sessionId);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "pastes text and a restored image at the selection (old clipboard: %s)",
  async (oldClipboard) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const submit = vi.fn();
    let written: ClipboardItem[] = [];
    vi.spyOn(navigator.clipboard, "write").mockImplementation(async (items) => {
      written = items;
    });
    try {
      const original = "[Image 1 · 3 B] See image";
      await copyMessage(original, [
        {
          id: "a",
          name: "shot.png",
          mimeType: "image/png",
          kind: "image",
          size: 3,
          path: "/saved/shot.png",
        },
      ]);
      const richHtml = await (await written[0].getType("text/html")).text();
      const html = oldClipboard
        ? richHtml.replace(/ data-bycoda-reference-text="[^"]*"/, "")
        : richHtml;
      const plainText = oldClipboard
        ? original
        : await (await written[0].getType("text/plain")).text();
      await act(async () =>
        root.render(
          createElement(Composer, {
            focused: false,
            harness: "codex",
            model: "",
            runtimeMode: "supervised",
            executionCwd: "~",
            initialDraft: "Before replace after",
            hideTopBar: true,
            onFocus: vi.fn(),
            onCwdChange: vi.fn(),
            onModelChange: vi.fn(),
            onRuntimeModeChange: vi.fn(),
            onSubmit: submit,
          }),
        ),
      );
      const textarea = container.querySelector("textarea")!;
      textarea.setSelectionRange(7, 14);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text/html" ? html : plainText),
          files: oldClipboard ? [new File(["abc"], "image.png", { type: "image/png" })] : [],
          items: [],
        },
      });
      await act(async () => {
        textarea.dispatchEvent(event);
      });
      // Restoring the attachment is asynchronous and slower on shared runners.
      const pastedDraft = oldClipboard
        ? "Before See image after [Image 1 · shot.png · 3 B]"
        : "Before [Image 1 · shot.png · 3 B] See image after";
      await act(async () => vi.waitFor(() => expect(textarea.value).toBe(pastedDraft)));
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click(),
      );
      expect(submit.mock.calls[0][0]).toBe(pastedDraft.replace(" · shot.png", ""));
      expect(submit.mock.calls[0][1]).toHaveLength(1);
      expect(submit.mock.calls[0][1][0]).toMatchObject({
        name: "shot.png",
        data: "YWJj",
      });
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);

it("leaves a pasted GitHub pull request URL as editable text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submit = vi.fn();
  const onDraftChange = vi.fn();
  const url = "https://github.com/bahadryalcn/bycoda/pull/318";
  const props = {
    focused: false,
    harness: "codex" as const,
    model: "",
    runtimeMode: "supervised" as const,
    executionCwd: "/repo",
    initialDraft: "What is this  explain in simple terms",
    hideTopBar: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: submit,
    onDraftChange,
  };
  try {
    await act(async () => root.render(createElement(Composer, props)));
    const textarea = container.querySelector("textarea")!;
    const insertionPoint = "What is this ".length;
    textarea.setSelectionRange(insertionPoint, insertionPoint);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? url : ""),
        files: [],
        items: [],
      },
    });

    await act(async () => textarea.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(container.querySelector("[data-composer-link-chip]")).toBeNull();

    await act(async () => {
      textarea.setRangeText(url, insertionPoint, insertionPoint, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const expected = `What is this ${url} explain in simple terms`;
    expect(textarea.value).toBe(expected);
    expect(onDraftChange).toHaveBeenLastCalledWith(expected);

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click(),
    );
    expect(submit).toHaveBeenCalledWith(expected, [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
