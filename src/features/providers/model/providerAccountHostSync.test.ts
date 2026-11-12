// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
import { startProviderAccountHostSync } from "./providerAccountHostSync";
import { saveProviderAccount, providerAccounts, editProviderAccount } from "./providerAccounts";
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
it("pushes kind and explicitly clears it with Automatic", async () => {
  stop = startProviderAccountHostSync();
  await flush();
  expect(mocks.request.mock.calls[0]?.[2].providerAccountStyles.codex["account-a"]).toMatchObject({
    kind: "work",
    derivedKind: "personal",
  });
  editProviderAccount("codex", "account-a", { label: "A", color: "coral" });
  await flush();
  const style = mocks.request.mock.calls.at(-1)?.[2].providerAccountStyles.codex["account-a"];
  expect(style).not.toHaveProperty("kind");
  expect(style.derivedKind).toBe("personal");
});
it("applies inbound kind and clearing without echoing or changing defaults", async () => {
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
  expect(providerAccounts("codex").find((a) => a.id === "account-a")?.kind).toBeUndefined();
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
