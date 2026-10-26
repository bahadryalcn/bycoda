import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { inspectHarnessBinary, updateHarnessCli } from "../../../integrations/harness/core/child";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";

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
    expect(updateHarnessCli).toHaveBeenCalledWith("opencode", "2.1.3");
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

describe("OpenCode migration and V2 updates", () => {
  beforeEach(() => {
    vi.mocked(updateHarnessCli).mockReset().mockResolvedValue(undefined);
    vi.mocked(inspectHarnessBinary).mockReset();
    vi.mocked(refreshHarnessCatalogs).mockReset();
    vi.mocked(emit).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["1.18.33", "2.1.3"])(
    "updates %s to the displayed V2 target and waits for its model catalog",
    async (installed) => {
      const update = { harness: "opencode" as const, installed, latest: "2.1.4" };
      vi.mocked(inspectHarnessBinary).mockResolvedValueOnce({
        path: "/bin/opencode",
        version: "opencode v2.1.4",
      });
      let finishRefresh!: () => void;
      vi.mocked(refreshHarnessCatalogs).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      );

      const result = runHarnessUpdate(update);
      await settle();
      expect(updateHarnessCli).toHaveBeenCalledExactlyOnceWith("opencode", "2.1.4");
      expect(inspectHarnessBinary).toHaveBeenCalledExactlyOnceWith("opencode");
      expect(refreshHarnessCatalogs).toHaveBeenCalledExactlyOnceWith(["opencode"], { force: true });
      expect(getHarnessUpdateSnapshot().runs.opencode?.status).toBe("updating");
      expect(emit).not.toHaveBeenCalled();

      finishRefresh();
      await expect(result).resolves.toEqual({ status: "updated", version: "2.1.4" });
      expect(getHarnessUpdateSnapshot().runs.opencode).toEqual({
        status: "updated",
        version: "2.1.4",
      });
      expect(emit).toHaveBeenCalledExactlyOnceWith("harness-updated", {
        harness: "opencode",
        source: expect.any(String),
      });
    },
  );

  it("rejects an apparent migration success if the resolved CLI still reports V1", async () => {
    vi.mocked(inspectHarnessBinary).mockResolvedValueOnce({
      path: "/bin/opencode",
      version: "1.18.33",
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      runHarnessUpdate({
        harness: "opencode",
        installed: "1.18.33",
        latest: "2.1.4",
      }),
    ).resolves.toEqual({
      status: "failed",
      error: "opencode version check: Still on 1.18.33 after updating.",
    });
    expect(updateHarnessCli).toHaveBeenCalledExactlyOnceWith("opencode", "2.1.4");
    expect(getHarnessUpdateSnapshot().runs.opencode?.status).toBe("failed");
    expect(refreshHarnessCatalogs).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
