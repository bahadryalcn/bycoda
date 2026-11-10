import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Select } from "../../../shared/ui/Select";
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
}: {
  pools: readonly CrewModelPool[];
  /** The selected pool id, or "" for none. */
  value: string;
  onChange: (poolId: string) => void;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-44 max-w-80 flex-1">
        <Select
          hideLabel
          label={t("Model pool")}
          value={value}
          disabled={disabled}
          options={[
            { value: "", label: t("No pool") },
            ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
            ...(value && !pools.some((pool) => pool.id === value)
              ? [{ value, label: t("Unknown pool"), disabled: true }]
              : []),
          ]}
          onValueChange={onChange}
        />
      </div>
      <Button variant="ghost" onClick={() => openCrewsPageAt({ tab: "models" })}>
        {t("Manage pools")}
      </Button>
    </div>
  );
}
