// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
vi.mock("../connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: vi.fn(),
  hostToolRequest: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const sample = {
  at: Date.now(),
  host: { totalMemoryBytes: 1024, freeMemoryBytes: 512, logicalCpus: 8, loadAverage: null },
  process: { pid: 1, rssBytes: 128, heapUsedBytes: 64, cpuPercent: null, uptimeSeconds: 1 },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(hostFeatureRequest).mockReset();
  vi.mocked(hostToolRequest).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("samples only on request and offers retry after a failed read", async () => {
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/repo" })));
  expect(hostFeatureRequest).not.toHaveBeenCalled();
  expect(container.querySelector(".resource-cards")).toBeNull();
  expect(container.querySelector(".resource-system-memory")).toBeNull();
  expect(container.textContent).toContain("Take a sample to start the charts.");
  vi.mocked(hostFeatureRequest)
    .mockRejectedValueOnce(new Error("Host offline"))
    .mockResolvedValueOnce({ samples: [sample] })
    .mockResolvedValueOnce({
      samples: [{ ...sample, process: { ...sample.process, cpuPercent: 2.5 } }],
    });
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Host offline");
  expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Retry");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Measuring…");
  await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(container.textContent).toContain("2.5%");
  expect(container.querySelectorAll(".resource-chart")).toHaveLength(2);
  expect(container.querySelector("button")!.disabled).toBe(false);
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
});

it("cancels the follow-up CPU sample when the panel closes", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({ samples: [sample] });
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/repo" })));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
});
it("keeps late resource samples from a different project out of the current panel", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/old" })));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/new" })));
  await act(async () => finish({ samples: [sample] }));
  expect(container.querySelector("dl")).toBeNull();
  expect(container.querySelector("button")!.disabled).toBe(false);
});

it("routes explicit machine samples without a conversation identity and drops previous target results", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(hostToolRequest)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ samples: [sample] });
  await act(async () =>
    root.render(
      createElement(DiagnosticsPanel, {
        cwd: "remote://macbook/repo",
        hostTarget: { kind: "machine", machineId: "linux" },
        hostLabel: "Linux server",
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    root.render(
      createElement(DiagnosticsPanel, {
        cwd: "remote://macbook/repo",
        hostTarget: { kind: "local" },
        hostLabel: "This computer",
      }),
    ),
  );
  await act(async () => finish({ samples: [sample] }));
  expect(container.querySelector("dl")).toBeNull();
  expect(container.textContent).not.toContain("Resource usage");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Measurement details"]')!.click(),
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("This computer");
  await act(async () => container.querySelector("button")!.click());
  expect(hostToolRequest).toHaveBeenLastCalledWith(
    "remote://macbook/repo",
    "resources.diagnostics",
    "resources.read",
    {},
    { kind: "local" },
  );
  expect(hostFeatureRequest).not.toHaveBeenCalled();
});

it("plots real history with CPU gaps and displays system memory separately", async () => {
  const history = [
    { ...sample, at: 1000 },
    { ...sample, at: 2000, process: { ...sample.process, cpuPercent: 150 } },
    { ...sample, at: 5000, process: { ...sample.process, cpuPercent: null } },
    { ...sample, at: 9000, process: { ...sample.process, cpuPercent: 50 } },
  ];
  vi.mocked(hostFeatureRequest).mockResolvedValue({ samples: history });
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/repo" })));
  expect(container.querySelectorAll(".resource-chart-point")).toHaveLength(0);
  await act(async () => container.querySelector("button")!.click());
  const cpu = container.querySelector(".resource-chart-cpu")!;
  expect(cpu.querySelectorAll("circle")).toHaveLength(2);
  expect(cpu.querySelector("path")!.getAttribute("d")!.match(/M/g)).toHaveLength(2);
  expect(cpu.textContent).toContain("150%");
  expect(cpu.querySelectorAll("circle")[1].getAttribute("cx")).toBe("312");
  expect(container.querySelector("[role=meter]")!.getAttribute("aria-valuenow")).toBe("50");
  expect(container.querySelector(".resource-history-caption")?.textContent).toContain("4 / 60");
  const details = container.querySelector<HTMLButtonElement>('[aria-label="Measurement details"]')!;
  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => details.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Node heap");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Logical CPUs8");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Samples only when requested.",
  );
  expect(details.getAttribute("aria-expanded")).toBe("true");
});

it("keeps the previous charts visible when refreshing fails", async () => {
  vi.mocked(hostFeatureRequest)
    .mockResolvedValueOnce({
      samples: [{ ...sample, process: { ...sample.process, cpuPercent: 5 } }],
    })
    .mockRejectedValueOnce(new Error("Host offline"));
  await act(async () => root.render(createElement(DiagnosticsPanel, { cwd: "/repo" })));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Host offline");
  expect(container.querySelector(".resource-value")?.textContent).toBe("5.0%");
});
