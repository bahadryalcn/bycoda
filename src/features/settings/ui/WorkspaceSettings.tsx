import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IS_MAC } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import { quickComposerShortcutLabel } from "../../quick-composer/model/quickComposerShortcut";
import {
  loadFileTabMode,
  subscribeFileTabMode,
  loadLiveAgentsEnabled,
  subscribeLiveAgentsEnabled,
  loadQuickComposerEnabled,
  subscribeQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveFileTabMode,
  saveLiveAgentsEnabled,
  saveQuickComposerEnabled,
  type FileTabMode,
} from "../model/settings";
import { Group, Row, Segmented, SettingsFeedback, Toggle } from "./settingsControls";
import { WorkspaceFeatureSettings, WorkspaceToolsHelp } from "./WorkspaceFeatureSettings";
import { loadExactGitRewind, saveExactGitRewind } from "../model/exactGitRewind";
import { Button } from "../../../shared/ui/Button";
import "./WorkspaceSettings.css";

function ExactGitRewindSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const saving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    setError(null);
    void loadExactGitRewind()
      .then((value) => {
        if (cancelled) return;
        setEnabled(value);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded(false);
          setError(String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readAttempt]);

  const save = async (next: boolean) => {
    if (saving.current || pending || !loaded) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      setEnabled(await saveExactGitRewind(next));
    } catch (cause) {
      setError(String(cause));
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return (
    <Row
      id="exact-git-rewind"
      label={t("Exact Git rewind (experimental)")}
      description={t(
        "Off by default. Captures complete Git trees for exact rewind. Applies to new turns on this computer's Host.",
      )}
      feedback={
        pending ? (
          <SettingsFeedback state="loading">
            {saving.current ? t("Saving…") : t("Loading…")}
          </SettingsFeedback>
        ) : error ? (
          <SettingsFeedback state="error">
            {error}{" "}
            <Button variant="link" onClick={() => setReadAttempt((value) => value + 1)}>
              {t("Retry")}
            </Button>
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Toggle
        label={t("Exact Git rewind (experimental)")}
        on={enabled}
        disabled={pending || !loaded}
        onChange={save}
      />
    </Row>
  );
}

export function WorkspacePage({ children }: { children?: ReactNode }) {
  useLocale();
  const [liveAgentsEnabled, setLiveAgentsEnabled] = useStoredPreferenceState(
    loadLiveAgentsEnabled,
    subscribeLiveAgentsEnabled,
  );
  const [fileTabMode, setFileTabMode] = useStoredPreferenceState(loadFileTabMode, subscribeFileTabMode);
  const [fileTabError, setFileTabError] = useState(false);
  const [liveAgentsError, setLiveAgentsError] = useState(false);

  const [quickComposerEnabled, setQuickComposerEnabled] = useStoredPreferenceState(
    loadQuickComposerEnabled,
    subscribeQuickComposerEnabled,
  );
  const [quickComposerError, setQuickComposerError] = useState<string | null>(null);
  const [quickComposerSaving, setQuickComposerSaving] = useState(false);
  const quickComposerPending = useRef(false);
  const onQuickComposerEnabled = (next: boolean) => {
    if (quickComposerPending.current) return;
    quickComposerPending.current = true;
    setQuickComposerSaving(true);
    saveQuickComposerEnabled(next);
    const saved = loadQuickComposerEnabled();
    setQuickComposerEnabled(saved);
    setQuickComposerError(null);
    if (saved !== next) {
      quickComposerPending.current = false;
      setQuickComposerSaving(false);
      setQuickComposerError(t("Could not save changes"));
      return;
    }
    void setQuickComposerShortcut(saved)
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
    const saved = loadLiveAgentsEnabled();
    setLiveAgentsEnabled(saved);
    setLiveAgentsError(saved !== next);
  };
  const onFileTabMode = (next: FileTabMode) => {
    saveFileTabMode(next);
    const saved = loadFileTabMode();
    setFileTabMode(saved);
    setFileTabError(saved !== next);
  };

  return (
    <div className="workspace-settings settings-topics">
      <Group
        title={t("Files and navigation")}
        layout="full"
        scope={t("Applies across projects. Changes save automatically.")}
      >
        <Row
          id="file-tabs"
          label={t("File tabs")}
          description={t("Choose where files open. Both layouts support split panes.")}
          feedback={fileTabError ? (
            <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
          ) : undefined}
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
      {children}
      <Group
        title={t("Workspace tools")}
        layout="full"
        action={<WorkspaceToolsHelp />}
        scope={t("Controls navigation visibility. Hiding this tool does not stop work or change permissions.")}
      >
        <WorkspaceFeatureSettings />
        <Row
          id="working-agents"
          label={t("Working agents")}
          description={t("Show running and recently finished chats in the project rail.")}
          feedback={liveAgentsError ? <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback> : undefined}
        >
          <Toggle
            label={t("Working agents")}
            on={liveAgentsEnabled}
            onChange={onLiveAgentsEnabled}
          />
        </Row>
      </Group>
      {IS_MAC ? <Group title={t("Session access")} layout="full">
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
      </Group> : null}
      <Group
        title={t("Experimental settings")}
        layout="full"
        scope={t("Applies to new turns on this computer's Host.")}
      >
        <ExactGitRewindSetting />
      </Group>
    </div>
  );
}
