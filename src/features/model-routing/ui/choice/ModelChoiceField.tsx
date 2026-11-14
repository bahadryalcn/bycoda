import type { ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Text } from "../../../../shared/ui/Text";
import { useModelRouting } from "../../model/modelRoutingClient";
import { ModelRoutingPoolSelect } from "./ModelRoutingPoolSelect";
import { ModelRoutingResolution } from "./ModelRoutingResolution";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
} from "../../../../shared/model/host-contracts/model-routing";

export type ModelChoiceFieldProps = {
  routingRole: ModelRoutingRole;
  /** Undefined means the item predates routing and uses its own model (`fixed`). */
  value: ModelRoutingItemChoice | undefined;
  onChange: (value: ModelRoutingItemChoice) => void;
  machineId: string | undefined;
  supported: boolean;
  /** Item forms offer "Default" (follow the role); the role table does not. */
  allowDefault?: boolean;
  /** The caller's own model picker, shown when the choice is `fixed`. */
  fixed: ReactNode;
  /** Opens Settings > Models. */
  onManage?: () => void;
  disabled?: boolean;
};

/** Default | Pool | Fixed for one item, with fixed-only fallback on unsupported Hosts. */
export function ModelChoiceField(props: ModelChoiceFieldProps) {
  useLocale();
  if (!props.supported || !props.machineId) return props.fixed;
  return <RoutingChoice {...props} machineId={props.machineId} />;
}

function RoutingChoice({
  routingRole,
  value,
  onChange,
  machineId,
  supported,
  allowDefault,
  fixed,
  onManage,
  disabled,
}: ModelChoiceFieldProps & { machineId: string }) {
  const routing = useModelRouting(machineId, supported);
  const kind = value?.kind ?? "fixed";
  const segment = kind === "order" || kind === "pool" ? "pool" : kind;
  return (
    <div
      className={
        kind === "fixed"
          ? "flex min-w-0 flex-wrap items-center gap-2"
          : "flex min-w-0 flex-col gap-2"
      }
    >
      <SegmentedControl
        label={t("Model choice")}
        value={segment}
        options={[
          ...(allowDefault ? [{ value: "default", label: t("Default"), disabled }] : []),
          { value: "pool", label: t("Pool"), disabled },
          { value: "fixed", label: t("Fixed"), disabled },
        ]}
        onValueChange={(next) =>
          onChange(
            next === "pool"
              ? { kind: "order" }
              : next === "default"
                ? { kind: "default" }
                : { kind: "fixed" },
          )
        }
      />
      {kind === "fixed" ? (
        fixed
      ) : kind === "default" ? (
        <>
          <ModelRoutingResolution
            machineId={machineId}
            role={routingRole}
            choice={{ kind: "default" }}
            revision={routing.state?.version}
          />
          {onManage ? (
            <Button type="button" variant="link" onClick={onManage} disabled={disabled}>
              {t("Manage models")}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <ModelRoutingPoolSelect
            pools={routing.state?.pools ?? []}
            value={value?.kind === "pool" ? value.poolId : ""}
            disabled={disabled || routing.loading}
            onChange={(poolId) => onChange(poolId ? { kind: "pool", poolId } : { kind: "order" })}
          />
          {routing.error ? (
            <Text as="p">
              {t("Model pools could not be loaded. You can still choose a fixed model.")}
            </Text>
          ) : null}
        </>
      )}
    </div>
  );
}
