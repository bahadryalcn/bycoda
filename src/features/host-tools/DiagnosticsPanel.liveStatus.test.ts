// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { hostFeatureRequest } from "../connections/model/hostFeatureClient";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

vi.mock("../connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: vi.fn(),
}));

it("announces measurement progress while keeping the sample timestamp out of live regions", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const sample = {
    at: Date.now(),
    host: { totalMemoryBytes: 1024, freeMemoryBytes: 512, logicalCpus: 8, loadAverage: null },
    process: { pid: 1, rssBytes: 128, heapUsedBytes: 64, cpuPercent: 5, uptimeSeconds: 1 },
  };
  vi.mocked(hostFeatureRequest)
    .mockResolvedValueOnce({
      samples: [{ ...sample, process: { ...sample.process, cpuPercent: null } }],
    })
    .mockResolvedValueOnce({ samples: [sample] });

  try {
    await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/repo" })));
    const status = () => container.querySelector(".resource-sample-status")!;
    const announcements = () =>
      Array.from(container.querySelectorAll('[role="status"], [aria-live]')).map(
        (region) => region.textContent,
      );

    await act(async () => container.querySelector("button")!.click());
    expect(announcements()).toContain("Measuring…");
    await act(async () => vi.advanceTimersByTimeAsync(1100));
    expect(status().textContent).toMatch(/\d/);
    expect(status().closest('[role="status"], [aria-live]')).toBeNull();
    expect(announcements()).not.toContain(status().textContent);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
