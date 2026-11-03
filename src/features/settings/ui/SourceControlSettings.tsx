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
import { RotateCcw } from "../../../shared/ui/icons";
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
  const [generationError, setGenerationError] = useState<{
    choice: Parameters<typeof saveDefaultGitGenerationChoice>[0];
  } | null>(null);
  const onGenerationChoice = (choice: Parameters<typeof saveDefaultGitGenerationChoice>[0]) => {
    try {
      saveDefaultGitGenerationChoice(choice);
      setGenerationError(null);
    } catch {
      setGenerationError({ choice });
    }
  };
  return (
    <div className="source-control-settings settings-topics flex min-w-0 flex-col gap-7">
      <Group
        title={t("Generation")}
        scope={t("Used across projects unless a project has its own generation selection.")}
      >
        <Row
          id="git-generation-default"
          label={t("Model")}
          description={t("Used across projects unless a project has its own generation selection.")}
          descriptionVisible={false}
          feedback={
            generationError ? (
              <SettingsFeedback
                state="error"
                action={
                  <Button onClick={() => onGenerationChoice(generationError.choice)}>
                    {t("Retry")}
                  </Button>
                }
              >
                {t("Could not save changes")}
              </SettingsFeedback>
            ) : undefined
          }
        >
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <GitGenerationModelControl choice={gitGenerationChoice} onChange={onGenerationChoice} />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={t("Use automatic selection")}
              disabled={!gitGenerationChoice}
              onClick={() => onGenerationChoice(undefined)}
            >
              <RotateCcw className="icon-sm" />
            </Button>
          </div>
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
