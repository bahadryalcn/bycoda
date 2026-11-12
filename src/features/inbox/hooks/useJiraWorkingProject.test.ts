// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxItem } from "../model/githubTasks";
import { saveJiraDefaultProject } from "../model/jiraDefaultProjectState";
import { useJiraWorkingProject } from "./useJiraWorkingProject";

let root: Root;
let container: HTMLDivElement;
let choice: readonly [string, (path: string) => void];
const error = vi.fn();
const item = {
  provider: "jira",
  url: "https://jira/browse/ENG-1",
  teamId: "100",
  jiraBoardId: 7,
} as InboxItem;
function Probe({ issue = item }: { issue?: InboxItem }) {
  choice = useJiraWorkingProject(issue, "/current", error);
  return createElement("span", null, choice[0]);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  error.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates inherited defaults, persists selection through remount, and protects it from later defaults", async () => {
  saveJiraDefaultProject("boards", "7", "/board");
  await act(async () => root.render(createElement(Probe)));
  expect(container.textContent).toBe("/board");
  await act(async () => saveJiraDefaultProject("boards", "7", "/updated"));
  expect(container.textContent).toBe("/updated");
  await act(async () => choice[1]("/explicit"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe)));
  expect(container.textContent).toBe("/explicit");
  await act(async () => saveJiraDefaultProject("boards", "7", "/later"));
  expect(container.textContent).toBe("/explicit");
});

it("preserves previous choice and reports failed persistence", async () => {
  saveJiraDefaultProject("global", "", "/global");
  await act(async () => root.render(createElement(Probe)));
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("quota");
  });
  await act(async () => choice[1]("/failed"));
  expect(container.textContent).toBe("/global");
  expect(error).toHaveBeenLastCalledWith("quota");
});

it("keeps non-Jira selection local", async () => {
  await act(async () =>
    root.render(createElement(Probe, { issue: { ...item, provider: "linear" } })),
  );
  await act(async () => choice[1]("/linear"));
  expect(container.textContent).toBe("/linear");
  expect(localStorage.length).toBe(0);
});
