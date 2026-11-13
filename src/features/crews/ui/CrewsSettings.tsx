import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Group, Row, SettingsFeedback, Toggle } from "../../settings/ui/settingsControls";
import { loadCrewsOnRail, saveCrewsOnRail, useCrewsOnRail } from "../model/crewAppearance";
import { requestOpenCrewsPage } from "../model/crewsPage";

/** Settings → Crews: whether crews show in the sidebar. Teams and members live on the Crews page. */
export function CrewsSettings() {
  useLocale();
  const shown = useCrewsOnRail();
  const [failedValue, setFailedValue] = useState<boolean | null>(null);
  const save = (next: boolean) => {
    saveCrewsOnRail(next);
    setFailedValue(loadCrewsOnRail() === next ? null : next);
  };
  return (
    <Group
      title={t("Sidebar")}
      feedback={
        failedValue !== null ? (
          <SettingsFeedback
            state="error"
            action={
              <Button size="sm" variant="ghost" onClick={() => save(failedValue)}>
                {t("Retry")}
              </Button>
            }
          >
            {t("Could not save changes")}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Row label={t("Show crews")}>
        <Toggle label={t("Show crews")} on={shown} onChange={save} />
      </Row>
      <Row
        label={t("Crews page")}
        description={t("Teams, members and work live on their own page.")}
      >
        <Button variant="secondary" onClick={requestOpenCrewsPage}>
          {t("Open Crews")}
        </Button>
      </Row>
    </Group>
  );
}
