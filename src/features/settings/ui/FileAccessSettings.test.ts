// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FileAccessSettings } from "./FileAccessSettings";
import { configureFileAccess, getFileAccessMode } from "../../../platform/tauri/fileAccess";

vi.mock("../../../platform/tauri/fileAccess", () => ({
  getFileAccessMode: vi.fn().mockResolvedValue("all-files"),
  configureFileAccess: vi.fn().mockResolvedValue("selected-folders"),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (text: string) => text,
  useT: () => (text: string) => text,
  useLocale: () => "en",
}));
const container = document.createElement("div");
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
  await act(async () => container.querySelector("button")!.click());
  expect(configureFileAccess).toHaveBeenCalledWith(true);
  expect(container.textContent).toContain("Selected folders only");
});

it("keeps the saved status and offers retry when native consent fails", async () => {
  vi.mocked(configureFileAccess).mockRejectedValueOnce(new Error("Storage unavailable"));
  await act(async () => root.render(createElement(FileAccessSettings)));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable");
  expect(container.textContent).toContain("All files allowed");
  expect(container.querySelector("button")!.disabled).toBe(false);
  await act(async () => container.querySelector("button")!.click());
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
  expect(container.querySelector("button")!.disabled).toBe(false);
});
