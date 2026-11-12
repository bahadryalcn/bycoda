// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderStatusGroup } from "./ProviderStatusGroup";
vi.mock("../../../integrations/harness/core/availability", () => ({
  hasProbedHarnessAvailability: () => true,
}));
vi.mock("../model/harnessUpdateActions", () => ({
  subscribeHarnessUpdates: () => () => {},
  getHarnessUpdateSnapshot: () => ({
    checking: false,
    runs: {},
    checks: [{ harness: "codex", installed: "0.94.0", latest: "0.95.0", status: "behind" }],
  }),
  runHarnessUpdate: vi.fn(),
}));
vi.mock("../../settings/ui/ProviderBinarySettings", () => ({
  ProviderBinaryControl: ({ missing }: { missing: boolean }) =>
    createElement("button", null, missing ? "Set up" : "CLI path"),
}));
it("shows one compact status and an accent update action with version columns", () => {
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
  expect(html).toContain("Update check unavailable");
  expect(html).not.toContain("Unknown");
  expect(html).not.toContain("Check for updates");
  expect(html).not.toContain("now");
  expect(html).toContain("<td");
});
