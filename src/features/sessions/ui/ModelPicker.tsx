import { TogglePill } from "./ModelExtras";
import { MorphSelect } from "../../../shared/ui/MorphSelect";
import { Button } from "../../../shared/ui/Button";
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
  showProviderInModelPicker,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
  type ModelSetting,
} from "../model/models";
import {
  isProviderHidden,
  projectProvidersRevision,
  subscribeProjectProviders,
} from "../model/projectProviders";
import {
  harnessUnavailableHint,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { useModelSource } from "./modelSource";
import { offeredDelegationSetting } from "../model/claudeAdvisor";
import { delegationNextValue } from "../model/crossDelegation";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { ModelPanel } from "./ModelPanel";
import { Popover } from "../../../shared/ui/Popover";
import { MOD } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/public/settings";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";
import "./ModelPicker.css";
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
  providerAccounts,
  supportsProviderAccounts,
  subscribeProviderAccounts,
} from "../../providers/public/providerAccounts";
import {
  effortSetting,
  fastSetting,
  isEffortSetting,
  isSettingLocked,
  menuSettings,
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
  // The highlighted model row is kept by identity (reset on open, query and submenu entry), so a
  // catalog refresh that reorders or regrows the list cannot move it onto another model.
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
  const recentOpenRef = useRef(recentMenu != null);
  const currentRef = useRef<AgentModel | null>(null);
  const lastHotkey = useRef(0);

  const current = source.resolve(harness, model);
  const field = presentation === "field";
  const inherit = hideSettings ? undefined : inheritChoice;
  const inheritSelected = inherit?.selected === true;
  const currentAccountId = supportsProviderAccounts(harness)
    ? (accountId ?? (source.accounts === undefined ? defaultProviderAccountId(harness) : "default"))
    : undefined;
  const currentChoiceKey = modelChoiceKey({
    ...current,
    accountId: accountChoices ? currentAccountId : undefined,
  });
  const currentLabel = accountChoices
    ? modelAccountLabel(current, currentAccountId, source.accounts)
    : current.name;
  // The account is part of the identity only while there is a choice between
  // accounts; a lone default account stays out of the trigger.
  const triggerAccountLabel = useMemo(() => {
    void accountsSnapshot;
    if (!accountChoices || !currentAccountId || !supportsProviderAccounts(harness))
      return undefined;
    // A saved account that no longer exists is shown honestly instead of a blank label.
    if (source.accounts !== undefined) {
      const accounts = source.accounts[harness] ?? [];
      const saved = accounts.find((account) => account.id === currentAccountId);
      if (!saved) return currentAccountId === "default" ? undefined : t("Unavailable Host account");
      return accounts.length > 1 ? accountDisplayLabel(accounts, saved) : undefined;
    }
    const accounts = providerAccounts(harness);
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
    void availabilityVersion;
    void visibilityVersion;
    void projectVersion;
    return HARNESSES.filter(
      (id) =>
        (!allowedHarnesses || allowedHarnesses.includes(id)) &&
        !isProviderHidden(project, id) &&
        showProviderInModelPicker(id, source.available(id), source.probed()),
    );
  }, [source, allowedHarnesses, availabilityVersion, visibilityVersion, projectVersion, project]);
  const settings = useMemo(() => {
    void catalogVersion;
    // In beside-picker mode every option row renders as a toolbar pill, so the
    // menu lists models only.
    if (hideSettings || inheritSelected) return [];
    // Delegation and Context lead; Fast and Reasoning stay near Model.
    return menuSettings({
      current,
      harnesses: pickerHarnesses,
      source,
      accountChoices: true,
      currentAccountId,
      signedOutAccounts: source.accounts === undefined ? signedOutAccountKeys(usage) : undefined,
      signedOutLabel: t("Not signed in"),
      values,
      unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
    });
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
  // Recent models that stopped being offered drop out of the open menu.
  const recentModels = useMemo(() => {
    void catalogVersion;
    return (recentMenu?.models ?? []).filter(
      (item) => pickerHarnesses.includes(item.harness) && isModelEnabled(item.id),
    );
  }, [recentMenu, pickerHarnesses, catalogVersion]);
  const recentOpen = recentMenu != null && recentModels.length > 0;
  const recentIndex = clampActiveIndex(recentActive, recentModels.length);
  useLayoutEffect(() => {
    recentOpenRef.current = recentOpen;
  }, [recentOpen]);

  const visibleModels = useMemo(() => {
    void catalogVersion;
    const needle = query.trim().toLowerCase();
    const pool =
      visibleTab === "favorites"
        ? favorites
            .map((id) => source.find(id))
            .filter(
              (item): item is AgentModel =>
                item != null && pickerHarnesses.includes(item.harness) && isModelEnabled(item.id),
            )
        : source.modelsFor(visibleTab).filter((item) => isModelEnabled(item.id));
    // The panel lists each model once and picks the account in its header; the beside-picker
    // flyout keeps one row per model and account.
    const choices = hideSettings
      ? accountModelChoices(pool, accountChoices, source.accounts)
      : pool;
    if (!needle) return choices;
    return choices.filter((item) =>
      `${item.name} ${HARNESS_TITLE[item.harness]} ${item.provider?.name ?? ""} ${item.provider?.id ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [
    source,
    catalogVersion,
    favorites,
    providerKey,
    query,
    visibleTab,
    accountChoices,
    accountsSnapshot,
    hideSettings,
  ]);

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
    if (restore) onCloseRef.current?.();
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

  const toggleRecentMenu = () => {
    if (recentOpenRef.current) {
      setRecentMenu(null);
      onCloseRef.current?.();
    } else {
      openRecentMenu();
    }
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
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    toggleRecentMenu();
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
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      const defaultSwitch =
        mod && !event.altKey && !event.shiftKey && (event.key === "." || event.code === "Period");
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

  const defaultAccountFor = (target: HarnessId) =>
    source.accounts === undefined && supportsProviderAccounts(target)
      ? defaultProviderAccountId(target)
      : "default";
  const accountFor = (target: HarnessId) =>
    tabAccounts[target] ??
    (target === current.harness && currentAccountId ? currentAccountId : defaultAccountFor(target));

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

  return (
    <>
      <Button
        size={field ? "md" : "sm"}
        className={field ? "model-picker-field-trigger" : "w-auto max-w-full min-w-0 shrink-0"}
        data-model-picker-presentation={presentation}
        variant="ghost"
        align={field ? "start" : undefined}
        fullWidth={field}
        ref={button}
        type="button"
        shortcut={hotkeys ? switchShortcut : null}
        tooltip={t("{p0} · Recent models: right-click or {p1}.", {
          p0: triggerTitle,
          p1: MOD,
        })}
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
        {inheritSelected ? (
          <span data-model-inherit className="min-w-0 flex-1 truncate text-left">
            {inherit.label}
          </span>
        ) : (
          <>
            <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{current.name}</span>
          </>
        )}
        {triggerAccountLabel && !inheritSelected ? (
          <>
            {" "}
            <span
              data-model-account
              className="min-w-0 max-w-24 truncate text-(--ui-text-secondary)"
            >
              {triggerAccountLabel}
            </span>
          </>
        ) : null}
        {triggerEffortLabel ? (
          <span data-model-effort className="shrink-0 text-(--ui-text-secondary)">
            {triggerEffortLabel}
          </span>
        ) : null}
        {triggerFastOn ? (
          <Zap
            data-model-fast
            className="icon-xs shrink-0 text-(--ui-text-secondary)"
            fill="currentColor"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : null}
        <ChevronDown
          className={`icon-xs shrink-0 text-(--ui-text-secondary) ${open ? "rotate-180" : ""} ${
            field ? "model-picker-field-chevron" : ""
          }`}
          strokeWidth={1.75}
        />
      </Button>

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
          leading={
            inherit ? (
              <Button
                className="w-full text-left"
                fullWidth
                variant="item"
                type="button"
                role="option"
                aria-selected={inheritSelected}
                data-model-inherit-choice
                tooltip={inherit.label}
                tooltipWhen="overflow"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickInherit()}
              >
                <span className={`min-w-0 flex-1 truncate ${inheritSelected ? "font-medium" : ""}`}>
                  {inherit.label}
                </span>
                {inheritSelected ? (
                  <Check className="icon-sm shrink-0 text-(--ui-tone-neutral-fg)" strokeWidth={2} />
                ) : null}
              </Button>
            ) : undefined
          }
          accountHarness={accountChoices && visibleTab !== "favorites" ? visibleTab : undefined}
          accountId={visibleTab === "favorites" ? "" : accountFor(visibleTab)}
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
          width={MENU_WIDTH}
          autoFocus
          onDismiss={() => setRecentMenu(null)}
          role="menu"
          aria-label={t("Recently used models")}
          aria-activedescendant={`${recentMenuId}-${recentIndex}`}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          data-model-picker
          className="p-1 font-sans"
        >
          {recentModels.map((item, index) => {
            const selected = modelChoiceKey(item) === currentChoiceKey;
            const highlighted = index === recentIndex;
            const disabled = !source.available(item.harness);
            return (
              <Button
                className="w-full text-left"
                fullWidth
                selected={highlighted}
                variant="item"
                key={modelChoiceKey(item)}
                id={`${recentMenuId}-${index}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                tooltip={disabled ? harnessUnavailableHint(item.harness) : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setRecentActive(index)}
                onClick={() => pickModel(item)}
              >
                <HarnessIcon harness={item.harness} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-secondary leading-4">{item.name}</span>
                  <span className="block truncate text-ui-micro leading-4 text-(--ui-text-secondary)">
                    {HARNESS_TITLE[item.harness]}
                    {item.provider ? ` · ${item.provider.name}` : ""}
                  </span>
                </span>
                {selected ? (
                  <Check className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={2} />
                ) : null}
              </Button>
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
        <MorphSelect
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
          onClose={onClose}
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
