// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));
vi.mock("../model/chatCitationHighlight", () => ({ highlightChatCitation: vi.fn(() => true) }));
import { Composer } from "./Composer";
import {
  extractChatCitations,
  serializeChatCitation,
  withChatCitations,
  type ChatCitation,
} from "../model/chatCitation";
const citation: ChatCitation = {
  version: 1,
  id: "c1",
  sessionId: "s1",
  blockId: "b1",
  text: "Exact selected words",
  sourceText: "Full reply. Exact selected words",
  occurrence: 0,
  comment: "Make this shorter",
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
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
async function render(props: Partial<ComponentProps<typeof Composer>> = {}) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "claude",
        model: "m",
        runtimeMode: "supervised",
        executionCwd: "/repo",
        sessionId: "s1",
        hideProjectPicker: true,
        hideBranchPicker: true,
        onFocus: () => {},
        onCwdChange: () => {},
        onModelChange: () => {},
        onRuntimeModeChange: () => {},
        onSubmit: () => true,
        ...props,
      }),
    ),
  );
  return container.querySelector("textarea")!;
}
async function enter(input: HTMLTextAreaElement) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
}

describe("composer citations", () => {
  it("keeps references out of editable text and persists them alongside the existing draft", async () => {
    const onDraftChange = vi.fn();
    const input = await render({
      initialDraft: "My existing draft",
      quoteRequest: { id: 1, text: serializeChatCitation(citation) },
      onDraftChange,
    });
    expect(input.value).toBe("My existing draft");
    expect(container.textContent).toContain(citation.comment);
    expect(extractChatCitations(onDraftChange.mock.calls.at(-1)![0])).toEqual({
      text: "My existing draft",
      citations: [citation],
    });
  });

  it("restores durable references on remount and removes them without changing message text", async () => {
    const onDraftChange = vi.fn();
    const input = await render({
      initialDraft: withChatCitations("Keep this", [citation]),
      onDraftChange,
    });
    expect(input.value).toBe("Keep this");
    await act(async () =>
      (container.querySelector('[aria-label="Remove citation"]') as HTMLButtonElement).click(),
    );
    expect(input.value).toBe("Keep this");
    expect(onDraftChange.mock.calls.at(-1)![0]).toBe("Keep this");
  });

  it("sends a citation-only message and keeps its metadata for the provider path", async () => {
    const onSubmit = vi.fn((_text: string) => true);
    const input = await render({ initialDraft: withChatCitations("", [citation]), onSubmit });
    await enter(input);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(extractChatCitations(onSubmit.mock.calls[0][0])).toEqual({
      text: "",
      citations: [citation],
    });
    expect(container.querySelector('[aria-label="Remove citation"]')).toBeNull();
  });

  it("preserves the citation and text when a send is rejected", async () => {
    const onSubmit = vi.fn((_text: string) => false);
    const input = await render({
      initialDraft: withChatCitations("Keep text too", [citation]),
      onSubmit,
    });
    await enter(input);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(input.value).toBe("Keep text too");
    expect(container.textContent).toContain(citation.comment);
  });

  it("never overwrites a newer citation-only draft after late send rejection", async () => {
    let reject: (() => boolean) | undefined;
    const onSubmit: ComponentProps<typeof Composer>["onSubmit"] = (_text, _files, options) => {
      reject = options?.onSendRejected;
      return true;
    };
    const input = await render({
      initialDraft: withChatCitations("Original request", [citation]),
      onSubmit,
    });
    await enter(input);
    const newer = { ...citation, id: "newer", comment: "Keep the newer reference" };
    await render({ quoteRequest: { id: 2, text: serializeChatCitation(newer) }, onSubmit });
    await act(async () => expect(reject?.()).toBe(false));
    expect(input.value).toBe("");
    expect(container.textContent).toContain(newer.comment);
    expect(container.textContent).not.toContain(citation.comment);
  });

  it("includes a citation-only message in the explicit queue shortcut", async () => {
    const onSubmit = vi.fn((_text: string) => true);
    const input = await render({
      initialDraft: withChatCitations("", [citation]),
      busy: true,
      onSubmit,
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(extractChatCitations(onSubmit.mock.calls[0][0]).citations).toEqual([citation]);
  });

  it("keeps attached quotes when a command cannot carry conversation context", async () => {
    const onSubmit = vi.fn((_text: string) => true);
    const input = await render({ initialDraft: withChatCitations("/clear", [citation]), onSubmit });
    await enter(input);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("/clear");
    expect(container.textContent).toContain(citation.comment);
    expect(container.textContent).toContain("Remove quoted replies before running this command.");
  });
});
