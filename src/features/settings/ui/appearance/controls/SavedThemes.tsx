import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { chatBackgroundKind } from "../../../../../shared/lib/chatBackgroundKind";
import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Text } from "../../../../../shared/ui/Text";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Pencil, RefreshCw, Trash2 } from "../../../../../shared/ui/icons";
import { ACCENT_COLOR_DEFAULT, THEME_DARK_LIGHTNESS_DEFAULT } from "../../../model/appearance";
import { libraryImageSrc, useBackgroundLibrary } from "../../../model/backgroundLibrary";
import { useSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import { SettingsFeedback } from "../../../../../shared/ui/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { SaveLookButton } from "./SaveLookButton";
import { paletteSwatches } from "./PaletteCards";
import {
  applySavedTheme,
  deleteTheme,
  overwriteWithCurrentLook,
  renameTheme,
} from "./savedThemeActions";
import { ThemeNameDialog } from "./ThemeNameDialog";
import "./ThemeControls.css";
import { writeGeneratorValue } from "./themeGeneratorSession";

/**
 * Saved looks as one horizontally scrolling strip of compact cards, starting with a dashed
 * save card: click applies the whole look including its background image. Each card can
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

  const apply = async (theme: SavedTheme) => {
    if (busy || appearance.chatBackgroundBusy) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await applySavedTheme(appearance, theme);
      writeGeneratorValue("selectedLookName", theme.name, "");
      if (outcome === "image-missing")
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
        <li
          {...surfaceAttributes({ frame: "pane", borderStyle: "dashed" }, "theme-saved-card")}
          data-add
        >
          <SaveLookButton appearance={appearance} card />
        </li>
        {themes.map((theme) => {
          const look = theme.look;
          const image = images.find((entry) => entry.id === theme.imageId);
          const swatches = paletteSwatches(
            look.hue ?? appearance.themeHue,
            look.saturation ?? appearance.themeSaturation,
            look.darkLightness ?? THEME_DARK_LIGHTNESS_DEFAULT,
            look.accent ?? ACCENT_COLOR_DEFAULT,
          );
          const cardSurface = surfaceAttributes(
            { frame: "pane", radius: "preview" },
            "theme-saved-card",
          );
          const actionSurface = surfaceAttributes(
            { radius: "row", variant: "canvas" },
            "theme-saved-actions",
          );
          return (
            <li
              key={theme.id}
              {...cardSurface}
              {...actionContentScopeAttributes(cardSurface.className)}
            >
              <Button
                variant="item"
                className="theme-saved-apply"
                disabled={busy || appearance.chatBackgroundBusy}
                tooltip={t("Apply this look")}
                onClick={() => {
                  apply(theme).catch((error: unknown) => console.error(error));
                }}
              >
                <span className="theme-palette-swatches" aria-hidden="true">
                  {swatches.map((color, index) => (
                    <span
                      key={index}
                      {...surfaceAttributes({ variant: "user-color" })}
                      style={{ "--surface-user-color": color } as React.CSSProperties}
                    />
                  ))}
                  {image && chatBackgroundKind(image.path) === "image" ? (
                    <img
                      src={libraryImageSrc(image)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  ) : null}
                </span>
                <Text
                  as="span"
                  size="secondary"
                  tone="inherit"
                  weight="medium"
                  leading="inherit"
                  truncate
                >
                  {theme.name}
                </Text>
              </Button>
              <span
                {...actionSurface}
                {...actionContentAttributes(
                  { phase: "interaction", hide: "opacity", focus: "within", display: "flex" },
                  actionSurface.className,
                )}
              >
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
            writeGeneratorValue<string>(
              "selectedLookName",
              (current) => (current === renaming.name ? name : current),
              "",
            );
          }}
        />
      ) : null}
      {dialog}
    </>
  );
}
