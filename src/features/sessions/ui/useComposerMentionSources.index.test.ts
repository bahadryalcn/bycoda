// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectFile } from "../../../platform/tauri/fs";

const truncated = vi.hoisted(() => vi.fn<(files: ProjectFile[]) => boolean | undefined>());
const listFiles = vi.hoisted(() => vi.fn<(cwd: string) => Promise<ProjectFile[]>>());
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: async () => [],
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  projectFilesTruncated: truncated,
  listProjectFiles: listFiles,
}));

import {
  projectIndexNotice,
  useComposerMentionSources,
  useComposerProjectFiles,
} from "./useComposerMentionSources";
import { Composer } from "./Composer";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";

const files: ProjectFile[] = [{ name: "a.ts", path: "/repo/a.ts", relative: "a.ts" }];

beforeEach(() => {
  truncated.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

it("reuses the local listing across three mention menu opens", async () => {
  listFiles.mockReset().mockResolvedValue(files);
  const root = createRoot(document.createElement("div"));
  function Probe({ open }: { open: boolean }) {
    useComposerProjectFiles({ cwd: "/mention-reopens", remote: false, mentionOpen: open });
    return null;
  }
  try {
    for (const open of [false, true, false, true, false, true]) {
      await act(async () => root.render(createElement(Probe, { open })));
    }
    expect(listFiles).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
  }
});

function largeListingWorker(cwd: string) {
  const listing = Array.from({ length: 1100 }, (_, i) => ({
    name: `item-${i}.ts`,
    relative: `src/item-${i}.ts`,
    path: `${cwd}/src/item-${i}.ts`,
  }));
  listFiles.mockReset().mockResolvedValue(listing);
  const post = vi.fn();
  const workers: WorkerStub[] = [];
  class WorkerStub {
    onmessage?: (event: { data: ProjectFile[] }) => void;
    constructor() {
      workers.push(this);
    }
    postMessage = post;
    terminate() {}
  }
  vi.stubGlobal("Worker", WorkerStub);
  const answer = (index: number) => {
    const row = { ...listing[index]!, score: 1, positions: [] };
    workers[workers.length - 1]!.onmessage?.({ data: [row] });
  };
  return { post, answer };
}

it("ranks a large listing off-thread and hides results from an earlier query", async () => {
  const cwd = "/mention-worker";
  const { post, answer } = largeListingWorker(cwd);
  const view = document.createElement("div");
  const root = createRoot(view);
  function Probe({ query }: { query: string }) {
    const { rankedFiles } = useComposerMentionSources({
      executionCwd: cwd,
      indexFiles: true,
      remote: false,
      notesEnabled: false,
      mentionOpen: true,
      mentionQuery: query,
    });
    return rankedFiles
      .filter((row) => row.path.startsWith(cwd))
      .map((row) => row.name)
      .join(",");
  }
  try {
    await act(async () => root.render(createElement(Probe, { query: "item-1" })));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0].files).toContainEqual(
      expect.objectContaining({ relative: "src", isDir: true }),
    );
    act(() => answer(1));
    expect(view.textContent).toBe("item-1.ts");
    await act(async () => root.render(createElement(Probe, { query: "item-2" })));
    expect(view.textContent).toBe("");
    expect(post.mock.lastCall?.[0].files).toBeUndefined();
    act(() => answer(2));
    expect(view.textContent).toBe("item-2.ts");
  } finally {
    act(() => root.unmount());
  }
});

it("reports a capped index so a missing late file is not read as 'no such file'", () => {
  truncated.mockReturnValue(true);
  expect(projectIndexNotice(files)).toBe("incomplete");
});

it.each(["composer", "queue"] as const)(
  "completes pending Enter in the %s once and drops the pick after the draft changes",
  async (surface) => {
    const cwd = "/keyboard-" + surface;
    const { post, answer } = largeListingWorker(cwd);
    const submit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      const editor =
        surface === "composer"
          ? createElement(Composer, {
              focused: false,
              harness: "codex",
              model: "",
              runtimeMode: "supervised",
              cwd,
              executionCwd: cwd,
              hideTopBar: true,
              onFocus: vi.fn(),
              onCwdChange: vi.fn(),
              onModelChange: vi.fn(),
              onRuntimeModeChange: vi.fn(),
              onSubmit: submit,
            })
          : createElement(QueuedMessageEditDialog, {
              message: { id: "keyboard", text: "", attachments: [] },
              canAttach: true,
              suggestions: {
                executionCwd: cwd,
                harness: "codex",
                remote: false,
                remotePlan: false,
                notesEnabled: false,
              },
              onSave: submit,
              onRemove: vi.fn(),
              onCancel: vi.fn(),
            });
      await act(async () => root.render(editor));
      const field = document.querySelector("textarea")!;
      const type = (value: string) =>
        act(async () => {
          field.focus();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
            field,
            value,
          );
          field.setSelectionRange(field.value.length, field.value.length);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      await type("@item-42");
      expect(post).toHaveBeenCalled();
      const enter = () =>
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      const waiting = enter();
      await act(async () => {
        field.dispatchEvent(waiting);
      });
      expect(waiting.defaultPrevented).toBe(true);
      expect(field.value).toBe("@item-42");
      act(() => answer(42));
      expect(field.value).toBe("@item-42.ts ");
      await type("@item-40");
      await act(async () => {
        field.dispatchEvent(enter());
      });
      await type("my revised draft");
      act(() => answer(40));
      expect(field.value).toBe("my revised draft");
      expect(submit).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  },
);

it("keeps a complete index and a not-yet-loaded index quiet", () => {
  truncated.mockReturnValue(false);
  expect(projectIndexNotice(files)).toBeUndefined();
  truncated.mockReturnValue(true);
  expect(projectIndexNotice([])).toBeUndefined();
});

it("marks a Host that does not report completeness as unknown", () => {
  truncated.mockReturnValue(undefined);
  expect(projectIndexNotice(files)).toBe("unknown");
});

it("forces one fresh remote file-index read for an explicit retry", async () => {
  const cwd = "remote://office/fixture";
  listFiles.mockReset().mockResolvedValue(files);
  listFiles.mockRejectedValueOnce(new Error("Index unavailable"));
  const root = createRoot(document.createElement("div"));
  let retry: (() => void) | undefined;
  function Fixture({ mentionOpen }: { mentionOpen: boolean }) {
    const state = useComposerProjectFiles({ cwd, remote: true, mentionOpen });
    return createElement("button", {
      onClick: () => state.retry(),
      ref: (button: HTMLButtonElement | null) => {
        retry = button ? () => button.click() : undefined;
      },
    });
  }
  try {
    await act(async () => root.render(createElement(Fixture, { mentionOpen: true })));
    await act(async () => retry?.());
    await act(async () => root.render(createElement(Fixture, { mentionOpen: false })));
    // The failed first read, one forced retry, and no further read once the index is fresh.
    expect(listFiles.mock.calls).toEqual([[cwd], [cwd]]);
  } finally {
    await act(async () => root.unmount());
  }
});
