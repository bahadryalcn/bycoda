// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InboxDiscussionPanel } from "./InboxDiscussionPanel";
import type { InboxItem } from "../model/githubTasks";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});
it("resizes the Ask panel with keyboard bounds and default reset", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1440);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(InboxDiscussionPanel, {
        item: { provider: "github", kind: "issue", repo: "org/repo", number: 1 } as InboxItem,
        onOpen: async () => "session",
        onRestart: async () => "session",
        onMount: () => {},
        onClose: () => {},
      }),
    ),
  );
  const separator = container.querySelector<HTMLElement>('[role="separator"]')!;
  const pane = container.querySelector("aside")!;
  expect(separator.tabIndex).toBe(0);
  separator.focus();
  expect(document.activeElement).toBe(separator);
  const press = async (key: string, expected: number) => {
    await act(async () =>
      separator.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ),
    );
    expect(pane.style.width).toBe(`${expected}px`);
    expect(separator.getAttribute("aria-valuenow")).toBe(String(expected));
  };
  expect(separator.getAttribute("aria-valuemin")).toBe("360");
  expect(separator.getAttribute("aria-valuemax")).toBe("790");
  await press("Home", 360);
  await press("End", 790);
  await press("Enter", 440);
  await press("ArrowLeft", 450);
  await press("ArrowRight", 440);
});
