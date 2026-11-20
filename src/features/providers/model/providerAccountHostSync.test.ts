// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
import { startProviderAccountHostSync } from "./providerAccountHostSync";
import { saveProviderAccount, providerAccounts, editProviderAccount } from "./providerAccounts";
import { announceRemoteRecovery } from "../../connections/model/remoteHealth";
let stop: (() => void) | undefined;
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  mocks.request.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (method: string) =>
    method === "local_host_connect" ? { id: "local" } : { organization: "Pat's Organization" },
  );
  mocks.request.mockResolvedValue({});
  saveProviderAccount({
    provider: "codex",
    id: "account-a",
    label: "A",
    kind: "work",
    color: "coral",
  });
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});
it("publishes account styles on recovery when the Host was unavailable at mount", async () => {
  let connected = false;
  mocks.invoke.mockImplementation(async (method: string) =>
    method === "local_host_connect" && connected ? { id: "local" } : null,
  );
  stop = startProviderAccountHostSync();
  await flush();
  expect(mocks.request).not.toHaveBeenCalled();

  connected = true;
  announceRemoteRecovery("local-env");
  await flush();
  expect(mocks.request).toHaveBeenCalledWith(
    "local",
    "host.settings.save",
    {
      providerAccountStyles: expect.objectContaining({
        codex: expect.objectContaining({ "account-a": expect.objectContaining({ label: "A" }) }),
      }),
    },
    false,
    true,
  );
});
it("pushes the saved kind and preserves it on a metadata edit without a kind", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  expect(mocks.request.mock.calls[0]?.[2].providerAccountStyles.codex["account-a"]).toMatchObject({
    kind: "work",
  });
  editProviderAccount("codex", "account-a", { label: "A", color: "coral" });
  await flush();
  const style = mocks.request.mock.calls.at(-1)?.[2].providerAccountStyles.codex["account-a"];
  expect(style.kind).toBe("work");
});
it("publishes a detected Team account as Work on startup", async () => {
  saveProviderAccount({ id: "account-team", provider: "claude", label: "Studio" });
  mocks.invoke.mockImplementation(async (method: string, args?: { accountId: string }) =>
    method === "local_host_connect"
      ? { id: "local" }
      : args?.accountId === "account-team"
        ? { plan: "Team" }
        : null,
  );
  stop = startProviderAccountHostSync();
  await flush();
  expect(providerAccounts("claude").find((a) => a.id === "account-team")?.kind).toBe("work");
  expect(
    mocks.request.mock.calls[0]?.[2].providerAccountStyles.claude["account-team"],
  ).toMatchObject({
    kind: "work",
  });
});
it("applies inbound kind and preserves it if a legacy Host omits it", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  const original = providerAccounts("codex").map((a) => [a.id, a.isDefault]);
  mocks.request.mockResolvedValue({
    providerAccountStyles: {
      codex: { "account-a": { label: "Remote", color: "teal", kind: "personal" } },
    },
  });
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  expect(providerAccounts("codex").find((a) => a.id === "account-a")).toMatchObject({
    label: "Remote",
    color: "teal",
    kind: "personal",
  });
  mocks.request.mockResolvedValue({
    providerAccountStyles: { codex: { "account-a": { label: "Remote", color: "teal" } } },
  });
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  expect(providerAccounts("codex").find((a) => a.id === "account-a")?.kind).toBe("personal");
  expect(providerAccounts("codex").map((a) => [a.id, a.isDefault])).toEqual(original);
  expect(mocks.request.mock.calls.filter((call) => call[1] === "host.settings.save")).toHaveLength(
    1,
  );
});
it("fences stale reads after a local edit and ignores older Hosts", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementation((_id, method) =>
    method === "host.settings.get"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({}),
  );
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  editProviderAccount("codex", "account-a", { label: "Local", kind: "work" });
  await flush();
  resolve({
    providerAccountStyles: { codex: { "account-a": { label: "Stale", kind: "personal" } } },
  });
  await flush();
  expect(providerAccounts("codex").find((a) => a.id === "account-a")).toMatchObject({
    label: "Local",
    kind: "work",
  });
  mocks.request.mockResolvedValue({});
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  expect(providerAccounts("codex").find((a) => a.id === "account-a")?.kind).toBe("work");
});

it("publishes the selected provider default for Automatic delegation", async () => {
  const { setDefaultProviderAccount } = await import("./providerAccounts");
  setDefaultProviderAccount("codex", "account-a");
  stop = startProviderAccountHostSync();
  await flush();
  expect(mocks.request.mock.calls[0]?.[2].providerAccountStyles.codex["account-a"].isDefault).toBe(
    true,
  );
});

function hostReads() {
  return mocks.request.mock.calls.filter((call) => call[1] === "host.settings.get").length;
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}
afterEach(() => setHidden(false));

it("backs off while reads find nothing and resets after an applied change", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  await vi.advanceTimersByTimeAsync(5000);
  expect(hostReads()).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(hostReads()).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(hostReads()).toBe(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(hostReads()).toBeLessThanOrEqual(4);
  mocks.request.mockResolvedValue({
    providerAccountStyles: { codex: { "account-a": { label: "Remote", kind: "work" } } },
  });
  await vi.advanceTimersByTimeAsync(60_000);
  const applied = hostReads();
  await vi.advanceTimersByTimeAsync(5000);
  await flush();
  expect(hostReads()).toBe(applied + 1);
});

it("reads nothing while hidden and catches up on visibility and focus", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  setHidden(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(hostReads()).toBe(0);
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(hostReads()).toBe(1);
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(hostReads()).toBe(2);
});

it("stops reading after the sync is stopped", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  stop();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(300_000);
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(hostReads()).toBe(0);
});
