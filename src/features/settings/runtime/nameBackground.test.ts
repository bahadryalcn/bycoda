// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { saveBackgroundName, prepareBackgroundName } from "./nameBackground";
import { addBackgroundLibraryImage, listBackgroundLibrary } from "../model/backgroundLibrary";
import { saveSavedThemes, loadSavedThemes, type SavedTheme } from "../model/savedThemes";
import { acceptAppearanceStorageChange } from "../model/appearancePersistence";
import { backgroundDisplayName } from "../model/backgroundNames";
vi.mock("../model/backgroundLibrary", () => ({
  addBackgroundLibraryImage: vi.fn(),
  listBackgroundLibrary: vi.fn(),
}));
const id = "a".repeat(24),
  path = `/assets/asset-${"a".repeat(64)}.html`;
const look = {
  image: {
    scope: "all" as const,
    emptyOpacity: 0.3,
    sessionOpacity: 0.2,
    blur: 0,
    effect: "none" as const,
  },
};
const original: SavedTheme = {
  id: "design",
  name: "Forest",
  imageId: id,
  createdAt: 1,
  updatedAt: 1,
  look,
  creation: { kind: "scene", prompt: "original source prompt" },
};
beforeEach(() => {
  localStorage.clear();
  acceptAppearanceStorageChange(null);
  vi.clearAllMocks();
  vi.mocked(listBackgroundLibrary).mockResolvedValue([]);
  vi.mocked(addBackgroundLibraryImage).mockResolvedValue({
    id,
    path: `/library/${id}.html`,
    createdMs: 1,
    bytes: 10,
    source: "generated",
    prompt: "Generated dusk",
  });
});
afterEach(() => vi.restoreAllMocks());
it("renames the existing design without media copy, apply, source loss or selection changes", async () => {
  saveSavedThemes([original, { ...original, id: "copy", name: "Variant", createdAt: 2 }]);
  localStorage.setItem("bycoda.chatBackgroundPath", path);
  const renamed = await saveBackgroundName({
    path,
    name: "  Dusk lake  ",
    look: {},
    expected: original,
  });
  expect(renamed).toMatchObject({
    name: "Dusk lake",
    createdAt: 1,
    imageId: id,
    look: original.look,
    creation: original.creation,
  });
  expect(loadSavedThemes()[1].name).toBe("Variant");
  expect(localStorage.getItem("bycoda.chatBackgroundPath")).toBe(path);
  expect(listBackgroundLibrary).not.toHaveBeenCalled();
  expect(addBackgroundLibraryImage).not.toHaveBeenCalled();
});
it("keeps the published name on a real storage failure and permits retry", async () => {
  saveSavedThemes([original]);
  const fail = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("quota");
  });
  await expect(
    saveBackgroundName({ path, name: "Edited", look, expected: original }),
  ).rejects.toThrow("Could not save");
  expect(loadSavedThemes()[0].name).toBe("Forest");
  fail.mockRestore();
  await saveBackgroundName({ path, name: "Edited", look, expected: original });
  expect(loadSavedThemes()[0].name).toBe("Edited");
});
it("saves imported/generated image video and HTML names in the same existing catalog", async () => {
  for (const extension of ["png", "mp4", "html"]) {
    saveSavedThemes([]);
    const asset = path.replace("html", extension);
    const saved = await saveBackgroundName({
      path: asset,
      name: `Named ${extension}`,
      look,
      expected: null,
    });
    expect(saved.creation?.kind).toBe(extension === "html" ? "scene" : "image");
    expect(saved.creation?.prompt).toBe("Generated dusk");
    expect(backgroundDisplayName(asset, loadSavedThemes())).toBe(`Named ${extension}`);
    expect(backgroundDisplayName(`/library/${id}.${extension}`, loadSavedThemes())).toBe(
      `Named ${extension}`,
    );
  }
});
it("holds conflicting sibling names and merges independent saved designs", async () => {
  saveSavedThemes([{ ...original, name: "Sibling" }]);
  await expect(
    saveBackgroundName({ path, name: "Mine", look, expected: original }),
  ).rejects.toThrow("changed");
  expect(loadSavedThemes()[0].name).toBe("Sibling");
  saveSavedThemes([]);
  vi.mocked(addBackgroundLibraryImage).mockImplementationOnce(async () => {
    saveSavedThemes([{ ...original, imageId: "b".repeat(24), id: "other" }]);
    return { id, path, source: "added", prompt: null, createdMs: 1, bytes: 10 };
  });
  await saveBackgroundName({ path, name: "Mine", look, expected: null });
  expect(loadSavedThemes().map((theme) => theme.id)).toContain("other");
});

it("names legacy selections without changing their path, then reloads the same alias", async () => {
  const legacy = "/old/chat-background.html";
  const prepared = await prepareBackgroundName(legacy);
  const saved = await saveBackgroundName({ path: legacy, name: "Old lake", look, ...prepared });
  expect(saved.backgroundPaths).toEqual([legacy]);
  expect(backgroundDisplayName(legacy, loadSavedThemes())).toBe("Old lake");
  expect(backgroundDisplayName(`/library/${id}.html`, loadSavedThemes())).toBe("Old lake");
});
