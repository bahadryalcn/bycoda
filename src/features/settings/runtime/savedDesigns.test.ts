// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { addBackgroundLibraryImage, listBackgroundLibrary } from "../model/backgroundLibrary";
import { loadSavedThemes, saveSavedThemes, type SavedTheme } from "../model/savedThemes";
import {
  saveDesign,
  openSavedDesign,
  applyDesign,
  importDesign,
  exportDesign,
} from "./savedDesigns";
import {
  loadProjectChatBackgroundSettings,
  saveProjectChatBackgroundSettings,
} from "../../projects/public/projectChatBackground";
import {
  validateChatBackgroundMedia,
  saveChatBackgroundFrom,
} from "../../projects/public/chatBackground";
import type { DesignDraft } from "../model/designs";
import type { AppearanceSettings } from "../ui/useAppearanceSettings";
import { saveChatBackgroundPath } from "../model/appearance";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../model/backgroundLibrary", () => ({
  addBackgroundLibraryImage: vi.fn(),
  listBackgroundLibrary: vi.fn(),
}));
vi.mock("../../projects/public/projectChatBackground", () => ({
  loadProjectChatBackgroundSettings: vi.fn(),
  saveProjectChatBackgroundSettings: vi.fn(),
}));
vi.mock("../../projects/public/chatBackground", () => ({
  validateChatBackgroundMedia: vi.fn(),
  saveChatBackgroundFrom: vi.fn(),
}));
vi.mock("../ui/appearance/controls/savedThemeActions", () => ({
  applySavedTheme: vi.fn(async () => "applied"),
}));
vi.mock("../model/savedThemes", async (original) => {
  const actual = await original<typeof import("../model/savedThemes")>();
  return { ...actual, saveSavedThemes: vi.fn(actual.saveSavedThemes) };
});

const image = {
  id: "a".repeat(24),
  path: "/owned/library/a.html",
  source: "generated" as const,
  bytes: 10,
  createdMs: 0,
  prompt: null,
};
const draft: DesignDraft = {
  kind: "scene",
  name: "Lake",
  prompt: "Dusk",
  path: "/owned/asset.html",
  look: {
    image: { scope: "all", emptyOpacity: 0.3, sessionOpacity: 0.2, blur: 0, effect: "none" },
  },
};
const theme = (id = "one"): SavedTheme => ({
  id,
  name: "Lake",
  createdAt: 1,
  updatedAt: 1,
  look: draft.look,
  imageId: image.id,
  creation: { kind: "scene", prompt: "Dusk" },
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(addBackgroundLibraryImage).mockResolvedValue(image);
  vi.mocked(listBackgroundLibrary).mockResolvedValue([image]);
  vi.mocked(invoke).mockResolvedValue("<b>source</b>");
  vi.mocked(loadProjectChatBackgroundSettings).mockReturnValue(null);
  vi.mocked(saveChatBackgroundFrom).mockResolvedValue("/owned/copied.html");
  vi.mocked(validateChatBackgroundMedia).mockResolvedValue();
});

it("saves a named durable reference with source metadata instead of a machine path", async () => {
  const saved = await saveDesign(draft);
  expect(saved).toMatchObject({
    name: "Lake",
    imageId: image.id,
    creation: { kind: "scene", prompt: "Dusk" },
  });
  expect(JSON.stringify(loadSavedThemes())).not.toContain("/owned");
  expect((await openSavedDesign(saved)).source).toBe("<b>source</b>");
});

it("holds conflicting edits but preserves an independent sibling creation", async () => {
  const original = theme();
  saveSavedThemes([original]);
  vi.mocked(addBackgroundLibraryImage).mockImplementationOnce(async () => {
    saveSavedThemes([{ ...original, name: "Sibling edit" }]);
    return image;
  });
  await expect(saveDesign({ ...draft, saved: original }, true)).rejects.toThrow("changed");
  expect(loadSavedThemes()[0].name).toBe("Sibling edit");
  saveSavedThemes([original]);
  vi.mocked(addBackgroundLibraryImage).mockImplementationOnce(async () => {
    saveSavedThemes([original, theme("other")]);
    return image;
  });
  await saveDesign({ ...draft, name: "Revision", saved: original }, true);
  expect(loadSavedThemes().map((item) => item.id)).toEqual(["one", "other"]);
});

it("does not apply project preferences when decoding fails or a sibling changes selection", async () => {
  vi.mocked(validateChatBackgroundMedia).mockRejectedValueOnce(new Error("codec"));
  await expect(applyDesign({} as AppearanceSettings, draft, "/project")).rejects.toThrow("codec");
  expect(saveProjectChatBackgroundSettings).not.toHaveBeenCalled();
  vi.mocked(loadProjectChatBackgroundSettings).mockReturnValueOnce(null).mockReturnValue({
    path: "/new.png",
    scope: "all",
    effect: "none",
    emptyOpacity: 0.3,
    sessionOpacity: 0.2,
  });
  await expect(applyDesign({} as AppearanceSettings, draft, "/project")).rejects.toThrow("changed");
  expect(saveProjectChatBackgroundSettings).not.toHaveBeenCalled();
});

it("keeps current state when imported metadata or saved media is missing", async () => {
  vi.mocked(open).mockResolvedValue("/design.json");
  vi.mocked(invoke).mockResolvedValueOnce({ design: { kind: "bad" }, assetPath: null });
  await expect(importDesign()).rejects.toThrow("Invalid");
  expect(loadSavedThemes()).toEqual([]);
  vi.mocked(listBackgroundLibrary).mockResolvedValue([]);
  await expect(openSavedDesign(theme())).rejects.toThrow("missing");
  await expect(exportDesign(theme())).rejects.toThrow("missing");
  expect(save).not.toHaveBeenCalled();
});

it("imports a reusable artifact into the shared named library without applying it", async () => {
  vi.mocked(open).mockResolvedValue("/design.json");
  vi.mocked(invoke).mockResolvedValueOnce({
    design: {
      name: "Portable lake",
      kind: "scene",
      prompt: "Dusk",
      look: { ...draft.look, hue: 200 },
    },
    assetPath: "/owned/imported.html",
  });
  const imported = await importDesign();
  expect(imported?.name).toBe("Portable lake");
  expect(imported?.look).not.toHaveProperty("hue");
  expect(saveProjectChatBackgroundSettings).not.toHaveBeenCalled();
});

it("does not export local legacy naming aliases as portable dependencies", async () => {
  vi.mocked(save).mockResolvedValue("/portable.json");
  await exportDesign({ ...theme(), backgroundPaths: ["C:/legacy/private.html"] });
  const args = vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "export_appearance_design")?.[1] as {
    design: unknown;
  };
  expect(JSON.stringify(args.design)).not.toContain("legacy");
});

it("retains the saved record when durable saving fails", async () => {
  const original = theme();
  saveSavedThemes([original]);
  vi.mocked(saveSavedThemes).mockReturnValueOnce(false);
  await expect(
    saveDesign({ ...draft, name: "Failed replacement", saved: original }, true),
  ).rejects.toThrow("Could not save");
  expect(loadSavedThemes()[0]).toEqual(original);
});

it("holds a global apply when a sibling changes selection during the library copy", async () => {
  saveChatBackgroundPath("/previous.html");
  vi.mocked(addBackgroundLibraryImage).mockImplementationOnce(async () => {
    saveChatBackgroundPath("/sibling.html");
    return image;
  });
  await expect(applyDesign({} as AppearanceSettings, draft)).rejects.toThrow("changed");
  expect(localStorage.getItem("bycoda.chatBackgroundPath")).toBe("/sibling.html");
});

it("rejects unreadable imports and opens before modifying the saved library", async () => {
  vi.mocked(open).mockResolvedValue("/design.json");
  vi.mocked(invoke).mockResolvedValueOnce({
    design: { name: "Bad codec", kind: "image", prompt: "", look: {} },
    assetPath: "/bad.mp4",
  });
  vi.mocked(validateChatBackgroundMedia).mockRejectedValueOnce(new Error("codec"));
  await expect(importDesign()).rejects.toThrow("codec");
  expect(addBackgroundLibraryImage).not.toHaveBeenCalled();
  expect(loadSavedThemes()).toEqual([]);
});
