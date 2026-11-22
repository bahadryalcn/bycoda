import { describe, expect, it, vi } from "vitest";
import { GhRuntime } from "../git/gh-runtime";
import { readGithubWorkItems } from "./github";

const repo = JSON.stringify({ nameWithOwner: "owner/repo", url: "https://github.com/owner/repo" });
const row = {
  number: 123,
  title: "Fix bug",
  state: "OPEN",
  url: "https://github.com/owner/repo/issues/123",
  updatedAt: "2025-01-01",
};

describe("Host GitHub work items", () => {
  it("resolves the registered cwd, quotes search terms and retains partial results", async () => {
    const project = vi.fn(async () => ({ cwd: "/host/project" }));
    const run = vi
      .fn()
      .mockResolvedValueOnce(repo)
      .mockResolvedValueOnce(JSON.stringify([row]))
      .mockRejectedValueOnce(new Error("HTTP 429\nRetry-After: 60"));
    const response = await readGithubWorkItems(project, { run }, "workItems.search", {
      projectId: "registered",
      query: 'is:closed "bug"',
    });
    expect(project).toHaveBeenCalledWith("registered");
    expect(run).toHaveBeenCalledWith(
      "/host/project",
      expect.arrayContaining(["owner/repo", '--search="is:closed" "\\"bug\\""']),
      { timeoutMs: 3_500, allowInstall: false, signal: expect.any(AbortSignal) },
    );
    expect(response.items).toEqual([expect.objectContaining({ kind: "issue", ...row })]);
    expect(response.errors).toEqual([
      expect.objectContaining({
        reason: "rate-limited",
        retryAt: expect.any(Number),
      }),
    ]);
  });

  it("reports missing GitHub CLI without starting the installer", async () => {
    const gh = new GhRuntime(process.cwd(), { env: {}, commonDirectories: [], platform: "linux" });
    const setup = vi.spyOn(gh, "setup").mockRejectedValue(new Error("Unexpected installation"));
    const result = await readGithubWorkItems(
      async () => ({ cwd: process.cwd() }),
      gh,
      "workItems.search",
      { projectId: "p", query: "bug" },
    );
    expect(result.errors).toEqual([expect.objectContaining({ reason: "missing-tool" })]);
    expect(setup).not.toHaveBeenCalled();
  });

  it.each([
    ["spawn gh ENOENT", "missing-tool"],
    ["GitHub is not signed in on this computer", "unauthenticated"],
    ["HTTP 404", "not-found"],
    ["command timed out", "failed"],
  ])("maps CLI errors %s", async (message, reason) => {
    const run = vi.fn().mockRejectedValue(new Error(message));
    const result = await readGithubWorkItems(
      async () => ({ cwd: process.cwd() }),
      { run },
      "workItems.get",
      { projectId: "p", number: 123 },
    );
    expect(result.errors).toEqual([expect.objectContaining({ reason })]);
  });

  it("distinguishes a missing project directory from a missing executable", async () => {
    const run = vi.fn().mockRejectedValue(new Error("spawn gh ENOENT"));
    const result = await readGithubWorkItems(
      async () => ({ cwd: "package.json" }),
      { run },
      "workItems.search",
      { projectId: "p", query: "fix" },
    );
    expect(result.errors).toEqual([
      { reason: "not-found", message: "Project folder was not found on the project Host." },
    ]);
  });

  it("returns completed reads when the request is cancelled", async () => {
    const controller = new AbortController();
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      if (args[0] === "repo") return repo;
      if (args[0] === "issue") return JSON.stringify([row]);
      controller.abort();
      return await new Promise<string>(() => {});
    });
    const result = await readGithubWorkItems(
      async () => ({ cwd: "/repo" }),
      { run },
      "workItems.search",
      { projectId: "p", query: "fix" },
      controller.signal,
    );
    expect(result.items).toEqual([expect.objectContaining({ number: 123 })]);
    expect(result.errors).toEqual([expect.objectContaining({ reason: "failed" })]);
  });

  it("reuses repository discovery and invalidates it after a failed read", async () => {
    const run = vi.fn(async (_cwd: string, args: string[]) => (args[0] === "repo" ? repo : "[]"));
    const gh = { run };
    const project = async () => ({ cwd: "/repo" });
    const search = () =>
      readGithubWorkItems(project, gh, "workItems.search", { projectId: "p", query: "bug" });
    await search();
    await search();
    expect(run.mock.calls.filter(([, args]) => args[0] === "repo")).toHaveLength(1);
    run.mockRejectedValueOnce(new Error("HTTP 404"));
    await search();
    await search();
    expect(run.mock.calls.filter(([, args]) => args[0] === "repo")).toHaveLength(2);
  });

  it("resolves issue or PR numbers in the registered repository", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(repo)
      .mockResolvedValueOnce(
        JSON.stringify({
          data: { repository: { n123: { ...row, isDraft: true, body: "Details" } } },
        }),
      );
    const result = await readGithubWorkItems(
      async () => ({ cwd: "/repo" }),
      { run },
      "workItems.get",
      { projectId: "p", number: 123 },
    );
    expect(result.items).toEqual([expect.objectContaining({ kind: "pr", body: "Details" })]);
    expect(run.mock.calls[1]?.[1].at(-1)).toContain("issueOrPullRequest(number:123)");
  });

  it("bounds prefix lookup and retains rows when some aliases do not exist", async () => {
    const stdout = JSON.stringify({
      data: { repository: { n12: { ...row, number: 12 }, n123: row } },
      errors: [{ type: "NOT_FOUND" }],
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce(repo)
      .mockResolvedValueOnce(JSON.stringify([row]))
      .mockResolvedValueOnce("[]")
      .mockRejectedValueOnce(Object.assign(new Error("missing aliases"), { stdout }));
    const result = await readGithubWorkItems(
      async () => ({ cwd: "/repo" }),
      { run },
      "workItems.search",
      { projectId: "p", query: "#12" },
    );
    expect(result.items.map(({ number }) => number)).toEqual([12, 123]);
    expect(result.errors).toEqual([]);
    expect(run.mock.calls[1]?.[1]).toContain('--search="12"');
    expect(run.mock.calls[3]?.[1].at(-1).match(/issueOrPullRequest/g)).toHaveLength(100);
  });

  it("rejects invalid inputs and repository names", async () => {
    const project = vi.fn(async () => ({ cwd: "/repo" }));
    const run = vi.fn().mockResolvedValue(JSON.stringify({ nameWithOwner: "owner/repo/extra" }));
    for (const number of [0, -1, 1.5, 2_147_483_648])
      await expect(
        readGithubWorkItems(project, { run }, "workItems.get", { projectId: "p", number }),
      ).rejects.toThrow();
    for (const query of ["\n", "a".repeat(201)])
      await expect(
        readGithubWorkItems(project, { run }, "workItems.search", { projectId: "p", query }),
      ).rejects.toThrow();
    expect(project).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    const result = await readGithubWorkItems(project, { run }, "workItems.get", {
      projectId: "p",
      number: 1,
    });
    expect(result.errors[0]?.reason).toBe("not-found");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
