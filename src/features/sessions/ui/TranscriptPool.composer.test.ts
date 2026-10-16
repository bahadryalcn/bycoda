// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));
import { Composer } from "./Composer";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
function TranscriptProbe({ visible: _visible, id }: { visible?: boolean; id: string }) {
  return createElement("div", { "data-transcript-probe": id }, "history");
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps real composer text, attachment, edit mode and queued content while its transcript expires", async () => {
  const pool = new TranscriptPool(12, undefined, 100, 1);
  let recall!: () => void;
  const onSubmit = vi.fn();
  const editing = vi.fn();
  const queuedMessages: NonNullable<ComponentProps<typeof Composer>["queuedMessages"]> = [
    { id: "queued", text: "unsent queued task", attachments: [], intent: "default" },
  ];
  const props: ComponentProps<typeof Composer> = {
    focused: false,
    harness: "codex",
    model: "m",
    runtimeMode: "supervised",
    executionCwd: "/repo",
    sessionId: "draft",
    hideProjectPicker: true,
    hideBranchPicker: true,
    editLastTurnSupported: true,
    lastTurnRecall: {
      text: "unfinished edit",
      attachments: [
        {
          id: "image",
          name: "review.png",
          kind: "image",
          mimeType: "image/png",
          size: 5,
          data: "aW1hZ2U=",
        },
      ],
    },
    onRecallLastTurnReady: (fn) => {
      recall = fn;
    },
    onEditingLastTurnChange: editing,
    queuedMessages,
    onEditQueuedMessage: vi.fn(),
    queueStatus: "paused",
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit,
  };
  const render = (visible: boolean) =>
    act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(
            "section",
            { style: { display: visible ? "block" : "none" } },
            createElement(
              PooledTranscript,
              { pool, sessionId: "draft" },
              createElement(TranscriptProbe, { visible, id: "draft" }),
            ),
            createElement(Composer, props),
          ),
          createElement(
            PooledTranscript,
            { pool, sessionId: "other" },
            createElement(TranscriptProbe, { visible: !visible, id: "other" }),
          ),
          createElement(TranscriptPoolOutlet, { pool }),
        ),
      ),
    );
  await render(true);
  await act(async () => recall());
  const textarea = host.querySelector("textarea")!;
  expect(textarea.value).toBe("unfinished edit");
  expect(editing).toHaveBeenLastCalledWith(true);
  await act(async () => {
    textarea.value = "unfinished edit plus unsent changes";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const attachment = host.querySelector('[aria-label="Remove review.png"]');
  expect(attachment).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click(),
  );
  const queueEditor = document.querySelector<HTMLTextAreaElement>(
    '[aria-label="Queued message text"]',
  )!;
  expect(queueEditor).not.toBeNull();
  await act(async () => {
    queueEditor.value = "unsaved queue edit";
    queueEditor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.useFakeTimers();
  await render(false);
  act(() => vi.advanceTimersByTime(101));
  expect(pool.getSnapshot().find((entry) => entry.id === "draft")?.mounted).toBe(false);
  expect(host.querySelector('[data-transcript-probe="draft"]')).toBeNull();
  await render(true);
  expect(host.querySelector("textarea")).toBe(textarea);
  expect(textarea.value).toBe("unfinished edit plus unsent changes");
  expect(host.querySelector('[aria-label="Remove review.png"]')).toBe(attachment);
  expect(editing).toHaveBeenLastCalledWith(true);
  expect(document.querySelector('[aria-label="Queued message text"]')).toBe(queueEditor);
  expect(queueEditor.value).toBe("unsaved queue edit");
  expect(host.textContent).toContain("unsent queued task");
  expect(queuedMessages[0].text).toBe("unsent queued task");
  expect(onSubmit).not.toHaveBeenCalled();
});
