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
import { saveBackgroundName, prepareBackgroundName } from "../../../runtime/nameBackground";
import { SettingsFeedback } from "../../../../../shared/ui/settings";
import { ErrorDetails } from "../../../../../shared/ui/ErrorDetails";
import { errorText } from "../../../../../shared/lib/errors";
import { ThemeNameDialog } from "./ThemeNameDialog";

/** Direct naming in the ordinary library/history; editing never changes the selected file. */
export function SaveBackgroundButton({
  path,
  disabled = false,
  image,
  look,
  designId,
}: {
  path: string;
  disabled?: boolean;
  image?: BackgroundLibraryImage;
  /** The look to store; defaults to the item's own saved look, then the current appearance. */
  look?: AppearanceSnapshot;
  /** Resolve this exact design when several share the media. */
  designId?: string;
}) {
  const themes = useSavedThemes();
  const design = backgroundDesign(path, themes, image?.id, designId);
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
      const snapshot = look ?? design?.look ?? captureAppearanceSnapshot();
      const target = await prepareBackgroundName(path, image, designId);
      setEditing({ path, ...target, look: snapshot });
    } catch (cause) {
      setError(errorText(cause));
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
        disabledReason={t("Wait for the current action to finish.")}
        loading={preparing}
        loadingLabel={t("Loading…")}
        aria-label={design ? `${t("Rename")}: ${design.name}` : t("Save background")}
        onClick={() => void open()}
      >
        {design ? t("Rename") : t("Save background")}
      </Button>
      {error ? (
        <SettingsFeedback
          state="error"
          extra={<ErrorDetails title={t("Could not complete this action.")} detail={error} />}
        >
          {t("Could not complete this action.")}
        </SettingsFeedback>
      ) : null}
      {editing ? (
        <ThemeNameDialog
          title={editing.expected ? t("Rename") : t("Save background")}
          inputLabel={t("Design name")}
          confirmLabel={t("Save")}
          initialName={editing.expected?.name ?? ""}
          onClose={() => setEditing(null)}
          onSubmit={async (name) => {
            await saveBackgroundName({ ...editing, name, designId });
          }}
        />
      ) : null}
    </>
  );
}
