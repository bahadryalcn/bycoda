/** Different job: Appearance preview draws the chosen background; it is not an ordinary selection row. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import {
  initWorkspaceBackground,
  loadWorkspaceBackground,
  readWorkspaceBackgroundIssue,
  saveWorkspaceBackground,
  subscribeWorkspaceBackground,
  WORKSPACE_BACKGROUND_DEFAULT,
  type WorkspaceBackground,
} from "../model/workspaceBackground";
import { Group, SettingsFeedback } from "./settingsControls";
import { AppearanceSaveFeedback } from "./useAppearanceSettings";
import {
  readAppearanceSaveIssues,
  retryAppearanceSave,
  subscribeAppearanceSaveIssues,
} from "../model/appearancePersistence";
import { GradientStrip } from "./appearance/controls/GradientStrip";

function useBackgroundSuppressed() {
  const [suppressed, setSuppressed] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const queries = ["(forced-colors: active)", "(prefers-reduced-transparency: reduce)"].map(
      (query) => window.matchMedia(query),
    );
    const update = () => setSuppressed(queries.some((query) => query.matches));
    update();
    for (const query of queries) query.addEventListener?.("change", update);
    return () => {
      for (const query of queries) query.removeEventListener?.("change", update);
    };
  }, []);
  return suppressed;
}

export function GradientBackgroundCard() {
  useLocale();
  const value = useSyncExternalStore(subscribeWorkspaceBackground, loadWorkspaceBackground);
  const issue = useSyncExternalStore(subscribeWorkspaceBackground, readWorkspaceBackgroundIssue);
  const saveIssues = useSyncExternalStore(subscribeAppearanceSaveIssues, readAppearanceSaveIssues);
  const suppressed = useBackgroundSuppressed();
  useEffect(() => {
    initWorkspaceBackground();
  }, []);
  const update = (change: Partial<WorkspaceBackground>) =>
    saveWorkspaceBackground(
      { ...value, ...change },
      { base: value, fields: Object.keys(change) as (keyof WorkspaceBackground)[] },
    );
  return (
    <Group
      id="workspace-background"
      title={t("Workspace background")}
      description={t("Add a color background behind your workspace and chat images.")}
      modified={JSON.stringify(value) !== JSON.stringify(WORKSPACE_BACKGROUND_DEFAULT)}
      resetLabel={t("Reset workspace background")}
      onReset={() => saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true })}
    >
      {value.enabled && suppressed ? (
        <SettingsFeedback state="empty">
          {t("Your accessibility settings hide workspace backgrounds. Your design is still saved.")}
        </SettingsFeedback>
      ) : null}
      <GradientStrip value={value} onChange={update} />
      {issue === "conflict" ? (
        <SettingsFeedback
          state="error"
          action={
            <Button onClick={() => saveWorkspaceBackground(value, { replace: true })}>
              {t("Apply my background")}
            </Button>
          }
        >
          {t("This background changed in another window. Your unsaved changes are still here.")}
        </SettingsFeedback>
      ) : issue === "unavailable" ? (
        <SettingsFeedback
          state="error"
          action={
            saveIssues.some((entry) => entry.settingId === "workspace-background") ? (
              <Button
                onClick={() =>
                  saveIssues
                    .filter((entry) => entry.settingId === "workspace-background")
                    .forEach((entry) => retryAppearanceSave(entry.key))
                }
              >
                {t("Retry save")}
              </Button>
            ) : undefined
          }
        >
          {t(
            "The saved workspace background could not be read. Your current changes are still here.",
          )}
        </SettingsFeedback>
      ) : (
        <AppearanceSaveFeedback settingIds={["workspace-background"]} />
      )}
    </Group>
  );
}
