import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearGithubRepositories, githubRepositories } from "./githubRepositories";
import {
  githubRepositoryOptions,
  hiddenAfterRepositorySelection,
  repositorySelectionHidden,
} from "./inboxRepositoryFilters";
import {
  filterInboxByProject,
  pruneInboxFilters,
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
} from "./inboxFilters";
import type { InboxItem } from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(async () => {
  clearGithubRepositories();
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const cwd = (args as { cwd: string }).cwd;
    return (
      cwd === "G:/fork"
        ? ["maya/dto", "acme/dto"]
        : cwd === "G:/other/dto"
          ? ["other/dto"]
          : ["acme/dto"]
    ) as never;
  });
  for (const path of ["G:/one/dto", "G:/two/dto", "G:/other/dto", "G:/fork"])
    await githubRepositories(path);
});
const projects = ["G:/one/dto", "g:/ONE/dto/", "G:/two/dto", "G:/other/dto", "G:/fork"].map(
  (path) => ({ path }),
);
function item(repo: string, projectPath: string, provider = "github"): InboxItem {
  return { repo, projectPath, provider } as InboxItem;
}

it("groups checkout copies but keeps owners and fork/upstream separate even without items", () => {
  const options = githubRepositoryOptions(projects);
  expect(options.map(({ path, name }) => ({ path, name }))).toEqual([
    { path: "github:acme/dto", name: "acme/dto" },
    { path: "github:maya/dto", name: "maya/dto" },
    { path: "github:other/dto", name: "other/dto" },
  ]);
  expect(githubRepositoryOptions([{ path: "G:/unknown" }, { path: "remote://mac/repo" }])).toEqual(
    [],
  );
});

it("applies repository filters regardless of chosen checkout and leaves other providers alone", () => {
  const items = [
    item("ACME/dto", "G:/two/dto"),
    item("other/dto", "G:/other/dto"),
    item("acme/dto", "G:/two/dto", "gitlab"),
  ];
  expect(filterInboxByProject(items, ["github:acme/dto"])).toEqual(items.slice(1));
  expect(filterInboxByProject(items, ["g:/ONE/dto/"])).toEqual(items.slice(1));
});

it("retains saved repository keys during incomplete discovery", () => {
  const filters = { ...DEFAULT_INBOX_FILTERS, hiddenProjects: ["github:acme/dto", "g:/ONE/dto/"] };
  expect(pruneInboxFilters(filters, ["G:/one/dto"])).toBe(filters);
});

it("does not mark other code hosts as narrowed by GitHub-only repository keys", () => {
  const filters = { ...DEFAULT_INBOX_FILTERS, hiddenProjects: ["github:acme/dto"] };
  expect(hasActiveInboxFilters(filters, "github")).toBe(true);
  expect(hasActiveInboxFilters(filters, "gitlab")).toBe(false);
  expect(hasActiveInboxFilters(filters, "azuredevops")).toBe(false);
});

it("resolves old checkout selections and clears their aliases when shown again", () => {
  const options = githubRepositoryOptions(projects);
  const previous = ["g:/ONE/dto/", "github:not-loaded/repo"];
  expect(repositorySelectionHidden(options[0]!, previous)).toBe(true);
  expect(
    hiddenAfterRepositorySelection(
      options,
      options.map((option) => option.path),
      previous,
    ),
  ).toEqual(["github:not-loaded/repo"]);
  expect(hiddenAfterRepositorySelection(options, ["github:other/dto"], previous)).toEqual([
    "github:not-loaded/repo",
    "github:acme/dto",
    "github:maya/dto",
  ]);
});
