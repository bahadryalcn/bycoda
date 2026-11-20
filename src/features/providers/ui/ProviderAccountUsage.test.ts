// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  UsageMeter,
  AccountUsageMeters,
  meterWindows,
  meterWindowsWith,
} from "./ProviderAccountUsage";
import { idleRateLimits } from "../model/rateLimits";
import { t } from "../../../shared/i18n";

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
  const bar = () => container.querySelector('[role="meter"]');
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
  const bar = container.querySelector('[role="meter"]')!;
  expect(bar.getAttribute("aria-valuenow")).toBe("0");
  expect(bar.getAttribute("data-tone")).toBe("danger");
  expect(container.textContent).toContain("0% left");
});

it("exposes loading placeholders only while limits are unavailable", async () => {
  await act(async () =>
    root.render(createElement(AccountUsageMeters, { now: 0, limits: undefined })),
  );
  await vi.waitFor(() => expect(container.querySelectorAll('[role="status"]')).toHaveLength(2));
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

it("meterWindowsWith returns the same titles as meterWindows and uses the translator given", () => {
  const w = { usedPercent: 10, windowMinutes: 300, resetsAt: null };
  const limits = { ...idleRateLimits("codex"), session: w, weekly: w, monthly: w };
  const plain = (list: ReturnType<typeof meterWindows>) =>
    list.map((entry) => ({ title: entry.title, window: entry.window }));
  expect(plain(meterWindowsWith(limits, t))).toEqual(plain(meterWindows(limits)));
  expect(meterWindowsWith(undefined, t)).toEqual([]);
  const upper = ((key: string) => key.toUpperCase()) as typeof t;
  expect(meterWindowsWith(limits, upper).map((entry) => entry.title)).toEqual([
    "5-HOUR",
    "WEEKLY",
    "MONTHLY",
  ]);
});

it("titles the 5-hour window with the shared translated name and reads a reset window as Resets now", async () => {
  const now = Date.now();
  await act(async () =>
    root.render(
      createElement(UsageMeter, {
        title: "5-hour",
        now,
        window: { usedPercent: 40, windowMinutes: 300, resetsAt: now - 1_000 },
      }),
    ),
  );
  expect(container.textContent).toContain("5-hour · Resets now");
  expect(container.textContent).not.toContain("reset due");
});

it("keeps account meters visible at narrow widths by wrapping them", async () => {
  const now = Date.now();
  const window = { usedPercent: 40, windowMinutes: 300, resetsAt: now + 3_600_000 };
  await act(async () =>
    root.render(
      createElement(AccountUsageMeters, {
        now,
        limits: { ...idleRateLimits("codex"), status: "ok", session: window, weekly: window },
      }),
    ),
  );
  const row = container.firstElementChild!;
  expect(row.querySelectorAll('[role="meter"]')).toHaveLength(2);
  expect(row.className).toContain("flex-wrap");
  expect(row.className).not.toMatch(/\bhidden\b|sm:flex/);
});

it("renders no fixed-width spacer when an account has no usage data", async () => {
  await act(async () =>
    root.render(
      createElement(AccountUsageMeters, {
        now: 0,
        limits: { ...idleRateLimits("codex"), status: "error" },
      }),
    ),
  );
  expect(container.innerHTML).toBe("");
});

it("makes the exact reset time reachable without hover", async () => {
  const now = Date.now();
  await act(async () =>
    root.render(
      createElement(UsageMeter, {
        title: "5h",
        now,
        window: { usedPercent: 23, windowMinutes: 300, resetsAt: now + 3_600_000 },
      }),
    ),
  );
  const focusable = container.querySelector<HTMLElement>('[tabindex="0"]')!;
  expect(focusable).not.toBeNull();
  expect(focusable.querySelector(".sr-only")?.textContent).toMatch(/^Resets /);

  await act(async () =>
    root.render(
      createElement(UsageMeter, {
        title: "Weekly",
        now,
        window: { usedPercent: 23, windowMinutes: 10080, resetsAt: null },
      }),
    ),
  );
  expect(container.querySelector('[tabindex="0"]')).toBeNull();
  expect(container.querySelector(".sr-only")).toBeNull();
});
