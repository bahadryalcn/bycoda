import { t, useLocale } from "../../../../shared/i18n";
import type {
  ModelRoutingChoice,
  ModelRoutingDraft,
  ModelRoutingRole,
  ModelRoutingTarget,
} from "../../../../shared/model/host-contracts/model-routing";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Switch } from "../../../../shared/ui/Switch";
import { Text } from "../../../../shared/ui/Text";
import { Row } from "../../../../shared/ui/settings";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import {
  defaultModelId,
  defaultModelSettings,
  resolveModel,
} from "../../../sessions/public/models";
import { withoutDelegation } from "../../model/modelRoutingRoles";
import { ResolvedRoutingModel } from "../choice/ModelRoutingResolution";
import { ModelRolePreview, type RolePreview } from "./ModelRolePreview";

const POOL_PREFIX = "pool:";

function choiceValue(choice: ModelRoutingChoice | undefined): string {
  if (!choice) return "automatic";
  return choice.kind === "pool" ? `${POOL_PREFIX}${choice.poolId}` : choice.kind;
}

/**
 * One job: any model in order, a group, or a fixed model. A helper also has an Automatic switch
 * (its own cheap model selection); the model choice appears before it while it is off.
 */
export function ModelRoleRow({
  role,
  label,
  choice,
  pools,
  seed,
  preview,
  disabled,
  onChange,
}: {
  role: ModelRoutingRole;
  label: string;
  choice: ModelRoutingChoice | undefined;
  pools: ModelRoutingDraft["pools"];
  seed?: ModelRoutingTarget;
  /** What the list read for this job; absent while no live "uses …" preview is meaningful. */
  preview?: RolePreview;
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
  const automatic = helper && !choice;
  const missingPool =
    choice?.kind === "pool" && !pools.some((pool) => pool.id === choice.poolId)
      ? choice.poolId
      : undefined;
  const options = [
    { value: "order", label: t("Any model, in order") },
    ...pools.map((pool) => ({
      value: `${POOL_PREFIX}${pool.id}`,
      label: t("Group: {p0}", { p0: pool.name || t("Unnamed group") }),
    })),
    ...(missingPool
      ? [
          {
            value: `${POOL_PREFIX}${missingPool}`,
            label: t("Deleted group"),
            disabled: true,
          },
        ]
      : []),
    { value: "fixed", label: t("Fixed model") },
  ];
  // Every job says which model it runs on now, so the order and groups need no explanation.
  const resolved = preview?.data;
  const previewNode =
    !helper && !preview?.isError && resolved?.ok ? (
      <Text as="p" size="caption" tone="secondary">
        <ResolvedRoutingModel target={resolved.target} compact />
      </Text>
    ) : preview ? (
      <ModelRolePreview preview={preview} helper={helper} />
    ) : null;
  return (
    <Row
      label={label}
      // Under the title, so the reset icon stays beside the title instead of after the preview.
      scope={previewNode}
      disabled={disabled}
      disabledReason={t("Wait for the current save to finish.")}
      // A job's default is any model in order; a helper's default is its Automatic selection.
      modified={!disabled && (helper ? !automatic : value !== "order")}
      onReset={() => onChange(helper ? undefined : { kind: "order" })}
      // A fixed model needs its picker beside the choice; a helper fits its choice and switch.
      controlWidth={choice?.kind === "fixed" ? "fill" : helper ? "wide" : undefined}
      feedback={
        choice?.kind === "fixed" ? (
          <InlineMessage tone="warning">
            {t(
              "No fallback: if this model is unavailable or out of quota, the job stops instead of moving to another model.",
            )}
          </InlineMessage>
        ) : null
      }
    >
      <div className="flex min-w-0 w-full flex-wrap items-center justify-end gap-2">
        {automatic ? null : (
          <div className="w-56 max-w-full shrink-0">
            <Select
              label={t("Model for {p0}", { p0: label })}
              hideLabel
              value={value}
              disabled={disabled}
              options={options}
              onValueChange={(next) => {
                if (next === value) return;
                if (next.startsWith(POOL_PREFIX))
                  onChange({
                    kind: "pool",
                    poolId: next.slice(POOL_PREFIX.length),
                  });
                else if (next === "fixed") onChange({ kind: "fixed", target: fixedTarget() });
                else onChange({ kind: "order" });
              }}
            />
          </div>
        )}
        {choice?.kind === "fixed" ? (
          <div className="min-w-0 flex-1 basis-52">
            <ModelPicker
              harness={choice.target.harness}
              model={choice.target.model}
              values={choice.target.modelSettings}
              presentation="field"
              hideAgentSettings
              accountChoices
              accountId={choice.target.providerAccountId}
              showExtras
              extrasDisabled={disabled}
              onChange={(harness, model, providerAccountId) => {
                const sameModel =
                  harness === choice.target.harness && model === choice.target.model;
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
          </div>
        ) : null}
        {helper ? (
          <Switch
            label={t("Automatic")}
            aria-label={t("Automatic model for {p0}", { p0: label })}
            checked={automatic}
            compact
            disabled={disabled}
            onCheckedChange={(on) => onChange(on ? undefined : { kind: "order" })}
          />
        ) : null}
      </div>
    </Row>
  );
}
