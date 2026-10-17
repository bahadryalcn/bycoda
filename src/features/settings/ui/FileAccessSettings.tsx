import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  configureFileAccess,
  getFileAccessMode,
  type FileAccessMode,
} from "../../../platform/tauri/fileAccess";
import { AdvancedSettings, Group, Row } from "./settingsControls";
import { Button } from "../../../shared/ui/Button";

export function FileAccessSettings() {
  useLocale();
  const [mode, setMode] = useState<FileAccessMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getFileAccessMode().then(
      (value) => {
        if (active) setMode(value);
      },
      (reason) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const review = async () => {
    setBusy(true);
    setError("");
    try {
      setMode(await configureFileAccess(true));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group
      title={t("File access")}
      scope={t("Scope: this computer. Remote hosts manage their own file access.")}
    >
      <Row
        id="file-access"
        label={t("Files, projects and skills")}
        description={t(
          "Allow access once for this computer. Your choice is saved across app restarts. Agent execution permissions are configured separately.",
        )}
      >
        <span role="status" aria-live="polite">
          {mode === null
            ? error
              ? t("Status unavailable")
              : t("Loading…")
            : mode === "all-files"
              ? t("All files allowed")
              : mode === "selected-folders"
                ? t("Selected folders only")
                : t("Not configured")}
        </span>
        <Button disabled={busy} onClick={() => void review()}>
          {busy ? t("Waiting for approval…") : t("Change file access")}
        </Button>
      </Row>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      <AdvancedSettings
        id="file-access-permissions"
        settingIds={["file-access-permissions"]}
        title={t("Advanced: file access and agent permissions")}
      >
        <Row
          label={t("Separate permissions")}
          description={t(
            "File access allows the app to read files. Agent approval rules still control commands and tools. Change file access opens the native consent flow; the saved status updates after it completes.",
          )}
        />
      </AdvancedSettings>
    </Group>
  );
}
