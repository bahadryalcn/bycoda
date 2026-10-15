// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../app/shell/TitleBar", () => ({
  IconButton: ({ label, children, ...props }: { label: string; children: unknown }) =>
    createElement("button", { ...props, "aria-label": label }, children as string),
}));
vi.mock("../../../shared/hooks/useDragResize", () => ({
  useDragResize: () => ({ setPaneRef: () => {}, onPointerDown: () => {}, onDoubleClick: () => {} }),
}));
import type { InboxItem } from "../model/githubTasks";
import { InboxDiscussionPanel } from "./InboxDiscussionPanel";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("ignores a restarted conversation that resolves after the selected issue changed", async () => {
  let finishRestart!: (id: string) => void;
  const onOpen = vi.fn(async (item: InboxItem) => `session-${item.number}`);
  const onRestart = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finishRestart = resolve;
      }),
  );
  const onMount = vi.fn();
  const render = async (number: number) => {
    await act(async () =>
      root.render(
        createElement(InboxDiscussionPanel, {
          item: {
            provider: "github",
            kind: "issue",
            repo: "org/repo",
            projectPath: "/repo",
            number,
          } as InboxItem,
          onOpen,
          onRestart,
          onMount,
          onClose: () => {},
        }),
      ),
    );
  };
  await render(1);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Restart conversation"]')!.click(),
  );
  await render(2);
  await act(async () => finishRestart("stale-restarted-session"));
  expect(onMount.mock.calls.map(([value]) => value?.sessionId).filter(Boolean)).toEqual([
    "session-1",
    "session-2",
  ]);
  expect(container.querySelector('[role="status"]')).toBeNull();
});
