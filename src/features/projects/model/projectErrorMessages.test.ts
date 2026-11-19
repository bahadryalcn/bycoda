import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { projectFolderName } from "./newProjectFolder";
import {
  clearProjectChatBackgroundSetting,
  saveProjectChatBackground,
} from "./projectChatBackground";
import { setProjectGroupAssignment } from "./projectGroups";

// Model errors are shown to users verbatim, so they must come from the active catalog.
describe("project model error messages", () => {
  beforeEach(async () => {
    await setLanguagePreference("tr");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await setLanguagePreference("en");
  });

  it("localizes the folder naming error", () => {
    expect(() => projectFolderName("???")).toThrow(
      "Harf veya rakam içeren bir proje adı seçin.",
    );
  });

  it("localizes the group assignment save failure", () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Quota");
    });
    expect(() => setProjectGroupAssignment("/work/alpha", null)).toThrow(
      "Proje grubu ataması kaydedilemedi.",
    );
  });

  it("localizes the background settings save failure", () => {
    saveProjectChatBackground("/work/alpha", { path: "/bg.png", opacity: 0.5, scope: "all" });
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Quota");
    });
    expect(() => clearProjectChatBackgroundSetting("/work/alpha")).toThrow(
      "Proje arka plan ayarları kaydedilemedi. Resmi kaldırmayı yeniden deneyin.",
    );
  });
});
