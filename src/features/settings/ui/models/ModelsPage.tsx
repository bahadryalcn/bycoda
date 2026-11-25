import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../../shared/i18n";
import { ErrorDetails } from "../../../../shared/ui/ErrorDetails";
import { errorText } from "../../../../shared/lib/errors";
import { HARNESSES, HARNESS_TITLE } from "../../../sessions";
import type { HarnessId } from "../../../sessions/public/session";
import type { RecentProject } from "../../../projects/public/recents";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../../integrations/harness/core/availability";
import {
  loadHiddenPickerProviders,
  subscribeModels,
  getModelSnapshot,
  loadLastModelChoice,
} from "../../../sessions/public/models";
import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../../providers/public/providerAccounts";
import {
  loadProjectProviderSettings,
  projectProviderSettingsPersisted,
  resetProjectSessionPreferences,
  subscribeProjectProviders,
  projectProvidersRevision,
} from "../../../sessions/public/projectProviders";
import {
  subscribeProviderSessionDefaults,
  providerSessionDefaultsSnapshot,
} from "../../../sessions/public/providerSessionDefaults";
import { persistProviderPreference } from "../../../providers/public/providerPreferenceOutcome";
import {
  EMPTY_DRAFT,
  parseAccountDraftKey,
  selectedTargetValues,
} from "../../model/providerDefaultsDraft";
import { defaultsDraftChanges } from "./defaultsChanges";
import { saveDefaultsTargetsWithDelegation } from "../../model/providerDefaultsSave";
import { useDelegationProfile } from "../../../model-routing/public/delegation";
import { prepareDefaultsDraft } from "../../model/providerDefaultsSupport";
import { ProviderDefaultsPanel } from "../ProviderDefaultsPanel";
import { BykitSettingsPage } from "../ToolSettings";
import { ProviderDefaultsScopeRow } from "../providerDefaultsTargetsPicker";
import {
  ProviderDefaultsSaveBar,
  useDefaultsTargets,
  type DefaultsSaveState,
} from "../ProviderDefaultsSaveBar";
import { hasProjectOverrides } from "../providerDefaultsScope";
import {
  useSettingsPageReset,
  SettingsFeedback,
  settingDomId,
  useLeaveGuard,
} from "../../../../shared/ui/settings";
import { ModelOrderSettings } from "../../../model-routing/public/settings";
import {
  useRetainedTransaction,
  retainedTransactionValue,
} from "../../../model-routing/public/settings";
import { useModelRoutingHost } from "./modelRoutingHost";
import { HostModelSource } from "../../../connections/public/HostModelSource";
import {
  SettingsHostFailure,
  SettingsHostNotice,
  SettingsHostPicker,
  useSettingsHostScope,
} from "../../../connections/public/settingsHosts";

function providerAccountsSnapshot() {
  return JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);
}

const retained = {
  draft: EMPTY_DRAFT,
  target: "global",
  provider: undefined as HarnessId | undefined,
  accountScope: {} as Partial<Record<HarnessId, string>>,
};
function updateRetainedModelsPage(next: Partial<typeof retained>) {
  Object.assign(retained, next);
}
export function resetRetainedModelsPage() {
  Object.assign(retained, {
    draft: EMPTY_DRAFT,
    target: "global",
    provider: undefined,
    accountScope: {},
  });
}

/** The Models page views this component owns; the page's tab strip picks one. */
export type ModelsView = "work" | "defaults";

export function ModelsPage({
  cwd,
  recents,
  view,
}: {
  cwd?: string;
  recents?: RecentProject[];
  view: ModelsView;
}) {
  const tab = view;
  useLocale();
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  useSyncExternalStore(
    subscribeProviderSessionDefaults,
    providerSessionDefaultsSnapshot,
    providerSessionDefaultsSnapshot,
  );
  useSyncExternalStore(
    subscribeProviderAccounts,
    providerAccountsSnapshot,
    providerAccountsSnapshot,
  );
  useQuery({
    queryKey: ["settings", "provider-availability"],
    queryFn: async () => {
      await probeHarnessAvailability();
      return true;
    },
    staleTime: 0,
  });
  // Background work follows the picked Host; Defaults and delegation stay on this computer.
  const scope = useSettingsHostScope();
  const localRouting = useModelRoutingHost(scope.local);
  const pickedRouting = useModelRoutingHost(scope.selected);
  const delegation = useDelegationProfile(
    localRouting.data?.machineId,
    localRouting.data?.supported === true,
  );
  const [targetChoice, setTargetChoice] = useState(retained.target);
  const leave = useLeaveGuard();
  const [accountScope, setAccountScope] = useState(retained.accountScope);
  const [activeProvider, setProvider] = useState<HarnessId>(
    retained.provider ?? loadLastModelChoice()?.harness ?? HARNESSES[0],
  );
  // One draft spans every provider and account, so switching them never hides an edit.
  const transactionKey = `defaults:${JSON.stringify([scope.local?.id ?? "", cwd ?? "", [...selectedTargetValues(targetChoice)].sort()])}`;
  const [draft, setDraftState] = useRetainedTransaction(transactionKey + ":draft", EMPTY_DRAFT);
  const [saving, setSaving] = useRetainedTransaction(transactionKey + ":saving", false);
  const [saveState, setSaveState] = useRetainedTransaction<DefaultsSaveState>(
    transactionKey + ":outcome",
    { state: "idle" },
  );
  const setDraft = (next: typeof draft) => {
    setDraftState(next);
    setSaveState({ state: "idle" });
  };
  const hiddenGlobally = loadHiddenPickerProviders();
  const orderedHarnesses = [...HARNESSES].sort(
    (left, right) => Number(isHarnessAvailable(right)) - Number(isHarnessAvailable(left)),
  );
  const targets = useDefaultsTargets(cwd, recents);
  const parsedTarget = targets.parse(targetChoice);
  const target = targets.has(parsedTarget) ? parsedTarget : ({ kind: "global" } as const);
  const changes = defaultsDraftChanges(draft, setDraft);
  const editedProviders = new Set(
    Object.keys(draft.providers).concat(
      Object.keys(draft.accounts).map((key) => parseAccountDraftKey(key).harness),
    ),
  );
  const saveDraft = async () => {
    if (retainedTransactionValue<boolean>(`${transactionKey}:saving`)) return false;
    // Defaults are desktop-local: only a still-running probe holds the save back, so a failing
    // Host never blocks it (the Host routing sync is skipped then).
    if (scope.loading || localRouting.pending) {
      setSaveState({ state: "error", message: t("Checking Host capabilities. Try again.") });
      return false;
    }
    const selected = selectedTargetValues(targetChoice).map(targets.parse).filter(targets.has);
    const destinations =
      saveState.state === "error" && saveState.failed
        ? saveState.failed.map(targets.parse).filter(targets.has)
        : selected;
    const prepared = activeProvider
      ? prepareDefaultsDraft(
          draft,
          activeProvider,
          orderedHarnesses.filter(
            (harness) => isHarnessAvailable(harness) && !hiddenGlobally.includes(harness),
          ),
        )
      : { draft };
    setSaving(true);
    const outcome = await saveDefaultsTargetsWithDelegation(
      prepared.draft,
      destinations.length ? destinations : [{ kind: "global" }],
      delegation.supported ? delegation : undefined,
    );
    setSaving(false);
    if (outcome.failed.length) {
      setSaveState({
        state: "error",
        failed: outcome.failed.map(({ target }) =>
          target.kind === "global"
            ? "global"
            : target.kind === "project"
              ? `project:${target.path}`
              : `group:${target.id}`,
        ),
        message: outcome.failed
          .map(({ target, message }) => `${targets.label(target)}: ${message}`)
          .join("; "),
      });
      return false;
    }
    // An edit made while saving is not part of the acknowledged draft: keep it and do not
    // acknowledge, so "Save and leave" never drops it.
    const unchanged = retainedTransactionValue<typeof draft>(`${transactionKey}:draft`) === draft;
    if (unchanged) setDraft(EMPTY_DRAFT);
    setSaveState({ state: "saved", target: outcome.saved.map(targets.label).join(", ") });
    return unchanged;
  };

  const targetOptions = targets.options.map((option) =>
    delegation.supported && option.value !== "global"
      ? { ...option, label: `${option.label} (${t("Chats only")})` }
      : option,
  );
  const project = target.kind === "project" ? target.path : null;
  // The settings shell offers "Restore defaults" for a project; visibility and accounts stay.
  useSettingsPageReset(
    project && tab === "defaults" && hasProjectOverrides(loadProjectProviderSettings(project))
      ? () => {
          const outcome = persistProviderPreference(
            () => resetProjectSessionPreferences(project),
            projectProviderSettingsPersisted,
          );
          setSaveState(
            outcome.state === "saved"
              ? { state: "saved", target: targets.label(target) }
              : { state: "error", message: outcome.message },
          );
        }
      : null,
  );

  return (
    <div className="settings-topics">
      {/* One failing Host shows one error here; nothing derived from it is shown below. */}
      {tab === "work" && scope.selected && pickedRouting.message ? (
        <SettingsHostFailure
          scope={scope}
          message={pickedRouting.message}
          revoked={pickedRouting.revoked}
          onRetry={pickedRouting.retry}
        />
      ) : null}
      {tab === "defaults" && delegation.error ? (
        <SettingsFeedback
          state="error"
          extra={<ErrorDetails detail={errorText(delegation.error)} />}
        >
          {t("Could not read the delegation settings.")}
        </SettingsFeedback>
      ) : null}
      {/* Background work reads top-down: models, groups, who uses what, limits; one Save. */}
      <div id={settingDomId("models-roles")} data-setting-id="models-roles" hidden={tab !== "work"}>
        <div className="grid max-w-4xl gap-4">
          <SettingsHostPicker scope={scope} />
          <div id={settingDomId("models-order")} data-setting-id="models-order">
            {/* Only a connected machine reaches the editor; any other state is reported instead. */}
            {!scope.selected ? (
              <SettingsHostNotice scope={scope} />
            ) : pickedRouting.pending ? (
              <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
            ) : pickedRouting.data ? (
              <HostModelSource
                machine={scope.selected}
                local={scope.entry?.isLocal}
                cwd=""
                model=""
                values={{}}
              >
                <ModelOrderSettings
                  machineId={pickedRouting.data.machineId}
                  supported={pickedRouting.data.supported}
                />
              </HostModelSource>
            ) : null}
          </div>
        </div>
        {tab === "work" ? <BykitSettingsPage /> : null}
      </div>
      <div
        id={settingDomId("models-chat")}
        data-setting-id="models-chat"
        hidden={tab !== "defaults"}
      >
        <ProviderDefaultsScopeRow
          selection={targetChoice}
          target={target}
          options={targetOptions}
          draft={changes.length > 0 ? draft : undefined}
          onDraftChange={setDraft}
          activeProvider={activeProvider ?? undefined}
          onTargetChange={(value) => {
            if (value === targetChoice) return;
            leave.guard(() => {
              updateRetainedModelsPage({ target: value });
              setTargetChoice(value);
            });
          }}
        />
        <ProviderDefaultsPanel
          harness={activeProvider}
          accountScope={accountScope}
          onAccountScopeChange={(harness, accountId) => {
            const next = { ...accountScope, [harness]: accountId };
            updateRetainedModelsPage({ accountScope: next });
            setAccountScope(next);
          }}
          target={target}
          draft={draft}
          onDraftChange={setDraft}
          providerControl={{
            // A provider with unsaved edits says so in the picker.
            options: orderedHarnesses.map((id) => ({
              value: id,
              label: editedProviders.has(id)
                ? `${HARNESS_TITLE[id]} · ${t("Unsaved")}`
                : HARNESS_TITLE[id],
            })),
            onChange: (id) => {
              updateRetainedModelsPage({ provider: id });
              setProvider(id);
            },
          }}
        />
        {tab === "defaults" ? (
          <ProviderDefaultsSaveBar
            selection={targetChoice}
            draft={draft}
            activeProvider={activeProvider ?? undefined}
            providers={orderedHarnesses.filter(
              (harness) => isHarnessAvailable(harness) && !hiddenGlobally.includes(harness),
            )}
            target={target}
            options={targetOptions}
            changes={changes}
            saveState={saveState}
            saving={saving}
            onSave={saveDraft}
            onDiscard={() => setDraft(EMPTY_DRAFT)}
          />
        ) : null}
      </div>

      {leave.dialog}
    </div>
  );
}
