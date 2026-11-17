import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import {
  captureAppearanceSnapshot,
  type AppearanceSnapshot,
} from "../../../model/appearanceSnapshot";
import { backgroundDesign } from "../../../model/backgroundNames";
import { useSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import type { BackgroundLibraryImage } from "../../../model/backgroundLibrary";
import { saveBackgroundName } from "../../../runtime/nameBackground";
import { prepareBackgroundName } from "../../../runtime/nameBackground";
import { SettingsFeedback } from "../../../../../shared/ui/settings";
import { ThemeNameDialog } from "./ThemeNameDialog";

/** Direct naming in the ordinary library/history; editing never changes the selected file. */
export function SaveBackgroundButton({
  path,
  disabled = false,
  image,
  look,
}: {
  path: string;
  disabled?: boolean;
  image?: BackgroundLibraryImage;
  look?: AppearanceSnapshot;
}) {
  const themes = useSavedThemes();
  const design = backgroundDesign(path, themes, image?.id);
  const [editing, setEditing] = useState<{
    path: string;
    image?: BackgroundLibraryImage;
    expected: SavedTheme | null;
    look: AppearanceSnapshot;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (disabled || preparing) return;
    setPreparing(true);
    setError(null);
    try {
      const snapshot = look ?? captureAppearanceSnapshot();
      const target = await prepareBackgroundName(path, image);
      setEditing({ path, ...target, look: snapshot });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreparing(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || preparing}
        loading={preparing}
        loadingLabel={t("Loading…")}
        aria-label={design ? `${t("Rename")}: ${design.name}` : t("Save background")}
        onClick={() => void open().catch((cause) => setError(String(cause)))}
      >
        {design ? t("Rename") : t("Save background")}
      </Button>
      {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      {editing ? (
        <ThemeNameDialog
          title={editing.expected ? t("Rename") : t("Save background")}
          inputLabel={t("Design name")}
          confirmLabel={t("Save")}
          initialName={editing.expected?.name ?? ""}
          onClose={() => setEditing(null)}
          onSubmit={async (name) => {
            await saveBackgroundName({ ...editing, name });
          }}
        />
      ) : null}
    </>
  );
}
