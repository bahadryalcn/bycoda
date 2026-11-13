// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderStatusGroup } from "./ProviderStatusGroup";
const updateState = vi.hoisted(() => ({ catalogRefresh: "unchanged", failed: false }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  hasProbedHarnessAvailability: () => true,
}));
vi.mock("../model/harnessUpdateActions", () => ({
  subscribeHarnessUpdates: () => () => {},
  getHarnessUpdateSnapshot: () => ({
    checking: false,
    runs: {
      codex: updateState.failed
        ? { status: "failed", error: "Version verification failed" }
        : { status: "updated", version: "0.95.0", catalogRefresh: updateState.catalogRefresh },
    },
    checks: [
      {
        harness: "codex",
        installed: "0.94.0",
        latest: "0.95.0",
        status: updateState.catalogRefresh === "initial" ? "behind" : "current",
      },
    ],
  }),
  runHarnessUpdate: vi.fn(),
}));
vi.mock("../../settings/ui/ProviderBinarySettings", () => ({
  ProviderBinaryControl: ({ missing }: { missing: boolean }) =>
    createElement("button", null, missing ? "Set up" : "CLI path"),
}));
it("shows one compact status and an accent update action with version columns", () => {
  updateState.catalogRefresh = "initial";
  const html = renderToStaticMarkup(
    createElement(ProviderStatusGroup, {
      harness: "codex",
      available: true,
      checkedAt: null,
      onCheck: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  expect(html).toContain("provider-inventory-row");
  expect(html).toContain("0.94.0");
  expect(html).toContain("0.95.0");
  expect(html).toContain("Update available");
  expect(html).toContain('aria-label="Update Codex to 0.95.0"');
  expect(html).not.toContain("settings-row");
});
it("keeps unchanged catalogs quiet and preserves genuine refresh failures", () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(ProviderStatusGroup, {
        harness: "codex",
        available: true,
        checkedAt: null,
        onCheck: vi.fn(),
        onSetup: vi.fn(),
      }),
    );
  updateState.catalogRefresh = "unchanged";
  expect(render()).not.toContain("The model list did not change");
  updateState.catalogRefresh = "failed";
  expect(render()).toContain("Model refresh failed");
});
it("offers setup without a meaningless update check for missing CLIs", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderStatusGroup, {
      harness: "hermes",
      available: false,
      checkedAt: Date.now(),
      onCheck: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  expect(html).not.toContain("now");
  expect(html).toContain("Not installed");
  expect(html).toContain("Set up");
  expect(html).not.toContain("Check for updates");
});

it("omits repeated bulk-check times and explains unavailable release feeds", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderStatusGroup, {
      harness: "antigravity",
      available: true,
      checkedAt: Date.now(),
      onCheck: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  expect(html).toContain("Unavailable");
  expect(html).not.toContain("Unknown");
  expect(html).not.toContain("Check for updates");
  expect(html).not.toContain("now");
  expect(html).toContain("<td");
});

it("uses failure glyph with a retained successful version check", () => {
  updateState.catalogRefresh = "unchanged";
  updateState.failed = true;
  try {
    const html = renderToStaticMarkup(
      createElement(ProviderStatusGroup, {
        harness: "codex",
        available: true,
        checkedAt: null,
        onCheck: vi.fn(),
        onSetup: vi.fn(),
      }),
    );
    expect(html).toContain("Update failed");
    expect(html).toContain("Version verification failed");
    expect(html).toContain("lucide-circle-x");
    expect(html).not.toContain("lucide-check");
  } finally {
    updateState.failed = false;
  }
});
