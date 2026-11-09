import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAppConfirmHost } from "../../../shared/model/appConfirm";
import { confirmSessionDelete, sessionDeleteRequest } from "./confirmSessionDelete";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.ask.mockReset();
});

describe("session deletion confirmation without a host", () => {
  it("denies instead of using a native or WebView dialog in the desktop app", async () => {
    mocks.isTauri.mockReturnValue(true);
    const confirm = vi.fn(() => {
      throw new Error("WebView confirm must not run");
    });
    vi.stubGlobal("window", { confirm });
    expect(await confirmSessionDelete({ count: 9 })).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("denies in the web preview without a registered host", async () => {
    mocks.isTauri.mockReturnValue(false);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    expect(await confirmSessionDelete({ count: 1 })).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("session deletion dialog wording", () => {
  it("uses singular wording with the conversation name", () => {
    const request = sessionDeleteRequest({ count: 1, title: "Fix login" });
    expect(request.title).toBe("Delete conversation?");
    expect(request.message).toBe(
      "“Fix login” and its history will be permanently deleted. This can’t be undone.",
    );
    expect(request.confirmLabel).toBe("Delete");
    expect(request.tone).toBe("danger");
  });
  it("uses plural wording with the count and the skipped running conversations", () => {
    const request = sessionDeleteRequest({ count: 3, skippedRunning: 2 });
    expect(request.title).toBe("Delete 3 conversations?");
    expect(request.message).toBe(
      "3 conversations and their history will be permanently deleted. This can’t be undone. 2 running conversations will be skipped.",
    );
    expect(request.confirmLabel).toBe("Delete 3 conversations");
  });
  it("shortens very long names", () => {
    const request = sessionDeleteRequest({ count: 1, title: "x".repeat(200) });
    expect(String(request.message)).toContain(`${"x".repeat(79)}…`);
    expect(String(request.message)).not.toContain("x".repeat(81));
  });
  it("routes through the registered in-app host instead of a platform dialog", async () => {
    mocks.isTauri.mockReturnValue(true);
    const host = vi.fn(async () => true);
    const unregister = registerAppConfirmHost(host);
    expect(await confirmSessionDelete({ count: 2 })).toBe(true);
    expect(host).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Delete 2 conversations?" }),
    );
    expect(mocks.ask).not.toHaveBeenCalled();
    host.mockResolvedValueOnce(false as never);
    expect(await confirmSessionDelete("Delete 4 conversations? This can’t be undone.")).toBe(false);
    expect(host).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Delete 4 conversations?" }),
    );
    unregister();
    expect(await confirmSessionDelete({ count: 1 })).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
