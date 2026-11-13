// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GeneralPage, UpdateRow } from "./GeneralSettings";
import { KEEP_AWAKE_DEFAULT, saveKeepAwakeEnabled } from "../model/settings";
import { LANGUAGE_STORAGE_KEY, DOMAIN_LANGUAGE_STORAGE_KEYS } from "../../../shared/i18n";
const mocks = vi.hoisted(() => ({
  reset: null as null | (() => Promise<void>),
  session: vi.fn(),
  language: vi.fn(),
  domain: vi.fn(),
  version: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock("../../../app/model/updater", async (original) => ({
  ...(await original<object>()),
  readAppVersion: mocks.version,
  isUpdaterEnabled: mocks.enabled,
  knownAppVersionState: () => undefined,
  knownUpdaterEnabledState: () => undefined,
}));
vi.mock("./settingsControls", async (original) => ({
  ...(await original<object>()),
  useSettingsPageReset: (reset: () => Promise<void>) => {
    mocks.reset = reset;
  },
}));
vi.mock("../../../shared/i18n", async (original) => ({
  ...(await original<object>()),
  setLanguagePreference: mocks.language,
  setDomainLanguagePreference: mocks.domain,
}));
vi.mock("./SessionFolderSettings", () => ({
  SessionFolderGroup: () => null,
  restoreSessionFolderDefault: mocks.session,
}));
vi.mock("./GeneralProductDetails", () => ({ ProductDetails: () => null }));
it("restores canonical independent English domains and reports partial reset failure", async () => {
  mocks.session
    .mockRejectedValueOnce(new Error("native write failed"))
    .mockResolvedValue(undefined);
  mocks.language.mockResolvedValue(undefined);
  mocks.domain.mockResolvedValue(undefined);
  renderToStaticMarkup(createElement(GeneralPage, { onOpenWhatsNew: () => {} }));
  await expect(mocks.reset!()).rejects.toThrow("Some settings could not be reset");
  expect(mocks.language).toHaveBeenCalledWith("system");
  expect(mocks.domain).toHaveBeenCalledWith("git", "en");
  expect(mocks.domain).toHaveBeenCalledWith("technical", "en");
  await expect(mocks.reset!()).resolves.toBeUndefined();
});

it("does not hide a rejected durable preference write behind partial reset success", async () => {
  saveKeepAwakeEnabled(!KEEP_AWAKE_DEFAULT);
  mocks.session.mockResolvedValue(undefined);
  renderToStaticMarkup(createElement(GeneralPage, { onOpenWhatsNew: () => {} }));
  const originalStorage = globalThis.localStorage;
  vi.stubGlobal("localStorage", {
    getItem: originalStorage.getItem.bind(originalStorage),
    setItem: () => {
      throw new Error("storage full");
    },
  });
  try {
    await expect(mocks.reset!()).rejects.toThrow("Some settings could not be reset");
  } finally {
    vi.unstubAllGlobals();
    saveKeepAwakeEnabled(KEEP_AWAKE_DEFAULT);
  }
  expect(mocks.session).toHaveBeenCalled();
});

it("shows retry for unknown build metadata and keeps a verified fork disabled", async () => {
  mocks.version.mockRejectedValueOnce(new Error("read failed")).mockResolvedValue("0.5.70-test");
  mocks.enabled.mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(false);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await act(async () => root.render(createElement(UpdateRow, { onOpenWhatsNew: () => {} })));
    expect(container.textContent).toContain("Could not read update information.");
    expect(container.textContent).not.toContain("0.0.0");
    const retry = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(container.textContent).toContain("0.5.70-test");
    expect(container.textContent).toContain("Automatic updates are disabled in this build.");
    expect(container.textContent).not.toContain("Could not read update information.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("reports session-only language resets when persisted preferences remain unchanged", async () => {
  mocks.session.mockResolvedValue(undefined);
  const keys = [
    LANGUAGE_STORAGE_KEY,
    DOMAIN_LANGUAGE_STORAGE_KEYS.git,
    DOMAIN_LANGUAGE_STORAGE_KEYS.technical,
  ];
  for (const key of keys) {
    localStorage.setItem(key, key === LANGUAGE_STORAGE_KEY ? "tr" : "app");
    try {
      renderToStaticMarkup(createElement(GeneralPage, { onOpenWhatsNew: () => {} }));
      await expect(mocks.reset!()).rejects.toThrow("Some settings could not be reset");
    } finally {
      localStorage.removeItem(key);
    }
  }
});
