import { t } from "../../../shared/i18n";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import {
  addBackgroundLibraryImage,
  listBackgroundLibrary,
  type BackgroundLibraryImage,
} from "../model/backgroundLibrary";
import { backgroundDesign, backgroundMediaId } from "../model/backgroundNames";
import {
  addSavedTheme,
  loadSavedThemes,
  normalizeSavedThemes,
  normalizeThemeName,
  saveSavedThemes,
  type SavedTheme,
} from "../model/savedThemes";
import { designLook } from "../model/designs";
import type { AppearanceSnapshot } from "../model/appearanceSnapshot";

/** Resolve legacy media before opening its name form, without changing the active selection. */
export async function prepareBackgroundName(path: string, image?: BackgroundLibraryImage) {
  const known = backgroundDesign(path, loadSavedThemes(), image?.id);
  if (known || image || backgroundMediaId(path)) return { expected: known ?? null, image };
  const resolved =
    (await listBackgroundLibrary()).find((image) => image.path === path) ??
    (await addBackgroundLibraryImage(path));
  return {
    image: resolved,
    expected: backgroundDesign(path, loadSavedThemes(), resolved.id) ?? null,
  };
}

/** Names use the existing saved-design catalog. This operation never applies media or preferences. */
export async function saveBackgroundName(input: {
  path: string;
  name: string;
  look: AppearanceSnapshot;
  expected: SavedTheme | null;
  image?: BackgroundLibraryImage;
}): Promise<SavedTheme> {
  const name = normalizeThemeName(input.name);
  if (!name) throw new Error(t("Enter a design name."));
  const image = input.expected
    ? undefined
    : (input.image ??
      (await listBackgroundLibrary()).find(
        (image) => image.id === backgroundMediaId(input.path) || image.path === input.path,
      ) ??
      (await addBackgroundLibraryImage(input.path)));
  const id = input.expected?.imageId ?? image?.id;
  const themes = loadSavedThemes();
  const current = backgroundDesign(input.path, themes, id);
  if (
    JSON.stringify(current ?? null) !==
    JSON.stringify(input.expected ? (normalizeSavedThemes([input.expected])[0] ?? null) : null)
  )
    throw new Error(t("The saved design changed. Reopen it before saving again."));
  let next: SavedTheme[], saved: SavedTheme;
  if (current) {
    saved = {
      ...current,
      name,
      updatedAt: Date.now(),
      ...(!backgroundMediaId(input.path)
        ? {
            backgroundPaths: [...new Set([input.path, ...(current.backgroundPaths ?? [])])].slice(
              0,
              8,
            ),
          }
        : {}),
    };
    next = themes.map((theme) => (theme.id === saved.id ? saved : theme));
  } else {
    const kind = chatBackgroundKind(input.path) === "html" ? "scene" : "image";
    next = addSavedTheme(
      themes,
      {
        name,
        imageId: id,
        look: designLook(kind, input.look),
        creation: { kind, prompt: image?.prompt ?? "" },
      },
      Date.now(),
      crypto.randomUUID(),
    );
    if (next.length === themes.length)
      throw new Error(t("The saved design library is full. Delete a design first."));
    saved = next[next.length - 1];
    if (!backgroundMediaId(input.path)) {
      saved = { ...saved, backgroundPaths: [input.path] };
      next = [...next.slice(0, -1), saved];
    }
  }
  if (!saveSavedThemes(next)) throw new Error(t("Could not save the theme."));
  return saved;
}
