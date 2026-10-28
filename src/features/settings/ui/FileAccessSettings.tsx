import { SettingsFeedback } from "./settingsControls";
import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  configureFileAccess,
  getFileAccessMode,
  type FileAccessMode,
} from "../../../platform/tauri/fileAccess";
import { AdvancedSettings, Group, Row } from "./settingsControls";
import { Button } from "../../../shared/ui/Button";

export function FileAccessSettings({ embedded = false }: { embedded?: boolean }) {
  useLocale();
  const [mode, setMode] = useState<FileAccessMode | null>(null);
  const [pending, setPending] = useState<"read" | "configure" | null>(null);
  const [error, setError] = useState("");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const active = useRef(false);
  const operation = useRef(false);
  const refresh = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setPending("read");
    try {
      const value = await getFileAccessMode();
      if (active.current) {
        setMode(value);
        setError("");
        setStatusUnavailable(false);
      }
    } catch (reason) {
      if (active.current) { setError(String(reason)); setStatusUnavailable(true); }
    } finally {
      operation.current = false;
      if (active.current) setPending(null);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const review = async () => {
    if (operation.current) return;
    operation.current = true;
    setPending("configure");
    setError("");
    try {
      const value = await configureFileAccess(true);
      if (active.current) { setMode(value); setStatusUnavailable(false); }
    } catch (reason) {
      // Native consent may have persisted before a later step failed. Read back
      // independently; rejection must not imply that access stayed unchanged.
      try {
        const value = await getFileAccessMode();
        if (active.current) { setMode(value); setStatusUnavailable(false); }
      } catch {
        if (active.current) setStatusUnavailable(true);
      }
      if (active.current) setError(String(reason));
    } finally {
      operation.current = false;
      if (active.current) setPending(null);
    }
  };
  const modeLabel = mode === "all-files" ? t("All files allowed") : mode === "selected-folders" ? t("Selected folders only") : t("Not configured");
  const content = (
    <>
      <Row
        id="file-access"
        label={t("File access")}
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              action={<Button onClick={() => void refresh()} disabled={pending !== null}>{t("Retry")}</Button>}
            >
              <p>{t("Could not confirm the file access operation. Refresh the status before trying again.")}</p>
              {error}
            </SettingsFeedback>
          ) : pending ? (
            <SettingsFeedback state="loading">
              {pending === "configure" ? t("Waiting for approval…") : t("Loading…")}
            </SettingsFeedback>
          ) : null
        }
      >
        <span role="status" aria-live="polite">
          {statusUnavailable ? t("Status unavailable") : mode === null
            ? error
              ? t("Status unavailable")
              : t("Loading…")
            : modeLabel}
        </span>
        {statusUnavailable && mode !== null ? <span>{t("Last known access: {p0}", { p0: modeLabel })}</span> : null}
        <Button
          loading={pending === "configure"}
          disabled={pending !== null || mode === null || statusUnavailable}
          onClick={() => void review()}
        >
          {t("Change file access")}
        </Button>
        <Button variant="ghost" loading={pending === "read"} disabled={pending !== null} onClick={() => void refresh()}>
          {t("Refresh")}
        </Button>
      </Row>
      <AdvancedSettings
        id="file-access-permissions"
        settingIds={["file-access-permissions"]}
        title={t("Files, projects and skills")}
        defaultOpen={false}
      >
        <p className="privacy-inline-note">
          {t("Scope: this computer. Remote hosts manage their own file access.")}
        </p>
        <Row
          label={t("Separate permissions")}
          description={t(
            "All files access allows reading and editing files on this computer. Selected-folder grants may be read-only. Agent approval rules still control commands and tools. Change file access opens the native consent flow.",
          )}
        />
      </AdvancedSettings>
    </>
  );
  return embedded ? content : <Group title={t("File access")}>{content}</Group>;
}
