import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmInApp, registerAppConfirmHost, type AppConfirmRequest } from "./appConfirm";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
afterEach(() => {
  vi.unstubAllGlobals();
  mocks.ask.mockReset();
  mocks.isTauri.mockReset();
});

const request: AppConfirmRequest = {
  title: "Delete branch?",
  message: "“feature/x” will be deleted from this repository.",
  confirmLabel: "Delete branch",
  tone: "danger",
};

describe("confirmInApp", () => {
  it("hands the request to the registered host and returns its answer", async () => {
    const host = vi.fn(async () => true);
    const unregister = registerAppConfirmHost(host);
    expect(await confirmInApp(request)).toBe(true);
    expect(host).toHaveBeenCalledWith(request);
    host.mockResolvedValueOnce(false as never);
    expect(await confirmInApp(request)).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
    unregister();
  });

  it("only unregisters its own host", async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);
    const unregisterFirst = registerAppConfirmHost(first);
    const unregisterSecond = registerAppConfirmHost(second);
    unregisterFirst();
    await confirmInApp(request);
    expect(second).toHaveBeenCalledTimes(1);
    unregisterSecond();
  });

  it("falls back to the platform dialog with the request's wording when no host is mounted", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.ask.mockResolvedValue(true);
    expect(await confirmInApp(request)).toBe(true);
    expect(mocks.ask).toHaveBeenCalledWith(
      "“feature/x” will be deleted from this repository.",
      expect.objectContaining({
        title: "Delete branch?",
        kind: "warning",
        okLabel: "Delete branch",
        cancelLabel: "Cancel",
      }),
    );
  });

  it("uses an info sheet for a normal-tone request and the browser confirm outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.ask.mockResolvedValue(false);
    expect(await confirmInApp({ ...request, tone: "normal" })).toBe(false);
    expect(mocks.ask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "info" }),
    );
    mocks.isTauri.mockReturnValue(false);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    expect(await confirmInApp(request)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete branch?"));
  });
});
