import { expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  github: vi.fn(),
  gitlab: vi.fn(),
  azure: vi.fn(),
  peek: vi.fn(),
}));
vi.mock("./githubTasks", () => ({ prefetchGithubWorkItem: calls.github }));
vi.mock("./gitlab", () => ({
  gitlabWorkItemDetails: calls.gitlab,
  peekGitlabWorkItemDetails: calls.peek,
}));
vi.mock("./azureDevOps", () => ({
  azureDevOpsWorkItemDetails: calls.azure,
  peekAzureDevOpsWorkItemDetails: calls.peek,
}));
import { prefetchInboxItem } from "./inboxPrefetch";
import type { InboxItem } from "./githubTasks";
it("warms all three code-host providers and deduplicates hover plus keyboard focus", async () => {
  calls.peek.mockReturnValue(null);
  const base = { repo: "team/repo", kind: "pr", number: 12, projectPath: "/repo" };
  let finish!: (value: never) => void;
  calls.gitlab.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  prefetchInboxItem({ ...base, provider: "gitlab" } as InboxItem);
  prefetchInboxItem({ ...base, provider: "gitlab" } as InboxItem);
  expect(calls.gitlab).toHaveBeenCalledTimes(1);
  finish(undefined as never);
  await Promise.resolve();
  await Promise.resolve();
  calls.azure.mockResolvedValue({});
  prefetchInboxItem({ ...base, provider: "azuredevops" } as InboxItem);
  expect(calls.azure).toHaveBeenCalledWith("team/repo", "pr", 12);
  prefetchInboxItem({ ...base, provider: "github" } as InboxItem);
  expect(calls.github).toHaveBeenCalledWith("/repo", { repo: "team/repo", kind: "pr", number: 12 });
});
