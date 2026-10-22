// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../integrations/harness/core/auth", () => ({
  loginHarness: vi.fn(),
}));
vi.mock("./providerAccountIdentity", () => ({
  readProviderAccountIdentity: vi.fn(),
}));
vi.mock("./providerAccountCredentials", () => ({
  removeProviderAccountCredentials: vi.fn(),
}));
vi.mock("./rateLimitsCache", () => ({ clearCachedRateLimits: vi.fn() }));
import { loginHarness } from "../../../integrations/harness/core/auth";
import { readProviderAccountIdentity } from "./providerAccountIdentity";
import { removeProviderAccountCredentials } from "./providerAccountCredentials";
import { providerAccounts } from "./providerAccounts";
import { registerProviderAccount, sameSignedInIdentity } from "./providerAccountRegistration";

const account = {
  id: "account-new",
  provider: "codex" as const,
  label: "Work",
};
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(loginHarness).mockResolvedValue();
  vi.mocked(removeProviderAccountCredentials).mockResolvedValue();
});

it("rejects the same signed-in identity even with a different label and casing", async () => {
  vi.mocked(readProviderAccountIdentity).mockResolvedValue({
    email: " Work@Example.com ",
    organization: "Company",
  });
  await expect(registerProviderAccount(account)).rejects.toThrow("already added");
  expect(removeProviderAccountCredentials).toHaveBeenCalledWith("codex", "account-new");
  expect(providerAccounts("codex")).toHaveLength(1);
});

it("persists a verified different identity", async () => {
  vi.mocked(readProviderAccountIdentity).mockImplementation(async (_, id) => ({
    email: id === "default" ? "personal@example.com" : "work@example.com",
  }));
  await registerProviderAccount(account);
  expect(providerAccounts("codex").map((entry) => entry.id)).toEqual(["default", "account-new"]);
  expect(removeProviderAccountCredentials).not.toHaveBeenCalled();
});

it("cleans up an unverified or failed login without publishing it", async () => {
  vi.mocked(readProviderAccountIdentity).mockResolvedValue(null);
  await expect(registerProviderAccount(account)).rejects.toThrow("verify");
  expect(providerAccounts("codex")).toHaveLength(1);
  vi.mocked(loginHarness).mockRejectedValueOnce(new Error("Login cancelled"));
  await expect(registerProviderAccount(account)).rejects.toThrow("Login cancelled");
  expect(removeProviderAccountCredentials).toHaveBeenCalledTimes(2);
});

it("reports cleanup failures and blocks overlapping registrations", async () => {
  let resolve!: () => void;
  vi.mocked(loginHarness).mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const first = registerProviderAccount(account);
  await expect(registerProviderAccount({ ...account, id: "account-second" })).rejects.toThrow(
    "already in progress",
  );
  // Web Locks may schedule their callback in a microtask.
  for (let index = 0; index < 10 && !resolve; index++) await Promise.resolve();
  expect(resolve).toBeTypeOf("function");
  vi.mocked(removeProviderAccountCredentials).mockRejectedValueOnce(new Error("Disk locked"));
  resolve();
  await expect(first).rejects.toThrow("cleanup failed");
});

it("keeps different organizations separate and never matches unknown identities", () => {
  expect(
    sameSignedInIdentity(
      { email: "a@b.com", organization: "One" },
      { email: "a@b.com", organization: "Two" },
    ),
  ).toBe(false);
  expect(sameSignedInIdentity(null, null)).toBe(false);
});

it("does not publish an account cancelled during identity verification and waits for cleanup", async () => {
  const controller = new AbortController();
  vi.mocked(readProviderAccountIdentity).mockImplementation(async (_, id) => {
    controller.abort();
    return { email: id === account.id ? "new@example.com" : "existing@example.com" };
  });
  let cleaned!: () => void;
  vi.mocked(removeProviderAccountCredentials).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        cleaned = resolve;
      }),
  );
  const registration = registerProviderAccount(account, controller.signal);
  const cancelled = expect(registration).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(removeProviderAccountCredentials).toHaveBeenCalledOnce());
  expect(providerAccounts("codex")).toHaveLength(1);
  await expect(registerProviderAccount({ ...account, id: "another" })).rejects.toThrow(
    "already in progress",
  );
  cleaned();
  await cancelled;
  expect(loginHarness).toHaveBeenCalledWith("codex", account.id, controller.signal);
});
