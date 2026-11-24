import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Row } from "../../../shared/ui/settings";
import { SharingModeSelect } from "../../data-sharing";
import { getTokensMode, setTokensMode, subscribeTokensMode } from "../model/anonymousUsage";

export function AnonymousUsageSetting() {
  useLocale();
  const mode = useSyncExternalStore(subscribeTokensMode, getTokensMode);
  const label = t("Share anonymous token totals");
  return (
    <Row
      id="anonymous-token-totals"
      label={label}
      descriptionVisible
      description={t(
        "Send daily desktop token totals and estimated API cost with a random installation ID.",
      )}
    >
      <SharingModeSelect label={label} value={mode} change={setTokensMode} />
    </Row>
  );
}
