import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { openModelsSettings } from "../public/modelsSettingsLink";
import { Row } from "../../../shared/ui/settings";

/** One link for every helper model; Settings > Models > Background work owns the choices. */
export function HelperModelsSettings() {
  return (
    <Row id="helper-models" label={t("Translation, reprompt and title models")}>
      <Button variant="link" onClick={() => openModelsSettings("roles")}>
        {t("Manage models")}
      </Button>
    </Row>
  );
}
