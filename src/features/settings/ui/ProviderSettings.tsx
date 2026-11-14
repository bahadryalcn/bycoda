import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../providers/public/providerAccounts";
import { mergeProviderCliChecks } from "../model/providerCliChecks";
import type { HarnessVersionCheck } from "../model/providerCliChecks";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Group, RevealedSetting, SettingsFeedback, settingDomId } from "./settingsControls";
import { t, useLocale } from "../../../shared/i18n";
import { ArrowDownCircle, RefreshCw } from "../../../shared/ui/icons";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import "./ProviderSettings.css";
import { Button } from "../../../shared/ui/Button";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import {
  catalogModelsFor,
  getModelSnapshot,
  loadHiddenPickerProviders,
  loadLastModelChoice,
  savePickerProviderVisible,
  subscribeModels,
  subscribePickerVisibility,
} from "../../sessions/public/models";
import { HARNESSES, HARNESS_TITLE } from "../../sessions";
import type { HarnessId } from "../../sessions/public/session";
import {
  projectProvidersRevision,
  subscribeProjectProviders,
} from "../../sessions/public/projectProviders";
import {
  providerSessionDefaultsSnapshot,
  subscribeProviderSessionDefaults,
} from "../../sessions/public/providerSessionDefaults";
import {
  persistProviderPreference,
  type ProviderPreferenceOutcome,
} from "../../providers/public/providerPreferenceOutcome";
import {
  ProviderList,
  providerMetaLine,
  type ProviderListEntry,
} from "../../providers/ui/ProviderList";
import { ProviderDetailHeader } from "../../providers/public/ProviderStatusGroup";
import { providerAuthState } from "../../providers/ui/providerStatus";
import {
  checkInstalledHarnessVersions,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
} from "../../providers/model/harnessUpdateActions";
import { onHarnessUpdated, pendingHarnessUpdates } from "../../providers/model/harnessUpdates";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { getAllRateLimits, subscribeRateLimits } from "../../providers/public/rateLimitsCache";
import { GenericAcpSettings } from "../../providers/ui/GenericAcpSettings";
import type { RecentProject } from "../../projects/public/recents";
import { loadClaudeHooks, saveClaudeHooks, subscribeClaudeHooks } from "../model/settings";
import { providersTabForSetting, type ProvidersTab } from "../model/providerSettingsTabs";
import { ProviderAccountsSettings } from "./ProviderAccountsSettings";
import { ProviderDecisionModels } from "./ProviderDecisionModels";
import { storedDefaultProvider } from "./ProviderDefaultsPanel";
import { ProviderModelsGroup } from "./ProviderModelsGroup";
import { ProviderCliTab } from "./ProviderCliTab";
import { ProviderRuntimeGroup } from "./ProviderRuntimeGroup";
import { ModelsPage as DefaultsPage } from "./models/ModelsPage";

let retainedTab: ProvidersTab = "providers";

export function resetRetainedProvidersPage() {
  retainedTab = "providers";
}

export function ProvidersPage({ cwd, recents }: { cwd?: string; recents?: RecentProject[] }) {
  useLocale();
  const modelsVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
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
  const rateLimits = useSyncExternalStore(subscribeRateLimits, getAllRateLimits, getAllRateLimits);
  const now = useMinuteNow();
  useSyncExternalStore(subscribeProviderAccounts, () =>
    JSON.stringify(PROVIDER_ACCOUNT_PROVIDERS.map((provider) => providerAccounts(provider))),
  );
  const [claudeHooks, setClaudeHooks] = useStoredPreferenceState(
    loadClaudeHooks,
    subscribeClaudeHooks,
  );
  const [hiddenGlobally, setHiddenGlobally] = useStoredPreferenceState(
    loadHiddenPickerProviders,
    subscribePickerVisibility,
  );
  const [selectedProvider, setSelectedProvider] = useState<HarnessId | null>(
    () => loadLastModelChoice()?.harness ?? null,
  );
  const [tab, setTabState] = useState<ProvidersTab>(retainedTab);
  const setTab = (next: ProvidersTab) => {
    retainedTab = next;
    setTabState(next);
  };
  const [accountBusy, setAccountBusy] = useState(false);
  const [defaultsVisited, setDefaultsVisited] = useState(tab === "defaults");
  if (tab === "defaults" && !defaultsVisited) setDefaultsVisited(true);
  const [standaloneSignIn, setStandaloneSignIn] = useState<HarnessId | null>(null);
  // When this window last finished a version check; the snapshot itself carries no time.
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  // The list's picker switches save at once; storage can refuse the write.
  const [listOutcome, setListOutcome] = useState<
    (ProviderPreferenceOutcome & { retry: () => void }) | null
  >(null);
  const updateSnapshot = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );
  const [rowChecks, setRowChecks] = useState<
    { source: HarnessVersionCheck[] | null; check: HarnessVersionCheck }[]
  >([]);
  const revealedSetting = useContext(RevealedSetting);
  const handledReveal = useRef<string | null>(null);

  useEffect(() => {
    void probeHarnessAvailability();
  }, []);

  useEffect(() => {
    // Another window's update leaves this window's versions stale.
    const unlisten = onHarnessUpdated(() => {
      if (getHarnessUpdateSnapshot().checks) {
        void checkInstalledHarnessVersions().catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => {
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  const onClaudeHooks = (next: boolean) => {
    saveClaudeHooks(next);
    setClaudeHooks(next);
  };

  const onPickerVisible = (harness: HarnessId, visible: boolean) => {
    const attempt = () => {
      const outcome = persistProviderPreference(
        () => savePickerProviderVisible(harness, visible),
        () => loadHiddenPickerProviders().includes(harness) === !visible,
      );
      setListOutcome({ ...outcome, retry: attempt });
    };
    attempt();
    setHiddenGlobally((prev) =>
      visible ? prev.filter((id) => id !== harness) : [...new Set([...prev, harness])],
    );
  };

  // Installed CLIs come first. Stable sorting keeps Claude before Codex and
  // preserves the catalog order within each availability group.
  const orderedHarnesses = [...HARNESSES].sort(
    (left, right) => Number(isHarnessAvailable(right)) - Number(isHarnessAvailable(left)),
  );
  const activeProvider =
    selectedProvider && orderedHarnesses.includes(selectedProvider)
      ? selectedProvider
      : (orderedHarnesses[0] ?? null);

  useEffect(() => {
    if (accountBusy) return;
    if (!revealedSetting) {
      handledReveal.current = null;
      return;
    }
    // A search reveal selects its tab and provider once. Keep subsequent manual
    // selections stable while the same setting remains revealed.
    if (handledReveal.current === revealedSetting) return;
    handledReveal.current = revealedSetting;
    const revealedTab = providersTabForSetting(revealedSetting);
    if (revealedTab) setTab(revealedTab);

    if (revealedSetting.startsWith("cli-path-")) {
      const harness = revealedSetting.slice("cli-path-".length) as HarnessId;
      if (HARNESSES.includes(harness)) setSelectedProvider(harness);
    } else if (revealedSetting.startsWith("terminal-account-profiles-")) {
      const provider = revealedSetting.slice("terminal-account-profiles-".length);
      if (PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider)) {
        setSelectedProvider(provider as HarnessId);
      }
    } else if (revealedSetting === "enabled-models") {
      const modelProvider =
        activeProvider && catalogModelsFor(activeProvider).length > 0
          ? activeProvider
          : HARNESSES.find((harness) => catalogModelsFor(harness).length > 0);
      if (modelProvider) setSelectedProvider(modelProvider);
    } else if (revealedSetting === "claude-hooks") {
      setSelectedProvider("claude");
    } else if (revealedSetting === "antigravity-account") {
      setSelectedProvider("antigravity");
    } else if (revealedSetting.startsWith("acp-")) {
      setSelectedProvider("acp");
    } else if (
      revealedSetting === "provider-accounts" ||
      revealedSetting === "terminal-account-profiles"
    ) {
      setSelectedProvider((current) =>
        current && PROVIDER_ACCOUNT_PROVIDERS.some((provider) => provider === current)
          ? current
          : PROVIDER_ACCOUNT_PROVIDERS[0],
      );
    }
  }, [revealedSetting, modelsVersion, activeProvider, accountBusy]);

  const listDefault = storedDefaultProvider({ kind: "global" });
  const probed = hasProbedHarnessAvailability();
  const entryFor = (harness: HarnessId): ProviderListEntry => {
    const check = updateSnapshot.checks?.find((entry) => entry.harness === harness);
    const accountKey = supportsProviderAccounts(harness)
      ? `${harness}:${defaultProviderAccountId(harness)}`
      : null;
    const accounts = supportsProviderAccounts(harness) ? providerAccounts(harness) : [];
    const states = accounts.map((account) =>
      providerAuthState(rateLimits[`${harness}:${account.id}`], now),
    );
    const signedOut = states.filter((state) => state?.tone === "signedOut").length;
    const auth = accountKey ? providerAuthState(rateLimits[accountKey], now) : null;
    const accountSummary =
      accounts.length > 1
        ? [
            t("{p0} accounts", { p0: accounts.length }),
            signedOut ? t("{p0} signed out", { p0: signedOut }) : "",
          ]
            .filter(Boolean)
            .join(", ")
        : accounts.length === 1
          ? auth?.label
          : undefined;
    return {
      harness,
      available: isHarnessAvailable(harness),
      isDefault: listDefault === harness,
      inPicker: !hiddenGlobally.includes(harness),
      pickerLocked: false,
      version: check && check.status !== "unknown" ? check.installed : undefined,
      updateAvailable: check?.status === "behind",
      auth: signedOut
        ? { tone: "signedOut", label: t("{p0} signed out", { p0: signedOut }) }
        : (auth ?? states.find((state) => state !== null) ?? null),
      accountSummary,
    };
  };
  const entries = orderedHarnesses.map(entryFor);

  // Update summary for the whole page; each provider's own state lives in its Status group.
  const { checks: sharedChecks, checking, runs, error: checkError } = updateSnapshot;
  const checks = mergeProviderCliChecks(sharedChecks, rowChecks);
  const pendingUpdates = pendingHarnessUpdates(checks ?? []).filter(
    (update) => runs[update.harness]?.status !== "updating",
  );
  const attention = checks
    ? checks.filter(
        (check) => check.status !== "current" || runs[check.harness]?.status === "failed",
      ).length
    : 0;
  const runCheck = () => {
    void checkInstalledHarnessVersions({ force: true })
      .then(() => setCheckedAt(Date.now()))
      .catch(() => undefined);
  };
  const updatesSummary = checking
    ? t("Checking installed CLIs…")
    : checks === null
      ? t("Not checked yet")
      : checks.length === 0
        ? t("None of the CLIs with a release feed are installed.")
        : pendingUpdates.length > 0 && pendingUpdates.length <= 3
          ? t("Update available: {p0}", {
              p0: pendingUpdates.map((update) => HARNESS_TITLE[update.harness]).join(", "),
            })
          : attention > 0
            ? attention === 1
              ? t("1 CLI needs attention")
              : t("{p0} CLIs need attention", { p0: attention })
            : t("Up to date");

  const setupProvider = (harness: HarnessId) => {
    setTab("cli");
    setSelectedProvider(harness);
    // The Runtime section holds the CLI path and setup for this provider.
    requestAnimationFrame(() =>
      document
        .getElementById(settingDomId(`cli-path-${harness}`))
        ?.scrollIntoView?.({ block: "center" }),
    );
  };

  const tabs: { id: ProvidersTab; label: string }[] = [
    { id: "providers", label: t("Accounts") },
    { id: "defaults", label: t("Defaults") },
    { id: "cli", label: t("CLI") },
    { id: "models", label: t("Catalog") },
    { id: "decision", label: t("Decision models") },
  ];

  return (
    <div className="settings-topics grid min-w-0 gap-4">
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as ProvidersTab)}
        panels="shared"
        size="md"
      >
        <TabList label={t("Providers")} className="provider-tabs">
          {tabs.map((item) => (
            <Tab key={item.id} value={item.id} disabled={accountBusy && item.id !== tab}>
              {item.label}
            </Tab>
          ))}
        </TabList>
        <TabPanel className="provider-tab-panel" tabIndex={-1}>
          <div
            className="provider-cli-section provider-defaults-section"
            hidden={tab !== "defaults"}
          >
            {defaultsVisited ? <DefaultsPage cwd={cwd} recents={recents} /> : null}
          </div>
          {tab === "cli" ? (
            <Group
              id="harness-updates"
              layout="full"
              title={t("CLI")}
              description={updatesSummary}
              action={
                <div className="provider-updates-actions">
                  {checkedAt != null && !checking ? (
                    <Text
                      as="span"
                      size="caption"
                      tone="muted"
                      leading="inherit"
                      className="provider-status-checked"
                    >
                      {t("Checked {p0}", { p0: formatRelativeTime(checkedAt) })}
                    </Text>
                  ) : null}
                  <Button
                    size="sm"
                    stableWidth
                    onClick={runCheck}
                    disabled={checking}
                    loading={checking}
                    startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />}
                  >
                    {t("Check all")}
                  </Button>
                  <Button
                    size="sm"
                    stableWidth
                    onClick={() => {
                      for (const update of pendingUpdates) void runHarnessUpdate(update);
                    }}
                    variant={pendingUpdates.length ? "primary" : "secondary"}
                    tone={pendingUpdates.length ? "accent" : "neutral"}
                    disabled={pendingUpdates.length === 0}
                    tooltip={pendingUpdates.length === 0 ? t("Nothing to update") : undefined}
                    startIcon={<ArrowDownCircle className="icon-sm text-accent" aria-hidden />}
                  >
                    {pendingUpdates.length
                      ? t("Update all ({p0})", { p0: pendingUpdates.length })
                      : t("Update all")}
                  </Button>
                </div>
              }
              feedback={
                checkError ? (
                  <SettingsFeedback state="error">
                    {t("Could not check CLI updates: {p0}", { p0: checkError })}
                  </SettingsFeedback>
                ) : undefined
              }
            >
              {null}
            </Group>
          ) : null}
          {listOutcome?.state === "unsaved" ? (
            <SettingsFeedback
              state="error"
              action={
                <Button size="sm" variant="ghost" onClick={listOutcome.retry}>
                  {t("Retry")}
                </Button>
              }
            >
              {t("Not saved. The choice applies until this window closes. {p0}", {
                p0: listOutcome.message,
              })}
            </SettingsFeedback>
          ) : null}
          {/* Decision models keeps its scan and routing drafts while other tabs show. */}
          <div className="provider-cli-section" hidden={tab !== "decision"}>
            <ProviderDecisionModels />
          </div>
          <div className="provider-cli-section" hidden={tab !== "cli"}>
            <ProviderCliTab
              checkedAt={checkedAt}
              onCheck={runCheck}
              onRowCheck={(check) =>
                setRowChecks((rows) => [
                  ...rows.filter((row) => row.check.harness !== check.harness),
                  { source: sharedChecks, check },
                ])
              }
            />
          </div>
          <div
            className="provider-cli-container"
            hidden={tab === "decision" || tab === "cli" || tab === "defaults"}
          >
            <div className="provider-cli-workspace">
              <div className="provider-cli-select">
                <SearchableSelect
                  hideLabel
                  label={t("Providers")}
                  value={activeProvider ?? ""}
                  disabled={accountBusy}
                  searchPlaceholder={t("Search providers…")}
                  options={entries.map((entry) => ({
                    value: entry.harness,
                    label: HARNESS_TITLE[entry.harness],
                    description: [
                      providerMetaLine(entry, probed),
                      entry.isDefault ? t("Default provider") : "",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  }))}
                  onChange={(value) => {
                    const provider = orderedHarnesses.find((harness) => harness === value);
                    if (provider) setSelectedProvider(provider);
                  }}
                />
              </div>
              <ProviderList
                entries={entries}
                active={activeProvider}
                probed={probed}
                disabled={accountBusy}
                onSelect={setSelectedProvider}
                onPickerVisible={onPickerVisible}
                onSetup={setupProvider}
              />
              <div
                {...surfaceAttributes(
                  { frame: "settings", edge: "responsive-start" },
                  "provider-cli-detail",
                )}
              >
                {/* Overview stays mounted across tabs so CLI path, ACP and sign-in drafts survive. */}
                <div className="provider-cli-section" hidden={tab !== "providers"}>
                  {activeProvider ? (
                    <>
                      <ProviderDetailHeader
                        harness={activeProvider}
                        signInCompleted={standaloneSignIn === activeProvider}
                        available={isHarnessAvailable(activeProvider)}
                      />
                    </>
                  ) : null}
                  {accountBusy ? (
                    <Text role="status" as="p" size="caption" tone="secondary">
                      {t("Finish or cancel the account operation before switching providers.")}
                    </Text>
                  ) : null}
                  <ProviderAccountsSettings
                    harness={activeProvider ?? undefined}
                    onBusyChange={setAccountBusy}
                    onStandaloneSignIn={setStandaloneSignIn}
                  />
                  {orderedHarnesses.map((harness) => (
                    <div
                      key={harness}
                      className="provider-cli-panel"
                      hidden={activeProvider !== harness}
                    >
                      <ProviderRuntimeGroup
                        harness={harness}
                        claudeHooks={claudeHooks}
                        onClaudeHooksChange={onClaudeHooks}
                        inPicker={!hiddenGlobally.includes(harness)}
                        onPickerVisible={(visible) => onPickerVisible(harness, visible)}
                      />
                      {harness === "acp" ? <GenericAcpSettings cwd={cwd} embedded /> : null}
                    </div>
                  ))}
                </div>
                {tab === "models" && activeProvider ? (
                  <ProviderModelsGroup key={activeProvider} harness={activeProvider} />
                ) : null}
              </div>
            </div>
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
