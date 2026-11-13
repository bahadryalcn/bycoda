import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Text } from "../../../../../shared/ui/Text";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Pencil, RefreshCw, Trash2 } from "../../../../../shared/ui/icons";
import { ACCENT_COLOR_DEFAULT, THEME_DARK_LIGHTNESS_DEFAULT } from "../../../model/appearance";
import { libraryImageSrc, useBackgroundLibrary } from "../../../model/backgroundLibrary";
import { useSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import { SettingsFeedback } from "../../settingsControls";
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
 * Saved looks as a wrapping grid of compact cards (two rows, then a toggle), ending in a dashed
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

  // Collapsed, the grid shows two rows (the add card takes the last slot); the column count is
  // whatever the responsive grid currently lays out.
  const grid = useRef<HTMLUListElement>(null);
  const [columns, setColumns] = useState(3);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setColumns(
        Math.max(
          1,
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const limit = columns * 2 - 1;
  const collapsible = themes.length > limit;
  const visible = collapsible && !expanded ? themes.slice(0, limit) : themes;

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
      <ul ref={grid} className="theme-saved" aria-label={t("Saved themes")}>
        {visible.map((theme) => {
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
            { radius: "row", variant: "base" },
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
                  {image ? <img src={libraryImageSrc(image)} alt="" draggable={false} /> : null}
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
        <li
          {...surfaceAttributes({ frame: "pane", borderStyle: "dashed" }, "theme-saved-card")}
          data-add
        >
          <SaveLookButton appearance={appearance} card />
        </li>
      </ul>
      {collapsible ? (
        <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("Show less") : t("Show all ({p0})", { p0: themes.length })}
        </Button>
      ) : null}
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
