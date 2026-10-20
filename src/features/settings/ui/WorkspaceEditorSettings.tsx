import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadAutosave,
  saveAutosave,
  subscribeAutosave,
  loadFormatOnSave,
  saveFormatOnSave,
} from "../model/settings";
import { Group, Row, Toggle } from "./settingsControls";

export function WorkspaceEditorSettings() {
  useLocale();
  const autosave = useSyncExternalStore(subscribeAutosave, loadAutosave, loadAutosave);
  const [formatOnSave, setFormatOnSave] = useState(loadFormatOnSave);
  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    setFormatOnSave(next);
  };
  return (
    <Group title={t("Editor")} layout="full">
      <Row id="auto-save" label={t("Autosave")}>
        <Toggle label={t("Autosave")} on={autosave} onChange={saveAutosave} />
      </Row>
      <Row
        id="format-on-save"
        label={t("Format on save")}
        dependency={t("Formatting requires a file type supported by Prettier.")}
        description={t(
          "Run Prettier on supported files before writing. Off keeps the text you typed, including quote style.",
        )}
      >
        <Toggle label={t("Format on save")} on={formatOnSave} onChange={onFormatOnSave} />
      </Row>
    </Group>
  );
}
