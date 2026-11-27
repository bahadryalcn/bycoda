import { expect, it } from "vitest";
import { backgroundDesign, backgroundDisplayName } from "./backgroundNames";
import type { SavedTheme } from "./savedThemes";
import { normalizeSavedThemes, overwriteSavedTheme, dropImageReference } from "./savedThemes";
const id = "a".repeat(24),
  path = `/owned/asset-${id}${"a".repeat(40)}.html`;
const theme = (name: string, key: string, createdAt = 1): SavedTheme => ({
  id: key,
  name,
  imageId: id,
  look: {},
  createdAt,
  updatedAt: createdAt,
  creation: { kind: "scene", prompt: "source stays on disk" },
});
it("uses the same existing name for immutable assets and library paths in any scope", () => {
  const themes = [theme("Forest lake", "one")];
  expect(backgroundDisplayName(path, themes)).toBe("Forest lake");
  expect(backgroundDisplayName(`/library/${id}.html`, themes)).toBe("Forest lake");
  expect(backgroundDisplayName(`/project/asset-${id}${"a".repeat(40)}.html`, themes)).toBe(
    "Forest lake",
  );
});
it("preserves named variants and resolves one stable primary regardless of update order", () => {
  const first = theme("Original", "one"),
    copy = theme("Copy", "two", 2);
  expect(backgroundDesign(path, [copy, { ...first, updatedAt: 99 }])?.name).toBe("Original");
});
it("uses translated friendly types instead of exposing immutable SHA filenames", () => {
  expect(backgroundDisplayName(path, [])).toBe("Live scene");
  expect(backgroundDisplayName("/asset-bbb.mp4", [])).toBe("Video");
  expect(backgroundDisplayName("/image.png", [])).toBe("Image");
});

it("bounds legacy label aliases and removes them when their immutable media changes", () => {
  const saved = normalizeSavedThemes([
    {
      ...theme("Legacy", "old"),
      backgroundPaths: [
        "/legacy.html",
        null,
        "x".repeat(4097),
        ...Array.from({ length: 12 }, (_, i) => `/old-${i}.html`),
      ],
    },
  ]);
  expect(saved[0].backgroundPaths).toHaveLength(8);
  expect(backgroundDisplayName("/legacy.html", saved)).toBe("Legacy");
  expect(
    overwriteSavedTheme(saved, "old", { look: {}, imageId: id }, 2)[0].backgroundPaths,
  ).toEqual(saved[0].backgroundPaths);
  const replaced = overwriteSavedTheme(saved, "old", { look: {}, imageId: "b".repeat(24) }, 2);
  expect(replaced[0].backgroundPaths).toBeUndefined();
  expect(backgroundDisplayName("/legacy.html", replaced)).toBe("Live scene");
  expect(dropImageReference(saved, id)[0].backgroundPaths).toBeUndefined();
});

it("resolves a copy that shares its original's media by its own design id", () => {
  const first = theme("Original", "one"),
    copy = theme("Copy", "two", 2);
  expect(backgroundDesign(path, [first, copy], undefined, "two")?.name).toBe("Copy");
  expect(backgroundDisplayName(path, [first, copy], undefined, "two")).toBe("Copy");
  expect(backgroundDesign(path, [first, copy], undefined, "missing")?.name).toBe("Original");
});
