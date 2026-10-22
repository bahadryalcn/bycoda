import { expect, it, vi } from "vitest";
vi.mock("./rateLimitsCache", () => ({
  getCachedRateLimits: vi.fn(),
  refreshClaudeQuotaOnce: vi.fn(),
}));
vi.mock("../../settings/model/mcpSettingsCache", () => ({ getCachedMcpSettings: vi.fn() }));
import { createProviderAccountControl } from "./providerAccountControl";
import { accountMetadataRevision } from "./providerManagementControl";
import type { ProviderAccount } from "./providerAccounts";
const context = {
  environmentId: "host",
  sourceSessionId: "source",
  projectCwd: "/project",
  workingCwd: "/project/worktree",
  valid: () => true,
};
async function fixture() {
  let accounts: ProviderAccount[] = [
    { provider: "claude", id: "one", label: "First", isDefault: true },
    { provider: "claude", id: "two", label: "Second" },
  ];
  const writes: unknown[] = [];
  const read = async () => ({
    environmentId: "host",
    sourceSessionId: "source",
    projectCwd: "/project",
    workingCwd: "/project/worktree",
    sampledAt: 1,
    revision: "a".repeat(64),
    accountRevision: await accountMetadataRevision(accounts),
    accounts: accounts.map((a) => ({
      ...a,
      color: a.color ?? null,
      isDefault: !!a.isDefault,
      quota: {
        status: "idle" as const,
        updatedAt: 0,
        session: null,
        weekly: null,
        monthly: null,
        renewalPending: false,
      },
    })),
    mcp: [],
    coverage: {
      accountMetadata: "desktop-owner" as const,
      quotaSource: "desktop-cache" as const,
      mcpSource: "unavailable" as const,
      truncated: false,
    },
  });
  const quotaRefresh = vi.fn(async (_account: string, allowed: () => boolean) => {
    expect(allowed()).toBe(true);
    return {
      provider: "claude" as const,
      status: "ok" as const,
      updatedAt: 1,
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      error: null,
    };
  });
  const control = createProviderAccountControl({
    accounts: () => accounts,
    read,
    quotaRefresh,
    rename: (p, id, label) => {
      writes.push(["rename", p, id, label]);
      accounts = accounts.map((a) => (a.id === id ? { ...a, label } : a));
      return accounts.find((a) => a.id === id)!;
    },
    color: (p, id, color) => {
      writes.push(["color", p, id, color]);
      accounts = accounts.map((a) => (a.id === id ? { ...a, color } : a));
      return true;
    },
    default: (p, id) => {
      writes.push(["default", p, id]);
      accounts = accounts.map((a) => ({ ...a, isDefault: a.id === id }));
    },
  });
  const input = {
    operationId: "operation",
    expectedAccountRevision: await accountMetadataRevision(accounts),
    provider: "claude",
    accountId: "two",
    change: { kind: "rename", label: "Renamed" },
  };
  return {
    control,
    input,
    writes,
    quotaRefresh,
    get: () => accounts,
    set: (rows: ProviderAccount[]) => (accounts = rows),
  };
}
it("applies one canonical setter and returns receipt without replay", async () => {
  const f = await fixture();
  expect(await f.control(context, "providerManagement.patch", f.input)).toMatchObject({
    state: "applied",
    atomic: false,
  });
  await f.control(context, "providerManagement.patch", f.input);
  expect(f.writes).toHaveLength(1);
  await expect(
    f.control(context, "providerManagement.patch", {
      ...f.input,
      change: { kind: "rename", label: "Different" },
    }),
  ).rejects.toThrow("already used");
  expect(
    await f.control(context, "providerManagement.status", { operationId: "operation" }),
  ).toMatchObject({ state: "applied" });
  expect(
    await f.control({ ...context, sourceSessionId: "other" }, "providerManagement.status", {
      operationId: "operation",
    }),
  ).toMatchObject({ state: "unknown" });
});
it("explicit Claude quota refresh shares receipt isolation and never replays a provider observation", async () => {
  const f = await fixture();
  const { change: _change, ...base } = f.input;
  const input = { ...base, confirm: "REFRESH_PROVIDER_QUOTA" };
  expect(await f.control(context, "providerManagement.quotaRefresh", input)).toMatchObject({
    state: "applied",
    operationId: input.operationId,
  });
  await f.control(context, "providerManagement.quotaRefresh", input);
  expect(f.quotaRefresh).toHaveBeenCalledTimes(1);
  expect(f.writes).toEqual([]);
  await expect(f.control(context, "providerManagement.patch", f.input)).rejects.toThrow(
    "already used",
  );
  for (const invalid of [
    { ...input, operationId: "codex", provider: "codex" },
    { ...input, operationId: "wrong", confirm: "SIGN_IN" },
    { ...input, operationId: "url", url: "https://private" },
  ])
    await expect(f.control(context, "providerManagement.quotaRefresh", invalid)).rejects.toThrow();
  expect(f.quotaRefresh).toHaveBeenCalledTimes(1);
});
it("rejects stale revision, extra fields, credentials and invalid review without writes", async () => {
  const f = await fixture();
  f.set(f.get().map((a) => ({ ...a, label: "Desktop change" })));
  expect(await f.control(context, "providerManagement.patch", f.input)).toMatchObject({
    state: "failed",
  });
  for (const extra of [
    { ...f.input, operationId: "extra", approved: true },
    { ...f.input, operationId: "delete", change: { kind: "delete" } },
    { ...f.input, operationId: "color", change: { kind: "color", color: "#secret" } },
    { ...f.input, operationId: "default", change: { kind: "default" } },
    { ...f.input, operationId: "long", change: { kind: "rename", label: "x".repeat(49) } },
  ])
    await expect(f.control(context, "providerManagement.patch", extra)).rejects.toThrow();
  expect(f.writes).toEqual([]);
});
it("explicit default and color clearing delegate only canonical metadata setters", async () => {
  const f = await fixture();
  expect(
    await f.control(context, "providerManagement.patch", {
      ...f.input,
      change: { kind: "default", confirm: "DEFAULT_FOR_FUTURE_SESSIONS" },
    }),
  ).toMatchObject({ state: "applied" });
  expect(f.get().find((a) => a.id === "two")?.isDefault).toBe(true);
  expect(
    await f.control(context, "providerManagement.patch", {
      ...f.input,
      operationId: "clear",
      expectedAccountRevision: await accountMetadataRevision(f.get()),
      change: { kind: "color", color: null },
    }),
  ).toMatchObject({ state: "applied" });
  expect(f.writes).toEqual([
    ["default", "claude", "two"],
    ["color", "claude", "two", undefined],
  ]);
});
it("guards source after digest and preserves unknown after a setter exception", async () => {
  const f = await fixture();
  let checks = 0;
  expect(
    await f.control(
      { ...context, valid: () => ++checks === 1 },
      "providerManagement.patch",
      f.input,
    ),
  ).toMatchObject({ state: "failed" });
  expect(f.writes).toEqual([]);
  const c = createProviderAccountControl({
    accounts: f.get,
    read: async () => {
      throw Error("unavailable");
    },
    rename: () => {
      throw Error("partial");
    },
    color: () => true,
    default: () => {},
  });
  expect(await c(context, "providerManagement.patch", f.input)).toMatchObject({ state: "unknown" });
});
