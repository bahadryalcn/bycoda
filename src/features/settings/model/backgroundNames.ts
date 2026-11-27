import { t } from "../../../shared/i18n";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import type { SavedTheme } from "./savedThemes";

/** Native assets use a full digest; their library copies use its first 24 characters. */
export function backgroundMediaId(path: string): string | undefined {
  return path
    .split(/[\\/]/)
    .pop()
    ?.match(/^(?:asset-)?([a-f0-9]{24}|[a-f0-9]{64})\.[a-z0-9]+$/i)?.[1]
    .slice(0, 24)
    .toLowerCase();
}

/**
 * One stable name per media surface. Named variants (a "Save a copy" shares its original's media)
 * keep their own names: pass `designId` to resolve that exact design; otherwise the oldest wins.
 */
export function backgroundDesign(
  path: string,
  themes: readonly SavedTheme[],
  libraryId = backgroundMediaId(path),
  designId?: string,
): SavedTheme | undefined {
  const candidates = themes.filter(
    (theme) =>
      theme.imageId &&
      (libraryId ? theme.imageId === libraryId : theme.backgroundPaths?.includes(path)) &&
      theme.creation?.kind !== "motion",
  );
  return (
    candidates.find((theme) => theme.id === designId) ??
    candidates.sort(
      (a, b) =>
        Number(!a.creation) - Number(!b.creation) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )[0]
  );
}

export function backgroundDisplayName(
  path: string,
  themes: readonly SavedTheme[],
  libraryId?: string,
  designId?: string,
): string {
  return backgroundDesign(path, themes, libraryId, designId)?.name ?? backgroundKindLabel(path);
}

export function backgroundKindLabel(path: string): string {
  const kind = chatBackgroundKind(path);
  return kind === "html" ? t("Live scene") : kind === "video" ? t("Video") : t("Image");
}
