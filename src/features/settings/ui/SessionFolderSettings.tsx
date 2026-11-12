import { Text } from "../../../shared/ui/Text";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { loadSessionFolder, saveSessionFolder, type SessionFolder } from "../model/sessionFolder";
import { Group, Row, SettingsFeedback } from "./settingsControls";

/** Page-level "Restore defaults": sessions without a project go back to the home folder. */
export const restoreSessionFolderDefault = () => saveSessionFolder(null);

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The folder sessions started with "No project" run in; empty means the home folder. */
export function SessionFolderGroup() {
  useLocale();
  const [folder, setFolder] = useState<SessionFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadSessionFolder().then(
      (value) => current && setFolder(value),
      (cause) => current && setError(message(cause)),
    );
    return () => {
      current = false;
    };
  }, []);

  // choose() and save() report their own failures; this only satisfies the rejection contract.
  const setErrorFrom = (cause: unknown) => setError(message(cause));

  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await saveSessionFolder(next);
      setFolder(await loadSessionFolder());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: folder?.chosen ?? folder?.home ?? undefined,
        title: t("Select folder for sessions without a project"),
      });
      if (typeof path === "string") await save(path);
    } catch (cause) {
      setError(message(cause));
    }
  };

  return (
    <Group title={t("Sessions without a project")}>
      <Row
        id="session-folder"
        label={t("Folder for sessions without a project")}
        description={t(
          "Sessions started with No project run here. The folder is created if it is missing.",
        )}
        feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
      >
        <Text size="caption" tone="secondary" truncate>
          {folder?.chosen ?? folder?.home ?? ""}
        </Text>
        <Button className="shrink-0" onClick={() => choose().catch(setErrorFrom)} disabled={busy}>
          {t("Choose folder…")}
        </Button>
        {folder?.chosen ? (
          <Button
            className="shrink-0"
            onClick={() => save(null).catch(setErrorFrom)}
            disabled={busy}
          >
            {t("Use home folder")}
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
