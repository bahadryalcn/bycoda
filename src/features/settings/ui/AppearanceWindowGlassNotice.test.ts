// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncNativeGlass } from "../model/appearance";
import { AppearancePage } from "./AppearanceSettings";
import { useAppearanceSettings } from "./useAppearanceSettings";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: vi.fn() }) }));
vi.mock("../model/newThreadBackgroundEffects", () => ({
  applyPreparedNewThreadBackground: vi.fn(),
  clearPreparedNewThreadBackground: vi.fn(),
}));
vi.mock("../../projects/model/chatBackground", () => ({
  pickAndSaveChatBackground: vi.fn(),
  removeChatBackground: vi.fn(),
}));

const NOTICE = "Restart bycoda to apply the window glass change.";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

function Page() {
  return createElement(AppearancePage, { appearance: useAppearanceSettings() });
}

async function settleGlass(restartRequired: boolean) {
  invoke.mockResolvedValue({ applied: !restartRequired, restartRequired });
  await act(async () => {
    syncNativeGlass("dark");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  localStorage.clear();
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Page)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("window glass restart notice", () => {
  it("is hidden until the window must restart to apply the saved setting", async () => {
    expect(container.textContent).not.toContain(NOTICE);
    await settleGlass(true);
    expect(container.textContent).toContain(NOTICE);
    await settleGlass(false);
    expect(container.textContent).not.toContain(NOTICE);
  });

  it("restarts through the app quit run and offers a retry when that fails", async () => {
    await settleGlass(true);
    const restartButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        ["Restart now", "Retry"].includes(button.textContent?.trim() ?? ""),
      );
    invoke.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => {
      restartButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).toHaveBeenLastCalledWith("request_app_restart");
    expect(container.textContent).toContain("bycoda could not restart.");
    expect(restartButton()?.textContent?.trim()).toBe("Retry");

    invoke.mockResolvedValueOnce(undefined);
    await act(async () => {
      restartButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).toHaveBeenLastCalledWith("request_app_restart");
    expect(container.textContent).toContain(NOTICE);
  });
});
