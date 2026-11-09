import { useEffect, useState } from "react";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { homeDir, pickFolders } from "../../../platform/tauri/fs";
import { newProjectFolderSetting, newProjectParent } from "../../projects/public/newProjectFolder";
import { loadRecents } from "../../projects/public/recents";
import { Group, Row, SettingsFeedback } from "./settingsControls";

/** Page-level "Restore defaults": bycoda chooses the folder again. */
export const restoreNewProjectFolderDefault = () => newProjectFolderSetting.save(null);

/** Where projects created by voice or the assistant ("create a snake game") are placed. */
export function NewProjectFolderGroup() {
  useLocale();
  const [chosen] = useStoredPreferenceState(
    newProjectFolderSetting.load,
    newProjectFolderSetting.subscribe,
  );
  const [home, setHome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    homeDir().then(
      (value) => current && typeof value === "string" && setHome(value),
      (cause: unknown) =>
        current && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      current = false;
    };
  }, []);

  const automatic =
    home === null
      ? ""
      : newProjectParent(
          null,
          loadRecents().map((item) => item.path),
          home,
        );

  const choose = async () => {
    setError(null);
    // The shared picker also grants file access, so creation needs no further prompt.
    const [path] = await pickFolders(t("Select folder for new projects"), false);
    if (path) newProjectFolderSetting.save(path);
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
        feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
      >
        <span className="min-w-0 truncate text-ui-caption text-(--ui-text-secondary)">
          {chosen ?? automatic}
        </span>
        <Button
          className="shrink-0"
          onClick={() =>
            choose().catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
          }
        >
          {t("Choose folder…")}
        </Button>
        {chosen ? (
          <Button className="shrink-0" onClick={restoreNewProjectFolderDefault}>
            {t("Choose automatically")}
          </Button>
        ) : null}
      </Row>
    </Group>
  );
}
