import { useContext, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../../shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { TabDirtyDot } from "../../../../shared/ui/TabLabel";
import { Button } from "../../../../shared/ui/Button";
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
import { EMPTY_DRAFT, draftSize, selectedTargetValues } from "../../model/providerDefaultsDraft";
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
  RevealedSetting,
  useSettingsPageReset,
  SettingsFeedback,
  settingDomId,
} from "../settingsControls";
import { ModelOrderSettings, ModelRolesSettings } from "../../../model-routing/public/settings";
import { MODELS_TABS, modelsTabForSetting, type ModelsTab } from "./modelsSettingsLink";
import {
  useRetainedTransaction,
  retainedTransactionValue,
} from "../../../model-routing/public/settings";
import { loadLocalModelRoutingHost } from "./localModelRoutingHost";

function providerAccountsSnapshot() {
  return JSON.stringify([providerAccounts("claude"), providerAccounts("codex")]);
}

const retained = {
  tab: "order" as ModelsTab,
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
    tab: "order",
    draft: EMPTY_DRAFT,
    target: "global",
    provider: undefined,
    accountScope: {},
  });
}

export function ModelsPage({
  cwd,
  recents,
  work = false,
}: {
  cwd?: string;
  recents?: RecentProject[];
  work?: boolean;
}) {
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
  const revealed = useContext(RevealedSetting);
  const [handled, setHandled] = useState<string | null | undefined>(undefined);
  const [tab, setTabState] = useState<ModelsTab>(
    (work
      ? modelsTabForSetting(revealed) === "chat"
        ? undefined
        : modelsTabForSetting(revealed)
      : "chat") ?? (retained.tab === "chat" ? "order" : retained.tab),
  );
  const setTab = (next: ModelsTab) => {
    updateRetainedModelsPage({ tab: next });
    setTabState(next);
  };
  // A new search/deep link selects once; manual tab changes remain stable.
  if (handled !== revealed) {
    setHandled(revealed);
    const next = modelsTabForSetting(revealed);
    if (next && (work ? next !== "chat" : next === "chat")) setTab(next);
  }
  const [targetChoice, setTargetChoice] = useState(retained.target);
  const [accountScope, setAccountScope] = useState(retained.accountScope);
  const [activeProvider, setProvider] = useState<HarnessId>(
    retained.provider ?? loadLastModelChoice()?.harness ?? HARNESSES[0],
  );
  const transactionKey = `defaults:${JSON.stringify([host.data?.machineId ?? "", cwd ?? "", activeProvider, accountScope[activeProvider] ?? "", [...selectedTargetValues(targetChoice)].sort()])}`;
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
  const pending = draftSize(draft);
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
    project &&
      (tab === "chat" || tab === "delegation") &&
      hasProjectOverrides(loadProjectProviderSettings(project))
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

  const labels = {
    order: t("Model order"),
    roles: t("Assignments"),
    chat: t("Chat"),
    delegation: t("Subagents"),
  };
  return (
    <div className="settings-topics grid min-w-0 gap-4">
      <Tabs value={tab} onValueChange={setTab} panels="shared" size="md">
        {/* Models keeps only Chat defaults; a lone tab would just repeat the page title. */}
        <TabList label={t(work ? "Background work" : "Chat models")} hidden={!work}>
          {MODELS_TABS.filter((id) => (work ? id !== "chat" : id === "chat")).map((id) => (
            <Tab
              key={id}
              value={id}
              accessory={
                (id === "chat" || id === "delegation") && pending > 0 ? <TabDirtyDot /> : undefined
              }
            >
              {labels[id]}
            </Tab>
          ))}
        </TabList>
        <TabPanel tabIndex={-1}>
          {host.error || delegation.error ? (
            <SettingsFeedback
              state="error"
              action={
                host.error ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void host.refetch();
                    }}
                  >
                    {t("Retry")}
                  </Button>
                ) : undefined
              }
            >
              {String(host.error ?? delegation.error)}
            </SettingsFeedback>
          ) : null}
          <div
            id={settingDomId("models-order")}
            data-setting-id="models-order"
            hidden={tab !== "order"}
          >
            {host.isPending ? (
              <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
            ) : (
              <ModelOrderSettings
                machineId={host.data?.machineId}
                supported={host.data?.supported === true}
              />
            )}
          </div>
          <div
            id={settingDomId("models-roles")}
            data-setting-id="models-roles"
            hidden={tab !== "roles"}
          >
            {host.isPending ? (
              <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
            ) : (
              <ModelRolesSettings
                machineId={host.data?.machineId}
                supported={host.data?.supported === true}
                onOpenOrder={() => setTab("order")}
              />
            )}
          </div>
          {!host.data && host.isPending ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : null}
          {host.data ? (
            <div
              id={settingDomId(tab === "delegation" ? "models-delegation" : "models-chat")}
              data-setting-id={tab === "delegation" ? "models-delegation" : "models-chat"}
              hidden={tab !== "chat" && tab !== "delegation"}
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
                section={tab === "delegation" ? "delegation" : "chat"}
                providerControl={{
                  options: orderedHarnesses.map((id) => ({ value: id, label: HARNESS_TITLE[id] })),
                  onChange: (id) => {
                    updateRetainedModelsPage({ provider: id });
                    setProvider(id);
                  },
                }}
              />
              {tab === "chat" || tab === "delegation" ? (
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
                    tab === "delegation" && delegation.supported && option.value !== "global"
                      ? { ...option, label: `${option.label} (${t("Chats only")})` }
                      : option,
                  )}
                  onTargetChange={(value) => {
                    updateRetainedModelsPage({ target: value });
                    setTargetChoice(value);
                  }}
                  pending={pending}
                  saveState={saveState}
                  saving={saving}
                  onSave={() => {
                    void saveDraft();
                  }}
                  onDiscard={() => setDraft(EMPTY_DRAFT)}
                />
              ) : null}
            </div>
          ) : null}
        </TabPanel>
      </Tabs>
    </div>
  );
}
