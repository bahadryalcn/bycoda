import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteMachineFor: vi.fn(),
  loadRemoteCapabilities: vi.fn(),
  remoteRequest: vi.fn(),
  machineProjects: vi.fn(),
  githubRepo: vi.fn(),
  githubWorkItem: vi.fn(),
  listGithubWorkItems: vi.fn(),
  listJiraProjects: vi.fn(),
  requireHiddenJiraProjectIds: vi.fn(),
  gitlabRepo: vi.fn(),
  azureDevOpsRepo: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => mocks);
vi.mock("../../automations/public/hostMachines", () => mocks);
vi.mock("./githubReadGate", () => ({ githubRead: mocks.invoke }));
vi.mock("./githubRepositories", () => mocks);
vi.mock("./githubTasks", () => mocks);
vi.mock("./jira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jira")>()),
  listJiraProjects: mocks.listJiraProjects,
  requireHiddenJiraProjectIds: mocks.requireHiddenJiraProjectIds,
}));
vi.mock("./gitlab", () => mocks);
vi.mock("./azureDevOps", () => mocks);
import { readWithDeadline, searchWorkItemMentions } from "./workItemMentionSearch";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue([]);
  mocks.githubRepo.mockResolvedValue("owner/repo");
  mocks.gitlabRepo.mockResolvedValue("group/repo");
  mocks.azureDevOpsRepo.mockResolvedValue("project/repo");
  mocks.listJiraProjects.mockResolvedValue([
    { id: "100", key: "PROJ" },
    { id: "200", key: "ENG" },
  ]);
  mocks.requireHiddenJiraProjectIds.mockReturnValue([]);
  mocks.listGithubWorkItems.mockResolvedValue([]);
  mocks.githubWorkItem.mockRejectedValue(new Error("missing"));
});
afterEach(() => vi.useRealTimers());

describe("provider mention search", () => {
  it("binds remote GitHub search to the owning environment and project", async () => {
    mocks.remoteMachineFor.mockResolvedValue({ id: "machine", environmentId: "env" });
    mocks.loadRemoteCapabilities.mockResolvedValue(["workItems.github.v1"]);
    mocks.machineProjects.mockResolvedValue([{ id: "project", cwd: "/home/me/app" }]);
    mocks.remoteRequest.mockResolvedValue({
      items: [{ kind: "pr", number: 123, repo: "owner/repo" }],
      errors: [{ reason: "rate-limited", message: "Rate limited" }],
    });
    const cwd = "remote://env/home/me/app";
    expect(await searchWorkItemMentions(cwd, ["github"], "#12")).toEqual([
      expect.objectContaining({ provider: "github", projectPath: cwd, number: 123 }),
    ]);
    expect(mocks.remoteMachineFor).toHaveBeenCalledWith("env");
    expect(mocks.remoteRequest).toHaveBeenCalledWith(
      "machine",
      "workItems.search",
      { projectId: "project", query: "#12" },
      false,
      false,
      "env",
    );
    expect(mocks.githubRepo).not.toHaveBeenCalled();
    mocks.loadRemoteCapabilities.mockResolvedValue([]);
    await expect(searchWorkItemMentions(cwd, ["github"], "login")).rejects.toMatchObject({
      failure: "remote-host-unavailable",
    });
    expect(mocks.remoteRequest).toHaveBeenCalledTimes(1);
  });
  it("sends all-assignee text search to each connected provider", async () => {
    await searchWorkItemMentions(
      "/repo",
      ["jira", "linear", "github", "gitlab", "azuredevops"],
      "login",
    );
    for (const command of [
      "jira_list_issues",
      "linear_list_issues",
      "gitlab_list_work_items",
      "azure_devops_list_work_items",
    ])
      expect(mocks.invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining({ assignedToMe: false }),
      );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "jira_list_issues",
      expect.objectContaining({
        filters: { search: "login", issuePicker: false, exactKey: false },
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "linear_list_issues",
      expect.objectContaining({ search: "login" }),
    );
    expect(mocks.listGithubWorkItems).toHaveBeenCalledWith(
      "/repo",
      "owner/repo",
      expect.objectContaining({ search: "login", assignedToMe: false, state: "open" }),
    );
  });

  it("combines Jira picker and exact reads without speculative key batches", async () => {
    await searchWorkItemMentions("/repo", ["jira"], "proj-9");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "jira_list_issues",
      expect.objectContaining({
        filters: { search: "PROJ-9", issuePicker: false, exactKey: true },
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "jira_list_issues",
      expect.objectContaining({
        filters: { search: "proj-9", issuePicker: true, exactKey: false },
      }),
    );
  });

  it("searches numeric Jira prefixes across projects and Linear exact numbers separately", async () => {
    await searchWorkItemMentions("/repo", ["jira", "linear"], "9");
    expect(mocks.listJiraProjects).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "jira_list_issues",
      expect.objectContaining({
        filters: { search: "9", issuePicker: true, exactKey: false },
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "linear_list_issues",
      expect.objectContaining({ search: "9", exact: true }),
    );
  });

  it("scopes every Jira source to visible projects and hides exact results", async () => {
    mocks.requireHiddenJiraProjectIds.mockReturnValue(["200"]);
    mocks.invoke.mockResolvedValue([{ id: "9", teamId: "200" }]);
    expect(await searchWorkItemMentions("/repo", ["jira"], "ENG-9")).toEqual([]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    for (const [, args] of mocks.invoke.mock.calls) expect(args.projectIds).toEqual(["100"]);
  });

  it("makes no Jira issue reads when all projects are hidden or scope is unreadable", async () => {
    mocks.requireHiddenJiraProjectIds.mockReturnValue(["100", "200"]);
    expect(await searchWorkItemMentions("/repo", ["jira"], "9")).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.requireHiddenJiraProjectIds.mockImplementation(() => {
      throw new Error("scope unavailable");
    });
    // An unreadable scope fails closed and says so instead of looking like "no match".
    await expect(searchWorkItemMentions("/repo", ["jira"], "login")).rejects.toMatchObject({
      failure: "provider-failed",
      provider: "jira",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each(["14", "owner/repo#14", "other/project#14"])(
    "never sends a remote project's path to the local GitHub CLI for %s",
    async (query) => {
      await expect(
        searchWorkItemMentions("remote://env/home/me/app", ["github"], query),
      ).rejects.toMatchObject({ failure: "remote-host-unavailable", provider: "github" });
      expect(mocks.githubRepo).not.toHaveBeenCalled();
      expect(mocks.listGithubWorkItems).not.toHaveBeenCalled();
      expect(mocks.githubWorkItem).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it("keeps account-wide providers working for a remote project", async () => {
    mocks.invoke.mockResolvedValue([{ id: "id", identifier: "ENG-9", number: 9, assignees: [] }]);
    expect(
      await searchWorkItemMentions("remote://env/home/me/app", ["linear", "github"], "login"),
    ).toMatchObject([{ provider: "linear", identifier: "ENG-9" }]);
  });

  it("tells no match, an unresolvable repository and a provider error apart", async () => {
    // No match: the provider answered with nothing.
    expect(await searchWorkItemMentions("/repo", ["github"], "login")).toEqual([]);
    expect(await searchWorkItemMentions("/repo", ["github"], "999")).toEqual([]);
    // Unresolvable repository.
    mocks.githubRepo.mockRejectedValue(new Error("no git remotes found"));
    await expect(searchWorkItemMentions("/repo", ["github"], "login")).rejects.toMatchObject({
      failure: "repository-unresolved",
    });
    mocks.githubRepo.mockResolvedValue("");
    await expect(searchWorkItemMentions("/repo", ["github"], "login")).rejects.toMatchObject({
      failure: "repository-unresolved",
    });
    // Provider error.
    mocks.githubRepo.mockResolvedValue("owner/repo");
    mocks.listGithubWorkItems.mockRejectedValue(new Error("gh: authentication required"));
    await expect(searchWorkItemMentions("/repo", ["github"], "login")).rejects.toMatchObject({
      failure: "provider-failed",
      message: expect.stringContaining("authentication required"),
    });
  });

  it("uses qualified repositories for text, batch and exact GitHub sources", async () => {
    await searchWorkItemMentions("/repo", ["github"], "other/project#14");
    expect(mocks.githubRepo).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("github_mention_prefix", {
      cwd: "/repo",
      repo: "other/project",
      prefix: "14",
    });
    expect(mocks.githubWorkItem).toHaveBeenCalledWith("/repo", "other/project", "issue", 14);
    expect(mocks.listGithubWorkItems).toHaveBeenCalledWith(
      "/repo",
      "other/project",
      expect.objectContaining({ search: "14" }),
    );
  });

  it("passes GitLab MR and ADO numeric queries through their native search", async () => {
    await searchWorkItemMentions("/repo", ["gitlab"], "other/project!14");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "gitlab_list_work_items",
      expect.objectContaining({ repo: "other/project", kind: "pr", search: "14" }),
    );
    await searchWorkItemMentions("/repo", ["azuredevops"], "14");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "azure_devops_list_work_items",
      expect.objectContaining({ kind: "issue", search: "14" }),
    );
  });

  it("isolates failures and returns healthy provider results", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "linear_list_issues")
        return [{ id: "id", identifier: "ENG-9", number: 9, assignees: [] }];
      throw new Error("offline");
    });
    expect(await searchWorkItemMentions("/repo", ["jira", "linear"], "login")).toMatchObject([
      { provider: "linear", identifier: "ENG-9" },
    ]);
  });

  it("stops follow-up requests when a closed menu aborts repository discovery", async () => {
    const controller = new AbortController();
    let finish!: (repo: string) => void;
    mocks.githubRepo.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = searchWorkItemMentions("/repo", ["github"], "14", controller.signal);
    await vi.waitFor(() => expect(mocks.githubRepo).toHaveBeenCalled());
    controller.abort();
    finish("owner/repo");
    expect(await pending).toEqual([]);
    expect(mocks.listGithubWorkItems).not.toHaveBeenCalled();
    expect(mocks.githubWorkItem).not.toHaveBeenCalled();
  });

  it("deadlines every read and ignores late completion", async () => {
    vi.useFakeTimers();
    const pending = readWithDeadline(() => new Promise<never>(() => {}));
    const assertion = expect(pending).rejects.toThrow("Work item read deadline exceeded");
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
