import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { loadSessionFolder, saveSessionFolder, type SessionFolder } from "../model/sessionFolder";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { errorText } from "../../../shared/lib/errors";

/** Page-level "Restore defaults": sessions without a project go back to the home folder. */
const changes = new EventTarget();
export const restoreSessionFolderDefault = async () => {
  await saveSessionFolder(null);
  changes.dispatchEvent(new Event("change"));
};

/** Older projectless sessions use the selected folder, or home when unset. */
export function SessionFolderGroup() {
  useLocale();
  const [folder, setFolder] = useState<SessionFolder | null>(null);
  const [operation, setOperation] = useState<"read" | "choose" | "reset" | null>("read");
  const busy = operation !== null;
  const inFlight = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const reload = async () => {
    const current = ++generation.current;
    setOperation("read");
    setError(null);
    try {
      const value = await loadSessionFolder();
      if (generation.current === current) setFolder(value);
    } catch (cause) {
      if (generation.current === current)
        setError({ title: t("Could not read the session folder."), detail: errorText(cause) });
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
  const setErrorFrom = (cause: unknown) =>
    setError({ title: t("Could not choose the session folder."), detail: errorText(cause) });

  const save = async (next: string | null) => {
    setError(null);
    const current = ++generation.current;
    try {
      await saveSessionFolder(next);
      const value = await loadSessionFolder();
      if (generation.current === current) setFolder(value);
    } catch (cause) {
      if (generation.current === current)
        setError({ title: t("Could not save the session folder."), detail: errorText(cause) });
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
        title: t("Session folder"),
      });
      if (typeof path === "string") await save(path);
    } catch (cause) {
      setErrorFrom(cause);
    } finally {
      inFlight.current = false;
      setOperation(null);
    }
  };

  return (
    <Group title={null}>
      <Row
        id="session-folder"
        label={t("Folder for sessions without a project")}
        description={t(
          "Older projectless sessions use this folder. New sessions get their own folder.",
        )}
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              extra={<ErrorDetails detail={error.detail} />}
              action={{ label: t("Retry"), onClick: () => void reload() }}
            >
              {error.title}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Button
          variant="link"
          onClick={() => choose().catch(setErrorFrom)}
          disabled={busy}
          loading={operation === "choose"}
          loadingLabel={t("Choosing folder…")}
        >
          {folder?.chosen ?? folder?.home ?? t("Choose folder…")}
        </Button>
        {folder?.chosen ? (
          <Button
            variant="ghost"
            iconOnly
            label={t("Use home folder")}
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
            <RotateCcw aria-hidden />
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
