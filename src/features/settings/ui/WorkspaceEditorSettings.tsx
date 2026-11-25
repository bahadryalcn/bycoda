import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadAutosave,
  saveAutosave,
  subscribeAutosave,
  loadFormatOnSave,
  saveFormatOnSave,
  subscribeFormatOnSave,
} from "../model/settings";
import { Group, Row, SettingsFeedback, Toggle } from "../../../shared/ui/settings";

export function WorkspaceEditorSettings() {
  useLocale();
  const autosave = useSyncExternalStore(subscribeAutosave, loadAutosave, loadAutosave);
  const formatOnSave = useSyncExternalStore(
    subscribeFormatOnSave,
    loadFormatOnSave,
    loadFormatOnSave,
  );
  const [formatError, setFormatError] = useState(false);
  const [autosaveError, setAutosaveError] = useState(false);
  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    const saved = loadFormatOnSave();
    setFormatError(saved !== next);
  };
  return (
    <Group title={t("Editor")}>
      <Row
        id="auto-save"
        label={t("Autosave")}
        description={t("Turning on autosave can save existing unsaved changes.")}
        feedback={
          autosaveError ? (
            <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
          ) : undefined
        }
      >
        <Toggle
          label={t("Autosave")}
          on={autosave}
          onChange={(next) => setAutosaveError(saveAutosave(next) !== next)}
        />
      </Row>
      <Row
        id="format-on-save"
        label={t("Format on save")}
        feedback={
          formatError ? (
            <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
          ) : undefined
        }
        info={t(
          "Uses the project's installed formatter for supported files on manual and automatic saves.",
        )}
      >
        <Toggle label={t("Format on save")} on={formatOnSave} onChange={onFormatOnSave} />
      </Row>
    </Group>
  );
}
