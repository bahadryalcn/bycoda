import { useState } from "react";
import { IS_MAC } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import { quickComposerShortcutLabel } from "../../quick-composer/model/quickComposerShortcut";
import {
  loadFileTabMode,
  loadLiveAgentsEnabled,
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveFileTabMode,
  saveLiveAgentsEnabled,
  saveQuickComposerEnabled,
  type FileTabMode,
} from "../model/settings";
import { Group, Row, Segmented, Toggle } from "./settingsControls";
import { WorkspaceFeatureSettings } from "./WorkspaceFeatureSettings";

export function WorkspacePage() {
  useLocale();
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useState(loadLiveAgentsEnabled);
  const [fileTabMode, setFileTabMode] = useState<FileTabMode>(loadFileTabMode);

  const [quickComposerEnabled, setQuickComposerEnabled] = useState(loadQuickComposerEnabled);
  const [quickComposerError, setQuickComposerError] = useState<string | null>(null);
  const onQuickComposerEnabled = (next: boolean) => {
    saveQuickComposerEnabled(next);
    setQuickComposerEnabled(next);
    setQuickComposerError(null);
    void setQuickComposerShortcut(next).catch((error: unknown) => {
      // Another app already owns the combination. Leave the switch where the
      // user put it so the next launch tries again, but say why it is dead.
      setQuickComposerError(String(error));
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
    <>
      <Group
        title={t("Workspace")}
        description={t("How project navigation and workspace tabs behave.")}
      >
        <Row
          id="file-tabs"
          label={t("File tabs")}
          description={t(
            "Open files beside the active chat, or give each file a normal tab in the top bar. Top-bar files can still be combined into split panes.",
          )}
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
        <WorkspaceFeatureSettings />
        {IS_MAC && (
          <Row
            id="quick-composer"
            label={t("Quick composer")}
            description={t(
              "Press {p0} in any app to float a prompt over it and start a session without switching to {p1}. Change the shortcut in Keybindings. Return starts it in the background; ⌘Return starts it and brings the session forward.",
              {
                p0: quickComposerShortcutLabel(loadQuickComposerShortcut()),
                p1: PRODUCT_IDENTITY.displayName,
              },
            )}
          >
            {quickComposerError ? (
              <span className="text-[12px] text-content/45">{quickComposerError}</span>
            ) : null}
            <Toggle
              label={t("Quick composer")}
              on={quickComposerEnabled}
              onChange={onQuickComposerEnabled}
            />
          </Row>
        )}
        <Row
          id="working-agents"
          label={t("Working agents")}
          description={t(
            "A card on the project rail lists working or just-finished chats you are not looking at, so you can jump across projects. Finished turns stay until you open that session.",
          )}
        >
          <Toggle
            label={t("Working agents")}
            on={liveAgentsEnabled}
            onChange={onLiveAgentsEnabled}
          />
        </Row>
      </Group>
    </>
  );
}
