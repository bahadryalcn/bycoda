import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  remoteRequest,
} from "../../connections/model/connections";
import { readHostAccountQuota } from "./hostAccountQuota";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({
  cachedRemoteCapabilities: vi.fn(),
  loadRemoteCapabilities: vi.fn(),
  remoteRequest: vi.fn(),
}));

const method = "usage.quota.read";
const local = {
  id: "local",
  environmentId: "local-env",
  endpoint: "http://127.0.0.1:3776",
  localHost: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue([local]);
});

it("keeps native compatibility for an older Host", async () => {
  vi.mocked(loadRemoteCapabilities).mockResolvedValue(["usage.limits.read"]);
  await expect(readHostAccountQuota("claude", "default", "read")).resolves.toBeUndefined();
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("routes Pi and its freshness request only to the owning local Host", async () => {
  vi.mocked(invoke).mockResolvedValue([
    { ...local, id: "remote", endpoint: "https://example.invalid", environmentId: "remote-env" },
    local,
  ]);
  vi.mocked(cachedRemoteCapabilities).mockReturnValue([method]);
  const expected = { provider: "claude", status: "ok" };
  vi.mocked(remoteRequest).mockResolvedValue(expected);
  await expect(readHostAccountQuota("pi-anthropic", "default", "read", 300_000)).resolves.toBe(
    expected,
  );
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    method,
    { provider: "pi-anthropic", accountId: "default", intent: "read", maxAgeMs: 300_000 },
    false,
    false,
    "local-env",
  );
});

it("does not return a compatibility fallback when the owning Host rejects a read", async () => {
  vi.mocked(cachedRemoteCapabilities).mockReturnValue([method]);
  vi.mocked(remoteRequest).mockRejectedValue(new Error("Host connection retired"));
  await expect(readHostAccountQuota("codex", "work", "refresh")).rejects.toThrow(
    "Host connection retired",
  );
});
