import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { HarnessId } from "../../sessions/model/session";
import {
  announceHarnessUpdated,
  checkHarnessVersions,
  fetchLatestHarnessVersion,
  findHarnessUpdates,
  isHarnessVersionBehind,
  onHarnessUpdated,
} from "./harnessUpdates";

const events = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
  return {
    emit: vi.fn(async (name: string, payload: unknown) => {
      listeners.get(name)?.forEach((listener) => listener({ payload }));
    }),
    listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(listener);
      listeners.set(name, handlers);
      return () => {
        handlers.delete(listener);
      };
    }),
  };
});
vi.mock("@tauri-apps/api/event", () => events);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const INSTALLED: Partial<Record<HarnessId, string>> = {
  claude: "2.1.284 (Claude Code)",
  codex: "codex-cli 0.159.2",
  opencode: "1.18.31",
  cursor: "2026.09.01-abc",
};

const LATEST: Partial<Record<HarnessId, string>> = {
  claude: "2.1.285",
  codex: "0.159.2",
  opencode: "1.18.33",
};

function find(harnesses: HarnessId[]) {
  return findHarnessUpdates({
    harnesses,
    installedVersion: async (id) => INSTALLED[id],
    latestVersion: async (id) => {
      const version = LATEST[id];
      if (!version) throw new Error("offline");
      return version;
    },
  });
}

describe("harness update check", () => {
  it.each([
    ["1.18.33", "2.1.4"],
    ["opencode v2.0.18", "2.0.26"],
  ])("offers updates and major migration when OpenCode reports %s", async (installed, latest) => {
    const latestVersion = vi.fn(async () => latest);
    expect(
      await findHarnessUpdates({
        harnesses: ["opencode"],
        installedVersion: async () => installed,
        latestVersion,
      }),
    ).toEqual([{ harness: "opencode", installed: installed.replace("opencode v", ""), latest }]);
    expect(latestVersion).toHaveBeenCalledExactlyOnceWith(
      "opencode",
      installed.replace("opencode v", ""),
    );
  });

  it("passes the installed version to the native release-feed lookup", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("1.19.0");
    await expect(fetchLatestHarnessVersion("opencode", "1.18.33")).resolves.toBe("1.19.0");
    expect(invoke).toHaveBeenCalledWith("harness_latest_version", {
      provider: "opencode",
      installedVersion: "1.18.33",
    });
  });

  it("does not guess a release channel when the installed version is invalid", async () => {
    const latestVersion = vi.fn(async () => "2.1.4");
    await expect(
      checkHarnessVersions({
        harnesses: ["opencode"],
        installedVersion: async () => "invalid",
        latestVersion,
      }),
    ).resolves.toEqual([
      { harness: "opencode", status: "unknown", error: "The CLI reported no version." },
    ]);
    expect(latestVersion).not.toHaveBeenCalled();
  });

  it("reports only harnesses behind the published release", async () => {
    expect(await find(["claude", "codex", "opencode"])).toEqual([
      {
        harness: "claude",
        installed: "2.1.284",
        latest: "2.1.285",
      },
      {
        harness: "opencode",
        installed: "1.18.31",
        latest: "1.18.33",
      },
    ]);
  });

  it("skips harnesses without a version feed or whose lookup fails", async () => {
    expect(await find(["cursor", "pi", "hermes", "antigravity"])).toEqual([]);
  });

  it("offers a harness still behind again, at the newest release", async () => {
    expect(await find(["claude"])).toMatchObject([{ latest: "2.1.285" }]);

    LATEST.claude = "2.1.286";
    try {
      expect(await find(["claude"])).toMatchObject([
        { harness: "claude", installed: "2.1.284", latest: "2.1.286" },
      ]);
    } finally {
      LATEST.claude = "2.1.285";
    }
  });
});

describe("per-harness version check", () => {
  const installed: Partial<Record<HarnessId, string>> = {
    cursor: "2026.09.18-9a7762b",
    grok: "grok 1.0.46 (4220f3b224a6) [stable]",
    fx: "fx v0.0.13-e3ad6d8 [dev]",
    omp: "omp/18.4.8",
    pi: "no version here",
  };
  const latest: Partial<Record<HarnessId, string>> = {
    cursor: "2026.09.28-64d2043",
    grok: "1.0.46",
    fx: "v0.0.12",
    pi: "0.80.0",
  };

  it("reports each harness as behind, current or unknown", async () => {
    const checks = await checkHarnessVersions({
      harnesses: ["cursor", "grok", "fx", "omp", "pi", "hermes"],
      installedVersion: async (id) => installed[id],
      latestVersion: async (id) => {
        const version = latest[id];
        if (!version) throw new Error("registry unreachable");
        return version;
      },
    });
    expect(checks).toEqual([
      {
        harness: "cursor",
        status: "behind",
        installed: "2026.09.18-9a7762b",
        latest: "2026.09.28-64d2043",
      },
      { harness: "grok", status: "current", installed: "1.0.46", latest: "1.0.46" },
      // A dev build ahead of the stable feed is not offered a downgrade.
      { harness: "fx", status: "current", installed: "0.0.13", latest: "0.0.12" },
      { harness: "omp", status: "unknown", error: "registry unreachable" },
      { harness: "pi", status: "unknown", error: "The CLI reported no version." },
    ]);
  });
});

it("compares Cursor builds from the same day by their full build", () => {
  expect(isHarnessVersionBehind("cursor", "2026.09.28-9a7762b", "2026.09.28-64d2043")).toBe(true);
  expect(isHarnessVersionBehind("cursor", "2026.09.28-64d2043", "2026.09.28-64d2043")).toBe(false);
  expect(isHarnessVersionBehind("cursor", "2026.10.01-1111111", "2026.09.28-64d2043")).toBe(false);
  // Other harnesses compare release numbers only.
  expect(isHarnessVersionBehind("grok", "1.0.46", "1.0.46")).toBe(false);
});

it("delivers updates to other windows while skipping the sender and respecting cleanup", async () => {
  // A fresh module instance represents another window's separate JS runtime.
  vi.resetModules();
  const otherWindow = await import("./harnessUpdates");
  const localRefresh = vi.fn();
  const remoteRefresh = vi.fn();
  const stopLocal = await onHarnessUpdated(localRefresh);
  const stopRemote = await otherWindow.onHarnessUpdated(remoteRefresh);
  try {
    await announceHarnessUpdated("claude");
    expect(localRefresh).not.toHaveBeenCalled();
    expect(remoteRefresh).toHaveBeenCalledExactlyOnceWith("claude");

    await otherWindow.announceHarnessUpdated("codex");
    expect(localRefresh).toHaveBeenCalledExactlyOnceWith("codex");
    expect(remoteRefresh).toHaveBeenCalledTimes(1);

    stopLocal();
    await otherWindow.announceHarnessUpdated("opencode");
    expect(localRefresh).toHaveBeenCalledTimes(1);
    expect(remoteRefresh).toHaveBeenCalledTimes(1);
  } finally {
    stopLocal();
    stopRemote();
  }
});
