import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  configureFileAccess,
  getFileAccessMode,
  type FileAccessMode,
} from "../../../platform/tauri/fileAccess";
import { Group, Row } from "./settingsControls";

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
    <Group title={t("File access")}>
      <Row
        id="file-access"
        label={t("Files, projects and skills")}
        description={t(
          "Allow access once for this computer. Your choice is saved across app restarts. Agent execution permissions are configured separately.",
        )}
      >
        <span role="status">
          {mode === null
            ? t("Loading…")
            : mode === "all-files"
              ? t("All files allowed")
              : mode === "selected-folders"
                ? t("Selected folders only")
                : t("Not configured")}
        </span>
        <button
          className="rounded border border-content/15 px-3 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-accent active:bg-content/10 disabled:opacity-50"
          disabled={busy}
          onClick={() => void review()}
        >
          {busy ? t("Waiting for approval…") : t("Change file access")}
        </button>
      </Row>
      {error ? <p role="alert">{error}</p> : null}
    </Group>
  );
}
