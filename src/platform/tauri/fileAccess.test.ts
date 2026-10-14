import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { configureFileAccess, getFileAccessMode } from "./fileAccess";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("../../shared/i18n", () => ({ getLocale: () => "tr" }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});

it("asks native storage for saved access and uses native consent to review it", async () => {
  vi.mocked(invoke).mockResolvedValue("all-files");
  expect(await getFileAccessMode()).toBe("all-files");
  expect(invoke).toHaveBeenCalledWith("get_file_access_mode");
  await configureFileAccess();
  expect(invoke).toHaveBeenCalledWith("configure_file_access", { review: false, language: "tr" });
  await configureFileAccess(true);
  expect(invoke).toHaveBeenCalledWith("configure_file_access", { review: true, language: "tr" });
});

it("does not invoke local filesystem consent from a browser preview", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await getFileAccessMode()).toBe("selected-folders");
  expect(await configureFileAccess()).toBe("selected-folders");
  expect(invoke).not.toHaveBeenCalled();
});
