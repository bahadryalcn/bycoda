import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { openCrewsPageAt } from "../model/crewsPage";
import type { CrewModelPool } from "../model/crewModelPools";

/**
 * Picks the model pool an automatic member uses, with a "Manage pools" action that opens the
 * Crews page Models tab. `value` is the member's `pool.id`; an empty value means the member
 * lists its own models. A value whose pool is gone stays visible until changed. Render it
 * only when the Host supports model pools (`ProjectCrews.modelPoolsSupported`).
 */
export function ModelPoolSelect({
  pools,
  value,
  onChange,
  disabled,
  hideLabel = false,
}: {
  pools: readonly CrewModelPool[];
  /** The selected pool id, or "" for none. */
  value: string;
  onChange: (poolId: string) => void;
  disabled?: boolean;
  /** Toolbars that supply their own context; forms show the "Model pool" label. */
  hideLabel?: boolean;
}) {
  useLocale();
  return (
    <SearchableSelect
      hideLabel={hideLabel}
      label={t("Model pool")}
      value={value}
      disabled={disabled}
      searchable={false}
      options={[
        { value: "", label: t("No pool") },
        ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
        ...(value && !pools.some((pool) => pool.id === value)
          ? [{ value, label: t("Unknown pool"), disabled: true }]
          : []),
      ]}
      onChange={onChange}
      footer={({ close }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            close();
            openCrewsPageAt({ tab: "models" });
          }}
        >
          {t("Manage pools")}
        </Button>
      )}
    />
  );
}
