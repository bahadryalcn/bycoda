// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let mount: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

it("renders the settled turn's file list below its footer and opens the diff or file", async () => {
  const blocks: Block[] = [
    { id: "prompt", role: "user", text: "Edit these files", durationMs: 2_000 },
    {
      id: "edit",
      role: "tool",
      text: "Edit src/main.ts",
      tool: {
        kind: "edit",
        status: "completed",
        fileChanges: [{ path: "src/main.ts", counts: { additions: 3, deletions: 2 } }],
      },
    },
    { id: "reply", role: "assistant", text: "Done" },
  ];
  const onOpenDiff = vi.fn();
  const onOpenFile = vi.fn();
  const render = async (busy: boolean, diff?: (path: string) => void, data = blocks) =>
    act(async () =>
      root.render(
        createElement(AgentTranscript, {
          blocks: data,
          cwd: "/repo",
          busy,
          onOpenFile,
          onOpenDiff: diff,
        }),
      ),
    );
  const list = () => mount.querySelector('ul[aria-label="Changed files"]');
  await render(true, onOpenDiff);
  expect(list()).toBeNull();
  await render(false, onOpenDiff, [
    ...blocks,
    { id: "second", role: "user", text: "Explain" },
    { id: "answer", role: "assistant", text: "No changes" },
  ]);
  expect(mount.querySelectorAll('ul[aria-label="Changed files"]')).toHaveLength(1);
  expect(list()?.previousElementSibling?.hasAttribute("data-transcript-actions-row")).toBe(true);
  const button = () => list()?.querySelector("button");
  expect(button()?.textContent).toBe("src/main.ts+3−2");
  await act(async () => button()?.click());
  expect(onOpenDiff).toHaveBeenCalledExactlyOnceWith("/repo/src/main.ts");
  expect(onOpenFile).not.toHaveBeenCalled();
  await render(false);
  await act(async () => button()?.click());
  expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("/repo/src/main.ts");
});
