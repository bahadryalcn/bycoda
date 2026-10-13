import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadDiffViewer,
  loadFormatOnSave,
  saveDiffViewer,
  saveFormatOnSave,
  type DiffViewer,
} from "../model/settings";
import { Group, Row, Segmented, Toggle } from "./settingsControls";

export function WorkspaceEditorSettings() {
  useLocale();
  const [diffViewer, setDiffViewer] = useState<DiffViewer>(loadDiffViewer);
  const [formatOnSave, setFormatOnSave] = useState(loadFormatOnSave);
  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    setDiffViewer(next);
  };
  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    setFormatOnSave(next);
  };
  return (
    <>
      <Group
        title={t("Editor")}
        description={t("What happens when you save a file in the workspace editor.")}
      >
        <Row
          id="format-on-save"
          label={t("Format on save")}
          description={t(
            "Run Prettier on supported files before writing. Off keeps the text you typed, including quote style.",
          )}
        >
          <Toggle label={t("Format on save")} on={formatOnSave} onChange={onFormatOnSave} />
        </Row>
      </Group>

      <Group
        title={t("Code review")}
        description={t("Where a turn's changes open when you go to read them.")}
      >
        <Row
          id="diff-view"
          label={t("Diff view")}
          description={t(
            "Editor keeps working-tree changes in the file. Unified stacks every changed file in one review, with sticky headers and collapsed unchanged lines.",
          )}
        >
          <Segmented
            label={t("Diff view")}
            value={diffViewer}
            options={[
              {
                value: "editor",
                get label() {
                  return t("Editor");
                },
              },
              {
                value: "unified",
                get label() {
                  return t("Unified");
                },
              },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
      </Group>
    </>
  );
}
