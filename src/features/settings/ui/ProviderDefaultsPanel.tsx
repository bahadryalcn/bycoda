import "./ProviderDefaults.css";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { defaultSessionChoice, loadHiddenPickerProviders } from "../../sessions/public/models";
import {
  loadProjectProviderSettings,
  storedProjectAccountId,
  type ProviderSessionDefaults,
} from "../../sessions/public/projectProviders";
import {
  accountSessionDefaults,
  globalProviderSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import {
  accountDraftKey,
  overlaySessionDefaults,
  recordField,
  recordSessionDefaults,
  changeSize,
  withChange,
  type DefaultsDraft,
  type DefaultsTarget,
  type ProviderDefaultsChange,
} from "../model/providerDefaultsDraft";
import { globalModelFor, storedProjectModel } from "../model/providerDefaultsSave";
import * as defaultsScope from "./providerDefaultsScope";
import { ProviderDefaultsForm } from "./ProviderDefaultsForm";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text } from "../../../shared/ui/Text";
import { Check } from "../../../shared/ui/icons";
import { Group, Row, Select } from "../../../shared/ui/settings";
import type { ModelRoutingDelegation } from "../../../shared/model/host-contracts/model-routing";
import { useState } from "react";
import {
  helperEdits,
  helperKeys,
  pendingHelperEdits,
  withHelperEdits,
} from "../model/helpersScope";

/** Past this many providers a segmented control stops fitting its row; a Select takes over. */
const MAX_SEGMENTED_PROVIDERS = 4;

/** The provider new conversations start with for a target, before pending changes. */
export function storedDefaultProvider(target: DefaultsTarget): HarnessId {
  // Groups write into each project, so before saving they show what Global resolves to.
  return defaultSessionChoice(target.kind === "project" ? target.path : undefined).harness;
}

/**
 * Models > Chat defaults / Subagents for the selected provider. Shows the target's stored values with the
 * pending changes on top; every edit goes into the draft, and the save bar writes it.
 */
export function ProviderDefaultsPanel({
  harness,
  target,
  draft,
  onDraftChange,
  section,
  providerControl,
  accountScope,
  onAccountScopeChange,
  hostDelegation,
}: {
  /** The local Host's helper layers; with it, Bycoda defaults edit All providers or one provider. */
  hostDelegation?: ModelRoutingDelegation;
  section?: "chat" | "delegation";
  providerControl?: {
    /** `edited`: the provider has unsaved changes in the draft. */
    options: { value: string; label: string; edited?: boolean }[];
    onChange: (id: HarnessId) => void;
  };
  accountScope: Partial<Record<HarnessId, string>>;
  onAccountScopeChange: (harness: HarnessId, accountId: string) => void;
  harness: HarnessId;
  target: DefaultsTarget;
  draft: DefaultsDraft;
  onDraftChange: (next: DefaultsDraft) => void;
}) {
  useLocale();
  const project = target.kind === "project" ? target.path : null;
  const globalModel = globalModelFor(harness);
  const accountId =
    target.kind === "global" &&
    defaultsScope.defaultsAccounts(harness).some((a) => a.id === accountScope[harness])
      ? accountScope[harness]
      : undefined;
  const inherits = target.kind !== "global" || accountId != null;
  const slot = { harness, accountId };
  const change = accountId
    ? draft.accounts[accountDraftKey(harness, accountId)]
    : draft.providers[harness];

  // Project and group targets save which account the provider starts on; the rows below then
  // inherit through that account. Global keeps its scope switch instead.
  const storedAccount =
    target.kind === "project" ? storedProjectAccountId(project ?? undefined, harness) : undefined;
  const projectAccount =
    target.kind === "global"
      ? undefined
      : change?.account !== undefined
        ? (change.account ?? undefined)
        : storedAccount;
  const knownProjectAccount = defaultsScope
    .defaultsAccounts(harness)
    .some((account) => account.id === projectAccount)
    ? projectAccount
    : undefined;
  const inheritedModel =
    (knownProjectAccount
      ? accountSessionDefaults(harness, knownProjectAccount).model
      : undefined) ?? globalModel;

  let base: ProviderSessionDefaults;
  let inherited: ProviderSessionDefaults;
  let storedModel: string | undefined;
  if (accountId) {
    const { model, ...own } = accountSessionDefaults(harness, accountId);
    base = own;
    inherited = globalProviderSessionDefaults(harness, accountId);
    storedModel = model;
  } else if (target.kind === "global") {
    base = defaultsScope.globalProviderDefaults(harness);
    inherited = defaultsScope.inheritedProviderDefaults(harness, false);
    storedModel = globalModel;
  } else {
    base = project ? (loadProjectProviderSettings(project).defaults?.[harness] ?? {}) : {};
    inherited = defaultsScope.inheritedProviderDefaults(harness, true, knownProjectAccount);
    storedModel = project ? storedProjectModel(project, harness) : undefined;
  }
  const modelValue = change?.model !== undefined ? (change.model ?? undefined) : storedModel;
  const selectedModel = modelValue ?? inheritedModel;

  const hiddenGlobally = loadHiddenPickerProviders().includes(harness);
  const storedHidden = project
    ? (loadProjectProviderSettings(project).hidden ?? []).includes(harness)
    : false;

  // Helpers: All providers (the Host's shared layer) unless this provider keeps its own values.
  const [helperChoice, setHelperChoice] = useState<Partial<Record<HarnessId, "all" | "provider">>>(
    {},
  );
  const providerLayer = helperKeys(hostDelegation?.providers[harness]);
  const helperScope =
    helperChoice[harness] ?? (Object.keys(providerLayer).length ? "provider" : "all");
  const helpers =
    hostDelegation && target.kind === "global" && !accountId
      ? (() => {
          const shared = helperKeys(hostDelegation.global);
          const all = helperScope === "all";
          const ownHelpers = withHelperEdits(providerLayer, pendingHelperEdits(change?.extras));
          return {
            control: (
              <Row
                label={t("Applies to")}
                description={
                  all
                    ? t("Every provider uses these helpers unless it has its own.")
                    : t("Only {p0} uses these values.", { p0: HARNESS_TITLE[harness] })
                }
                descriptionVisible
              >
                <SegmentedControl
                  label={t("Applies to")}
                  value={helperScope}
                  options={[
                    { value: "all", label: t("All providers") },
                    {
                      value: "provider",
                      label: HARNESS_TITLE[harness],
                      icon: <HarnessIcon harness={harness} className="icon-sm" />,
                    },
                  ]}
                  onValueChange={(next) => {
                    setHelperChoice((current) => ({
                      ...current,
                      [harness]: next as "all" | "provider",
                    }));
                    // Back to All providers drops this provider's own helper values.
                    if (next === "all" && Object.keys(providerLayer).length) {
                      const extras = { ...change?.extras };
                      for (const key of Object.keys(providerLayer)) extras[key] = null;
                      onDraftChange(withChange(draft, slot, { ...change, extras }));
                    }
                  }}
                />
              </Row>
            ),
            scopeDefaults: {
              extras: all ? withHelperEdits(shared, draft.delegation) : ownHelpers,
            },
            inheritedDefaults: { extras: all ? {} : shared },
            resetLabel: all ? t("Reset to automatic") : t("Use the All providers value"),
            onChange: (next: ProviderSessionDefaults) => {
              if (all) {
                const { delegation: _old, ...rest } = draft;
                const edits = helperEdits(shared, next.extras);
                onDraftChange(edits ? { ...rest, delegation: edits } : rest);
                return;
              }
              const extras = { ...change?.extras };
              for (const [key, value] of Object.entries(
                helperEdits(providerLayer, next.extras) ?? {},
              ))
                extras[key] = value;
              // An edit back to the stored value is no edit.
              for (const key of Object.keys(pendingHelperEdits(extras)))
                if (extras[key] === (providerLayer[key] ?? null)) delete extras[key];
              const nextChange: ProviderDefaultsChange = { ...change, extras };
              if (!Object.keys(extras).length) delete nextChange.extras;
              onDraftChange(
                withChange(draft, slot, changeSize(nextChange) ? nextChange : undefined),
              );
            },
          };
        })()
      : undefined;

  const storedDefault = storedDefaultProvider(target);
  const defaultProvider = draft.defaultProvider ?? storedDefault;

  return (
    <>
      <ProviderDefaultsForm
        key={`${harness}:${accountId ?? ""}`}
        harness={harness}
        section={section}
        providerControl={
          providerControl ? (
            <Group id="default-provider" layout="full" title={null}>
              <Row
                label={t("Provider")}
                info={
                  section === "delegation"
                    ? t(
                        "Global settings apply to chats and unattended work. Project, group and workspace settings apply to chats only.",
                      )
                    : undefined
                }
              >
                {providerControl.options.length > MAX_SEGMENTED_PROVIDERS ? (
                  <Select
                    hideLabel
                    label={t("Provider defaults")}
                    value={harness}
                    options={providerControl.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                      icon: (
                        <span className="provider-icon-marked">
                          <HarnessIcon harness={option.value as HarnessId} className="icon-sm" />
                          {option.edited ? <StatusDot tone="accent" label={t("Unsaved")} /> : null}
                        </span>
                      ),
                    }))}
                    onChange={(value) => providerControl.onChange(value as HarnessId)}
                  />
                ) : (
                  <SegmentedControl
                    label={t("Provider defaults")}
                    value={harness}
                    options={providerControl.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                      icon: <HarnessIcon harness={option.value as HarnessId} className="icon-sm" />,
                      accessory: option.edited ? (
                        <StatusDot tone="accent" label={t("Unsaved")} />
                      ) : undefined,
                    }))}
                    onValueChange={(value) => providerControl.onChange(value as HarnessId)}
                  />
                )}
                {section !== "delegation" ? (
                  defaultProvider === harness ? (
                    <Text
                      size="caption"
                      tone="muted"
                      className="inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <Check className="icon-sm" />
                      {t("Default")}
                    </Text>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const { defaultProvider: _drop, ...rest } = draft;
                        onDraftChange(
                          harness === storedDefault ? rest : { ...rest, defaultProvider: harness },
                        );
                      }}
                    >
                      {t("Make default")}
                    </Button>
                  )
                ) : null}
              </Row>
            </Group>
          ) : null
        }
        helpers={helpers}
        selectedModel={selectedModel}
        inheritedDefaults={inherited}
        scopeDefaults={overlaySessionDefaults(base, change)}
        onSessionDefaultsChange={(next) =>
          onDraftChange(withChange(draft, slot, recordSessionDefaults(change, base, next)))
        }
        inherits={inherits}
        modelOverride={inherits ? modelValue : undefined}
        globalModel={inherits ? inheritedModel : undefined}
        onModelChange={(model) =>
          onDraftChange(withChange(draft, slot, recordField(change, "model", model, storedModel)))
        }
        onModelReset={
          inherits
            ? () =>
                onDraftChange(
                  withChange(draft, slot, recordField(change, "model", null, storedModel)),
                )
            : undefined
        }
        accountId={accountId}
        projectAccountId={knownProjectAccount}
        scopeControl={
          target.kind === "global" ? (
            <defaultsScope.AccountDefaultsScope
              harness={harness}
              value={accountScope[harness] ?? ""}
              onChange={(id) => onAccountScopeChange(harness, id)}
            />
          ) : section !== "delegation" ? (
            <defaultsScope.ProjectAccountChoice
              harness={harness}
              value={projectAccount ?? ""}
              onChange={(id) =>
                onDraftChange(
                  withChange(
                    draft,
                    slot,
                    recordField(change, "account", id || null, storedAccount ?? null),
                  ),
                )
              }
            />
          ) : null
        }
        picker={
          target.kind === "global" || accountId
            ? undefined
            : {
                inPicker: !hiddenGlobally && !(change?.hidden ?? storedHidden),
                locked: hiddenGlobally,
                onChange: (visible) =>
                  onDraftChange(
                    withChange(draft, slot, recordField(change, "hidden", !visible, storedHidden)),
                  ),
              }
        }
      />
    </>
  );
}
