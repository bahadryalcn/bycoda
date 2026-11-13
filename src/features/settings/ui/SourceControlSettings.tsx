import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadDiffViewer,
  saveDiffViewer,
  subscribeDiffViewer,
  type DiffViewer,
} from "../model/settings";
import { Group, Row, Segmented, SettingsFeedback } from "./settingsControls";
import { Button } from "../../../shared/ui/Button";
import { openModelsSettings } from "../public/modelsSettingsLink";

export function SourceControlSettings() {
  useLocale();
  const [diffViewer, setDiffViewer] = useStoredPreferenceState(loadDiffViewer, subscribeDiffViewer);
  const [diffError, setDiffError] = useState(false);
  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    const saved = loadDiffViewer();
    setDiffViewer(saved);
    setDiffError(saved !== next);
  };
  return (
    <div className="source-control-settings settings-topics flex min-w-0 flex-col gap-8">
      <Group
        title={t("Generation")}
        scope={t("Used across projects unless a project has its own generation selection.")}
      >
        <Row
          id="git-generation-default"
          label={t("Model")}
          description={t("Model set in Settings > Models > Assignments.")}
        >
          <Button variant="link" onClick={() => openModelsSettings("roles")}>
            {t("Manage models")}
          </Button>
        </Row>

        <Row
          id="diff-view"
          label={t("Diff view")}
          description={t("Review changes in the editor or together in one unified view.")}
          feedback={
            diffError ? (
              <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
            ) : undefined
          }
        >
          <Segmented
            label={t("Diff view")}
            value={diffViewer}
            options={[
              { value: "editor", label: t("Editor") },
              { value: "unified", label: t("Unified") },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
      </Group>
    </div>
  );
}
