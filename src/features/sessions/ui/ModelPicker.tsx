import { MenuRow } from "../../../shared/ui/MenuRow";
import { Text } from "../../../shared/ui/Text";
import { TogglePill } from "./ModelExtras";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { SelectTrigger } from "../../../shared/ui/Select";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { clampActiveIndex } from "../../../shared/hooks/useKeyedActiveIndex";
import { useLocale, useT } from "../../../shared/i18n";
import { Check, ChevronDown, Gauge, Zap } from "../../../shared/ui/icons";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  coerceModelPickerTab,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  isModelEnabled,
  loadFavoriteModels,
  loadRecentModelChoices,
  saveFavoriteModels,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
  type ModelSetting,
} from "../model/models";

import { projectProvidersRevision, subscribeProjectProviders } from "../model/projectProviders";

import {
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { useModelSource } from "./modelSource";
import {
  visibleModelsAtSnapshot,
  menuSettingsAtRevision,
  modelEnabledAtRevision,
  pickerProviderAtRevision,
  providerAccountsAtSnapshot,
} from "./modelStoreReaders";
import { offeredDelegationSetting } from "../model/claudeAdvisor";
import { delegationNextValue } from "../model/crossDelegation";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { ModelPanel } from "./ModelPanel";
import { Popover, popupListClassName } from "../../../shared/ui/Popover";
import { keybindingPressed } from "../../settings/public/settings";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";
import { lazySurface } from "../../../shared/ui/lazySurface";
import {
  accountChoicesSnapshot,
  signedOutAccountKeys,
  accountModelChoices,
  accountDisplayLabel,
  modelAccountLabel,
  modelChoiceKey,
  type AccountModelChoice,
} from "../model/accountModelChoices";
import { getAllRateLimits, subscribeRateLimits } from "../../providers/public/rateLimitsCache";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  supportsProviderAccounts,
  subscribeProviderAccounts,
} from "../../providers/public/providerAccounts";
import {
  effortSetting,
  fastSetting,
  isEffortSetting,
  isSettingLocked,
  pillSettings,
  recentMenuModels,
  settingLabel,
  settingValue,
  settingValueLabel,
} from "../model/modelPickerData";
const ModelFlyout = lazySurface(async () => ({
  default: (await import("./ModelFlyout")).ModelFlyout,
}));

/** Warm the optional flyout when the user shows intent to choose a model. */
export const preloadModelPicker = () => ModelFlyout.preload();

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  /** Project whose disabled providers are hidden from the picker. */
  project?: string;
  /** Hide option rows from the menu when they render as pills beside the picker. */
  hideSettings?: boolean;
  /** Keep the current effort beside the model when options live in Extras. */
  showEffortSummary?: boolean;
  /** Limit provider tabs for surfaces that only support one harness. */
  allowedHarnesses?: readonly HarnessId[];
  hotkeys?: boolean;
  /** Bump to open the picker from outside, e.g. a usage-limit notice. */
  openRequest?: number;
  /**
   * `inline` (default) is the compact toolbar trigger. `field` renders the trigger as a
   * full-width, left-aligned form field, for forms where the picker answers a labelled question.
   */
  presentation?: "inline" | "field";
  /**
   * Optional labelled "no explicit model" choice, e.g. "Use the global agent". It leads the menu;
   * `selected` mirrors the owner's empty value and `onSelect` stores it. While it is selected the
   * trigger shows the label and the model options stay hidden. Menu presentation only: it is
   * ignored with `hideSettings`, which opens the model list directly.
   */
  inheritChoice?: { label: string; selected: boolean; onSelect: () => void };
  accountId?: string;
  accountChoices?: boolean;
  /** Offer the current selection's extras inside the picker; only where changes are kept. */
  showExtras?: boolean;
  /** Model settings stay readable but locked, e.g. while a turn runs. */
  extrasDisabled?: boolean;
  onChange: (harness: HarnessId, model: string, accountId?: string) => void;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
};
type RecentMenu = { models: AccountModelChoice[] };
const MENU_WIDTH = 250;
/** Account the provider tab `target` runs on: the one picked while browsing, else the current one, else its default. */
function accountForTab(
  target: HarnessId,
  tabAccounts: Partial<Record<HarnessId, string>>,
  currentHarness: HarnessId,
  currentAccountId: string | undefined,
  hostAccounts: unknown,
): string {
  return (
    tabAccounts[target] ??
    (target === currentHarness && currentAccountId
      ? currentAccountId
      : hostAccounts === undefined && supportsProviderAccounts(target)
        ? defaultProviderAccountId(target)
        : "default")
  );
}
/**
 * @use Provider/account/model selection with settings and recent-model shortcuts; shared triggers own presentation.
 * @avoid A single flat model value without these controls: SearchableSelect.
 * @replaces Domain model selection, not the shared field or popup row primitives.
 */
export function ModelPicker({
  harness,
  model,
  values,
  project,
  hideSettings = false,
  showEffortSummary = !hideSettings,
  allowedHarnesses,
  hotkeys = false,
  openRequest = 0,
  presentation = "inline",
  inheritChoice,
  accountId,
  accountChoices = false,
  showExtras = false,
  extrasDisabled = false,
  onChange,
  onSettingsChange,
  onClose,
}: Props) {
  const t = useT();
  const source = useModelSource();
  const usage = useSyncExternalStore(subscribeRateLimits, getAllRateLimits, getAllRateLimits);
  const switchShortcut = useKeybindingShortcut("App: Switch Model");
  const refreshSource = useStableCallback(source.refresh);
  const accountsSnapshot = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      source.accounts === undefined ? accountChoicesSnapshot() : JSON.stringify(source.accounts),
    () =>
      source.accounts === undefined ? accountChoicesSnapshot() : JSON.stringify(source.accounts),
  );
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const projectVersion = useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelPickerTab>(harness);
  // The highlighted row is kept by identity, so a catalog refresh cannot move it to another model.
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const [seenOpenRequest, setSeenOpenRequest] = useState(0);
  const [recentMenu, setRecentMenu] = useState<RecentMenu | null>(null);
  const [recentActive, setRecentActive] = useState(0);
  // Account picked per provider tab while browsing; the current provider starts on its account.
  const [tabAccounts, setTabAccounts] = useState<Partial<Record<HarnessId, string>>>({});
  const [accountListOpen, setAccountListOpen] = useState(false);
  const accountListOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const favoritesRef = useRef(favorites);
  useLayoutEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  const recentMenuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const currentRef = useRef<AgentModel | null>(null);
  const lastHotkey = useRef(-Infinity);

  const current = source.resolve(harness, model);
  const field = presentation === "field";
  const inherit = hideSettings ? undefined : inheritChoice;
  const inheritSelected = inherit?.selected === true;
  // The local default account lives in browser storage, so React reads it through its store.
  const localDefaultAccountId = useSyncExternalStore(
    subscribeProviderAccounts,
    () => (supportsProviderAccounts(harness) ? defaultProviderAccountId(harness) : undefined),
    () => (supportsProviderAccounts(harness) ? defaultProviderAccountId(harness) : undefined),
  );
  const currentAccountId = supportsProviderAccounts(harness)
    ? (accountId ?? (source.accounts === undefined ? localDefaultAccountId : "default"))
    : undefined;
  const currentChoiceKey = modelChoiceKey({
    ...current,
    accountId: accountChoices ? currentAccountId : undefined,
  });
  // Local account names live in browser storage, so React reads the label through their store.
  const currentLabel = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      accountChoices ? modelAccountLabel(current, currentAccountId, source.accounts) : current.name,
    () =>
      accountChoices ? modelAccountLabel(current, currentAccountId, source.accounts) : current.name,
  );
  // The account is part of the identity only while there is a choice between
  // accounts; a lone default account stays out of the trigger.
  const triggerAccountLabel = useMemo(() => {
    if (!accountChoices || !currentAccountId || !supportsProviderAccounts(harness))
      return undefined;
    // A saved account that no longer exists is shown honestly instead of a blank label.
    if (source.accounts !== undefined) {
      const accounts = source.accounts[harness] ?? [];
      const saved = accounts.find((account) => account.id === currentAccountId);
      if (!saved) return currentAccountId === "default" ? undefined : t("Unavailable Host account");
      return accounts.length > 1 ? accountDisplayLabel(accounts, saved) : undefined;
    }
    const accounts = providerAccountsAtSnapshot(harness, accountsSnapshot);
    const known = accounts.some((account) => account.id === currentAccountId);
    if (
      !known &&
      currentAccountId !== defaultProviderAccountId(harness) &&
      currentAccountId !== "default"
    )
      return t("Removed account");
    if (accounts.length <= 1) return undefined;
    const saved = accounts.find((account) => account.id === currentAccountId);
    return saved
      ? accountDisplayLabel(accounts, saved)
      : providerAccountLabel(harness, currentAccountId);
  }, [accountChoices, accountsSnapshot, currentAccountId, harness, source.accounts, t]);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    currentRef.current = current;
  }, [onClose, current]);
  useLayoutEffect(() => {
    openRef.current = open;
    accountListOpenRef.current = accountListOpen;
  }, [open, accountListOpen]);
  const pickerHarnesses = useMemo(() => {
    return HARNESSES.filter(
      (id) =>
        (!allowedHarnesses || allowedHarnesses.includes(id)) &&
        pickerProviderAtRevision(
          id,
          project,
          source,
          availabilityVersion,
          visibilityVersion,
          projectVersion,
        ),
    );
  }, [source, allowedHarnesses, availabilityVersion, visibilityVersion, projectVersion, project]);
  const settings = useMemo(() => {
    // In beside-picker mode every option row renders as a toolbar pill, so the
    // menu lists models only.
    if (hideSettings || inheritSelected) return [];
    // Delegation and Context lead; Fast and Reasoning stay near Model.
    return menuSettingsAtRevision(
      {
        current,
        harnesses: pickerHarnesses,
        source,
        accountChoices: true,
        currentAccountId,
        signedOutAccounts: source.accounts === undefined ? signedOutAccountKeys(usage) : undefined,
        signedOutLabel: t("Not signed in"),
        values,
        unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
      },
      catalogVersion,
    );
  }, [
    catalogVersion,
    current,
    currentAccountId,
    hideSettings,
    inheritSelected,
    pickerHarnesses,
    source,
    t,
    usage,
    values,
  ]);
  // Moving option rows into Extras must not hide the current effort next to
  // the model name. Menu placement and the selection summary are independent.
  const triggerEffortSetting =
    showEffortSummary && !inheritSelected ? effortSetting(current) : undefined;
  const triggerEffortLabel = triggerEffortSetting
    ? settingValueLabel(triggerEffortSetting, values)
    : undefined;
  const triggerFastSetting =
    showEffortSummary && !inheritSelected ? fastSetting(current) : undefined;
  const triggerFastOn =
    triggerFastSetting?.kind === "toggle" && settingValue(triggerFastSetting, values) === "true";
  const triggerTitle = inheritSelected
    ? inherit.label
    : [
        HARNESS_TITLE[current.harness],
        current.provider?.name,
        currentLabel,
        triggerEffortLabel,
        triggerFastOn ? t("Fast") : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
  const providerKey = pickerHarnesses.join(",");
  const visibleTab = coerceModelPickerTab(tab, (id) => pickerHarnesses.includes(id));
  const accountFor = (target: HarnessId) =>
    accountForTab(target, tabAccounts, current.harness, currentAccountId, source.accounts);
  // The browsed provider's account may be the local default, which lives in browser storage.
  const browsedAccountId = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      visibleTab === "favorites"
        ? ""
        : accountForTab(
            visibleTab,
            tabAccounts,
            current.harness,
            currentAccountId,
            source.accounts,
          ),
    () =>
      visibleTab === "favorites"
        ? ""
        : accountForTab(
            visibleTab,
            tabAccounts,
            current.harness,
            currentAccountId,
            source.accounts,
          ),
  );
  // Recent models that stopped being offered drop out of the open menu.
  const recentModels = useMemo(() => {
    return (recentMenu?.models ?? []).filter(
      (item) =>
        pickerHarnesses.includes(item.harness) && modelEnabledAtRevision(item.id, catalogVersion),
    );
  }, [recentMenu, pickerHarnesses, catalogVersion]);
  const recentOpen = recentMenu != null && recentModels.length > 0;
  const recentIndex = clampActiveIndex(recentActive, recentModels.length);

  const visibleModels = useMemo(
    () =>
      visibleModelsAtSnapshot(
        {
          source,
          tab: visibleTab,
          favorites,
          harnesses: pickerHarnesses,
          query,
          hideSettings,
          accountChoices,
        },
        catalogVersion,
        accountsSnapshot,
      ),
    [
      source,
      catalogVersion,
      favorites,
      pickerHarnesses,
      query,
      visibleTab,
      accountChoices,
      accountsSnapshot,
      hideSettings,
    ],
  );

  // An inherited (empty) choice has no current model to mark or start on.
  const markedChoiceKey = inheritSelected
    ? ""
    : hideSettings
      ? currentChoiceKey
      : modelChoiceKey({ ...current, accountId: undefined });
  const currentModelIndex = visibleModels.findIndex(
    (item) => modelChoiceKey(item) === markedChoiceKey,
  );
  const chosenModelIndex =
    activeModelKey == null
      ? -1
      : visibleModels.findIndex((item) => modelChoiceKey(item) === activeModelKey);
  const activeModel = chosenModelIndex >= 0 ? chosenModelIndex : Math.max(0, currentModelIndex);
  const setActiveModel = (next: number | ((index: number) => number)) => {
    const item = visibleModels[typeof next === "function" ? next(activeModel) : next];
    if (item) setActiveModelKey(modelChoiceKey(item));
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setActiveModelKey(null);
  };

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setRecentMenu(null);
    setAccountListOpen(false);
    if (restore) {
      button.current?.focus({ preventScroll: true });
      onCloseRef.current?.();
    }
  };

  // Every open starts from the current provider with a fresh list, search and favorites.
  const beginOpen = () => {
    setRecentMenu(null);
    setOpen(true);
    setTab(coerceModelPickerTab(current.harness, (id) => pickerHarnesses.includes(id)));
    setTabAccounts({});
    setAccountListOpen(false);
    setQuery("");
    setActiveModelKey(null);
    setFavorites(loadFavoriteModels());
  };

  const togglePicker = () => {
    if (openRef.current) dismiss(true);
    else beginOpen();
  };

  const openRecentMenu = () => {
    const selected = currentRef.current;
    if (!selected) return;
    const models = accountModelChoices(
      recentMenuModels(selected, source, loadRecentModelChoices()).filter(
        (item) => pickerHarnesses.includes(item.harness) && isModelEnabled(item.id),
      ),
      accountChoices,
      source.accounts,
    );
    if (!models.length) return;
    const selectedIndex = models.findIndex((item) => modelChoiceKey(item) === currentChoiceKey);
    setOpen(false);
    setRecentActive(selectedIndex >= 0 ? selectedIndex : 0);
    setRecentMenu({ models });
  };

  // A bumped request opens the picker from outside (also on mount).
  if (openRequest !== seenOpenRequest) {
    setSeenOpenRequest(openRequest);
    if (openRequest !== 0) {
      if (open) setRecentMenu(null);
      else beginOpen();
    }
  }

  const toggleFromHotkey = () => {
    // Native menu accelerators can arrive alongside the webview key event.
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    togglePicker();
  };

  // Source object/catalog updates must not reset a live menu or refresh the remote catalog in a loop.
  useEffect(() => {
    if (!open) return;
    refreshSource([current.harness]);
  }, [open, current.harness, source.id, refreshSource]);

  useEffect(() => {
    if (!open || visibleTab === "favorites") return;
    refreshSource([visibleTab]);
  }, [open, visibleTab, source.id, refreshSource]);

  useEffect(() => {
    const inBlockingUi = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".bycoda-terminal")) return true;
      return Boolean(
        target.closest(
          "[data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-access-picker], [data-model-control]",
        ),
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      const mod = event.metaKey || event.ctrlKey;
      const defaultSwitch = mod && !event.altKey && event.shiftKey && event.code === "Period";
      if (hotkeys && keybindingPressed("App: Switch Model", event, defaultSwitch)) {
        if (!openRef.current && inBlockingUi(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleFromHotkey();
        return;
      }
      if (!openRef.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // Escape steps back from the account list before it closes the panel.
      if (accountListOpenRef.current) setAccountListOpen(false);
      else dismiss(true);
    };

    const onMenu = () => {
      if (!hotkeys) return;
      if (inBlockingUi(document.activeElement)) return;
      toggleFromHotkey();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("open_model_picker", onMenu);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("open_model_picker", onMenu);
    };
  }, [hotkeys, source, providerKey, catalogVersion, visibilityVersion, projectVersion]);

  const settingDisabled = (setting: ModelSetting) =>
    isSettingLocked(setting, current, values, extrasDisabled);

  const setSetting = (setting: ModelSetting, value: string) => {
    if (settingDisabled(setting)) return;
    const next = {
      ...values,
      [setting.id]:
        value ||
        (setting.id === "crossSubagents" ? "[]" : setting.id === "crossAdvisor" ? "null" : value),
    };
    if (setting.id === "crossSubagents") delete next.subagentModel;
    if (setting.id === "crossAdvisor" && value) delete next.advisor;
    if (setting.id === "crossAdvisor" && !value) next.advisor = "off";
    onSettingsChange(next);
  };

  const pickModel = (item: AccountModelChoice) => {
    if (
      !pickerHarnesses.includes(item.harness) ||
      !isModelEnabled(item.id) ||
      !source.available(item.harness)
    )
      return;
    const accountId =
      hideSettings || recentOpen
        ? item.accountId
        : accountChoices && supportsProviderAccounts(item.harness)
          ? accountFor(item.harness)
          : undefined;
    if (accountId) onChange(item.harness, item.id, accountId);
    else onChange(item.harness, item.id);
    if (hideSettings || recentOpen) {
      dismiss(true);
    } else {
      setQuery("");
      setActiveModelKey(null);
    }
  };

  // Choosing an account on the current provider switches the current model to it; on another
  // provider it waits for the model picked there.
  const selectAccount = (id: string) => {
    if (visibleTab === "favorites") return;
    setTabAccounts((previous) => ({ ...previous, [visibleTab]: id }));
    if (visibleTab === current.harness && !inheritSelected && id !== currentAccountId)
      onChange(current.harness, current.id, id);
  };

  useEffect(() => {
    if (!recentOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setRecentActive((recentIndex + direction + recentModels.length) % recentModels.length);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      const item = recentModels[recentIndex];
      if (item) pickModel(item);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recentIndex, recentOpen, recentModels, pickerHarnesses, catalogVersion, source, onChange]);

  const pickInherit = () => {
    if (!inherit) return;
    inherit.onSelect();
    dismiss(true);
  };

  // Subagents toggle in place; every choice keeps the panel open.
  const pickSetting = (setting: ModelSetting, value: string) => {
    if (settingDisabled(setting)) return;
    setSetting(setting, delegationNextValue(setting, values, value));
  };

  const toggleFavorite = (id: string) => {
    // Persist once from the event, not from inside a state updater.
    const previous = favoritesRef.current;
    const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
    favoritesRef.current = next;
    setFavorites(next);
    saveFavoriteModels(next);
  };

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setAccountListOpen(false);
    setQuery("");
    setActiveModelKey(null);
  };

  const Trigger = field ? SelectTrigger : Button;

  return (
    <>
      <Tooltip
        asChild

        shortcut={hotkeys ? switchShortcut : null}

        label={triggerTitle}
      >
        <Trigger
          {...(field
            ? { "data-field-size": "md", "data-state": open || recentOpen ? "open" : "closed" }
            : { size: "sm" as const, variant: "ghost" as const })}
          className={field ? "bycoda-arc-select" : "w-auto max-w-full min-w-0 shrink-0"}
          data-model-picker-presentation={presentation}
          ref={button}
          motion="none"
          type="button"
          aria-label={
            inheritSelected
              ? inherit.label
              : `${HARNESS_TITLE[current.harness]}${
                  current.provider ? `, ${current.provider.name},` : ""
                } ${currentLabel}${triggerEffortLabel ? `, effort ${triggerEffortLabel}` : ""}${triggerFastOn ? `, ${t("Fast")}` : ""}`
          }
          aria-expanded={open || recentOpen}
          aria-haspopup="dialog"
          onPointerEnter={() => void preloadModelPicker().catch(() => {})}
          onFocus={() => void preloadModelPicker().catch(() => {})}
          onMouseDown={(event) => event.preventDefault()}
          onContextMenu={(event) => {
            event.preventDefault();

            event.stopPropagation();

            openRecentMenu();
          }}

          onClick={() => togglePicker()}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {inheritSelected ? (
              <Text
                data-model-inherit
                size="inherit"
                tone="inherit"
                truncate
                className="min-w-0 flex-1 text-left"
              >
                {inherit.label}
              </Text>
            ) : (
              <>
                <HarnessIcon harness={current.harness} className="size-4 shrink-0" />

                <Text size="inherit" tone="inherit" truncate className="min-w-0">
                  {current.name}
                </Text>
              </>
            )}

            {triggerAccountLabel && !inheritSelected ? (
              <>
                {" "}
                <Text
                  data-model-account
                  size="inherit"
                  tone="secondary"
                  truncate
                  className="min-w-0 max-w-24"
                >
                  {triggerAccountLabel}
                </Text>
              </>
            ) : null}

            {triggerEffortLabel ? (
              <Text data-model-effort size="inherit" tone="secondary" className="shrink-0">
                {triggerEffortLabel}
              </Text>
            ) : null}

            {triggerFastOn ? (
              <Zap
                data-model-fast
                className="icon-xs shrink-0"
                tone="secondary"
                fill="currentColor"
                strokeWidth={1.75}
                aria-hidden
              />
            ) : null}
          </span>

          <ChevronDown
            className={`icon-xs shrink-0 ${open ? "rotate-180" : ""} ${
              field ? "bycoda-arc-select-chevron" : ""
            }`}

            tone="secondary"

            strokeWidth={1.75}
          />
        </Trigger>
      </Tooltip>

      {open && hideSettings ? (
        <ModelFlyout
          anchor={button}
          side="top"
          autoFocusSearch
          onDismiss={(reason) => dismiss(reason === "escape")}
          harnesses={pickerHarnesses}
          tab={visibleTab}
          models={visibleModels}
          currentId={markedChoiceKey}
          active={activeModel}
          query={query}
          favorites={favorites}
          searchRef={search}
          onQuery={changeQuery}
          onSelectTab={selectTab}
          onActive={setActiveModel}
          onPick={pickModel}
          onToggleFavorite={toggleFavorite}
          extras={
            showExtras
              ? {
                  harness,
                  model,
                  values,
                  onSettingsChange,
                  disabled: extrasDisabled,
                }
              : undefined
          }
        />
      ) : null}

      {open && !hideSettings ? (
        <ModelPanel
          anchor={button}
          side={field ? "bottom" : "top"}
          project={project}
          onDismiss={(reason) => dismiss(reason === "escape")}
          browser={{
            harnesses: pickerHarnesses,
            tab: visibleTab,
            models: visibleModels,
            currentId: markedChoiceKey,
            active: activeModel,
            query,
            favorites,
            searchRef: search,
            autoFocusSearch: true,
            onQuery: changeQuery,
            onSelectTab: selectTab,
            onActive: setActiveModel,
            onPick: pickModel,
            onToggleFavorite: toggleFavorite,
          }}

          // Inherit resets model authority; it is a separate action above the value list.

          leading={
            inherit ? (
              <Button
                className="w-full text-left"
                fullWidth
                variant="item"
                type="button"
                aria-pressed={inheritSelected}
                data-model-inherit-choice
                tooltip={inherit.label}
                tooltipWhen="overflow"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickInherit()}
              >
                <Text
                  as="span"
                  size="inherit"
                  tone="inherit"
                  weight={inheritSelected ? "medium" : undefined}
                  truncate
                  className="min-w-0 flex-1"
                >
                  {inherit.label}
                </Text>
                {inheritSelected ? (
                  <Check className="icon-sm shrink-0" tone="neutral" strokeWidth={2} />
                ) : null}
              </Button>
            ) : undefined
          }
          accountHarness={accountChoices && visibleTab !== "favorites" ? visibleTab : undefined}
          accountId={browsedAccountId}
          accountListOpen={accountListOpen}
          onAccountListOpen={setAccountListOpen}
          onSelectAccount={selectAccount}
          settings={
            inheritSelected
              ? undefined
              : { current, settings, values, locked: settingDisabled, onChoose: pickSetting }
          }
        />
      ) : null}

      {recentOpen ? (
        // ui-drift-ignore: popover-menu -- bespoke model quick-switch menu: own aria-activedescendant keys while composer focus stays put
        <Popover
          anchor={button}
          side="top"
          minWidth={MENU_WIDTH}
          autoFocus
          onDismiss={() => setRecentMenu(null)}
          role="menu"
          aria-label={t("Recently used models")}
          aria-activedescendant={`${recentMenuId}-${recentIndex}`}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          data-model-picker
          className={popupListClassName}
        >
          {recentModels.map((item, index) => {
            const selected = modelChoiceKey(item) === currentChoiceKey;
            const highlighted = index === recentIndex;
            const disabled = !source.available(item.harness);
            return (
              <MenuRow
                data-active={highlighted || undefined}
                key={modelChoiceKey(item)}
                id={`${recentMenuId}-${index}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setRecentActive(index)}
                onClick={() => pickModel(item)}
              >
                <HarnessIcon harness={item.harness} className="size-4 shrink-0" />

                <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                  {item.name}
                </Text>

                <Text size="caption" tone="secondary">
                  {HARNESS_TITLE[item.harness]}
                  {item.provider ? ` · ${item.provider.name}` : ""}
                </Text>

                {selected ? (
                  <Check className="icon-sm shrink-0" tone="secondary" strokeWidth={2} />
                ) : null}
              </MenuRow>
            );
          })}
        </Popover>
      ) : null}
    </>
  );
}

export function ModelControlPills({
  harness,
  model,
  values,
  onSettingsChange,
  onClose,
}: Pick<Props, "harness" | "model" | "values" | "onSettingsChange" | "onClose">) {
  useLocale();
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  void catalogVersion;
  const source = useModelSource();
  const current = source.resolve(harness, model);
  const offered = source.modelsFor(harness);
  const pills = pillSettings(current).map((setting) =>
    offeredDelegationSetting(setting, offered, settingValue(setting, values), current),
  );
  const effort = pills.find((setting) => setting.kind === "select" && isEffortSetting(setting));
  const groupedSettings = effort
    ? pills.filter((setting) => setting.id === "fast" || setting.id === "serviceTier")
    : [];
  if (pills.length === 0) return null;
  return (
    <>
      {pills.map((setting) => {
        if (groupedSettings.some((grouped) => grouped.id === setting.id)) {
          return null;
        }
        return setting.kind === "toggle" ? (
          <TogglePill
            key={setting.id}
            setting={setting}
            values={values}
            onSettingsChange={onSettingsChange}
          />
        ) : (
          <SelectPill
            key={setting.id}
            setting={setting}
            values={values}
            onSettingsChange={onSettingsChange}
            onClose={onClose}
            harness={harness}
            additionalSettings={setting.id === effort?.id ? groupedSettings : undefined}
          />
        );
      })}
    </>
  );
}

function SelectPill({
  setting,
  values,
  onSettingsChange,
  onClose,
  additionalSettings,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
  harness: HarnessId;
  additionalSettings?: ModelSetting[];
}) {
  const t = useT();
  return (
    <>
      {[setting, ...(additionalSettings ?? [])].map((item) => (
        <SearchableSelect
          hideLabel
          variant="pill"
          searchable={false}
          loopNavigation
          key={item.id}
          label={t(settingLabel(item))}
          value={settingValue(item, values)}
          options={item.options.map((option) => ({
            value: option.value,

            label: t(option.label),

            icon: isEffortSetting(item) ? (
              <Gauge className="icon-sm" />
            ) : item.id === "serviceTier" ? (
              <Zap className="icon-sm" />
            ) : undefined,
          }))}

          onChange={(value) => onSettingsChange({ ...values, [item.id]: value })}

          onClose={(restoreFocus) => {
            if (restoreFocus) onClose?.();
          }}

          triggerProps={{
            "aria-label": `${t(settingLabel(item))}: ${t(settingValueLabel(item, values))}`,

            onMouseDown: (event) => event.preventDefault(),

            title: item.description ? t(item.description) : t(settingLabel(item)),
          }}
        />
      ))}
    </>
  );
}
