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
import { Group, Row, SettingsFeedback, Toggle } from "./settingsControls";

export function WorkspaceEditorSettings() {
  useLocale();
  const autosave = useSyncExternalStore(subscribeAutosave, loadAutosave, loadAutosave);
  const formatOnSave = useSyncExternalStore(subscribeFormatOnSave, loadFormatOnSave, loadFormatOnSave);
  const [formatError, setFormatError] = useState(false);
  const [autosaveError, setAutosaveError] = useState(false);
  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    const saved = loadFormatOnSave();
    setFormatError(saved !== next);
  };
  return (
    <Group title={t("Editor")} layout="full">
      <Row
        id="auto-save"
        label={t("Autosave")}
        dependency={t("Autosave can save existing unsaved changes. Format on save applies to manual and automatic saves.")}
        feedback={autosaveError ? <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback> : undefined}
      >
        <Toggle label={t("Autosave")} on={autosave} onChange={(next) => setAutosaveError(saveAutosave(next) !== next)} />
      </Row>
      <Row
        id="format-on-save"
        label={t("Format on save")}
        dependency={t("Formatting requires a file type supported by Prettier.")}
        feedback={formatError ? <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback> : undefined}
        description={t(
          "Run Prettier on supported files before writing. Off keeps the text you typed, including quote style.",
        )}
      >
        <Toggle label={t("Format on save")} on={formatOnSave} onChange={onFormatOnSave} />
      </Row>
    </Group>
  );
}
