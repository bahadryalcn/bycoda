import type { HarnessVersionCheck } from "../../providers/public/ProviderStatusGroup";
import { HARNESSES } from "../../sessions";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { ProviderStatusGroup } from "../../providers/public/ProviderStatusGroup";
import { t } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { settingDomId } from "./settingsControls";

/** Full-width CLI inventory. Rows stay mounted so setup drafts survive navigation. */
export function ProviderCliTab({
  checkedAt,
  onCheck,
  onRowCheck,
}: {
  checkedAt: number | null;
  onCheck: () => void;
  onRowCheck: (check: HarnessVersionCheck) => void;
}) {
  const installed = HARNESSES.filter(isHarnessAvailable);
  const missing = HARNESSES.filter((harness) => harness !== "acp" && !isHarnessAvailable(harness));
  if (!isHarnessAvailable("acp")) missing.push("acp");
  const row = (harness: (typeof HARNESSES)[number]) => (
    <div
      key={harness}
      id={settingDomId(`cli-path-${harness}`)}
      data-setting-id={`cli-path-${harness}`}
    >
      <ProviderStatusGroup
        harness={harness}
        available={isHarnessAvailable(harness)}
        checkedAt={checkedAt}
        onCheck={onCheck}
        onRowCheck={onRowCheck}
        onSetup={() => undefined}
      />
    </div>
  );
  return (
    <div className="provider-inventory">
      <div className="provider-inventory-row provider-inventory-columns">
        {[t("Provider"), t("Installed"), t("Status"), t("Checked")].map((label) => (
          <Text key={label} size="caption" tone="secondary">
            {label}
          </Text>
        ))}
      </div>
      {installed.map(row)}
      {missing.length ? (
        <>
          <Text as="p" size="caption" tone="secondary" className="provider-inventory-heading">
            {t("Not installed")}
          </Text>
          {missing.map(row)}
        </>
      ) : null}
    </div>
  );
}
