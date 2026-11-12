import "./ProviderDefaults.css";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { HARNESSES } from "../../sessions";
import { defaultSessionChoice, loadHiddenPickerProviders } from "../../sessions/public/models";
import {
  loadProjectProviderSettings,
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
  withChange,
  type DefaultsDraft,
  type DefaultsTarget,
} from "../model/providerDefaultsDraft";
import { globalModelFor, storedProjectModel } from "../model/providerDefaultsSave";
import * as defaultsScope from "./providerDefaultsScope";
import { ProviderDefaultsForm } from "./ProviderDefaultsForm";
import { Group, Row, Select } from "./settingsControls";

/** The provider new conversations start with for a target, before pending changes. */
export function storedDefaultProvider(target: DefaultsTarget): HarnessId {
  // Groups write into each project, so before saving they show what Global resolves to.
  return defaultSessionChoice(target.kind === "project" ? target.path : undefined).harness;
}

/**
 * Providers > Defaults for the selected provider. Shows the target's stored values with the
 * pending changes on top; every edit goes into the draft, and the save bar writes it.
 */
export function ProviderDefaultsPanel({
  harness,
  target,
  draft,
  onDraftChange,
}: {
  harness: HarnessId;
  target: DefaultsTarget;
  draft: DefaultsDraft;
  onDraftChange: (next: DefaultsDraft) => void;
}) {
  useLocale();
  const [accountScope, setAccountScope] = useState<Partial<Record<HarnessId, string>>>({});
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
    inherited = defaultsScope.inheritedProviderDefaults(harness, true);
    storedModel = project ? storedProjectModel(project, harness) : undefined;
  }
  const modelValue = change?.model !== undefined ? (change.model ?? undefined) : storedModel;
  const selectedModel = modelValue ?? globalModel;

  const hiddenGlobally = loadHiddenPickerProviders().includes(harness);
  const storedHidden = project
    ? (loadProjectProviderSettings(project).hidden ?? []).includes(harness)
    : false;

  const storedDefault = storedDefaultProvider(target);
  const defaultProvider = draft.defaultProvider ?? storedDefault;
  const providerChoices = HARNESSES.filter(
    // The saved default stays listed even when its CLI is missing, so the field is never blank.
    (id) =>
      id === defaultProvider ||
      (isHarnessAvailable(id) && !loadHiddenPickerProviders().includes(id)),
  );

  return (
    <>
      <Group
        layout="full"
        title={t("Default provider")}
        description={t("New conversations start with this provider and its default model.")}
      >
        <Row label={t("Provider")}>
          <Select
            hideLabel
            label={t("Default provider")}
            value={defaultProvider ?? ""}
            options={providerChoices.map((id) => ({
              value: id,
              label: HARNESS_TITLE[id],
              icon: <HarnessIcon harness={id} className="icon-sm" />,
            }))}
            onChange={(next) => {
              const value = next as HarnessId;
              const { defaultProvider: _drop, ...rest } = draft;
              onDraftChange(value === storedDefault ? rest : { ...rest, defaultProvider: value });
            }}
          />
        </Row>
      </Group>
      <ProviderDefaultsForm
        key={`${harness}:${accountId ?? ""}`}
        harness={harness}
        selectedModel={selectedModel}
        inheritedDefaults={inherited}
        scopeDefaults={overlaySessionDefaults(base, change)}
        onSessionDefaultsChange={(next) =>
          onDraftChange(withChange(draft, slot, recordSessionDefaults(change, base, next)))
        }
        inherits={inherits}
        modelOverride={inherits ? modelValue : undefined}
        globalModel={inherits ? globalModel : undefined}
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
        scopeControl={
          target.kind === "global" ? (
            <defaultsScope.AccountDefaultsScope
              harness={harness}
              value={accountScope[harness] ?? ""}
              onChange={(id) => setAccountScope((all) => ({ ...all, [harness]: id }))}
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
