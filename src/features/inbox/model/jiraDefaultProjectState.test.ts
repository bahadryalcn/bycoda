// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  JIRA_DEFAULT_PROJECTS_KEY,
  readJiraDefaultProjects,
  saveJiraDefaultProject,
  subscribeJiraDefaultProjects,
} from "./jiraDefaultProjectState";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("persists all default scopes and explicit issue choices independently", () => {
  saveJiraDefaultProject("global", "", "/global");
  saveJiraDefaultProject("projects", "100", "/project");
  saveJiraDefaultProject("boards", "7", "/board");
  saveJiraDefaultProject("issues", "https://jira/browse/ENG-1", "/issue");
  expect(readJiraDefaultProjects()).toEqual({
    global: "/global",
    projects: { "100": "/project" },
    boards: { "7": "/board" },
    issues: { "https://jira/browse/ENG-1": "/issue" },
  });
});

it("patches fresh state, preserves unknown scopes, and clears a default to inheritance", () => {
  saveJiraDefaultProject("projects", "unknown", "/keep");
  saveJiraDefaultProject("boards", "8", "/sibling");
  saveJiraDefaultProject("projects", "100", "/project");
  saveJiraDefaultProject("projects", "100", "");
  expect(readJiraDefaultProjects()).toMatchObject({
    projects: { unknown: "/keep", "100": "" },
    boards: { "8": "/sibling" },
  });
});

it("does not overwrite corrupt settings or conceal failed writes", () => {
  localStorage.setItem(JIRA_DEFAULT_PROJECTS_KEY, "{broken");
  expect(() => saveJiraDefaultProject("global", "", "/new")).toThrow();
  expect(localStorage.getItem(JIRA_DEFAULT_PROJECTS_KEY)).toBe("{broken");
  localStorage.removeItem(JIRA_DEFAULT_PROJECTS_KEY);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {});
  expect(() => saveJiraDefaultProject("global", "", "/new")).toThrow(
    "Jira working folder was not saved.",
  );
});

it.each(["[]", "null", '{"projects":[]}', '{"boards":{"7":42}}', '{"global":42}'])(
  "rejects invalid saved state %s",
  (raw) => {
    localStorage.setItem(JIRA_DEFAULT_PROJECTS_KEY, raw);
    expect(readJiraDefaultProjects).toThrow();
  },
);

it("notifies local and sibling consumers, then unsubscribes", () => {
  const listener = vi.fn();
  const stop = subscribeJiraDefaultProjects(listener);
  saveJiraDefaultProject("global", "", "/global");
  window.dispatchEvent(new StorageEvent("storage", { key: JIRA_DEFAULT_PROJECTS_KEY }));
  window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  saveJiraDefaultProject("global", "", "/new");
  expect(listener).toHaveBeenCalledTimes(2);
});
