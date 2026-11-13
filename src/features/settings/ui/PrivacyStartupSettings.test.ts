// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivacyStartupSettings } from "./PrivacyStartupSettings";
import { retryGroupLockStorage, setRelockOnLaunch } from "../../group-lock/model/groupLock";
import { saveMaskEmails } from "../model/displayPrefs";
vi.mock("../../account", () => ({
  isAnonymousStatsEnabled: () => false,
  setAnonymousStatsEnabled: vi.fn(),
  subscribeAnonymousStats: () => () => {},
}));
vi.mock("../../diagnostics", () => ({ DiagnosticsSharingSetting: () => null }));
vi.mock("./FileAccessSettings", () => ({ FileAccessSettings: () => null }));
vi.mock("../../group-lock/model/roomPrivacyProjection", () => ({
  queueRoomPrivacyProjection: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  retryGroupLockStorage();
  saveMaskEmails(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(createElement(PrivacyStartupSettings)));
const remount = async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
};
it("retains startup durability feedback after navigation and clears only after durable save", async () => {
  await render();
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[role="switch"][aria-label="Start in privacy mode"]')!
      .click(),
  );
  await remount();
  expect(host.textContent).toContain("The next launch may not start in privacy mode.");
  expect(
    host.querySelector('[aria-label="Start in privacy mode"]')?.getAttribute("aria-checked"),
  ).toBe("true");
  write.mockRestore();
  await act(async () => {
    setRelockOnLaunch(false);
  });
  expect(host.textContent).not.toContain("The next launch may not start in privacy mode.");
});
it("retains email masking fallback warning across navigation and retries same value", async () => {
  await render();
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await act(async () => {
    saveMaskEmails(false);
  });
  await remount();
  expect(host.textContent).toContain("Applied in this window, but not saved.");
  write.mockRestore();
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Retry")!
      .click(),
  );
  expect(localStorage.getItem("bycoda.maskEmails")).toBe("0");
  expect(host.textContent).not.toContain("Applied in this window, but not saved.");
});
