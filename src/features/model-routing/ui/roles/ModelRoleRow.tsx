import { t, useLocale } from "../../../../shared/i18n";
import type {
  ModelRoutingChoice,
  ModelRoutingDraft,
  ModelRoutingRole,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { Select } from "../../../../shared/ui/Select";
import { Row } from "../../../settings/public/settingsControls";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import {
  defaultModelId,
  defaultModelSettings,
  resolveModel,
} from "../../../sessions/public/models";
import { HelperRoleResolution } from "./HelperRoleResolution";
import type { HelperModelRole } from "../../model/helperModelRouting";
import { withoutDelegation } from "../../model/modelRoutingRoles";
import { ModelRoutingResolution } from "../choice/ModelRoutingResolution";

const POOL_PREFIX = "pool:";

function choiceValue(choice: ModelRoutingChoice | undefined): string {
  if (!choice) return "automatic";
  return choice.kind === "pool" ? `${POOL_PREFIX}${choice.poolId}` : choice.kind;
}

/** One role: a single choice (Automatic for helpers, Model order, a pool, or a fixed model). */
export function ModelRoleRow({
  role,
  label,
  description,
  choice,
  pools,
  seed,
  machineId,
  version,
  orderReady,
  disabled,
  onChange,
}: {
  role: ModelRoutingRole;
  label: string;
  description: string;
  choice: ModelRoutingChoice | undefined;
  pools: ModelRoutingDraft["pools"];
  seed?: ModelRoutingTarget;
  machineId: string;
  version: number;
  /** The saved order has entries, so a live "uses …" preview is meaningful. */
  orderReady: boolean;
  disabled: boolean;
  onChange: (choice: ModelRoutingChoice | undefined) => void;
}) {
  useLocale();
  const helper = role.startsWith("text.");
  function fixedTarget(): ModelRoutingTarget {
    if (choice?.kind === "fixed") return withoutDelegation(choice.target);
    if (seed)
      return withoutDelegation({
        harness: seed.harness,
        model: seed.model,
        modelSettings: seed.modelSettings,
        providerAccountId: seed.providerAccountId,
      });
    const model = defaultModelId("codex");
    return withoutDelegation({
      harness: "codex",
      model,
      modelSettings: defaultModelSettings(resolveModel("codex", model)),
    });
  }
  const value = choiceValue(choice);
  const missingPool =
    choice?.kind === "pool" && !pools.some((pool) => pool.id === choice.poolId)
      ? choice.poolId
      : undefined;
  const options = [
    ...(helper ? [{ value: "automatic", label: t("Automatic") }] : []),
    { value: "order", label: t("Model order") },
    ...pools.map((pool) => ({
      value: `${POOL_PREFIX}${pool.id}`,
      label: t("Pool: {p0}", { p0: pool.name || t("Unnamed pool") }),
    })),
    ...(missingPool
      ? [
          {
            value: `${POOL_PREFIX}${missingPool}`,
            label: t("Missing pool ({p0})", { p0: missingPool }),
            disabled: true,
          },
        ]
      : []),
    { value: "fixed", label: t("Fixed model") },
  ];
  const preview =
    choice && choice.kind !== "fixed" && orderReady ? (
      helper ? (
        <HelperRoleResolution
          machineId={machineId}
          role={role as HelperModelRole}
          choice={choice}
          version={version}
        />
      ) : (
        <ModelRoutingResolution
          machineId={machineId}
          role={role}
          choice={choice}
          revision={version}
        />
      )
    ) : null;
  return (
    <Row
      label={t(label)}
      description={t(description)}
      disabled={disabled}
      feedback={
        choice?.kind === "fixed" ? (
          <ModelPicker
            harness={choice.target.harness}
            model={choice.target.model}
            values={choice.target.modelSettings}
            presentation="field"
            showExtras
            extrasDisabled={disabled}
            onChange={(harness, model, providerAccountId) => {
              const sameModel = harness === choice.target.harness && model === choice.target.model;
              onChange({
                kind: "fixed",
                target: withoutDelegation({
                  harness,
                  model,
                  providerAccountId,
                  modelSettings: sameModel
                    ? choice.target.modelSettings
                    : defaultModelSettings(resolveModel(harness, model)),
                }),
              });
            }}
            onSettingsChange={(settings) =>
              onChange({
                kind: "fixed",
                target: withoutDelegation({
                  ...choice.target,
                  modelSettings: { ...choice.target.modelSettings, ...settings },
                }),
              })
            }
          />
        ) : (
          preview
        )
      }
    >
      <Select
        label={t("Model for {p0}", { p0: t(label) })}
        hideLabel
        value={value}
        disabled={disabled}
        options={options}
        onValueChange={(next) => {
          if (next === value) return;
          if (next.startsWith(POOL_PREFIX))
            onChange({ kind: "pool", poolId: next.slice(POOL_PREFIX.length) });
          else if (next === "fixed") onChange({ kind: "fixed", target: fixedTarget() });
          else if (next === "automatic") onChange(undefined);
          else onChange({ kind: "order" });
        }}
      />
    </Row>
  );
}
