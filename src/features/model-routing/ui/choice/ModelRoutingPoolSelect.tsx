import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingPool } from "../../../../shared/model/host-contracts/model-routing";
import { Select } from "../../../../shared/ui/Select";

export function ModelRoutingPoolSelect({
  pools,
  value,
  onChange,
  disabled,
  includeOrder = true,
}: {
  pools: readonly ModelRoutingPool[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  includeOrder?: boolean;
}) {
  useLocale();
  return (
    <Select
      label={t("Model pool")}
      value={value}
      disabled={disabled}
      options={[
        ...(includeOrder ? [{ value: "", label: t("Model order") }] : []),
        ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
        ...(value && !pools.some((pool) => pool.id === value)
          ? [{ value, label: t("Missing pool ({p0})", { p0: value }), disabled: true }]
          : []),
      ]}
      onValueChange={onChange}
    />
  );
}
