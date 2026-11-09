// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GithubPrActions } from "./InboxPrActions";
import { githubPrAction, type InboxItem } from "../model/githubTasks";

vi.mock("../model/githubTasks", () => ({ githubPrAction: vi.fn() }));

const item: InboxItem = {
  kind: "pr",
  provider: "github",
  projectPath: "/fixture",
  repo: "fixture/repo",
  number: 12,
  title: "Review changes",
  url: "https://example.test/12",
  state: "open",
  updatedAt: "2026-10-25T00:00:00Z",
  labels: [],
  assignees: [],
  draft: false,
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(githubPrAction).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text,
  )!;

it("keeps reviewed-head confirmation and local progress without duplicate mutations", async () => {
  const head = "a".repeat(40);
  let finish!: (value: Awaited<ReturnType<typeof githubPrAction>>) => void;
  vi.mocked(githubPrAction).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(GithubPrActions, {
        item,
        baseRef: "main",
        headRef: "feature",
        reviewedHeadOid: head,
        onChange,
      }),
    ),
  );
  await act(async () => button(container, "Merge pull request").click());
  expect(githubPrAction).not.toHaveBeenCalled();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(head);
  const confirm = button(dialog, "Merge pull request");
  confirm.focus();
  await act(async () => confirm.click());
  expect(confirm.getAttribute("aria-busy")).toBe("true");
  expect(confirm.textContent).toBe("Merge pull request");
  expect(document.activeElement).toBe(confirm);
  await act(async () => confirm.click());
  expect(githubPrAction).toHaveBeenCalledExactlyOnceWith(
    "/fixture",
    "fixture/repo",
    12,
    "merge",
    head,
  );
  await act(async () => finish({ ...item, state: "merged" }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: "merged" }));
});

it("requires a reviewed head and permits cancelling without running an action", async () => {
  const render = (reviewedHeadOid?: string) =>
    act(async () =>
      root.render(
        createElement(GithubPrActions, {
          item,
          baseRef: "main",
          headRef: "feature",
          reviewedHeadOid,
        }),
      ),
    );
  await render();
  await act(async () => button(container, "Merge pull request").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Refresh and review");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("b".repeat(40));
  await act(async () => button(container, "Merge pull request").click());
  await act(async () => button(document.querySelector('[role="dialog"]')!, "Cancel").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(githubPrAction).not.toHaveBeenCalled();
});
