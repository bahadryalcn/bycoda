// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileAccessSettings } from "./FileAccessSettings";
import {
  configureFileAccess,
  dismissFileAccessRecovery,
  getFileAccessMode,
  getFileAccessRecoveries,
} from "../../../platform/tauri/fileAccess";

vi.mock("../../../platform/tauri/fileAccess", () => ({
  getFileAccessMode: vi.fn().mockResolvedValue("all-files"),
  configureFileAccess: vi.fn().mockResolvedValue("selected-folders"),
  getFileAccessRecoveries: vi.fn().mockResolvedValue([]),
  dismissFileAccessRecovery: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (text: string, values?: Record<string, string>) =>
    values
      ? text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
      : text,
  useT: () => (text: string) => text,
  useLocale: () => "en",
}));
const container = document.createElement("div");
// The information button precedes the action, so find the action by its name.
const changeButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Change file access…",
  )!;
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
});

it("shows saved access and reflects a native downgrade", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await act(async () => root.render(createElement(FileAccessSettings)));
  expect(getFileAccessMode).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("All files allowed");
  await act(async () => changeButton().click());
  expect(configureFileAccess).toHaveBeenCalledWith(true);
  expect(container.textContent).toContain("Selected folders only");
});

it("keeps the saved status and offers retry when native consent fails", async () => {
  vi.mocked(configureFileAccess).mockRejectedValueOnce(new Error("Storage unavailable"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => changeButton().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable");
  expect(container.textContent).toContain("All files allowed");
  expect(changeButton().disabled).toBe(false);
  await act(async () => changeButton().click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Selected folders only");
});

it("reports unavailable status after an initial read failure without implying consent", async () => {
  vi.mocked(getFileAccessMode).mockRejectedValueOnce(new Error("Access status unavailable"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Status unavailable");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Access status unavailable",
  );
  expect(configureFileAccess).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    "Could not read file access status. Retry to check current access.",
  );
  expect(container.textContent).not.toContain("Could not confirm the file access operation.");
  const change = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Change file access…",
  )!;
  expect(change.disabled).toBe(true);
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Retry",
  )!;
  await act(async () => retry.click());
  expect(configureFileAccess).not.toHaveBeenCalled();
  expect(container.textContent).toContain("All files allowed");
  expect(change.disabled).toBe(false);
});

it("reads back permissions after an uncertain consent failure without invoking consent again", async () => {
  vi.mocked(getFileAccessMode)
    .mockResolvedValueOnce("all-files")
    .mockResolvedValueOnce("selected-folders");
  vi.mocked(configureFileAccess).mockRejectedValueOnce(new Error("Cleanup failed after saving"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => changeButton().click());
  expect(configureFileAccess).toHaveBeenCalledOnce();
  expect(getFileAccessMode).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Selected folders only");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Cleanup failed after saving",
  );
});

it("refreshes changed permissions on window focus through a read-only operation", async () => {
  vi.mocked(getFileAccessMode)
    .mockResolvedValueOnce("all-files")
    .mockResolvedValueOnce("selected-folders");
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Selected folders only");
  expect(configureFileAccess).not.toHaveBeenCalled();
});

it("keeps the last known access visible and says so when a refresh fails", async () => {
  vi.mocked(getFileAccessMode)
    .mockResolvedValueOnce("all-files")
    .mockRejectedValueOnce(new Error("Status read failed"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Status unavailable");
  expect(container.textContent).toContain("Last known access");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Status read failed");
});

it("ignores a read that finishes after the surface closed", async () => {
  let finish!: (mode: "all-files") => void;
  vi.mocked(getFileAccessMode).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(createElement(FileAccessSettings)));
  expect(container.textContent).toContain("Loading…");
  await act(async () => root.unmount());
  await act(async () => finish("all-files"));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

const dismissButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Dismiss",
  )!;

it("shows a corrupt-file notice with the preserved copy until the owner dismisses it", async () => {
  vi.mocked(getFileAccessRecoveries).mockResolvedValueOnce([
    { id: "r1", kind: "mode", quarantine: "C:/data/access-mode.json.corrupt-1" },
  ]);
  await act(async () => root.render(createElement(FileAccessSettings)));
  expect(container.textContent).toContain(
    "Your saved file access choice could not be read, so access is off until you choose it again.",
  );
  expect(container.textContent).toContain("Unreadable copy kept at C:/data/access-mode.json.corrupt-1");
  // The notice is the only signal that prior access was lost, so it must not
  // be replaced by an automatic consent prompt.
  expect(configureFileAccess).not.toHaveBeenCalled();
  await act(async () => dismissButton().click());
  expect(dismissFileAccessRecovery).toHaveBeenCalledWith("r1");
  expect(container.textContent).not.toContain("could not be read");
});

it("keeps the notice visible when dismissing it fails", async () => {
  vi.mocked(getFileAccessRecoveries).mockResolvedValueOnce([
    { id: "r2", kind: "grants", quarantine: "C:/data/grants.json.corrupt-2" },
  ]);
  vi.mocked(dismissFileAccessRecovery).mockRejectedValueOnce(new Error("Disk full"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => dismissButton().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
  expect(container.textContent).toContain("Saved folder permissions could not be read");
  expect(dismissButton()).toBeDefined();
});
