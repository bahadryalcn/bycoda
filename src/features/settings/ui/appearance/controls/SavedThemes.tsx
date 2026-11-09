import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Pencil, RefreshCw, Trash2 } from "../../../../../shared/ui/icons";
import { ACCENT_COLOR_DEFAULT, THEME_DARK_LIGHTNESS_DEFAULT } from "../../../model/appearance";
import { libraryImageSrc, useBackgroundLibrary } from "../../../model/backgroundLibrary";
import { useSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import { SettingsFeedback } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { paletteSwatches } from "./PaletteCards";
import {
  applySavedTheme,
  deleteTheme,
  overwriteWithCurrentLook,
  renameTheme,
} from "./savedThemeActions";
import { ThemeNameDialog } from "./ThemeNameDialog";
import "./ThemeControls.css";

/**
 * Saved looks as cards: click applies the whole look including its background image. Each card can
 * be renamed, overwritten with the current look, or deleted (after a confirmation).
 */
export function SavedThemes({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const themes = useSavedThemes();
  const { images } = useBackgroundLibrary();
  const { confirm, dialog } = useConfirm();
  const [renaming, setRenaming] = useState<SavedTheme | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (themes.length === 0) return <p className="theme-saved-empty">{t("No saved themes yet.")}</p>;

  const apply = async (theme: SavedTheme) => {
    setBusy(true);
    setNotice(null);
    try {
      if ((await applySavedTheme(appearance, theme)) === "image-missing")
        setNotice(
          t("This theme's image is no longer in the library. The rest of the look was applied."),
        );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const overwrite = (theme: SavedTheme) =>
    confirm({
      title: t("Overwrite theme"),
      message: t("Replace “{p0}” with the current look?", { p0: theme.name }),
      confirmLabel: t("Overwrite"),
      tone: "neutral",
      onConfirm: async () => {
        if (!(await overwriteWithCurrentLook(appearance, theme.id)))
          throw new Error(t("Could not save the theme."));
      },
    }).catch((error: unknown) => console.error(error));
  const remove = (theme: SavedTheme) =>
    confirm({
      title: t("Delete theme"),
      message: t("Delete “{p0}”? Its image stays in the library.", {
        p0: theme.name,
      }),
      confirmLabel: t("Delete"),
      onConfirm: () => {
        if (!deleteTheme(theme.id)) throw new Error(t("Could not save the theme."));
      },
    }).catch((error: unknown) => console.error(error));

  return (
    <>
      <ul className="theme-saved" aria-label={t("Saved themes")}>
        {themes.map((theme) => {
          const look = theme.look;
          const image = images.find((entry) => entry.id === theme.imageId);
          const swatches = paletteSwatches(
            look.hue ?? appearance.themeHue,
            look.saturation ?? appearance.themeSaturation,
            look.darkLightness ?? THEME_DARK_LIGHTNESS_DEFAULT,
            look.accent ?? ACCENT_COLOR_DEFAULT,
          );
          return (
            <li key={theme.id} className="theme-saved-card">
              <Button
                variant="item"
                className="theme-saved-apply"
                disabled={busy}
                tooltip={t("Apply this look")}
                onClick={() => {
                  apply(theme).catch((error: unknown) => console.error(error));
                }}
              >
                <span className="theme-palette-swatches" aria-hidden="true">
                  {swatches.map((color, index) => (
                    <span key={index} style={{ background: color }} />
                  ))}
                  {image ? <img src={libraryImageSrc(image)} alt="" draggable={false} /> : null}
                </span>
                <span className="theme-palette-name">{theme.name}</span>
              </Button>
              <span className="theme-saved-actions">
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  label={t("Rename")}
                  onClick={() => setRenaming(theme)}
                >
                  <Pencil />
                </Button>
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  label={t("Overwrite with current look")}
                  onClick={() => overwrite(theme)}
                >
                  <RefreshCw />
                </Button>
                <Button
                  iconOnly
                  size="sm"
                  variant="ghost"
                  label={t("Delete")}
                  onClick={() => remove(theme)}
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {notice ? (
        <SettingsFeedback state="warning" onDismiss={() => setNotice(null)}>
          {notice}
        </SettingsFeedback>
      ) : null}
      {renaming ? (
        <ThemeNameDialog
          title={t("Rename theme")}
          confirmLabel={t("Rename")}
          initialName={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            if (!renameTheme(renaming.id, name)) throw new Error(t("Could not save the theme."));
          }}
        />
      ) : null}
      {dialog}
    </>
  );
}
