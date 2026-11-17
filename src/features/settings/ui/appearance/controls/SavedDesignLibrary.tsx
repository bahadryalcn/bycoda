import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Text } from "../../../../../shared/ui/Text";
import { Heading } from "../../../../../shared/ui/Heading";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { useSavedThemes, loadSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import { exportDesign, importDesign } from "../../../runtime/savedDesigns";
import { renameTheme, deleteTheme } from "./savedThemeActions";
import { ThemeNameDialog } from "./ThemeNameDialog";

export function SavedDesignLibrary({
  disabled,
  onOpen,
  onApply,
  onError,
}: {
  disabled: boolean;
  onOpen: (theme: SavedTheme) => Promise<void>;
  onApply: (theme: SavedTheme) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const themes = useSavedThemes().filter((theme) => theme.creation);
  const [renaming, setRenaming] = useState<SavedTheme | null>(null);
  const [pending, setPending] = useState(false);
  const { confirm, dialog } = useConfirm();
  const guard = (theme: SavedTheme) => {
    if (
      JSON.stringify(loadSavedThemes().find((item) => item.id === theme.id)) !==
      JSON.stringify(theme)
    )
      throw new Error(t("The saved design changed. Reopen it before saving again."));
  };
  const run = async (action: () => Promise<unknown>) => {
    if (disabled || pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading size="section">{t("Saved designs")}</Heading>
        <Button
          disabled={disabled || pending}
          onClick={() =>
            void run(async () => {
              const theme = await importDesign();
              if (theme?.creation) await onOpen(theme);
            })
          }
        >
          {t("Import design")}
        </Button>
      </div>
      {themes.length === 0 ? (
        <EmptyState size="inline" context="list" title={t("No saved designs")} />
      ) : (
        <ul className="grid min-w-0 gap-2">
          {themes.map((theme) => (
            <li key={theme.id} className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <Text as="div" weight="medium" truncate>
                  {theme.name}
                </Text>
                <Text as="div" size="caption" tone="muted">
                  {theme.creation?.kind === "motion"
                    ? t("Motion preset")
                    : theme.creation?.kind === "scene"
                      ? t("Live scene")
                      : t("Background")}
                </Text>
              </div>
              <Button
                size="sm"
                disabled={disabled || pending}
                onClick={() => void run(() => onOpen(theme))}
              >
                {t("Open")}
              </Button>
              <Button
                size="sm"
                disabled={disabled || pending}
                onClick={() => void run(() => onApply(theme))}
              >
                {t("Apply")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || pending}
                onClick={() => setRenaming(theme)}
              >
                {t("Rename")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || pending}
                onClick={() => void run(() => exportDesign(theme))}
              >
                {t("Export")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                tone="danger"
                disabled={disabled || pending}
                onClick={() =>
                  void confirm({
                    title: t("Delete design"),
                    message: t("Delete {p0}? Imported media stays on this device.", {
                      p0: theme.name,
                    }),
                    confirmLabel: t("Delete"),
                    onConfirm: () => {
                      guard(theme);
                      if (!deleteTheme(theme.id)) throw new Error(t("Could not save the theme."));
                    },
                  }).catch(onError)
                }
              >
                {t("Delete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {renaming ? (
        <ThemeNameDialog
          title={t("Rename")}
          confirmLabel={t("Save")}
          initialName={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            guard(renaming);
            if (!renameTheme(renaming.id, name)) throw new Error(t("Could not save the theme."));
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}
