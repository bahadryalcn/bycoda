// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGitlabCache,
  gitlabMrDiff,
  gitlabWorkItemDetails,
  peekGitlabMrDiff,
  peekGitlabWorkItemDetails,
} from "./gitlab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  clearGitlabCache();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, args) => ({ args }) as never);
});

describe("gitlab detail and diff caches", () => {
  it("caps work item details at 128 entries and refreshes on read", async () => {
    for (let i = 0; i < 128; i++) await gitlabWorkItemDetails("org/repo", "issue", i);
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 0)).not.toBeNull();
    await gitlabWorkItemDetails("org/repo", "issue", 128);

    expect(peekGitlabWorkItemDetails("org/repo", "issue", 0)).not.toBeNull();
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 1)).toBeNull();
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 128)).not.toBeNull();
  });

  it("caps merge request diffs at 128 entries and refreshes on read", async () => {
    for (let n = 1; n <= 128; n++) await gitlabMrDiff("org/repo", n);
    expect(peekGitlabMrDiff("org/repo", 1)).not.toBeNull();
    await gitlabMrDiff("org/repo", 129);

    expect(peekGitlabMrDiff("org/repo", 1)).not.toBeNull();
    expect(peekGitlabMrDiff("org/repo", 2)).toBeNull();
    expect(peekGitlabMrDiff("org/repo", 129)).not.toBeNull();
  });
});
