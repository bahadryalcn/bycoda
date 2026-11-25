import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Popover } from "../../../../shared/ui/Popover";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { ChevronDown, Sparkles } from "../../../../shared/ui/icons";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Text } from "../../../../shared/ui/Text";
import { useModelRouting } from "../../model/modelRoutingClient";
import { modelRoutingPreviewOptions } from "../../model/useModelRoutingPreview";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { ModelRoutingPoolSelect } from "./ModelRoutingPoolSelect";
import { ModelRoutingResolution } from "./ModelRoutingResolution";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
} from "../../../../shared/model/host-contracts/model-routing";

type ChoiceProps = {
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

/** `presentation="chip"` opts into one compact chip; `fixedLabel` names the fixed model on it. */
export type ModelChoiceFieldProps = ChoiceProps & {
  presentation?: "field" | "chip";
  fixedLabel?: ReactNode;
};

/** Default | Pool | Fixed for one item, with fixed-only fallback on unsupported Hosts. */
export function ModelChoiceField(props: ModelChoiceFieldProps) {
  useLocale();
  if (!props.supported || !props.machineId) return props.fixed;
  if (props.presentation === "chip")
    return (
      <RoutingChip {...props} machineId={props.machineId} fixedLabel={props.fixedLabel ?? null} />
    );
  return <RoutingChoice {...props} machineId={props.machineId} />;
}

function RoutingChip({
  routingRole,
  value,
  onChange,
  machineId,
  supported,
  allowDefault,
  fixed,
  fixedLabel,
  onManage,
  disabled,
}: ChoiceProps & { machineId: string; fixedLabel: ReactNode }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const routing = useModelRouting(machineId, supported);
  const choice = value ?? { kind: "fixed" as const };
  const preview = useQuery({
    ...modelRoutingPreviewOptions(
      machineId,
      [
        "model-routing-resolution",
        machineId,
        routingRole,
        choice,
        undefined,
        routing.state?.version,
      ],
      { role: routingRole, choice },
    ),
    enabled: choice.kind !== "fixed",
  });
  const pools = routing.state?.pools ?? [];
  const poolOptions = pools.map((pool) => ({ value: `pool:${pool.id}`, label: pool.name }));
  const pool = choice.kind === "pool" ? choice.poolId : undefined;
  const selected = pool === undefined ? choice.kind : `pool:${pool}`;
  const options = [
    ...(allowDefault ? [{ value: "default", label: t("Default") }] : []),
    { value: "order", label: t("Full model order") },
    ...poolOptions,
    ...(pool !== undefined && !pools.some((entry) => entry.id === pool)
      ? [{ value: selected, label: pool, disabled: true }]
      : []),
    { value: "fixed", label: t("Fixed") },
  ];
  const result = !preview.isError ? preview.data : undefined;
  const automatic = choice.kind === "default";
  const resolvedLabel = result?.ok ? (
    <ModelLabel model={result.target.model} harness={result.target.harness} />
  ) : null;
  const label = automatic ? (
    <>
      {t("Auto")}
      {resolvedLabel ? <> · {resolvedLabel}</> : null}
    </>
  ) : choice.kind === "fixed" ? (
    fixedLabel
  ) : (
    options.find((option) => option.value === selected)?.label
  );
  const change = (next: string) => {
    if (next === "default" || next === "order" || next === "fixed") onChange({ kind: next });
    else onChange({ kind: "pool", poolId: next.slice("pool:".length) });
  };
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="chip"
        aria-haspopup="dialog"
        expanded={!disabled && open}
        disabled={disabled}
        disabledReason={t("Models cannot change right now.")}
        startIcon={<Sparkles className="icon-xs" aria-hidden />}
        endIcon={<ChevronDown className="icon-xs" aria-hidden />}
        onClick={() => setOpen(!open)}
        className="min-w-0 max-w-full"
      >
        <span className="sr-only">{t("Model")}, </span>
        <Text truncate size="inherit" tone="inherit">
          {label}
        </Text>
      </Button>
      {!disabled && open ? (
        <Popover
          anchor={anchor}
          size="md"
          kind="dialog"
          aria-label={t("Model choice")}
          onDismiss={() => setOpen(false)}
          className="grid gap-2"
        >
          <SearchableSelect
            label={t("Model choice")}
            hideLabel
            value={selected}
            options={options}
            onChange={change}
          />
          {choice.kind === "fixed" ? (
            fixed
          ) : (
            <>
              {preview.isPending ? (
                <LoadingText>{t("Checking current model…")}</LoadingText>
              ) : preview.isError ? (
                <Text size="caption" tone="secondary">
                  {t("Current model could not be checked. You can still edit this choice.")}
                </Text>
              ) : result && !result.ok ? (
                <Text size="caption" tone="secondary">
                  {result.reason === "notConfigured"
                    ? t("No model order configured. Uses the item's own model.")
                    : t("No eligible model right now.")}
                </Text>
              ) : !automatic && resolvedLabel ? (
                <Text size="caption" tone="secondary">
                  {t("Now uses")} {resolvedLabel}
                </Text>
              ) : null}
            </>
          )}
          {routing.error ? (
            <Text size="caption" tone="secondary">
              {t("Model groups could not be loaded. You can still choose a fixed model.")}
            </Text>
          ) : null}
          {onManage ? (
            <Button variant="link" type="button" onClick={onManage}>
              {t("Manage models")}
            </Button>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
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
          ...(allowDefault ? [{ value: "default", label: t("Use settings"), disabled }] : []),
          { value: "pool", label: t("Any model"), disabled },
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
            <Button
              type="button"
              variant="link"
              onClick={onManage}
              disabled={disabled}
              disabledReason={t("Models cannot change right now.")}
            >
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
              {t("Model groups could not be loaded. You can still choose a fixed model.")}
            </Text>
          ) : null}
        </>
      )}
    </div>
  );
}
