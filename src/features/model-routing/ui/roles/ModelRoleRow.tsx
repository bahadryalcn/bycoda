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
  // Rows on the plain order would all repeat the same first model; they speak up only on a problem.
  const problemsOnly = choice?.kind === "order";
  const preview =
    choice && choice.kind !== "fixed" && orderReady ? (
      helper ? (
        <HelperRoleResolution
          machineId={machineId}
          role={role as HelperModelRole}
          choice={choice}
          version={version}
          problemsOnly={problemsOnly}
        />
      ) : (
        <ModelRoutingResolution
          machineId={machineId}
          role={role}
          choice={choice}
          revision={version}
          problemsOnly={problemsOnly}
        />
      )
    ) : null;
  return (
    <Row
      label={t(label)}
      disabled={disabled}
      stacked={choice?.kind === "fixed"}
      feedback={choice?.kind === "fixed" ? undefined : preview}
    >
      <div className="flex w-full flex-wrap items-center gap-2">
        <div className="w-56 max-w-full shrink-0">
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
        </div>
        {choice?.kind === "fixed" ? (
          <div className="min-w-56 flex-1">
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
            }            />
          </div>
        ) : null}
      </div>
    </Row>
  );
}
