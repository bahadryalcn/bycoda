import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./child", () => ({ invokeProviderCommand: mock.invoke }));
import { readHarnessAuthStatus } from "./authStatus";

beforeEach(() => mock.invoke.mockReset());
afterEach(() => vi.useRealTimers());

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

it("returns unknown at the visible deadline but joins the original until physical settlement", async () => {
  vi.useFakeTimers();
  let finish!: (status: string) => void;
  const actual = new Promise<string>((resolve) => {
    finish = resolve;
  });
  mock.invoke.mockReturnValueOnce(actual).mockResolvedValue("signedOut");
  const first = readHarnessAuthStatus("codex", "held-profile");
  expect(readHarnessAuthStatus("codex", "held-profile")).toBe(first);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await first).toBe("unknown");
  expect(readHarnessAuthStatus("codex", "held-profile")).toBe(first);
  expect(await readHarnessAuthStatus("codex", "held-profile")).toBe("unknown");
  expect(mock.invoke).toHaveBeenCalledOnce();
  // Other profiles remain independently usable while the old operation is held.
  expect(await readHarnessAuthStatus("codex", "other-profile")).toBe("signedOut");
  finish("signedIn");
  await actual;
  await vi.advanceTimersByTimeAsync(0);
  expect(await first).toBe("unknown");
  // A later explicit fresh check is admitted only after the old actual result.
  expect(await readHarnessAuthStatus("codex", "held-profile")).toBe("signedOut");
  expect(mock.invoke).toHaveBeenCalledTimes(3);
});

it("retains a late actual failure without turning an uncertain status into a login request", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const actual = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  mock.invoke.mockReturnValueOnce(actual).mockResolvedValue("signedIn");
  const first = readHarnessAuthStatus("claude", "late-failure");
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await first).toBe("unknown");
  expect(mock.invoke).toHaveBeenCalledOnce();
  fail(new Error("actual process cleanup failed"));
  await actual.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(0);
  expect(await first).toBe("unknown");
  expect(await readHarnessAuthStatus("claude", "late-failure")).toBe("signedIn");
});
