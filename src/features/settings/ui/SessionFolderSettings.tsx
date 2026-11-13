import { Text } from "../../../shared/ui/Text";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { loadSessionFolder, saveSessionFolder, type SessionFolder } from "../model/sessionFolder";
import { Group, Row, SettingsFeedback } from "./settingsControls";

/** Page-level "Restore defaults": sessions without a project go back to the home folder. */
const changes = new EventTarget();
export const restoreSessionFolderDefault = async () => {
  await saveSessionFolder(null);
  changes.dispatchEvent(new Event("change"));
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The folder sessions started with "No project" run in; empty means the home folder. */
export function SessionFolderGroup() {
  useLocale();
  const [folder, setFolder] = useState<SessionFolder | null>(null);
  const [operation, setOperation] = useState<"read" | "choose" | "reset" | null>("read");
  const busy = operation !== null;
  const inFlight = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const current = ++generation.current;
    setOperation("read");
    setError(null);
    try {
      const value = await loadSessionFolder();
      if (generation.current === current) setFolder(value);
    } catch (cause) {
      if (generation.current === current) setError(message(cause));
    } finally {
      if (generation.current === current) setOperation(null);
    }
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- subscribes the mounted row to successful resets and invalidates pending reads on unmount.
  useEffect(() => {
    const changed = () => {
      void reload();
    };
    changed();
    changes.addEventListener("change", changed);
    return () => {
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- intentionally invalidates the latest native request, not a DOM ref.
      ++generation.current;
      changes.removeEventListener("change", changed);
    };
  }, []);

  // choose() and save() report their own failures; this only satisfies the rejection contract.
  const setErrorFrom = (cause: unknown) => setError(message(cause));

  const save = async (next: string | null) => {
    setError(null);
    const current = ++generation.current;
    try {
      await saveSessionFolder(next);
      const value = await loadSessionFolder();
      if (generation.current === current) setFolder(value);
    } catch (cause) {
      if (generation.current === current) setError(message(cause));
    } finally {
      if (generation.current === current) setOperation(null);
    }
  };

  const choose = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOperation("choose");
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
    } finally {
      inFlight.current = false;
      setOperation(null);
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
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              action={<Button onClick={() => void reload()}>{t("Retry")}</Button>}
            >
              {error}
            </SettingsFeedback>
          ) : operation === "read" ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : undefined
        }
      >
        <OverflowTooltip label={folder?.chosen ?? folder?.home ?? ""}>
          <Text size="caption" tone="secondary" truncate tabIndex={0}>
            {folder?.chosen ?? folder?.home ?? ""}
          </Text>
        </OverflowTooltip>
        <Button
          className="shrink-0"
          onClick={() => choose().catch(setErrorFrom)}
          disabled={busy}
          loading={operation === "choose"}
          loadingLabel={t("Choosing folder…")}
        >
          {t("Choose folder…")}
        </Button>
        {folder?.chosen ? (
          <Button
            className="shrink-0"
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              setOperation("reset");
              void save(null)
                .finally(() => {
                  inFlight.current = false;
                })
                .catch(setErrorFrom);
            }}
            disabled={busy}
            loading={operation === "reset"}
            loadingLabel={t("Saving…")}
          >
            {t("Use home folder")}
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
