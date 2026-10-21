// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InboxDetail } from "./InboxDetail";
import type { InboxItem } from "../model/githubTasks";

vi.mock("./useInboxDetailData", () => ({
  useInboxDetailData: () => ({
    isPr: true,
    loading: true,
    diffLoading: true,
    threadLoading: true,
    details: null,
    prDiff: null,
    thread: null,
    setThread: vi.fn(),
  }),
}));
vi.mock("../hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => ({
    checks: { headOid: "head", checks: [] },
    loading: false,
    refreshing: false,
    error: null,
    stale: false,
    provider: "github",
    refresh: () => {},
  }),
}));
vi.mock("./InboxPrChecks", async (original) => ({
  ...(await original<object>()),
  InboxPrChecks: () => createElement("div", null, "Checks content"),
}));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});
it("navigates Summary, Code and Checks with roving focus and a labelled tabpanel", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(InboxDetail, {
        item: {
          provider: "github",
          kind: "pr",
          repo: "org/repo",
          number: 1,
          title: "PR",
          url: "https://github.com/org/repo/pull/1",
          state: "open",
          updatedAt: "2026-10-21T00:00:00Z",
          projectPath: "/repo",
          labels: [],
          assignees: [],
          draft: false,
        } as InboxItem,
        cwd: "/repo",
        projects: [],
        revision: 0,
        relatedSessions: [],
      }),
    ),
  );
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs).toHaveLength(3);
  tabs[0].focus();
  const press = async (key: string, index: number) => {
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ),
    );
    const current = tabs[index];
    expect(document.activeElement).toBe(current);
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([current]);
    const panel = document.getElementById(current.getAttribute("aria-controls")!)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(current.id);
  };
  await press("ArrowRight", 1);
  await press("ArrowRight", 2);
  await press("ArrowRight", 0);
  await press("ArrowLeft", 2);
  await press("Home", 0);
  await press("End", 2);
});
