import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { homeDir, pickFolders } from "../../../platform/tauri/fs";
import { newProjectFolderSetting, newProjectParent } from "../../projects/public/newProjectFolder";
import { loadRecents } from "../../projects/public/recents";
import { Group, Row, SettingsFeedback } from "./settingsControls";

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
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeAttempt, setHomeAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- resolves the native home directory for this mounted row and ignores completion after unmount.
  useEffect(() => {
    let current = true;
    setHomeLoading(true);
    setHomeError(null);
    homeDir().then(
      (value) => {
        if (current) {
          if (typeof value !== "string" || !value.trim()) {
            setHomeError(t("Could not read your home folder. Retry or choose a folder."));
            setHomeLoading(false);
            return;
          }
          setHome(value);
          setHomeLoading(false);
        }
      },
      (cause: unknown) => {
        if (current) {
          setHomeError(cause instanceof Error ? cause.message : String(cause));
          setHomeLoading(false);
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
          throw new Error(t("Could not save. Your previous choice was kept."));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Group title={t("New projects")}>
      <Row
        id="new-project-folder"
        label={t("Folder for new projects")}
        description={
          chosen
            ? t("New projects you ask the assistant to create are added here.")
            : t(
                "Not set: new projects go to the folder most of your projects share, otherwise Projects in your home folder.",
              )
        }
        feedback={
          error ? (
            <SettingsFeedback state="error">{error}</SettingsFeedback>
          ) : !chosen && homeError ? (
            <SettingsFeedback
              state="error"
              action={
                <Button disabled={busy} onClick={() => setHomeAttempt((attempt) => attempt + 1)}>
                  {t("Retry")}
                </Button>
              }
            >
              {homeError}
            </SettingsFeedback>
          ) : !chosen && homeLoading ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : undefined
        }
      >
        <OverflowTooltip label={chosen ?? automatic}>
          <Text size="caption" tone="secondary" truncate tabIndex={0}>
            {chosen ?? automatic}
          </Text>
        </OverflowTooltip>
        <Button
          className="shrink-0"
          loading={busy}
          disabled={!chosen && homeLoading}
          loadingLabel={t("Choosing folder…")}
          onClick={() =>
            choose().catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
          }
        >
          {t("Choose folder…")}
        </Button>
        {chosen ? (
          <Button
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setError(null);
              if (!restoreNewProjectFolderDefault())
                setError(t("Could not save. Your previous choice was kept."));
            }}
          >
            {t("Choose automatically")}
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
