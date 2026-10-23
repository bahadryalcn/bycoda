import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectHarnessBinary, updateHarnessCli } from "../../../integrations/harness/core/child";

const probe = vi.hoisted(() => {
  const finishers: Array<() => void> = [];
  return {
    finishers,
    probeHarnessAvailability: vi.fn(() => new Promise<void>((resolve) => finishers.push(resolve))),
  };
});
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: probe.probeHarnessAvailability,
  isHarnessAvailable: () => false,
}));
vi.mock("../../../integrations/harness/core/child", () => ({
  inspectHarnessBinary: vi.fn(),
  updateHarnessCli: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn() }));

import {
  checkInstalledHarnessVersions,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
} from "./harnessUpdateActions";

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("installed harness check", () => {
  it("exposes a failed availability probe and clears the error on retry", async () => {
    probe.probeHarnessAvailability.mockRejectedValueOnce(new Error("Probe failed"));
    await expect(checkInstalledHarnessVersions()).rejects.toThrow("Probe failed");
    expect(getHarnessUpdateSnapshot()).toMatchObject({
      checking: false,
      error: "Probe failed",
    });
    const retry = checkInstalledHarnessVersions();
    expect(getHarnessUpdateSnapshot().error).toBeNull();
    probe.finishers.shift()!();
    await retry;
    expect(getHarnessUpdateSnapshot()).toMatchObject({
      checking: false,
      error: null,
    });
  });
  afterEach(() => {
    probe.finishers.length = 0;
    probe.probeHarnessAvailability.mockClear();
  });

  it("shares a running check but runs a forced one after it", async () => {
    const first = checkInstalledHarnessVersions();
    const shared = checkInstalledHarnessVersions();
    const forced = checkInstalledHarnessVersions({ force: true });
    expect(probe.probeHarnessAvailability).toHaveBeenCalledTimes(1);
    expect(probe.probeHarnessAvailability).toHaveBeenLastCalledWith(undefined);

    probe.finishers.shift()!();
    await Promise.all([first, shared]);
    await settle();
    expect(probe.probeHarnessAvailability).toHaveBeenCalledTimes(2);
    expect(probe.probeHarnessAvailability).toHaveBeenLastCalledWith({
      force: true,
    });

    probe.finishers.shift()!();
    await expect(forced).resolves.toEqual([]);
  });
});

describe("update failure diagnostics", () => {
  const update = { harness: "opencode" as const, installed: "2.1.1", latest: "2.1.3" };

  afterEach(() => vi.restoreAllMocks());

  it("preserves the version probe error rather than claiming the old version is still installed", async () => {
    vi.mocked(updateHarnessCli).mockResolvedValueOnce(undefined);
    vi.mocked(inspectHarnessBinary).mockResolvedValueOnce({
      path: "/bin/opencode",
      error: "Failed to run opencode: access denied",
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(runHarnessUpdate(update)).resolves.toEqual({
      status: "failed",
      error: "opencode version check: Failed to run opencode: access denied",
    });
    expect(warning).toHaveBeenCalledWith(
      "[bycoda] Harness update failed: opencode version check: Failed to run opencode: access denied",
    );
  });

  it("distinguishes an updater failure from a version-check failure", async () => {
    vi.mocked(updateHarnessCli).mockRejectedValueOnce("Could not detect the installation method");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(runHarnessUpdate(update)).resolves.toEqual({
      status: "failed",
      error: "opencode updater: Could not detect the installation method",
    });
  });
});
