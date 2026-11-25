import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import {
  loadFileTabMode,
  subscribeFileTabMode,
  loadLiveAgentsEnabled,
  subscribeLiveAgentsEnabled,
  saveFileTabMode,
  saveLiveAgentsEnabled,
  type FileTabMode,
} from "../model/settings";
import { Group, Row, Segmented, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import { WorkspaceFeatureSettings, WorkspaceToolsHelp } from "./WorkspaceFeatureSettings";
import { loadExactGitRewind, saveExactGitRewind } from "../model/exactGitRewind";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import "./WorkspaceSettings.css";

export function ExactGitRewindSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
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
          setError(errorText(cause));
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
    setIsSaving(true);
    setPending(true);
    setError(null);
    try {
      setEnabled(await saveExactGitRewind(next));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      saving.current = false;
      setIsSaving(false);
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
          <SettingsFeedback state="loading" immediate={isSaving}>
            {isSaving ? t("Saving…") : t("Loading…")}
          </SettingsFeedback>
        ) : error ? (
          <SettingsFeedback
            state="error"
            extra={<ErrorDetails detail={error} />}
            action={{ label: t("Retry"), onClick: () => setReadAttempt((value) => value + 1) }}
          >
            {loaded ? t("Could not save Exact Git rewind.") : t("Could not load Exact Git rewind.")}
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
  const [fileTabMode, setFileTabMode] = useStoredPreferenceState(
    loadFileTabMode,
    subscribeFileTabMode,
  );
  const [fileTabError, setFileTabError] = useState(false);
  const [liveAgentsError, setLiveAgentsError] = useState(false);

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
      <Group title={t("Files and navigation")}>
        <Row
          id="file-tabs"
          label={t("File tabs")}
          info={t("Choose where files open. Both layouts support split panes.")}
          feedback={
            fileTabError ? (
              <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
            ) : undefined
          }
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
      {/* File, explorer and editor behavior read as one task; tool visibility is its own group below. */}
      {children}
      <Group title={t("Workspace tools")} info={<WorkspaceToolsHelp />}>
        <WorkspaceFeatureSettings />
        <Row
          id="working-agents"
          label={t("Working agents")}
          info={t("Show running and recently finished chats in the project rail.")}
          feedback={
            liveAgentsError ? (
              <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
            ) : undefined
          }
        >
          <Toggle
            label={t("Working agents")}
            on={liveAgentsEnabled}
            onChange={onLiveAgentsEnabled}
          />
        </Row>
      </Group>
    </div>
  );
}
