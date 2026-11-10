import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
import { saveCrewsOnRail, useCrewsOnRail } from "../model/crewAppearance";
import { requestOpenCrewsPage } from "../model/crewsPage";

/** Settings → Crews: whether crews show in the sidebar. Teams and members live on the Crews page. */
export function CrewsSettings() {
  useLocale();
  const shown = useCrewsOnRail();
  return (
    <Group title={t("Sidebar")}>
      <Row label={t("Show crews")}>
        <Toggle label={t("Show crews")} on={shown} onChange={saveCrewsOnRail} />
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
