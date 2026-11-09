// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { desktopInstanceId } from "./desktopInstance";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

afterEach(() => vi.restoreAllMocks());

it("keeps one identity for the whole run, even when storage cannot be read or written", () => {
  const first = desktopInstanceId();
  expect(first).toMatch(/^[0-9a-f-]{16,64}$/i);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  expect(desktopInstanceId()).toBe(first);
});
