import { useEffect, useRef } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Sparkles, Trash2 } from "../../../../../shared/ui/icons";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import {
  deleteBackgroundLibraryImage,
  ensureCurrentLibraryImage,
  libraryImageSrc,
  useBackgroundLibrary,
  type BackgroundLibraryImage,
} from "../../../model/backgroundLibrary";
import {
  dropImageReference,
  loadSavedThemes,
  saveSavedThemes,
  themesUsingImage,
  useSavedThemes,
} from "../../../model/savedThemes";
import { Row } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import styles from "./BackgroundLibrary.module.css";

/**
 * Every image applied before, generated or added, as thumbnails: click to apply it again, delete
 * with a confirmation. A saved theme that uses an image is named in the confirmation and keeps its
 * look without the picture once the image is deleted.
 */
export function BackgroundLibrary({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const { images, currentId, loaded } = useBackgroundLibrary();
  const themes = useSavedThemes();
  const { confirm, dialog } = useConfirm();
  const backfilled = useRef<string | null>(null);
  const path = appearance.chatBackgroundPath;

  // An image applied before the library existed joins it, so it can be picked and saved again.
  useEffect(() => {
    if (!loaded || !path || currentId || backfilled.current === path) return;
    backfilled.current = path;
    ensureCurrentLibraryImage(path).catch(() => undefined);
  }, [loaded, path, currentId]);

  const apply = (image: BackgroundLibraryImage) => {
    if (image.id === currentId || appearance.chatBackgroundBusy) return;
    appearance
      .onChooseChatBackground(image.path, { libraryId: image.id })
      .catch((error: unknown) => console.error(error));
  };

  const remove = (image: BackgroundLibraryImage) => {
    const using = themesUsingImage(themes, image.id);
    confirm({
      title: t("Delete image"),
      message:
        using.length > 0
          ? t("Saved themes using this image: {p0}. They keep their look but lose the picture.", {
              p0: using.map((theme) => theme.name).join(", "),
            })
          : t("Delete this image from the library?"),
      confirmLabel: t("Delete"),
      onConfirm: async () => {
        await deleteBackgroundLibraryImage(image.id);
        if (using.length > 0) saveSavedThemes(dropImageReference(loadSavedThemes(), image.id));
      },
    }).catch((error: unknown) => console.error(error));
  };

  if (!loaded) return null;
  return (
    <Row id="background-library" stacked label={t("Library")}>
      {images.length === 0 ? (
        <p className={styles.empty}>{t("Images you use appear here.")}</p>
      ) : (
        <ul className={styles.grid} aria-label={t("Library")}>
          {images.map((image) => {
            const generated = image.source === "generated";
            return (
              <li key={image.id} className={styles.item}>
                <Button
                  variant="item"
                  className={styles.tile}
                  selected={image.id === currentId}
                  aria-label={generated ? t("Generated image") : t("Added image")}
                  tooltip={image.prompt ?? undefined}
                  onClick={() => apply(image)}
                >
                  <img src={libraryImageSrc(image)} alt="" draggable={false} loading="lazy" />
                  {generated ? (
                    <span className={styles.badge} aria-hidden="true">
                      <Sparkles className="icon-xs" />
                    </span>
                  ) : null}
                </Button>
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  className={styles.remove}
                  label={t("Delete image")}
                  onClick={() => remove(image)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </Row>
  );
}
