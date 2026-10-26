// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHarnessUpdateSnapshot } from "../model/harnessUpdateActions";
import { HarnessUpdateNotice } from "./HarnessUpdateNotice";
import { updateHarnessCli } from "../../../integrations/harness/core/child";

let claimed = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: { provider: string }) => {
    if (command === "harness_update_check_claim") {
      const first = !claimed;
      claimed = true;
      return first;
    }
    if (command === "harness_latest_version")
      return args?.provider === "opencode" ? "2.0.26" : "2.1.285";
    throw new Error(`unexpected ${command}`);
  }),
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: vi.fn(async () => undefined),
  isHarnessAvailable: (id: string) => ["claude", "codex", "opencode"].includes(id),
}));
let installed = "2.1.284 (Claude Code)";
let openCodeInstalled = "opencode v2.0.18";
vi.mock("../../../integrations/harness/core/child", () => ({
  inspectHarnessBinary: vi.fn(async (provider: string) => ({
    path: `/bin/${provider}`,
    version: provider === "opencode" ? openCodeInstalled : installed,
  })),
  updateHarnessCli: vi.fn(async (provider: string) => {
    if (provider === "opencode") openCodeInstalled = "opencode v2.0.26";
    else installed = "2.1.285 (Claude Code)";
  }),
}));
vi.mock("../../sessions/model/models", () => ({
  isPickerProviderVisible: (id: string) => id !== "codex",
}));
const refreshHarnessCatalogs = vi.fn(async () => undefined);
vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: (...args: unknown[]) => refreshHarnessCatalogs(...(args as [])),
}));
const eventListeners = new Set<(event: { payload: unknown }) => void>();
const emit = vi.fn(async (_event: string, payload: unknown) => {
  eventListeners.forEach((listener) => listener({ payload }));
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload: unknown) => emit(event, payload),
  listen: vi.fn(async (_event: string, listener: (event: { payload: unknown }) => void) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  }),
}));
vi.mock("../../sessions/ui/HarnessIcon", () => ({ HarnessIcon: () => null }));

describe("HarnessUpdateNotice", () => {
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("survives a StrictMode remount and updates from the card", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(HarnessUpdateNotice)));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const notice = document.body.querySelector('[aria-label="Harness updates"]');
    expect(notice?.textContent).toContain("Claude Code");
    expect(notice?.textContent).toContain("2.1.284 → 2.1.285");
    expect(notice?.textContent).toContain("OpenCode");
    expect(notice?.textContent).toContain("2.0.18 → 2.0.26");
    // Hidden from the picker, so left out of the toast but kept for Settings.
    expect(notice?.textContent).not.toContain("Codex");
    expect(getHarnessUpdateSnapshot().checks?.map((check) => check.harness)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);

    const update = Array.from(notice!.querySelectorAll("button")).find(
      (button) => button.textContent === "Update",
    )!;
    await act(async () => {
      update.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(notice?.textContent).toContain("Updated to 2.1.285");
    expect(getHarnessUpdateSnapshot().checks?.[0]).toMatchObject({
      harness: "claude",
      status: "current",
      installed: "2.1.285",
    });
    expect(refreshHarnessCatalogs).toHaveBeenCalledWith(["claude"], {
      force: true,
    });
    expect(refreshHarnessCatalogs).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("harness-updated", {
      harness: "claude",
      source: expect.any(String),
    });
    expect(notice?.textContent).toContain("Model picker refreshed");
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(document.body.contains(notice)).toBe(true);
    vi.useRealTimers();
    await act(async () => {
      await emit("harness-updated", {
        harness: "claude",
        source: "other-window",
      });
    });
    expect(refreshHarnessCatalogs).toHaveBeenCalledTimes(2);
    expect(refreshHarnessCatalogs).toHaveBeenLastCalledWith(["claude"], {
      force: true,
    });
    const openCodeRow = Array.from(notice!.querySelectorAll("article")).find((row) =>
      row.textContent?.includes("OpenCode"),
    )!;
    vi.mocked(updateHarnessCli).mockRejectedValueOnce(new Error("Upgrade failed for bun"));
    await act(async () => {
      openCodeRow.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(openCodeRow.textContent).toContain("Upgrade failed for bun");
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(document.body.contains(notice)).toBe(true);
    await act(async () => {
      openCodeRow.querySelector("button")!.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(openCodeRow.textContent).toContain("Updated to 2.0.26");
    expect(
      getHarnessUpdateSnapshot().checks?.find((check) => check.harness === "opencode"),
    ).toMatchObject({
      status: "current",
      installed: "2.0.26",
      latest: "2.0.26",
    });
    expect(refreshHarnessCatalogs).toHaveBeenLastCalledWith(["opencode"], { force: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(document.body.contains(notice)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(document.body.contains(notice)).toBe(false);
    act(() => root.unmount());
  });

  it("dismisses while OpenCode is updating and keeps the shared update running", async () => {
    vi.resetModules();
    claimed = false;
    installed = "2.1.284 (Claude Code)";
    openCodeInstalled = "opencode v2.0.18";
    const { HarnessUpdateNotice: Notice } = await import("./HarnessUpdateNotice");
    const { getHarnessUpdateSnapshot: snapshot } = await import("../model/harnessUpdateActions");
    const { updateHarnessCli: updateCli } =
      await import("../../../integrations/harness/core/child");
    let finishUpdate!: () => void;
    vi.mocked(updateCli).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUpdate = () => {
            openCodeInstalled = "opencode v2.0.26";
            resolve();
          };
        }),
    );
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Notice)));
      const notice = document.body.querySelector('[aria-label="Harness updates"]')!;
      const row = Array.from(notice.querySelectorAll("article")).find((item) =>
        item.textContent?.includes("OpenCode"),
      )!;
      await act(async () => row.querySelector("button")!.click());
      expect(snapshot().runs.opencode?.status).toBe("updating");
      expect(row.querySelector("button")!.disabled).toBe(true);

      const dismiss = notice.querySelector<HTMLButtonElement>('[aria-label="Dismiss notice"]')!;
      expect(dismiss.disabled).toBe(false);
      await act(async () => dismiss.click());
      expect(document.body.contains(notice)).toBe(false);
      expect(snapshot().runs.opencode?.status).toBe("updating");

      await act(async () => finishUpdate());
      expect(snapshot().runs.opencode).toEqual({ status: "updated", version: "2.0.26" });
      expect(document.body.querySelector('[aria-label="Harness updates"]')).toBeNull();
      await act(async () => {
        root.render(null);
      });
      await act(async () => root.render(createElement(Notice)));
      expect(document.body.querySelector('[aria-label="Harness updates"]')).toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });
});
