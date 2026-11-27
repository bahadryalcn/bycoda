import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "../../../shared/ui/icons";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { homeDir, pickFolders } from "../../../platform/tauri/fs";
import { newProjectFolderSetting, newProjectParent } from "../../projects/public/newProjectFolder";
import { loadRecents } from "../../projects/public/recents";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { errorText } from "../../../shared/lib/errors";

/** Page-level "Restore defaults": bycoda chooses the folder again. */
export const restoreNewProjectFolderDefault = () => {
  newProjectFolderSetting.save(null);
  return newProjectFolderSetting.load() === null;
};

/** Where projects created by voice or the assistant ("create a snake game") are placed. */
export function NewProjectFolderGroup() {
  useLocale();
  const [chosen] = useStoredPreferenceState(
    newProjectFolderSetting.load,
    newProjectFolderSetting.subscribe,
  );
  const [home, setHome] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | true | null>(null);
  const [homeAttempt, setHomeAttempt] = useState(0);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- resolves the native home directory for this mounted row and ignores completion after unmount.
  useEffect(() => {
    let current = true;
    setHomeError(null);
    homeDir().then(
      (value) => {
        if (current) {
          if (typeof value !== "string" || !value.trim()) {
            setHomeError(true);
            return;
          }
          setHome(value);
        }
      },
      (cause: unknown) => {
        if (current) {
          setHomeError(errorText(cause));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [homeAttempt]);

  const automatic =
    home === null
      ? ""
      : newProjectParent(
          null,
          loadRecents().map((item) => item.path),
          home,
        );

  const choose = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // The shared picker also grants file access, so creation needs no further prompt.
    try {
      const [path] = await pickFolders(t("Select folder for new projects"), false);
      if (path) {
        newProjectFolderSetting.save(path);
        if (newProjectFolderSetting.load() !== path)
          setError({ title: t("Could not save. Your previous choice was kept.") });
      }
    } catch (cause) {
      setError({
        title: t("Could not choose the folder for new projects."),
        detail: errorText(cause),
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Group title={null}>
      <Row
        id="new-project-folder"
        label={t("Folder for new projects")}
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              extra={error.detail ? <ErrorDetails detail={error.detail} /> : undefined}
            >
              {error.title}
            </SettingsFeedback>
          ) : !chosen && homeError ? (
            <SettingsFeedback
              state="error"
              extra={
                typeof homeError === "string" ? <ErrorDetails detail={homeError} /> : undefined
              }
              action={{
                label: t("Retry"),
                disabled: busy,
                onClick: () => setHomeAttempt((attempt) => attempt + 1),
              }}
            >
              {t("Could not read your home folder. Retry or choose a folder.")}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Button
          variant="link"
          loading={busy}
          disabled={busy}
          loadingLabel={t("Choosing folder…")}
          onClick={() => void choose()}
        >
          {chosen || automatic || t("Choose folder…")}
        </Button>
        {chosen ? (
          <Button
            variant="ghost"
            iconOnly
            label={t("Choose automatically")}
            disabled={busy}
            onClick={() => {
              setError(null);
              if (!restoreNewProjectFolderDefault())
                setError({ title: t("Could not save. Your previous choice was kept.") });
            }}
          >
            <RotateCcw aria-hidden />
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
