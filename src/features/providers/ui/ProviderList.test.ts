// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderDetailHeader } from "./ProviderStatusGroup";
import { ProviderList, providerMetaLine, type ProviderListEntry } from "./ProviderList";
import { clearCachedRateLimits, setCachedRateLimits } from "../model/rateLimitsCache";
import { idleRateLimits, type RateLimitStatus } from "../model/rateLimits";
const entry: ProviderListEntry = {
  harness: "codex",
  available: true,
  isDefault: true,
  inPicker: true,
  pickerLocked: false,
  version: "1.2.3",
  updateAvailable: false,
  auth: { tone: "ready", label: "Signed in" },
};
it("paints the provider selection and picker switch inside one shared row", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(ProviderList, {
      entries: [entry],
      active: "codex",
      probed: true,
      disabled: false,
      onSelect: vi.fn(),
      onPickerVisible: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  const row = root.querySelector(".provider-cli-item");
  expect(row?.hasAttribute("data-action-host")).toBe(true);
  expect(row?.hasAttribute("data-selected")).toBe(true);
  expect(row?.querySelector('[aria-current="true"]')).not.toBeNull();
  expect(row?.querySelector('[role="switch"]')?.closest("[data-action-inline]")).not.toBeNull();
  expect(row?.querySelector("button button")).toBeNull();
});
it("keeps CLI versions out of Accounts metadata and marks default and auth semantically", () => {
  expect(providerMetaLine(entry, true)).not.toContain("1.2.3");
  const html = renderToStaticMarkup(
    createElement(ProviderList, {
      entries: [entry],
      active: "codex",
      probed: true,
      disabled: false,
      onSelect: vi.fn(),
      onPickerVisible: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  expect(html).toContain('aria-label="Default provider"');
  expect(html).toContain('aria-label="Codex, Signed in, Default provider"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("Show Codex in the model picker");
});

it("shows standalone sign-in once in the header without inferring readiness from installation", () => {
  const unknown = renderToStaticMarkup(
    createElement(ProviderDetailHeader, { harness: "cursor", available: true }),
  );
  expect(unknown).toContain("Sign-in");
  expect(unknown).toContain("Not checked");
  expect(unknown).not.toContain("CLI detected");
  expect(unknown).not.toContain("Verified ready");
  const completed = renderToStaticMarkup(
    createElement(ProviderDetailHeader, {
      harness: "cursor",
      available: true,
      signInCompleted: true,
    }),
  );
  expect(completed).toContain("CLI sign-in completed");
  expect(completed).not.toContain("Unknown");
});

it("uses sign-in metadata without repeated installation filler", () => {
  expect(providerMetaLine(entry, true)).toBe("Signed in");
  expect(providerMetaLine({ ...entry, auth: null }, true)).toBe("");
  expect(providerMetaLine({ ...entry, accountSummary: "3 accounts · 1 signed out" }, true)).toBe(
    "3 accounts · 1 signed out",
  );
});

it.each([
  ["ok", "Signed in"],
  ["unavailable", "Signed out"],
  ["fetching", "Checking…"],
  ["error", "Not checked"],
] satisfies [RateLimitStatus, string][])(
  "shows Grok %s cache state in header and rail",
  (status, label) => {
    setCachedRateLimits("grok", "default", { ...idleRateLimits("grok"), status });
    try {
      const header = renderToStaticMarkup(
        createElement(ProviderDetailHeader, {
          harness: "grok",
          available: true,
          signInCompleted: true,
        }),
      );
      expect(header).toContain(`Sign-in: ${label}`);
      const rail = renderToStaticMarkup(
        createElement(ProviderList, {
          entries: [{ ...entry, harness: "grok", auth: null }],
          active: "grok",
          probed: true,
          disabled: false,
          onSelect: vi.fn(),
          onPickerVisible: vi.fn(),
          onSetup: vi.fn(),
        }),
      );
      expect(rail).toContain(label);
      expect(rail).not.toContain('data-button-layout="stacked"');
      if (status === "error" || status === "fetching")
        expect(rail).toContain('data-tone="secondary"');
    } finally {
      clearCachedRateLimits("grok");
    }
  },
);

it("keeps installed, installable and ACP provider icons beside their labels", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderList, {
      entries: [
        entry,
        { ...entry, harness: "cursor", available: false },
        { ...entry, harness: "acp", available: false },
      ],
      active: "cursor",
      probed: true,
      disabled: false,
      onSelect: vi.fn(),
      onPickerVisible: vi.fn(),
      onSetup: vi.fn(),
    }),
  );
  expect(html).not.toContain('data-button-layout="stacked"');
  expect(html.match(/provider-cli-option-copy/g)).toHaveLength(3);
});

it.each(["low", "exhausted"] as const)("keeps %s visible with several accounts", (tone) => {
  const label = tone === "low" ? "Running low" : "Exhausted";
  expect(
    providerMetaLine({ ...entry, accountSummary: "2 accounts", auth: { tone, label } }, true),
  ).toBe(`2 accounts, ${label}`);
});
