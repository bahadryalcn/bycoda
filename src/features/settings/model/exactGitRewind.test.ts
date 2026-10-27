import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mock.remote }));
import { getExactGitRewindEnabled, loadExactGitRewind, saveExactGitRewind } from "./exactGitRewind";

beforeEach(() => {
  mock.invoke.mockReset().mockResolvedValue({ id: "local-fixture" });
  mock.remote.mockReset().mockResolvedValue({ enabled: false });
});

it("reads the execution Host policy and writes explicit boolean owner requests", async () => {
  expect(await loadExactGitRewind()).toBe(false);
  expect(mock.invoke).toHaveBeenCalledWith("local_host_connect");
  expect(mock.remote).toHaveBeenLastCalledWith(
    "local-fixture",
    "workspaces.exactGitRewind.get",
    {},
  );
  mock.remote.mockResolvedValue({ enabled: true });
  expect(await saveExactGitRewind(true)).toBe(true);
  expect(mock.remote).toHaveBeenLastCalledWith("local-fixture", "workspaces.exactGitRewind.set", {
    enabled: true,
  });
});

it.each([null, { enabled: "true" }, {}])(
  "treats unavailable or invalid policy %j as disabled for ordinary sends",
  async (response) => {
    mock.remote.mockResolvedValue(response);
    expect(await getExactGitRewindEnabled()).toBe(false);
    await expect(loadExactGitRewind()).rejects.toThrow("invalid setting");
  },
);

it("keeps Host failures visible in Settings while ordinary sends remain available", async () => {
  mock.invoke.mockResolvedValue(null);
  await expect(loadExactGitRewind()).rejects.toThrow("local Host is unavailable");
  expect(await getExactGitRewindEnabled()).toBe(false);
  expect(mock.remote).not.toHaveBeenCalled();
  mock.invoke.mockResolvedValue({ id: "local-fixture" });
  mock.remote.mockRejectedValue(new Error("Synthetic Host offline"));
  await expect(saveExactGitRewind(true)).rejects.toThrow("Synthetic Host offline");
  expect(await getExactGitRewindEnabled()).toBe(false);
});
