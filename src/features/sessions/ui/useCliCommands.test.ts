import { beforeEach, expect, it, vi } from "vitest";

const listClaudeCommands = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => ({ listClaudeCommands }));
vi.mock("../../../integrations/harness/core/reportedCommands", () => ({
  getReportedCommands: () => [],
  subscribeReportedCommands: () => () => {},
}));

import { cachedDiskEntry, discoverCommands } from "./useCliCommands";

const command = (name: string) => ({ name }) as never;

beforeEach(() => {
  listClaudeCommands.mockReset();
});

it("bounds remembered folders by recency so worktrees do not accumulate", async () => {
  for (let index = 0; index < 40; index++) {
    listClaudeCommands.mockResolvedValueOnce([command(`c${index}`)]);
    await discoverCommands(`/work/${index}`);
  }
  expect(cachedDiskEntry("/work/0")).toBeNull();
  expect(cachedDiskEntry("/work/39")?.commands).toEqual([command("c39")]);
});
