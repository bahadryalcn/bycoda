// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProviderDetailHeader } from "./ProviderStatusGroup";
import { ProviderList, providerMetaLine, type ProviderListEntry } from "./ProviderList";
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
  expect(html).toContain('data-tone="accent"');
  expect(html).toContain('aria-label="Signed in"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("Show Codex in the model picker");
});

it("shows standalone sign-in once in the header without inferring readiness from installation", () => {
  const unknown = renderToStaticMarkup(
    createElement(ProviderDetailHeader, { harness: "cursor", available: true }),
  );
  expect(unknown).toContain("Sign-in");
  expect(unknown).toContain("Unknown");
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
