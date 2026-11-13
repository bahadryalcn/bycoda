import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { openModelsSettings } from "../public/modelsSettingsLink";
import { Row } from "./settingsControls";

/** One link for every helper model; Settings > Models > Assignments owns the choices. */
export function HelperModelsSettings() {
  return (
    <Row
      id="helper-models"
      label={t("Translation, reprompt and title models")}
      description={t("Model set in Work > Assignments.")}
    >
      <Button variant="link" onClick={() => openModelsSettings("roles")}>
        {t("Manage models")}
      </Button>
    </Row>
  );
}
