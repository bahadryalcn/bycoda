import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useRef, useState, type ReactNode } from "react";
import { IS_MAC } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import { quickComposerShortcutLabel } from "../../quick-composer/model/quickComposerShortcut";
import {
  loadFileTabMode,
  loadLiveAgentsEnabled,
  subscribeLiveAgentsEnabled,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveFileTabMode,
  saveLiveAgentsEnabled,
  saveQuickComposerEnabled,
  type FileTabMode,
} from "../model/settings";
import { Group, Row, Segmented, SettingsFeedback, Toggle } from "./settingsControls";
import { WorkspaceFeatureSettings, WorkspaceToolsHelp } from "./WorkspaceFeatureSettings";
import "./WorkspaceSettings.css";

export function WorkspacePage({ children }: { children?: ReactNode }) {
  useLocale();
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useStoredPreferenceState(
    loadLiveAgentsEnabled,
    subscribeLiveAgentsEnabled,
  );
  const [fileTabMode, setFileTabMode] = useState<FileTabMode>(loadFileTabMode);

  const [quickComposerEnabled, setQuickComposerEnabled] = useState(loadQuickComposerEnabled);
  const [quickComposerError, setQuickComposerError] = useState<string | null>(null);
  const [quickComposerSaving, setQuickComposerSaving] = useState(false);
  const quickComposerPending = useRef(false);
  const onQuickComposerEnabled = (next: boolean) => {
    if (quickComposerPending.current) return;
    quickComposerPending.current = true;
    setQuickComposerSaving(true);
    saveQuickComposerEnabled(next);
    setQuickComposerEnabled(next);
    setQuickComposerError(null);
    void setQuickComposerShortcut(next)
      .catch((error: unknown) => {
        // Another app already owns the combination. Leave the switch where the
        // user put it so the next launch tries again, but say why it is dead.
        setQuickComposerError(String(error));
      })
      .finally(() => {
        quickComposerPending.current = false;
        setQuickComposerSaving(false);
      });
  };
  const onLiveAgentsEnabled = (next: boolean) => {
    saveLiveAgentsEnabled(next);
    setLiveAgentsEnabled(next);
  };
  const onFileTabMode = (next: FileTabMode) => {
    saveFileTabMode(next);
    setFileTabMode(next);
  };

  return (
    <div className="workspace-settings">
      <Group
        title={t("Files and navigation")}
        layout="full"
        scope={t("Applies across projects. Changes save automatically.")}
      >
        <Row
          id="file-tabs"
          label={t("File tabs")}
          description={t("Choose where files open. Both layouts support split panes.")}
        >
          <Segmented
            label={t("File tabs")}
            value={fileTabMode}
            options={[
              {
                value: "pane",
                get label() {
                  return t("Beside chat");
                },
              },
              {
                value: "workspace",
                get label() {
                  return t("Top bar");
                },
              },
            ]}
            onChange={onFileTabMode}
          />
        </Row>
      </Group>
      <Group title={t("Workspace tools")} layout="full" action={<WorkspaceToolsHelp />}>
        <WorkspaceFeatureSettings />
      </Group>
      <Group title={t("Session access")} layout="full">
        {IS_MAC && (
          <Row
            id="quick-composer"
            label={t("Quick composer")}
            feedback={
              quickComposerError ? (
                <SettingsFeedback state="error">{quickComposerError}</SettingsFeedback>
              ) : quickComposerSaving ? (
                <SettingsFeedback state="loading">{t("Saving…")}</SettingsFeedback>
              ) : undefined
            }
            description={t(
              "Press {p0} in any app to float a prompt over it and start a session without switching to {p1}. Change the shortcut in Keybindings. Return starts it in the background; ⌘Return starts it and brings the session forward.",
              {
                p0: quickComposerShortcutLabel(loadQuickComposerShortcut()),
                p1: PRODUCT_IDENTITY.displayName,
              },
            )}
          >
            <Toggle
              label={t("Quick composer")}
              on={quickComposerEnabled}
              disabled={quickComposerSaving}
              onChange={onQuickComposerEnabled}
            />
          </Row>
        )}
        <Row
          id="working-agents"
          label={t("Working agents")}
          description={t("Show running and recently finished chats in the project rail.")}
        >
          <Toggle
            label={t("Working agents")}
            on={liveAgentsEnabled}
            onChange={onLiveAgentsEnabled}
          />
        </Row>
      </Group>
      {children}
    </div>
  );
}
