import { useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Plus } from "../../../../../shared/ui/icons";
import { SAVED_THEMES_MAX, useSavedThemes } from "../../../model/savedThemes";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { saveCurrentLook } from "./savedThemeActions";
import { ThemeNameDialog } from "./ThemeNameDialog";
import { useGeneratorState } from "./themeGeneratorSession";

/**
 * The one "Save current look" entry: a dashed card in the saved-themes grid. It saves the whole
 * current look (every Appearance setting and the chat background image) under a name the owner
 * types, the same after an AI suggestion or a hand-made change.
 */
export function SaveLookButton({
  appearance,
  pendingImage,
}: {
  appearance: AppearanceSettings;
  /** The generator is still drawing an image; saving captures the current applied look only. */
  pendingImage?: boolean;
}) {
  useLocale();
  const [asking, setAsking] = useState(false);
  const [selectedLookName, setSelectedLookName] = useGeneratorState("selectedLookName", "");
  const [chipImages] = useGeneratorState<Record<number, { status: string }>>("chipImages", {});
  const imagePending =
    pendingImage ?? Object.values(chipImages).some((image) => image.status === "loading");
  const full = useSavedThemes().length >= SAVED_THEMES_MAX;
  const label = t("Save current look");
  const blocked = full ? t("Delete a saved theme to save another.") : undefined;
  return (
    <>
      <Button
        variant="item"
        className="theme-saved-add"
        textTone="muted"
        startIcon={<Plus />}
        disabled={full}
        disabledReason={blocked}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
      {asking ? (
        <ThemeNameDialog
          title={label}
          confirmLabel={t("Save")}
          initialName={selectedLookName}
          description={
            imagePending
              ? t(
                  "The image is still generating. This saves your current look without the pending image.",
                )
              : undefined
          }
          onClose={() => setAsking(false)}
          onSubmit={async (name) => {
            if (!(await saveCurrentLook(appearance, name)))
              throw new Error(t("Could not save the theme."));
            setSelectedLookName(name);
          }}
        />
      ) : null}
    </>
  );
}
