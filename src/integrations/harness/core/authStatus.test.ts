import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./child", () => ({ invokeProviderCommand: mock.invoke }));
import { readHarnessAuthStatus } from "./authStatus";

beforeEach(() => mock.invoke.mockReset());

it("coalesces simultaneous scans but keeps account profiles separate", async () => {
  mock.invoke.mockResolvedValue("signedIn");
  await Promise.all([
    readHarnessAuthStatus("claude", "default"),
    readHarnessAuthStatus("claude", "default"),
    readHarnessAuthStatus("claude", "terminal-work"),
  ]);
  expect(mock.invoke).toHaveBeenCalledTimes(2);
  expect(mock.invoke).toHaveBeenCalledWith("harness_auth_status", {
    provider: "claude",
    accountId: "terminal-work",
  });
  await readHarnessAuthStatus("claude", "default");
  expect(mock.invoke).toHaveBeenCalledTimes(3);
});

it("treats unavailable commands or malformed replies as unknown, never signed out", async () => {
  mock.invoke.mockRejectedValueOnce(new Error("old host"));
  expect(await readHarnessAuthStatus("codex", "default")).toBe("unknown");
  mock.invoke.mockResolvedValueOnce({ email: "cached@example.test" });
  expect(await readHarnessAuthStatus("codex", "default")).toBe("unknown");
});
