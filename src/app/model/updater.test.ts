import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
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
  ask: mocks.ask,
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
  mocks.ask.mockResolvedValue(true);
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
  it("coalesces installs before version preflight resolves", async () => {
    mocks.downloadAndInstall.mockResolvedValue(undefined);
    const updater = await updaterWithPendingUpdate();
    let finish!: (version: string) => void;
    mocks.getVersion.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const first = updater.installPendingUpdate();
    const nextProgress = vi.fn();
    const second = updater.installPendingUpdate(nextProgress);
    finish("0.1.22");
    await Promise.all([first, second]);
    expect(mocks.downloadAndInstall).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(nextProgress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "current" }));
  });

  it("reports installed state with manual restart recovery when relaunch fails", async () => {
    mocks.downloadAndInstall.mockResolvedValue(undefined);
    mocks.relaunch.mockRejectedValueOnce(new Error("restart unavailable"));
    const updater = await updaterWithPendingUpdate();
    const result = await updater.installPendingUpdate();
    expect(result).toEqual(
      expect.objectContaining({
        phase: "error",
        currentVersion: "0.1.23",
        error: expect.stringContaining("Restart the app manually"),
      }),
    );
    expect(result.availableVersion).toBeUndefined();
    expect(mocks.remember).toHaveBeenCalledWith("0.1.23");
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("The update was installed"),
      expect.anything(),
    );
    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.downloadAndInstall).toHaveBeenCalledOnce();
  });
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
  it("coalesces a manual flow throughout delayed preflight and installation", async () => {
    mocks.updaterEnabled = true;
    let finish!: (version: string) => void;
    let installed!: () => void;
    mocks.getVersion.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.downloadAndInstall.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          installed = resolve;
        }),
    );
    mocks.check.mockResolvedValue({
      version: "0.1.23",
      downloadAndInstall: mocks.downloadAndInstall,
    });
    const updater = await import("./updater");
    const first = updater.runUpdateFlow(true);
    const second = updater.runUpdateFlow(true);
    finish("0.1.22");
    await vi.waitFor(() => expect(mocks.downloadAndInstall).toHaveBeenCalledOnce());
    const third = updater.runUpdateFlow(true);
    expect(mocks.ask).toHaveBeenCalledOnce();
    expect(mocks.check).toHaveBeenCalledOnce();
    installed();
    await Promise.all([first, second, third]);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });
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
