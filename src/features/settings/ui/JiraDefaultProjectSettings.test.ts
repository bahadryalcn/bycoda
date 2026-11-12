// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JiraDefaultProjectSettings } from "./JiraDefaultProjectSettings";
import {
  JIRA_DEFAULT_PROJECTS_KEY,
  readJiraDefaultProjects,
  saveJiraDefaultProject,
} from "../../inbox/public/jiraDefaultProjects";

vi.mock("../../projects/public/recents", () => ({
  useRecents: () => [{ path: "/work/app", openedAt: 1 }],
}));
vi.mock("../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (path: string) => void;
  }) =>
    createElement(
      "button",
      {
        "data-picker": "true",
        "aria-label": label,
        disabled,
        onClick: () => onChange("/work/app"),
      },
      value || "inherit",
    ),
}));
let root: Root;
let container: HTMLDivElement;
const props = {
  projects: [{ id: "100", key: "ENG", name: "Engineering" }],
  boards: [{ id: 7, name: "Work", kind: "kanban" as const }],
  disabled: false,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("persists global, project and board settings and renders them after reopening", async () => {
  await act(async () => root.render(createElement(JiraDefaultProjectSettings, props)));
  const pickers = [...container.querySelectorAll<HTMLButtonElement>("button[data-picker]")];
  expect(pickers).toHaveLength(3);
  for (const picker of pickers) await act(async () => picker.click());
  expect(readJiraDefaultProjects()).toMatchObject({
    global: "/work/app",
    projects: { "100": "/work/app" },
    boards: { "7": "/work/app" },
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(JiraDefaultProjectSettings, props)));
  expect(
    [...container.querySelectorAll("button[data-picker]")].map((picker) => picker.textContent),
  ).toEqual(["/work/app", "/work/app", "/work/app"]);
  await act(async () => saveJiraDefaultProject("global", "", "/sibling"));
  expect(container.querySelector("button[data-picker]")?.textContent).toBe("/sibling");
});

it("blocks edits when settings are unreadable and recovers after sibling repair", async () => {
  localStorage.setItem(JIRA_DEFAULT_PROJECTS_KEY, "{broken");
  await act(async () => root.render(createElement(JiraDefaultProjectSettings, props)));
  expect(container.textContent).toContain("Saved Jira working folders are unavailable.");
  expect(container.querySelectorAll("button[data-picker]")).toHaveLength(0);
  await act(async () => {
    localStorage.removeItem(JIRA_DEFAULT_PROJECTS_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: JIRA_DEFAULT_PROJECTS_KEY }));
  });
  expect(container.querySelectorAll("button[data-picker]")).toHaveLength(3);
});
