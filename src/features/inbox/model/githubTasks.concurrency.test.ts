import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_PROVIDER_CONCURRENCY,
  clearInboxCache,
  listInboxItems,
  settleWithLimit,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("settleWithLimit", () => {
  it("never runs more than the limit at once and keeps task order", async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, index) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      // Later tasks finish first, so completion order differs from task order.
      await new Promise((resolve) => setTimeout(resolve, 10 - index));
      running -= 1;
      if (index === 3) throw new Error("boom");
      return index;
    });
    const results = await settleWithLimit(tasks, 4);
    expect(peak).toBe(4);
    expect(results.map((result) => result.status)).toEqual(
      tasks.map((_, index) => (index === 3 ? "rejected" : "fulfilled")),
    );
    expect(
      results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
    ).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  });

  it("handles no tasks", async () => {
    expect(await settleWithLimit([])).toEqual([]);
  });
});

describe("inbox provider fan-out", () => {
  const query = { assignedToMe: false, state: "open", search: "" } as const;

  beforeEach(() => {
    clearInboxCache();
    vi.mocked(invoke).mockReset();
  });

  it("bounds repository lookups per provider and keeps the merged order", async () => {
    const projects = Array.from({ length: 7 }, (_, index) => ({
      path: `/tmp/p${index}`,
    }));
    let running = 0;
    let peak = 0;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "gitlab_status") return { connected: true };
      if (command.endsWith("_status")) return { connected: false };
      if (command === "git_github_repositories") return ["github/repo"];
      if (command === "git_github_work_items") return [];
      if (command === "gitlab_repo") {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return `acme/${(args as { cwd: string }).cwd.slice(-2)}`;
      }
      if (command === "gitlab_list_work_items") {
        const { cwd, kind } = args as { cwd: string; kind: string };
        return [
          {
            kind,
            number: 1,
            title: `${cwd} ${kind}`,
            url: `https://gitlab.test/${cwd}/${kind}`,
            state: "open",
            updatedAt: "2026-09-16T08:00:00Z",
            labels: [],
            assignees: [],
            draft: false,
            repo: "",
          },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await listInboxItems(projects, query, { force: true });

    expect(peak).toBeLessThanOrEqual(INBOX_PROVIDER_CONCURRENCY);
    expect(result.errors).toEqual({});
    expect(result.items.map((item) => item.projectPath).sort()).toEqual(
      projects.flatMap((project) => [project.path, project.path]).sort(),
    );
  });

  it("does not make one slow provider delay another", async () => {
    const slow = deferred();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "linear_status") {
        await slow.promise;
        return { connected: false };
      }
      if (command === "gitlab_status") return { connected: true };
      if (command.endsWith("_status")) return { connected: false };
      if (command === "git_github_repositories") return ["github/repo"];
      if (command === "git_github_work_items") return [];
      if (command === "gitlab_repo") return "acme/web";
      if (command === "gitlab_list_work_items") return [];
      throw new Error(`Unexpected command: ${command}`);
    });

    const pending = listInboxItems([{ path: "/tmp/a" }], query, {
      force: true,
    });
    await vi.waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("gitlab_list_work_items", expect.anything());
    });
    slow.resolve();
    expect((await pending).errors).toEqual({});
  });
});
