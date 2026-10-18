import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { loadFormatOnSave, saveFormatOnSave } from "../model/settings";
import { AdvancedSettings, Group, Row, Toggle } from "./settingsControls";

export function WorkspaceEditorSettings() {
  useLocale();
  const [formatOnSave, setFormatOnSave] = useState(loadFormatOnSave);
  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    setFormatOnSave(next);
  };
  return (
    <>
      <AdvancedSettings title={t("Advanced editor settings")} settingIds={["format-on-save"]}>
        <Group title={t("Editor")} layout="full">
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
      </AdvancedSettings>
    </>
  );
}
