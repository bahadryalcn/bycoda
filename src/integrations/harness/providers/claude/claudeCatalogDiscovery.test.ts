import { expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../core/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: spawn,
  writeChild: async () => undefined,
  watchChild: () => undefined,
  unwatchChild: () => undefined,
  killChild: async () => undefined,
  execChild: async () => "2.1.34 (Claude Code)",
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
import { discoverClaudeModels } from "./claudeCatalog";

it("backs off a hung probe across projects and retries after the cooldown", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "debug").mockImplementation(() => undefined);
  try {
    const first = discoverClaudeModels("/one");
    await vi.advanceTimersByTimeAsync(15_001);
    expect((await first).length).toBeGreaterThan(0);
    expect((await discoverClaudeModels("/two")).length).toBeGreaterThan(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_001);
    const retry = discoverClaudeModels("/three");
    await vi.advanceTimersByTimeAsync(15_001);
    await retry;
    expect(spawn).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
    vi.useRealTimers();
  }
});
