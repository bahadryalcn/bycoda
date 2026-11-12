import type { HarnessVersionCheck } from "../../providers/public/ProviderStatusGroup";
import { HARNESSES } from "../../sessions";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { ProviderStatusGroup } from "../../providers/public/ProviderStatusGroup";
import { t } from "../../../shared/i18n";
import { DataTable, DataTableRow } from "../../../shared/ui/SortableDataTable";
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
    <ProviderStatusGroup
      key={harness}
      id={settingDomId(`cli-path-${harness}`)}
      harness={harness}
      available={isHarnessAvailable(harness)}
      checkedAt={checkedAt}
      onCheck={onCheck}
      onRowCheck={onRowCheck}
      onSetup={() => undefined}
    />
  );
  return (
    <div className="provider-inventory">
      <DataTable
        caption={t("CLI")}
        headers={[
          { label: t("Provider name") },
          { label: t("Installed version") },
          { label: t("Status") },
          { label: t("Actions"), hidden: true },
        ]}
      >
        {installed.map(row)}
        {missing.length ? <DataTableRow heading={t("Not installed")} columnCount={4} /> : null}
        {missing.map(row)}
      </DataTable>
    </div>
  );
}
