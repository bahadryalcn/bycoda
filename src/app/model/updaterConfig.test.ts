import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getIdentifier, getVersion, check, message, ask, relaunch } = vi.hoisted(() => ({
  getIdentifier: vi.fn(),
  getVersion: vi.fn(),
  check: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  relaunch: vi.fn(),
}));

const identity = vi.hoisted(() => ({
  displayName: "bycoda",
  updaterEnabled: true,
  repositoryUrl: null as string | null,
}));
vi.mock("../../shared/lib/productIdentity", () => ({ PRODUCT_IDENTITY: identity }));

vi.mock("@tauri-apps/api/app", () => ({ getIdentifier, getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask, message }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("../../features/settings/model/sounds", () => ({
  announceUpdateAvailable: vi.fn(),
}));

import { probeForUpdate, runUpdateFlow } from "./updater";

describe("updater", () => {
  beforeEach(() => {
    identity.updaterEnabled = true;
    identity.repositoryUrl = null;
    getIdentifier.mockResolvedValue("com.bycoda.desktop");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    "com.bycoda.desktop.dev",
    "com.other.desktop",
    "com.bycoda.desktop.fork",
    "com.unknown.desktop",
  ])("never contacts the release feed from %s", async (identifier) => {
    getIdentifier.mockResolvedValue(identifier);
    getVersion.mockResolvedValue("0.6.0");

    await expect(probeForUpdate()).resolves.toBeNull();
    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.6.0",
    });
    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "idle",
    });
    expect(check).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledOnce();
  });

  it("checks only an explicitly enabled independent installed product", async () => {
    getIdentifier.mockResolvedValue("com.bycoda.desktop");
    check.mockResolvedValue(null);
    await expect(probeForUpdate()).resolves.toBeNull();
    expect(check).toHaveBeenCalledOnce();
  });

  it("treats an unreadable identifier as updates disabled", async () => {
    getIdentifier.mockRejectedValue(new Error("no tauri"));
    getVersion.mockResolvedValue("0.6.0");

    await expect(probeForUpdate()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("keeps automatic checks quiet when updater endpoints are missing", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(new Error("Updater does not have any endpoints set"));

    await expect(runUpdateFlow(false)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("reports disabled updates without an inherited release URL", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(new Error("Updater does not have any endpoints set"));

    await expect(runUpdateFlow(true)).resolves.toEqual({
      phase: "idle",
      currentVersion: "0.1.23",
    });
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("Automatic updates are disabled"),
      { title: "bycoda" },
    );
  });

  it("never probes a feed while independent updates are disabled", async () => {
    identity.updaterEnabled = false;
    await expect(probeForUpdate()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("still reports real updater failures", async () => {
    getVersion.mockResolvedValue("0.1.23");
    check.mockRejectedValue(new Error("network failed"));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "network failed",
    });
    expect(message).toHaveBeenCalledOnce();
  });
});
