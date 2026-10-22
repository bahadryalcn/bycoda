// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  azureDevOpsMrDiff,
  azureDevOpsWorkItemDetails,
  clearAzureDevOpsCache,
  peekAzureDevOpsMrDiff,
  peekAzureDevOpsWorkItemDetails,
} from "./azureDevOps";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  clearAzureDevOpsCache();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, args) => ({ args }) as never);
});

describe("azure devops detail and diff caches", () => {
  it("caps work item details at 128 entries and refreshes on read", async () => {
    for (let i = 0; i < 128; i++) await azureDevOpsWorkItemDetails("org/proj", "issue", i);
    expect(peekAzureDevOpsWorkItemDetails("org/proj", "issue", 0)).not.toBeNull();
    await azureDevOpsWorkItemDetails("org/proj", "issue", 128);

    expect(peekAzureDevOpsWorkItemDetails("org/proj", "issue", 0)).not.toBeNull();
    expect(peekAzureDevOpsWorkItemDetails("org/proj", "issue", 1)).toBeNull();
    expect(peekAzureDevOpsWorkItemDetails("org/proj", "issue", 128)).not.toBeNull();
  });

  it("caps pull request diffs at 128 entries and refreshes on read", async () => {
    for (let n = 1; n <= 128; n++) await azureDevOpsMrDiff("org/proj", n);
    expect(peekAzureDevOpsMrDiff("org/proj", 1)).not.toBeNull();
    await azureDevOpsMrDiff("org/proj", 129);

    expect(peekAzureDevOpsMrDiff("org/proj", 1)).not.toBeNull();
    expect(peekAzureDevOpsMrDiff("org/proj", 2)).toBeNull();
    expect(peekAzureDevOpsMrDiff("org/proj", 129)).not.toBeNull();
  });
});
