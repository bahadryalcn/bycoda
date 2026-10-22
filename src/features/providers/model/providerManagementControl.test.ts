import { describe, expect, it, vi } from "vitest";
vi.mock("./providerAccounts", () => ({
  providerAccounts: vi.fn(() => {
    throw Error("real account owner forbidden");
  }),
  PROVIDER_ACCOUNT_PROVIDERS: ["claude", "codex"],
}));
vi.mock("./rateLimitsCache", () => ({
  getCachedRateLimits: vi.fn(() => {
    throw Error("real quota owner forbidden");
  }),
}));
vi.mock("../../settings/model/mcpSettingsCache", () => ({
  getCachedMcpSettings: vi.fn(() => {
    throw Error("real MCP owner forbidden");
  }),
}));
import { readProviderManagement } from "./providerManagementControl";
const context = {
  environmentId: "host",
  sourceSessionId: "session",
  projectCwd: "/project",
  workingCwd: "/project/worktree",
  valid: () => true,
};
const fixture = () => ({
  accounts: () => [{ provider: "claude" as const, id: "default", label: "Work", isDefault: true }],
  quota: () => ({
    provider: "claude" as const,
    status: "error" as const,
    updatedAt: 1,
    session: { usedPercent: 30, windowMinutes: 300, resetsAt: null },
    weekly: null,
    monthly: null,
    resetCredits: null,
    error: "SECRET",
    renewalPending: true,
  }),
  mcp: () => ({
    servers: [
      {
        provider: "claude" as const,
        name: "Docs",
        scope: "project" as const,
        configPath: "SECRET",
        transport: "https://SECRET",
        status: "SECRET",
        enabled: false,
      },
    ],
    error: "SECRET",
    claudeError: "SECRET",
  }),
  now: () => 7,
});
describe("safe provider desktop cache projection", () => {
  it("projects metadata and cached quota only, omitting raw error/path/transport secrets", async () => {
    const report = await readProviderManagement(context, {}, fixture());
    expect(JSON.stringify(report)).not.toContain("SECRET");
    expect(report.accounts[0].quota).toMatchObject({
      status: "error",
      renewalPending: true,
      session: { usedPercent: 30 },
    });
    expect(report.mcp[0]).toMatchObject({ transport: "unknown", enabled: false });
    expect(report.coverage).toMatchObject({
      quotaSource: "desktop-cache",
      mcpSource: "desktop-cache",
      truncated: false,
    });
    expect(report.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(report.workingCwd).toBe("/project/worktree");
  });
  it("cache miss remains unavailable and metadata revision changes without initiating work", async () => {
    const deps = fixture();
    const first = await readProviderManagement(context, {}, { ...deps, mcp: () => undefined });
    expect(first.mcp).toEqual([]);
    expect(first.coverage.mcpSource).toBe("unavailable");
    const second = await readProviderManagement(
      context,
      {},
      {
        ...deps,
        accounts: () => [{ ...deps.accounts()[0], label: "Other" }],
        mcp: () => undefined,
      },
    );
    expect(first.revision).not.toBe(second.revision);
    expect(first.accountRevision).not.toBe(second.accountRevision);
    const quotaChanged = await readProviderManagement(
      context,
      {},
      { ...deps, quota: () => ({ ...deps.quota(), updatedAt: 2 }) },
    );
    const baseline = await readProviderManagement(context, {}, deps);
    expect(quotaChanged.revision).not.toBe(baseline.revision);
    expect(quotaChanged.accountRevision).toBe(baseline.accountRevision);
  });
  it("rejects extra fields and revoked source before or after asynchronous digest", async () => {
    await expect(readProviderManagement(context, { cwd: "/private" }, fixture())).rejects.toThrow(
      "identity",
    );
    await expect(
      readProviderManagement({ ...context, valid: () => false }, {}, fixture()),
    ).rejects.toThrow("identity");
    let checks = 0;
    await expect(
      readProviderManagement({ ...context, valid: () => ++checks === 1 }, {}, fixture()),
    ).rejects.toThrow("changed");
  });
});
