import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolvers = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
const missing = (name: string) => () =>
  Promise.reject(new Error(`${name} CLI not found. Install.`));

vi.mock("./child", () => ({
  resolveClaudeBinary: () => resolvers.claude(),
  resolveCodexBinary: () => resolvers.codex(),
  resolveAntigravityBinary: missing("Antigravity"),
  resolveCursorBinary: missing("Cursor"),
  resolveFxBinary: missing("fx"),
  resolveGrokBinary: missing("Grok Build"),
  resolveHermesBinary: missing("Hermes Agent"),
  resolveOmpBinary: missing("omp"),
  resolveOpenCodeBinary: missing("OpenCode"),
  resolvePiBinary: missing("Pi"),
  invokeProviderCommand: () => Promise.resolve([]),
}));
vi.mock("./registry", () => ({ isLiveHarness: () => true }));

async function load() {
  vi.resetModules();
  return import("./availability");
}

describe("probeHarnessAvailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolvers.claude.mockResolvedValue({ path: "claude" });
    resolvers.codex.mockResolvedValue({ path: "codex" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resolvers.claude.mockReset();
    resolvers.codex.mockReset();
  });

  it("treats the documented not-found error as a missing CLI and caches the answer", async () => {
    resolvers.codex.mockRejectedValue(new Error("Codex CLI not found. Install it, then retry."));
    const mod = await load();
    await mod.probeHarnessAvailability();
    expect(mod.isHarnessAvailable("claude")).toBe(true);
    expect(mod.isHarnessAvailable("codex")).toBe(false);
    expect(mod.hasProbedHarnessAvailability()).toBe(true);
    await mod.probeHarnessAvailability();
    expect(resolvers.claude).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous value and retries when the failure is not a missing CLI", async () => {
    const mod = await load();
    await mod.probeHarnessAvailability();
    expect(mod.isHarnessAvailable("claude")).toBe(true);

    resolvers.claude.mockRejectedValue(new Error("Host is unreachable (token=abc123secret)"));
    await mod.probeHarnessAvailability({ force: true });
    expect(mod.isHarnessAvailable("claude")).toBe(true);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).toContain("claude");
    expect(logged).not.toContain("abc123secret");

    // The failure was not cached as a finished probe, so the next call asks again.
    vi.advanceTimersByTime(1);
    await mod.probeHarnessAvailability({ force: true });
    expect(resolvers.claude).toHaveBeenCalledTimes(3);
  });

  it("does not claim a CLI is missing when the first probe only failed", async () => {
    resolvers.claude.mockRejectedValue(new Error("IPC channel closed"));
    const mod = await load();
    await mod.probeHarnessAvailability();
    expect(mod.hasProbedHarnessAvailability()).toBe(false);
    resolvers.claude.mockResolvedValue({ path: "claude" });
    await mod.probeHarnessAvailability();
    expect(mod.isHarnessAvailable("claude")).toBe(true);
    expect(mod.hasProbedHarnessAvailability()).toBe(true);
  });

  it("bounds a hung resolver so a forced probe can start again", async () => {
    resolvers.claude.mockReturnValue(new Promise(() => undefined));
    const mod = await load();
    const probe = mod.probeHarnessAvailability();
    await vi.advanceTimersByTimeAsync(10_000);
    await probe;
    expect(mod.hasProbedHarnessAvailability()).toBe(false);

    resolvers.claude.mockResolvedValue({ path: "claude" });
    await mod.probeHarnessAvailability({ force: true });
    expect(mod.isHarnessAvailable("claude")).toBe(true);
  });
});
