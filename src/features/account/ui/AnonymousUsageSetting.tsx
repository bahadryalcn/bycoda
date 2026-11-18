import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Row, Toggle } from "../../../shared/ui/settings";
import {
  isAnonymousUsageEnabled,
  setAnonymousUsageEnabled,
  subscribeAnonymousUsage,
} from "../model/anonymousUsage";

export function AnonymousUsageSetting() {
  useLocale();
  const enabled = useSyncExternalStore(subscribeAnonymousUsage, isAnonymousUsageEnabled);
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
      <Toggle label={label} on={enabled} onChange={setAnonymousUsageEnabled} />
    </Row>
  );
}
