import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  getIdentifier: vi.fn(),
  getVersion: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
  remember: vi.fn(),
  updaterEnabled: false,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getIdentifier: mocks.getIdentifier,
  getVersion: mocks.getVersion,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: mocks.message,
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../../features/settings/model/sounds", () => ({
  announceUpdateAvailable: mocks.announce,
}));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));
vi.mock("../../shared/lib/productIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/lib/productIdentity")>();
  return {
    ...actual,
    PRODUCT_IDENTITY: {
      ...actual.PRODUCT_IDENTITY,
      get updaterEnabled() {
        return mocks.updaterEnabled;
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.updaterEnabled = false;
  mocks.getIdentifier.mockResolvedValue("com.bycoda.desktop");
  mocks.getVersion.mockResolvedValue("0.1.22");
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.message.mockResolvedValue(undefined);
});

async function updaterWithPendingUpdate() {
  mocks.updaterEnabled = true;
  mocks.getIdentifier.mockResolvedValue("com.bycoda.desktop");
  const update = {
    version: "0.1.23",
    downloadAndInstall: mocks.downloadAndInstall,
  };
  mocks.check.mockResolvedValue(update);
  const updater = await import("./updater");
  await updater.probeForUpdate();
  return updater;
}

describe("installPendingUpdate", () => {
  it("records a successful installation before relaunching", async () => {
    mocks.downloadAndInstall.mockResolvedValue(undefined);
    const updater = await updaterWithPendingUpdate();

    await updater.installPendingUpdate();

    expect(mocks.remember).toHaveBeenCalledWith("0.1.23");
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.remember.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relaunch.mock.invocationCallOrder[0]!,
    );
  });

  it("does not record or relaunch after installation fails", async () => {
    mocks.downloadAndInstall.mockRejectedValue(new Error("install failed"));
    const updater = await updaterWithPendingUpdate();

    const result = await updater.installPendingUpdate();

    expect(result.phase).toBe("error");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("does not record when no update is pending", async () => {
    mocks.updaterEnabled = true;
    mocks.getIdentifier.mockResolvedValue("com.bycoda.desktop");
    const updater = await import("./updater");

    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});

describe("disabled updater", () => {
  it("ships with the signed release feed enabled", async () => {
    const actual = await vi.importActual<typeof import("../../shared/lib/productIdentity")>(
      "../../shared/lib/productIdentity",
    );
    expect(actual.PRODUCT_IDENTITY.updaterEnabled).toBe(true);
  });

  it("does not check, install, or relaunch when updates are disabled", async () => {
    const actual = await vi.importActual<typeof import("../../shared/lib/productIdentity")>(
      "../../shared/lib/productIdentity",
    );
    // Even an otherwise eligible identity must respect a disabled build flag.
    mocks.getIdentifier.mockResolvedValue("com.bycoda.desktop");
    const updater = await import("./updater");

    expect(await updater.isUpdaterEnabled()).toBe(false);
    expect(await updater.probeForUpdate()).toBeNull();
    expect((await updater.runUpdateFlow(true)).phase).toBe("idle");
    expect((await updater.installPendingUpdate()).phase).toBe("idle");

    expect(mocks.message).toHaveBeenCalledWith(updater.UPDATES_DISABLED_MESSAGE, {
      title: actual.PRODUCT_IDENTITY.displayName,
    });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
