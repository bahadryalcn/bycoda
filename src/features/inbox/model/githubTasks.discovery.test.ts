import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearInboxCache, listInboxItems, uniqueInboxProjects } from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const query = { assignedToMe: false, state: "open" as const, search: "" };

beforeEach(() => {
  clearInboxCache();
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "git_github_repositories") {
        const cwd = (args as { cwd: string }).cwd;
        if (cwd === "G:/plain")
          throw new Error("fatal: not a git repository (or any of the parent directories): .git");
        if (cwd === "G:/no-remote") throw new Error("no git remotes found");
        if (cwd === "G:/gone") throw new Error("The directory name is invalid. (os error 267)");
        if (cwd === "G:/denied") throw new Error("Access is denied. (os error 5)");
        if (cwd === "G:/offline") throw new Error("error connecting to api.github.com");
        return ["acme/web"] as never;
      }
      if (command === "git_github_work_items") return [] as never;
      return { connected: false } as never;
    });
});

it("does not send remote machine paths to local GitHub discovery", async () => {
  await listInboxItems([{ path: "remote://mac/Users/dev/web" }, { path: "G:/web" }], query);
  const paths = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "git_github_repositories")
    .map(([, args]) => (args as { cwd: string }).cwd);
  expect(paths).toEqual(["G:/web"]);
});

it("ignores ineligible remembered folders while keeping operational failures visible", async () => {
  const result = await listInboxItems(
    ["G:/plain", "G:/no-remote", "G:/gone", "G:/denied", "G:/offline", "G:/web"].map((path) => ({
      path,
    })),
    query,
  );
  expect(result.errors.github).toBe(
    "G:/denied: Access is denied. (os error 5)\nG:/offline: error connecting to api.github.com",
  );
});

it("deduplicates Windows checkout variants without folding POSIX case", () => {
  expect(
    uniqueInboxProjects([
      { path: "G:/Work/Web" },
      { path: "g:\\work\\web\\" },
      { path: "/work/Web" },
      { path: "/work/web" },
    ]),
  ).toEqual([{ path: "G:/Work/Web" }, { path: "/work/Web" }, { path: "/work/web" }]);
});

it("keeps missing executables, authentication and invalid provider responses visible", async () => {
  for (const error of [
    "The system cannot find the file specified. (os error 2)",
    "gh auth login required",
    "GitHub did not return a repository",
    "spawn gh ENOENT",
  ]) {
    clearInboxCache();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_github_repositories") throw new Error(error);
      return { connected: false } as never;
    });
    const result = await listInboxItems([{ path: "G:/web" }], query);
    expect(result.errors.github).toBe(`G:/web: ${error}`);
  }
});

it("rediscovers a folder after a remote is added instead of caching an empty candidate", async () => {
  await listInboxItems([{ path: "G:/no-remote" }], query);
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repositories") return ["acme/new"] as never;
    if (command === "git_github_work_items") return [] as never;
    return { connected: false } as never;
  });
  const result = await listInboxItems([{ path: "G:/no-remote" }], query, { force: true });
  expect(result.errors).toEqual({});
  expect(invoke).toHaveBeenCalledWith(
    "git_github_work_items",
    expect.objectContaining({ repo: "acme/new" }),
  );
});
