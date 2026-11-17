import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../../shared/i18n";
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
import { loadLocalModelRoutingHost } from "./localModelRoutingHost";

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
  const host = useQuery({
    queryKey: ["settings", "local-model-routing-host"],
    queryFn: loadLocalModelRoutingHost,
  });
  const delegation = useDelegationProfile(host.data?.machineId, host.data?.supported === true);
  const [targetChoice, setTargetChoice] = useState(retained.target);
  const leave = useLeaveGuard();
  const [accountScope, setAccountScope] = useState(retained.accountScope);
  const [activeProvider, setProvider] = useState<HarnessId>(
    retained.provider ?? loadLastModelChoice()?.harness ?? HARNESSES[0],
  );
  // One draft spans every provider and account, so switching them never hides an edit.
  const transactionKey = `defaults:${JSON.stringify([host.data?.machineId ?? "", cwd ?? "", [...selectedTargetValues(targetChoice)].sort()])}`;
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
    if (retainedTransactionValue<boolean>(`${transactionKey}:saving`)) return;
    if (host.isPending || host.error) {
      setSaveState({
        state: "error",
        message: host.error ? String(host.error) : t("Checking Host capabilities. Try again."),
      });
      return;
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
      return;
    }
    if (retainedTransactionValue<typeof draft>(`${transactionKey}:draft`) === draft)
      setDraft(EMPTY_DRAFT);
    setSaveState({ state: "saved", target: outcome.saved.map(targets.label).join(", ") });
  };

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
    <div className="settings-topics grid min-w-0 gap-4">
      {host.error || delegation.error ? (
        <SettingsFeedback
          state="error"
          action={
            host.error
              ? {
                  label: t("Retry"),
                  onClick: () => {
                    void host.refetch();
                  },
                }
              : undefined
          }
        >
          {String(host.error ?? delegation.error)}
        </SettingsFeedback>
      ) : null}
      {/* Background work reads top-down: models, groups, who uses what, limits; one Save. */}
      <div id={settingDomId("models-roles")} data-setting-id="models-roles" hidden={tab !== "work"}>
        <div id={settingDomId("models-order")} data-setting-id="models-order">
          {host.isPending ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : (
            <ModelOrderSettings
              machineId={host.data?.machineId}
              supported={host.data?.supported === true}
            />
          )}
        </div>
      </div>
      {!host.data && host.isPending && tab !== "work" ? (
        <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
      ) : null}
      {host.data ? (
        <div
          id={settingDomId("models-chat")}
          data-setting-id="models-chat"
          hidden={tab !== "defaults"}
        >
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
              onDraftChange={setDraft}
              target={target}
              options={targets.options.map((option) =>
                delegation.supported && option.value !== "global"
                  ? {
                      ...option,
                      label: `${option.label} (${t("Chats only")})`,
                    }
                  : option,
              )}
              onTargetChange={(value) => {
                if (value === targetChoice) return;
                leave.guard(() => {
                  updateRetainedModelsPage({ target: value });
                  setTargetChoice(value);
                });
              }}
              changes={changes}
              saveState={saveState}
              saving={saving}
              onSave={saveDraft}
              onDiscard={() => setDraft(EMPTY_DRAFT)}
            />
          ) : null}
        </div>
      ) : null}
      {leave.dialog}
    </div>
  );
}
