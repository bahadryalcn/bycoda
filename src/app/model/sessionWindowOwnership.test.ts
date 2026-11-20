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
  expect([...(await store.claimRestoredSessions(["a"]))]).toEqual([]);
  await store.syncSessionWindowOwnership([]);
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await store.abortRestoredSession("a");
  expect(api.invoke).toHaveBeenLastCalledWith("release_session_windows", {
    tokens: { a: "token" },
  });
});

/** Fake native registry: all-or-nothing claims, one named conflict per refusal. */
function fakeNative(foreignIds: readonly string[]) {
  api.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command !== "claim_session_windows") return undefined;
    const ids = args.sessionIds as string[];
    const other = ids.find((id) => foreignIds.includes(id));
    if (other) return { status: "other", sessionId: other, ownerWindowLabel: "owner" };
    return { status: "owned", tokens: Object.fromEntries(ids.map((id) => [id, `t-${id}`])) };
  });
}
const claimCalls = () =>
  api.invoke.mock.calls.filter(([command]) => command === "claim_session_windows");

it("claims many restored sessions in one native call", async () => {
  fakeNative([]);
  const store = await import("./sessionWindowOwnership");
  const ids = Array.from({ length: 5 }, (_, index) => `s${index}`);
  expect([...(await store.claimRestoredSessions(ids))]).toEqual([]);
  expect(claimCalls()).toHaveLength(1);
  expect(claimCalls()[0][1]).toEqual({ sessionIds: ids });
  // Each id keeps its own release, so a mount keeps some and drops the rest.
  await store.syncSessionWindowOwnership(["s0", "s1"]);
  await Promise.all(["s2", "s3", "s4"].map((id) => store.abortRestoredSession(id)));
  expect(api.invoke).toHaveBeenLastCalledWith("release_session_windows", {
    tokens: { s2: "t-s2", s3: "t-s3", s4: "t-s4" },
  });
});

it("sets a conflicting restored session aside and claims the rest in order", async () => {
  fakeNative(["b", "d"]);
  const store = await import("./sessionWindowOwnership");
  const foreign = await store.claimRestoredSessions(["a", "b", "c", "d", "e"]);
  expect([...foreign]).toEqual(["b", "d"]);
  expect(claimCalls().map(([, args]) => (args as { sessionIds: string[] }).sessionIds)).toEqual([
    ["a", "b", "c", "d", "e"],
    ["a", "c", "d", "e"],
    ["a", "c", "e"],
  ]);
  // Only the owned ones hold tokens; the foreign ones never get a release.
  await Promise.all(["a", "b", "c", "d", "e"].map((id) => store.abortRestoredSession(id)));
  expect(api.invoke).toHaveBeenLastCalledWith("release_session_windows", {
    tokens: { a: "t-a", c: "t-c", e: "t-e" },
  });
});

it("does not claim again for a restored session it already holds", async () => {
  fakeNative([]);
  const store = await import("./sessionWindowOwnership");
  await store.claimRestoredSessions(["a"]);
  expect([...(await store.claimRestoredSessions(["a"]))]).toEqual([]);
  expect(claimCalls()).toHaveLength(1);
  expect([...(await store.claimRestoredSessions([]))]).toEqual([]);
  expect(claimCalls()).toHaveLength(1);
});

it("splits restored claims at the native limit of 128 ids", async () => {
  fakeNative([]);
  const store = await import("./sessionWindowOwnership");
  const ids = Array.from({ length: 130 }, (_, index) => `s${index}`);
  await store.claimRestoredSessions(ids);
  expect(claimCalls().map(([, args]) => (args as { sessionIds: string[] }).sessionIds)).toEqual([
    ids.slice(0, 128),
    ids.slice(128),
  ]);
});

it("releases every restored claim of a batch when a later call fails", async () => {
  fakeNative([]);
  const store = await import("./sessionWindowOwnership");
  const ids = Array.from({ length: 130 }, (_, index) => `s${index}`);
  api.invoke.mockImplementationOnce(async (_command: string, args: { sessionIds: string[] }) => ({
    status: "owned",
    tokens: Object.fromEntries(args.sessionIds.map((id) => [id, `t-${id}`])),
  }));
  api.invoke.mockRejectedValueOnce(new Error("offline"));
  await expect(store.claimRestoredSessions(ids)).rejects.toThrow("offline");
  const release = api.invoke.mock.calls.find(([command]) => command === "release_session_windows");
  expect(Object.keys(release?.[1].tokens)).toEqual(ids.slice(0, 128));
  // Nothing stays restored: a later sync has no pending bootstrap claims to finish.
  await store.abortRestoredSession("s0");
  expect(
    api.invoke.mock.calls.filter(([command]) => command === "release_session_windows"),
  ).toHaveLength(1);
});

it("rejects a conflict that names a conversation outside the request", async () => {
  api.invoke.mockResolvedValue({ status: "other", sessionId: "zzz", ownerWindowLabel: "owner" });
  const store = await import("./sessionWindowOwnership");
  await expect(store.claimRestoredSessions(["a"])).rejects.toThrow("unrequested");
  expect(claimCalls()).toHaveLength(1);
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
