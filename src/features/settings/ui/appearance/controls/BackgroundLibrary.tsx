import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
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
import { Row, SettingsFeedback } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import styles from "./BackgroundLibrary.module.css";
import { generatorSession } from "./themeGeneratorSession";

/**
 * Every image applied before, generated or added, as thumbnails: click to apply it again, delete
 * with a confirmation. A saved theme that uses an image is named in the confirmation and keeps its
 * look without the picture once the image is deleted.
 */
export function BackgroundLibrary({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const { images, currentId, loaded, loading, error, retry } = useBackgroundLibrary();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const themes = useSavedThemes();
  const { confirm, dialog } = useConfirm();
  const backfilled = useRef<string | null>(null);
  const path = appearance.chatBackgroundPath;

  // An image applied before the library existed joins it, so it can be picked and saved again.
  useEffect(() => {
    if (!loaded || error || !path || currentId || backfilled.current === path) return;
    backfilled.current = path;
    ensureCurrentLibraryImage(path).catch(() => undefined);
  }, [loaded, error, path, currentId]);

  const apply = (image: BackgroundLibraryImage) => {
    if (image.id === currentId || appearance.chatBackgroundBusy || applyingId) return;
    generatorSession.invalidateImageIntent();
    setApplyingId(image.id);
    appearance
      .onChooseChatBackground(image.path, { libraryId: image.id })
      .catch((error: unknown) => console.error(error))
      .finally(() => setApplyingId(null));
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
        const currentThemes = loadSavedThemes();
        if (
          themesUsingImage(currentThemes, image.id).length > 0 &&
          !saveSavedThemes(dropImageReference(currentThemes, image.id))
        )
          throw new Error(t("Could not save the theme."));
      },
    }).catch((error: unknown) => console.error(error));
  };

  return (
    <Row id="background-library" stacked label={t("Library")}>
      {error ? (
        <SettingsFeedback
          state="error"
          action={
            <Button loading={loading} loadingLabel={t("Loading…")} onClick={retry}>
              {t("Retry")}
            </Button>
          }
        >
          {t("Could not load the image library. Retry to see your saved images.")}
        </SettingsFeedback>
      ) : !loaded ? (
        <Text as="p" size="caption" tone="muted">
          {t("Loading…")}
        </Text>
      ) : null}
      {loaded && !error && images.length === 0 ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className={styles.empty}>
          {t("Images you use appear here.")}
        </Text>
      ) : images.length > 0 ? (
        <ul className={styles.grid} aria-label={t("Library")}>
          {images.map((image) => {
            const generated = image.source === "generated";
            return (
              <li key={image.id} {...actionContentScopeAttributes(styles.item)}>
                <Button
                  variant="item"
                  {...surfaceAttributes({ variant: "selected", radius: "row" }, styles.tile)}
                  selected={image.id === currentId}
                  disabled={appearance.chatBackgroundBusy || applyingId !== null || loading}
                  loading={applyingId === image.id}
                  loadingLabel={t("Applying…")}
                  selectionIndicator="accent-ring"
                  aria-label={generated ? t("Generated image") : t("Added image")}
                  tooltip={image.prompt ?? undefined}
                  onClick={() => apply(image)}
                >
                  <img src={libraryImageSrc(image)} alt="" draggable={false} loading="lazy" />
                  {generated ? (
                    <Text
                      size="inherit"
                      tone="secondary"
                      leading="inherit"
                      {...surfaceAttributes({ radius: "pill", variant: "plain" }, styles.badge)}
                      aria-hidden="true"
                    >
                      <Sparkles className="icon-xs" />
                    </Text>
                  ) : null}
                </Button>
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  {...actionContentAttributes(
                    { phase: "interaction", hide: "opacity", focus: "within", touch: "preserve" },
                    styles.remove,
                  )}
                  label={t("Delete image")}
                  disabled={appearance.chatBackgroundBusy || applyingId !== null || loading}
                  onClick={() => remove(image)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {dialog}
    </Row>
  );
}
