// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsageMeter, AccountUsageMeters } from "./ProviderAccountUsage";
import { idleRateLimits } from "../model/rateLimits";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("flips the meter when another window turns off remaining usage", async () => {
  const now = Date.now();
  await act(async () =>
    root.render(
      createElement(UsageMeter, {
        title: "5h",
        now,
        window: {
          usedPercent: 23,
          windowMinutes: 300,
          resetsAt: now + 3_600_000,
        },
      }),
    ),
  );
  const bar = () => container.querySelector('[role="progressbar"]');
  expect(bar()?.getAttribute("aria-label")).toBe("5h limit remaining");
  expect(bar()?.getAttribute("aria-valuenow")).toBe("77");
  expect(container.textContent).toContain("77% left");

  await act(async () => {
    localStorage.setItem("bycoda.showRemainingUsage", "0");
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.showRemainingUsage" }));
  });

  expect(bar()?.getAttribute("aria-label")).toBe("5h limit used");
  expect(bar()?.getAttribute("aria-valuenow")).toBe("23");
  expect(container.textContent).not.toContain("left");
});

it("keeps exhausted quota dangerous even when showing zero remaining", async () => {
  await act(async () =>
    root.render(
      createElement(UsageMeter, {
        title: "Weekly",
        now: 0,
        window: { usedPercent: 100, windowMinutes: 10080, resetsAt: 1000 },
      }),
    ),
  );
  const bar = container.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute("aria-valuenow")).toBe("0");
  expect(bar.getAttribute("data-tone")).toBe("danger");
  expect(container.textContent).toContain("0% left");
});

it("exposes loading placeholders only while limits are unavailable", async () => {
  await act(async () =>
    root.render(createElement(AccountUsageMeters, { now: 0, limits: undefined })),
  );
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  await act(async () =>
    root.render(
      createElement(AccountUsageMeters, {
        now: 0,
        limits: { ...idleRateLimits("codex"), status: "error" },
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')).toBeNull();
});
