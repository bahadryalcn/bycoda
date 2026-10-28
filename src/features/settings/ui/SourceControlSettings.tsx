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
import { GitGenerationModelControl } from "../../source-control/ui/GitGenerationSettings";
import {
  saveDefaultGitGenerationChoice,
  useDefaultGitGenerationChoice,
} from "../../source-control/model/gitGenerationPreferences";
import { Button } from "../../../shared/ui/Button";

export function SourceControlSettings() {
  useLocale();
  const gitGenerationChoice = useDefaultGitGenerationChoice();
  const [diffViewer, setDiffViewer] = useStoredPreferenceState(loadDiffViewer, subscribeDiffViewer);
  const [diffError, setDiffError] = useState(false);
  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    const saved = loadDiffViewer();
    setDiffViewer(saved);
    setDiffError(saved !== next);
  };
  return (
    <>
      <Group
        title={t("Commit and pull request generation")}
        layout="full"
        scope={t("Used across projects unless a project has its own generation selection.")}
      >
        <Row
          id="git-generation-default"
          label={t("Model")}
          description={t("Used across projects unless a project has its own generation selection.")}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!gitGenerationChoice && (
              <span className="text-ui-secondary text-(--ui-text-secondary)">{t("Automatic")}</span>
            )}
            <GitGenerationModelControl
              choice={gitGenerationChoice}
              onChange={saveDefaultGitGenerationChoice}
            />
            {gitGenerationChoice && (
              <Button variant="link" onClick={() => saveDefaultGitGenerationChoice(undefined)}>
                {t("Use automatic selection")}
              </Button>
            )}
          </div>
        </Row>
      </Group>
      <Group title={t("Code review")} layout="full">
        <Row
          id="diff-view"
          label={t("Diff view")}
          description={t("Review changes in the editor or together in one unified view.")}
          feedback={diffError ? <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback> : undefined}
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
    </>
  );
}
