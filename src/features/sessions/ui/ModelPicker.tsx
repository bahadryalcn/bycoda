import { MorphSelect } from "../../../shared/ui/MorphSelect";
import { Button } from "../../../shared/ui/Button";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { clampActiveIndex, useKeyedActiveIndex } from "../../../shared/hooks/useKeyedActiveIndex";
import { useOpenSessionKey } from "./useOpenSessionKey";
import { useLocale, useT } from "../../../shared/i18n";
import { Check, ChevronDown, ChevronRight, Gauge, Zap } from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
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
import {
  delegationNextValue,
  delegationOptionSelected,
  isSubagentSetting,
} from "../model/crossDelegation";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";

import { LAYER } from "../../../shared/lib/layers";
import { HarnessIcon } from "./HarnessIcon";
import { DelegationOptionIcon, settingMenuWidth } from "./DelegationSettings";
import { Popover } from "../../../shared/ui/Popover";
import { MOD } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/public/settings";
import { useKeybindingShortcut } from "../../settings/public/useKeybindingShortcut";
import "./ModelPicker.css";

import { lazySurface } from "../../../shared/ui/lazySurface";
import {
  accountChoicesSnapshot,
  accountModelChoices,
  accountDisplayLabel,
  modelAccountLabel,
  modelChoiceKey,
  type AccountModelChoice,
} from "../model/accountModelChoices";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  providerAccounts,
  supportsProviderAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  effortSetting,
  fastSetting,
  isEffortSetting,
  isSettingLocked,
  menuSettings,
  pillSettings,
  recentMenuModels,
  SETTING_GROUP_TITLE,
  settingGroupId,
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

type MenuEntry =
  | { kind: "setting"; setting: ModelSetting }
  | { kind: "model" }
  | { kind: "inherit" };

type Submenu = { kind: "setting"; setting: ModelSetting } | { kind: "models" };

type RecentMenu = { models: AccountModelChoice[] };

const MENU_WIDTH = 250;
const SETTING_MENU_WIDTH = 210;
const SUBMENU_OVERLAP = -4;
const SELF = "[data-model-picker]";

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
  const [activeSetting, setActiveSetting] = useState(0);
  const [seenOpenRequest, setSeenOpenRequest] = useState(0);
  const [recentMenu, setRecentMenu] = useState<RecentMenu | null>(null);
  const [recentActive, setRecentActive] = useState(0);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [activeRow, setActiveRow] = useState<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const favoritesRef = useRef(favorites);
  useLayoutEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  const recentMenuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const modelRow = useRef<HTMLButtonElement | null>(null);
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
  }, [open]);
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
      values,
      unavailable: (name) => t("Unavailable: {p0}", { p0: name }),
    });
  }, [catalogVersion, current, hideSettings, inheritSelected, pickerHarnesses, source, t, values]);
  // Model ends the upward-opening menu, directly below Reasoning and Fast.
  const entries = useMemo<MenuEntry[]>(
    () => [
      ...(inherit ? [{ kind: "inherit" as const }] : []),
      ...settings.map((setting) => ({
        kind: "setting" as const,
        setting,
      })),
      { kind: "model" as const },
    ],
    [inherit, settings],
  );
  const openKey = useOpenSessionKey(open);
  const [active, setActive] = useKeyedActiveIndex(openKey, entries.length, 0);

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
    const choices = accountModelChoices(pool, accountChoices, source.accounts);
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
  ]);

  // An inherited (empty) choice has no current model to mark or start on.
  const markedChoiceKey = inheritSelected ? "" : currentChoiceKey;
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
    setSubmenu(null);
    if (restore) onCloseRef.current?.();
  };

  // Every open starts from the current provider with a fresh list, search and favorites.
  const beginOpen = () => {
    setRecentMenu(null);
    setOpen(true);
    setTab(coerceModelPickerTab(current.harness, (id) => pickerHarnesses.includes(id)));
    // Beside-picker mode leaves only the Model row; open its list directly
    // instead of making it one more hover step.
    setSubmenu(hideSettings ? { kind: "models" } : null);
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
    setSubmenu(null);
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
    if (!open || submenu?.kind !== "models" || visibleTab === "favorites") {
      return;
    }
    refreshSource([visibleTab]);
  }, [open, submenu?.kind, visibleTab, source.id, refreshSource]);

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
      dismiss(true);
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
    onSettingsChange({ ...values, [setting.id]: value });
  };

  const pickModel = (item: AccountModelChoice) => {
    if (
      !pickerHarnesses.includes(item.harness) ||
      !isModelEnabled(item.id) ||
      !source.available(item.harness)
    )
      return;
    if (item.accountId) onChange(item.harness, item.id, item.accountId);
    else onChange(item.harness, item.id);
    if (hideSettings || recentOpen) {
      dismiss(true);
    } else {
      setSubmenu(null);
      setQuery("");
      requestAnimationFrame(() => {
        const row = modelRow.current;
        if (!row) return;
        setActive(Number(row.dataset.modelControlIndex));
        row.focus({ preventScroll: true });
      });
    }
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

  const pickSetting = (setting: ModelSetting, value: string) => {
    if (settingDisabled(setting)) return;
    setSetting(setting, delegationNextValue(setting, values, value));
    // Subagent models toggle in place; every other choice closes the menu.
    if (!isSubagentSetting(setting)) dismiss(true);
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
    setQuery("");
    setActiveModelKey(null);
  };

  const showEntrySubmenu = (entry: MenuEntry) => {
    if (entry.kind === "inherit") {
      setSubmenu(null);
      return;
    }
    if (entry.kind === "model") {
      if (submenu?.kind !== "models") {
        setActiveModelKey(null);
        setQuery("");
        setTab(coerceModelPickerTab(current.harness, (id) => pickerHarnesses.includes(id)));
      }
      setSubmenu({ kind: "models" });
      return;
    }
    if (settingDisabled(entry.setting)) {
      setSubmenu(null);
      return;
    }
    if (entry.setting.kind === "select") {
      const setting = entry.setting;
      const index = setting.options.findIndex(
        (option) => option.value === settingValue(setting, values),
      );
      setActiveSetting(index >= 0 ? index : 0);
      setSubmenu({ kind: "setting", setting });
      return;
    }
    setSubmenu(null);
  };

  const moveEntry = (direction: 1 | -1) => {
    setSubmenu(null);
    setActive((index) => (index + direction + entries.length) % entries.length);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (submenu?.kind === "models") {
        setActiveModel((index) => Math.min(visibleModels.length - 1, index + 1));
      } else if (submenu?.kind === "setting") {
        setActiveSetting((index) => Math.min(submenu.setting.options.length - 1, index + 1));
      } else {
        moveEntry(1);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (submenu?.kind === "models") {
        setActiveModel((index) => Math.max(0, index - 1));
      } else if (submenu?.kind === "setting") {
        setActiveSetting((index) => Math.max(0, index - 1));
      } else {
        moveEntry(-1);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) showEntrySubmenu(entry);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSubmenu(null);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (submenu?.kind === "models") {
      const item = visibleModels[activeModel];
      if (item) pickModel(item);
      return;
    }
    if (submenu?.kind === "setting") {
      const option = submenu.setting.options[activeSetting];
      if (option) pickSetting(submenu.setting, option.value);
      return;
    }
    const entry = entries[active];
    if (!entry) return;
    if (entry.kind === "inherit") {
      pickInherit();
      return;
    }
    if (entry.kind === "model" || entry.setting.kind === "select") {
      showEntrySubmenu(entry);
      return;
    }
    const value = settingValue(entry.setting, values);
    setSetting(entry.setting, value === "true" ? "false" : "true");
  };

  const showSubmenu =
    open &&
    submenu != null &&
    activeRow != null &&
    activeRow.dataset.modelControlIndex === String(active);

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
        aria-haspopup={hideSettings ? "dialog" : "menu"}
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
        <>
          {/* Kept as Popover role=menu: single-level DropdownMenu cannot host hover flyouts or a second control per row. */}
          <Popover
            anchor={button}
            side={field ? "bottom" : "top"}
            autoFocus
            dismissOnEscape={false}
            ignore={SELF}
            onDismiss={() => dismiss(false)}
            role="menu"
            aria-label={t("Model and settings")}
            tabIndex={-1}
            onKeyDown={onMenuKey}
            data-model-picker
            className="model-controls-menu p-1 font-sans"
          >
            {entries.map((entry, index) => {
              const highlighted = index === active;
              const group = entry.kind === "setting" ? settingGroupId(entry.setting) : "model";
              const previous = entries[index - 1];
              const previousGroup =
                previous?.kind === "setting" ? settingGroupId(previous.setting) : "model";
              if (entry.kind === "inherit") {
                if (!inherit) return null;
                return (
                  <Button
                    className="w-full text-left"
                    fullWidth
                    selected={highlighted}
                    variant="item"
                    key="inherit"
                    ref={highlighted ? setActiveRow : undefined}
                    data-model-control-index={index}
                    data-model-inherit-choice
                    type="button"
                    role="menuitemradio"
                    aria-checked={inheritSelected}
                    tooltip={inherit.label}
                    tooltipWhen="overflow"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setSubmenu(null);
                    }}
                    onClick={() => pickInherit()}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${inheritSelected ? "font-medium" : ""}`}
                    >
                      {inherit.label}
                    </span>
                    {inheritSelected ? (
                      <Check
                        className="icon-sm shrink-0 text-(--ui-tone-neutral-fg)"
                        strokeWidth={2}
                      />
                    ) : (
                      <span className="size-3.5 shrink-0" aria-hidden />
                    )}
                  </Button>
                );
              }
              // Delegation and Context precede Fast, Reasoning and the final Model row.
              const caption =
                group !== "model" && group !== previousGroup ? (
                  <div
                    key={`group-${group}`}
                    role="presentation"
                    data-model-group={group}
                    className="px-2.5 pt-2 pb-1 ui-caption-text font-medium"
                  >
                    {t(SETTING_GROUP_TITLE[group])}
                  </div>
                ) : null;
              if (entry.kind === "model") {
                return (
                  <Button
                    className="w-full text-left"
                    fullWidth
                    selected={highlighted}
                    variant="item"
                    key="model"
                    ref={(node) => {
                      modelRow.current = node;
                      if (highlighted) setActiveRow(node);
                    }}
                    data-model-control-index={index}
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={highlighted && showSubmenu}
                    // Long model and account names truncate here; the tooltip keeps the full identity.
                    tooltip={triggerTitle}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      showEntrySubmenu(entry);
                    }}
                    onClick={() => showEntrySubmenu(entry)}
                  >
                    <span className="min-w-0 flex-1 truncate">{t("Model")}</span>
                    <span className="flex min-w-0 items-center justify-end gap-1 text-(--ui-text-secondary)">
                      {inheritSelected ? null : (
                        <>
                          <HarnessIcon harness={current.harness} className="size-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{current.name}</span>
                        </>
                      )}
                      {triggerAccountLabel && !inheritSelected ? (
                        <span data-model-account className="min-w-0 max-w-20 truncate">
                          {triggerAccountLabel}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      className="icon-sm shrink-0 text-(--ui-text-secondary)"
                      strokeWidth={1.75}
                    />
                  </Button>
                );
              }

              const setting = entry.setting;
              const value = settingValue(setting, values);
              const isToggle = setting.kind === "toggle";
              return (
                <Fragment key={setting.id}>
                  {caption}
                  <Button
                    className="w-full text-left"
                    fullWidth
                    selected={highlighted}
                    variant="item"
                    ref={highlighted ? setActiveRow : undefined}
                    data-model-control-index={index}
                    type="button"
                    role={isToggle ? "menuitemcheckbox" : "menuitem"}
                    disabled={settingDisabled(setting)}
                    aria-checked={isToggle ? value === "true" : undefined}
                    aria-haspopup={isToggle ? undefined : "menu"}
                    aria-expanded={!isToggle && highlighted ? showSubmenu : undefined}
                    tooltip={
                      setting.id === "advisor" && setting.description
                        ? t(setting.description)
                        : setting.description
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      showEntrySubmenu(entry);
                    }}
                    onClick={() => {
                      if (isToggle) {
                        setSetting(setting, value === "true" ? "false" : "true");
                      } else {
                        showEntrySubmenu(entry);
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{t(settingLabel(setting))}</span>
                    {isToggle ? (
                      <>
                        <span
                          className={`shrink-0 ${
                            value === "true"
                              ? "font-medium text-(--ui-tone-neutral-fg)"
                              : "text-(--ui-text-secondary)"
                          }`}
                        >
                          {value === "true" ? t("On") : t("Off")}
                        </span>
                        <span className="size-3.5 shrink-0" aria-hidden />
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 truncate text-right text-(--ui-text-secondary)">
                          {t(settingValueLabel(setting, values))}
                        </span>
                        <ChevronRight
                          className="icon-sm shrink-0 text-(--ui-text-secondary)"
                          strokeWidth={1.75}
                        />
                      </>
                    )}
                  </Button>
                </Fragment>
              );
            })}
          </Popover>

          {showSubmenu && submenu.kind === "setting" ? (
            // Kept as Popover role=menu: the setting flyout is a hover/ArrowRight child of the model menu.
            <Popover
              key={submenu.setting.id}
              anchor={activeRow}
              side="right"
              gap={SUBMENU_OVERLAP}
              width={settingMenuWidth(submenu.setting, SETTING_MENU_WIDTH)}
              layer={LAYER.submenu}
              role="menu"
              aria-label={t(settingLabel(submenu.setting))}
              onMouseEnter={() => setSubmenu(submenu)}
              data-model-picker
              className="p-1 font-sans"
            >
              {submenu.setting.options.map((option, index) => {
                const selected = delegationOptionSelected(submenu.setting, values, option.value);
                const highlighted = index === activeSetting;
                return (
                  <Button
                    className="w-full text-left"
                    fullWidth
                    selected={highlighted}
                    variant="item"
                    key={option.value}
                    type="button"
                    role={isSubagentSetting(submenu.setting) ? "menuitemcheckbox" : "menuitemradio"}
                    disabled={settingDisabled(submenu.setting)}
                    aria-checked={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSetting(index)}
                    onClick={() => pickSetting(submenu.setting, option.value)}
                  >
                    <DelegationOptionIcon setting={submenu.setting} value={option.value} />
                    <span className={`min-w-0 flex-1 truncate ${selected ? "font-medium" : ""}`}>
                      {t(option.label)}
                    </span>
                    {selected ? (
                      <Check
                        className="icon-sm shrink-0 text-(--ui-tone-neutral-fg)"
                        strokeWidth={2}
                      />
                    ) : (
                      <span className="size-3.5 shrink-0" aria-hidden />
                    )}
                  </Button>
                );
              })}
            </Popover>
          ) : null}

          {showSubmenu && submenu.kind === "models" ? (
            <ModelFlyout
              anchor={activeRow}
              autoFocusSearch
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
            />
          ) : null}
        </>
      ) : null}

      {recentOpen ? (
        // Kept as Popover role=menu: anchored to the picker button with its own aria-activedescendant keyboard, not a DropdownMenu trigger.
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

function TogglePill({
  setting,
  values,
  onSettingsChange,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
}) {
  useLocale();
  const on = settingValue(setting, values) === "true";
  return (
    <Button
      variant="ghost"
      type="button"
      tooltip={`${setting.label}: ${on ? "On" : "Off"}`}
      aria-label={`${setting.label}: ${on ? "On" : "Off"}`}
      aria-pressed={on}
      data-model-control
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSettingsChange({ ...values, [setting.id]: on ? "false" : "true" })}
      className="max-w-28"
    >
      <span className={`min-w-0 truncate text-ui-micro ${on ? "" : "text-(--ui-text-secondary)"}`}>
        {setting.label}
      </span>
    </Button>
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
