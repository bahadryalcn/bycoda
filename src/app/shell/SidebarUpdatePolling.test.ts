// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarUpdateFooter } from "./SidebarUpdate";

const mocks = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("../model/updater", () => ({
  probeForUpdate: mocks.probe,
  readAppVersion: async () => "0.8.33",
  installPendingUpdate: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("checks periodically, preserves available updates, and clears its timer on unmount", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.probe.mockResolvedValueOnce(null).mockResolvedValue({ version: "0.8.34" });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SidebarUpdateFooter)));
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Update to 0.8.34");
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
    expect(mocks.probe).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
  }
  // The update prompt can schedule exit animations; only update polling must stop.
  await act(async () => vi.advanceTimersByTimeAsync(30 * 60 * 1000));
  expect(mocks.probe).toHaveBeenCalledTimes(3);
});
