import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn(), focus: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("./windowNavigation", () => ({ focusSessionWindow: api.focus }));
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it("retains a claimed open and releases it after its pane closes", async () => {
  api.invoke.mockImplementation(async (command: string) =>
    command === "claim_session_windows" ? { status: "owned", tokens: { a: "token" } } : undefined,
  );
  const store = await import("./sessionWindowOwnership");
  const finish = await store.reserveSessionWindow(["a"]);
  await finish?.(true);
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await store.syncSessionWindowOwnership([]);
  expect(api.invoke).toHaveBeenLastCalledWith("release_session_windows", {
    tokens: { a: "token" },
  });
});
it("focuses exact owner and never creates local reservation on conflict", async () => {
  api.invoke.mockResolvedValue({ status: "other", sessionId: "a", ownerWindowLabel: "owner" });
  const store = await import("./sessionWindowOwnership");
  store.configureSessionWindowFocus(api.focus);
  expect(await store.reserveSessionWindow(["a"])).toBeNull();
  expect(api.focus).toHaveBeenCalledWith("owner", "a", undefined);
});
it("does not treat uncertain claim or failed focus as an unowned session", async () => {
  api.invoke.mockRejectedValueOnce(new Error("unknown result"));
  const store = await import("./sessionWindowOwnership");
  store.configureSessionWindowFocus(api.focus);
  await expect(store.reserveSessionWindow(["a"])).rejects.toThrow("unknown result");
  expect(api.focus).not.toHaveBeenCalled();
  api.invoke.mockResolvedValueOnce({ status: "other", sessionId: "a", ownerWindowLabel: "owner" });
  api.focus.mockRejectedValueOnce(new Error("closed"));
  await expect(store.reserveSessionWindow(["a"])).rejects.toThrow("closed");
});

it("holds restored ownership through an initial empty render and releases on abort", async () => {
  api.invoke.mockImplementation(async (command: string) =>
    command === "claim_session_windows" ? { status: "owned", tokens: { a: "token" } } : undefined,
  );
  const store = await import("./sessionWindowOwnership");
  expect(await store.claimRestoredSession("a")).toBe(true);
  await store.syncSessionWindowOwnership([]);
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await store.abortRestoredSession("a");
  expect(api.invoke).toHaveBeenLastCalledWith("release_session_windows", {
    tokens: { a: "token" },
  });
});

it("scopes remote session ownership to the physical environment", async () => {
  const store = await import("./sessionWindowOwnership");
  expect(store.remoteSessionOwnershipKey("remote://machine-a/project", "same")).not.toBe(
    store.remoteSessionOwnershipKey("remote://machine-b/project", "same"),
  );
  expect(store.remoteSessionOwnershipKey("remote://machine-a/other", "same")).toBe(
    store.remoteSessionOwnershipKey("remote://machine-a/project", "same"),
  );
  expect(() => store.remoteSessionOwnershipKey("/local", "same")).toThrow();
});
