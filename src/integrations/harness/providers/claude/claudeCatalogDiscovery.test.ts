import { expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const processIo = vi.hoisted(() => ({ write: vi.fn(), kill: vi.fn() }));
vi.mock("../../core/child", () => ({
  createChildProcessHandle: (sessionId: string) => Object.freeze({ sessionId }),
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: spawn,
  writeChild: async (...args: unknown[]) => {
    processIo.write(...args);
  },
  watchChild: () => undefined,
  unwatchChild: () => undefined,
  killChild: async (...args: unknown[]) => {
    processIo.kill(...args);
  },
  execChild: async () => "2.1.34 (Claude Code)",
}));
vi.mock("../../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
vi.mock("../../../../features/providers/model/providerAccounts", async (load) => ({
  ...(await load<object>()),
  defaultProviderAccountId: () => "terminal-max",
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
    // A signed-out ambient profile lists only aliases; probe the session account.
    expect(spawn.mock.calls[0][4]).toEqual({ provider: "claude", id: "terminal-max" });
    await vi.advanceTimersByTimeAsync(300_001);
    const retry = discoverClaudeModels("/three");
    await vi.advanceTimersByTimeAsync(15_001);
    await retry;
    expect(spawn).toHaveBeenCalledTimes(2);
    const originals = spawn.mock.calls.map((call) => call[0]);
    expect(originals.every((handle) => typeof handle === "object" && handle !== null)).toBe(true);
    expect(originals[0]).not.toBe(originals[1]);
    expect(processIo.write.mock.calls.every(([handle]) => originals.includes(handle))).toBe(true);
    expect(processIo.kill.mock.calls.every(([handle]) => originals.includes(handle))).toBe(true);
  } finally {
    log.mockRestore();
    vi.useRealTimers();
  }
});
