import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearInboxCache, listInboxItems, type GithubWorkItem } from "./githubTasks";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  clearInboxCache();
  vi.mocked(invoke).mockReset();
});

it("publishes ready provider items and replays them to a joined reader before a slow provider finishes", async () => {
  let release!: (value: { connected: boolean }) => void;
  const held = new Promise<{ connected: boolean }>((resolve) => {
    release = resolve;
  });
  const item: GithubWorkItem = {
    kind: "issue",
    number: 1,
    title: "Ready",
    url: "https://example.invalid/1",
    state: "open",
    updatedAt: "2026-10-25",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/repo",
  };
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repositories") return ["acme/repo"];
    if (command === "git_github_work_items") return [item];
    if (command === "linear_status") return held;
    if (["jira_status", "gitlab_status", "azure_devops_status"].includes(String(command)))
      return { connected: false };
    throw new Error(`Unexpected command ${command}`);
  });
  const first = vi.fn(),
    second = vi.fn();
  const projects = [{ path: "/project" }],
    query = { assignedToMe: false, state: "open", search: "", githubKinds: ["issue"] } as const;
  let finished = false;
  const pending = listInboxItems(
    projects,
    { ...query, githubKinds: ["issue"] },
    { onProgress: first },
  ).then((result) => {
    finished = true;
    return result;
  });
  let joined: ReturnType<typeof listInboxItems> | undefined;
  try {
    await vi.waitFor(() =>
      expect(first).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ title: "Ready" })],
          pendingProviders: expect.arrayContaining(["linear"]),
        }),
      ),
    );
    expect(finished).toBe(false);
    joined = listInboxItems(projects, { ...query, githubKinds: ["issue"] }, { onProgress: second });
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ title: "Ready" })] }),
    );
  } finally {
    release({ connected: false });
    await Promise.all([pending, joined]);
  }
  expect((await pending).items).toHaveLength(1);
  expect((await pending).pendingProviders).toBeUndefined();
});
