import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t, useLocale } from "../../../shared/i18n";
import { Check, ChevronDown, ChevronRight, Gauge, Zap } from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
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
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../model/session";

import { LAYER } from "../../../shared/lib/layers";
import { HarnessIcon } from "./HarnessIcon";
import { Popover } from "../../../shared/ui/Popover";
import { MOD } from "../../../platform/tauri/platform";
import { keybindingPressed } from "../../settings/model/settings";
import "./ModelPicker.css";

import { ModelFlyout } from "./ModelFlyout";
import {
  accountChoicesSnapshot,
  accountModelChoices,
  modelAccountLabel,
  modelChoiceKey,
  type AccountModelChoice,
} from "../model/accountModelChoices";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  effortSetting,
  effortTileTone,
  isEffortSetting,
  pickerSettings,
  pillSettings,
  recentMenuModels,
  settingLabel,
  settingValue,
  settingValueLabel,
} from "../model/modelPickerData";
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

type MenuEntry = { kind: "setting"; setting: ModelSetting } | { kind: "model" };

type Submenu = { kind: "setting"; setting: ModelSetting } | { kind: "models" };

type RecentMenu = { models: AccountModelChoice[] };

const MENU_WIDTH = 250;
const SETTING_MENU_WIDTH = 210;
const SUBMENU_OVERLAP = -4;
const SELF = "[data-model-picker]";

const EFFORT_TILE_COLUMNS = 32;
const EFFORT_TILE_ROWS = 5;

function EffortTileShimmer() {
  useLocale();
  return (
    <span className="codex-effort-tiles" aria-hidden="true">
      {Array.from({ length: EFFORT_TILE_COLUMNS * EFFORT_TILE_ROWS }, (_, index) => {
        const column = index % EFFORT_TILE_COLUMNS;
        const row = Math.floor(index / EFFORT_TILE_COLUMNS);
        const centerColumn = (EFFORT_TILE_COLUMNS - 1) / 2;
        const centerRow = (EFFORT_TILE_ROWS - 1) / 2;
        const distance = Math.hypot(
          (column - centerColumn) / centerColumn,
          (row - centerRow) / centerRow,
        );
        const filled = (index * 73 + index * index * 19 + 23) % 101 < 65;
        return (
          <span
            key={index}
            className={`codex-effort-tile${filled ? " codex-effort-tile--filled" : ""}`}
            style={{ "--tile-distance": distance } as React.CSSProperties}
          />
        );
      })}
    </span>
  );
}

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
  accountId,
  accountChoices = false,
  showExtras = false,
  extrasDisabled = false,
  onChange,
  onSettingsChange,
  onClose,
}: Props) {
  useLocale();
  const source = useModelSource();
  const refreshSource = useStableCallback(source.refresh);
  const accountsSnapshot = useSyncExternalStore(
    subscribeProviderAccounts,
    accountChoicesSnapshot,
    accountChoicesSnapshot,
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
  const [active, setActive] = useState(0);
  const [activeModel, setActiveModel] = useState(0);
  const [activeSetting, setActiveSetting] = useState(0);
  const [recentMenu, setRecentMenu] = useState<RecentMenu | null>(null);
  const [recentActive, setRecentActive] = useState(0);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [activeRow, setActiveRow] = useState<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const recentMenuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const recentOpenRef = useRef(recentMenu != null);
  const currentRef = useRef<AgentModel | null>(null);
  const lastHotkey = useRef(0);
  onCloseRef.current = onClose;
  openRef.current = open;
  recentOpenRef.current = recentMenu != null;

  const current = source.resolve(harness, model);
  const currentAccountId = supportsProviderAccounts(harness)
    ? (accountId ?? defaultProviderAccountId(harness))
    : undefined;
  const currentChoiceKey = modelChoiceKey({
    ...current,
    accountId: accountChoices ? currentAccountId : undefined,
  });
  const currentLabel = accountChoices ? modelAccountLabel(current, currentAccountId) : current.name;
  currentRef.current = current;
  const settings = useMemo(() => {
    void catalogVersion;
    // In beside-picker mode every option row renders as a toolbar pill, so the
    // menu lists models only.
    if (hideSettings) return [];
    const offered = source.modelsFor(harness);
    return pickerSettings(current).map((setting) =>
      offeredDelegationSetting(setting, offered, settingValue(setting, values)),
    );
  }, [catalogVersion, current, harness, hideSettings, source, values]);
  const entries = useMemo<MenuEntry[]>(
    () => [
      ...settings.map((setting) => ({
        kind: "setting" as const,
        setting,
      })),
      { kind: "model" as const },
    ],
    [settings],
  );

  // Moving option rows into Extras must not hide the current effort next to
  // the model name. Menu placement and the selection summary are independent.
  const triggerEffortSetting = showEffortSummary ? effortSetting(current) : undefined;
  const triggerEffortLabel = triggerEffortSetting
    ? settingValueLabel(triggerEffortSetting, values)
    : undefined;
  const triggerTitle = [
    HARNESS_TITLE[current.harness],
    current.provider?.name,
    currentLabel,
    triggerEffortLabel,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const providerKey = pickerHarnesses.join(",");
  const visibleTab = coerceModelPickerTab(tab, (id) => pickerHarnesses.includes(id));

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
    const choices = accountModelChoices(pool, accountChoices);
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

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setRecentMenu(null);
    setSubmenu(null);
    if (restore) onCloseRef.current?.();
  };

  const togglePicker = () => {
    if (openRef.current) dismiss(true);
    else {
      setRecentMenu(null);
      setOpen(true);
    }
  };

  const openRecentMenu = () => {
    const selected = currentRef.current;
    if (!selected) return;
    const models = accountModelChoices(
      recentMenuModels(selected, source, loadRecentModelChoices()).filter(
        (item) => pickerHarnesses.includes(item.harness) && isModelEnabled(item.id),
      ),
      accountChoices,
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

  useEffect(() => {
    if (openRequest === 0) return;
    setRecentMenu(null);
    setOpen(true);
  }, [openRequest]);

  const toggleFromHotkey = () => {
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    toggleRecentMenu();
  };

  useEffect(() => {
    if (!open) return;
    refreshSource([current.harness]);
    setTab(coerceModelPickerTab(current.harness, (id) => pickerHarnesses.includes(id)));
    setActive(0);
    // Beside-picker mode leaves only the Model row; open its list directly
    // instead of making it one more hover step.
    setSubmenu(hideSettings ? { kind: "models" } : null);
    setQuery("");
    setFavorites(loadFavoriteModels());
    // providerKey represents the filter membership used above. Source object/catalog
    // updates must not reset a live menu or refresh the remote catalog in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current.harness, hideSettings, providerKey, source.id, refreshSource]);

  useEffect(() => {
    if (visibleTab === tab) return;
    setTab(visibleTab);
  }, [tab, visibleTab]);

  useEffect(() => {
    if (!open || submenu?.kind !== "models" || visibleTab === "favorites") {
      return;
    }
    refreshSource([visibleTab]);
  }, [open, submenu?.kind, visibleTab, source.id, refreshSource]);

  useEffect(() => {
    if (!open) return;
    setActive((index) => Math.min(index, Math.max(0, entries.length - 1)));
  }, [entries.length, open]);

  useEffect(() => {
    if (!open || submenu?.kind !== "models") return;
    const index = visibleModels.findIndex((item) => modelChoiceKey(item) === currentChoiceKey);
    setActiveModel(index >= 0 ? index : 0);
  }, [open, submenu?.kind, query, visibleModels, currentChoiceKey]);

  useEffect(() => {
    if (submenu?.kind !== "setting") return;
    const value = settingValue(submenu.setting, values);
    const index = submenu.setting.options.findIndex((option) => option.value === value);
    setActiveSetting(index >= 0 ? index : 0);
  }, [submenu, values]);

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

  const settingDisabled = (setting: ModelSetting) => {
    const effectiveValue = (id: string) => {
      const dependent = current.settings?.find((item) => item.id === id);
      return dependent ? settingValue(dependent, values) : undefined;
    };
    return (
      extrasDisabled ||
      (setting.id === "subagentPolicy" &&
        (!effectiveValue("subagentModel") || effectiveValue("subagentModel") === "default")) ||
      (setting.id === "autoCompactWindow" && effectiveValue("autoCompact") === "off")
    );
  };

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
    dismiss(true);
  };

  useEffect(() => {
    if (!recentMenu) return;
    const models = recentMenu.models.filter(
      (item) => pickerHarnesses.includes(item.harness) && isModelEnabled(item.id),
    );
    if (models.length === recentMenu.models.length) return;
    setRecentMenu(models.length ? { models } : null);
    setRecentActive((index) => Math.min(index, Math.max(0, models.length - 1)));
  }, [recentMenu, pickerHarnesses, catalogVersion]);

  useEffect(() => {
    if (!recentMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setRecentActive(
          (index) => (index + direction + recentMenu.models.length) % recentMenu.models.length,
        );
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      const item = recentMenu.models[recentActive];
      if (item) pickModel(item);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recentActive, recentMenu, pickerHarnesses, catalogVersion, source, onChange]);

  const pickSetting = (setting: ModelSetting, value: string) => {
    if (settingDisabled(setting)) return;
    setSetting(setting, value);
    dismiss(true);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((previous) => {
      const next = previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id];
      saveFavoriteModels(next);
      return next;
    });
  };

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setQuery("");
    setActiveModel(0);
  };

  const showEntrySubmenu = (entry: MenuEntry) => {
    if (entry.kind === "model") {
      setSubmenu({ kind: "models" });
      return;
    }
    if (settingDisabled(entry.setting)) {
      setSubmenu(null);
      return;
    }
    if (entry.setting.kind === "select") {
      setSubmenu({ kind: "setting", setting: entry.setting });
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
      <button
        ref={button}
        type="button"
        title={t("{p0} · Recent models: right-click or {p1}.", {
          p0: triggerTitle,
          p1: MOD,
        })}
        aria-label={`${HARNESS_TITLE[current.harness]}${
          current.provider ? `, ${current.provider.name},` : ""
        } ${currentLabel}${triggerEffortLabel ? `, effort ${triggerEffortLabel}` : ""}`}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open || recentMenu != null}
        aria-haspopup={hideSettings ? "dialog" : "menu"}
        onMouseDown={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openRecentMenu();
        }}
        onClick={() => togglePicker()}
        className={`flex h-6.5 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 ${
          open ? "bg-selection text-content" : "bg-selection text-content hover:bg-selection-hover"
        }`}
      >
        <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-[11px]">{currentLabel}</span>
        {triggerEffortLabel ? (
          <span data-model-effort className="shrink-0 text-[11px] text-content/50">
            {triggerEffortLabel}
          </span>
        ) : null}
        <ChevronDown
          className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && hideSettings ? (
        <ModelFlyout
          anchor={button}
          side="top"
          autoFocusSearch
          onDismiss={(reason) => dismiss(reason === "escape")}
          harnesses={pickerHarnesses}
          tab={visibleTab}
          models={visibleModels}
          currentId={currentChoiceKey}
          active={activeModel}
          query={query}
          favorites={favorites}
          searchRef={search}
          onQuery={setQuery}
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
          <Popover
            anchor={button}
            side="top"
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
              if (entry.kind === "model") {
                return (
                  <button
                    key="model"
                    ref={highlighted ? setActiveRow : undefined}
                    data-model-control-index={index}
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={highlighted && showSubmenu}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      showEntrySubmenu(entry);
                    }}
                    onClick={() => showEntrySubmenu(entry)}
                    className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${
                      highlighted ? "bg-selection text-content" : "text-content hover:bg-content/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{t("Model")}</span>
                    <span className="flex min-w-0 items-center gap-1 text-content/55">
                      <HarnessIcon harness={current.harness} className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{current.name}</span>
                    </span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-content/45"
                      strokeWidth={1.75}
                    />
                  </button>
                );
              }

              const setting = entry.setting;
              const value = settingValue(setting, values);
              const isToggle = setting.kind === "toggle";
              return (
                <button
                  key={setting.id}
                  ref={highlighted ? setActiveRow : undefined}
                  data-model-control-index={index}
                  type="button"
                  role={isToggle ? "menuitemcheckbox" : "menuitem"}
                  disabled={settingDisabled(setting)}
                  aria-checked={isToggle ? value === "true" : undefined}
                  aria-haspopup={isToggle ? undefined : "menu"}
                  aria-expanded={!isToggle && highlighted ? showSubmenu : undefined}
                  title={
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
                  className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] disabled:opacity-40 ${
                    highlighted ? "bg-selection text-content" : "text-content hover:bg-content/5"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{t(setting.label)}</span>
                  {isToggle ? (
                    <span
                      aria-hidden="true"
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        value === "true" ? "bg-content/35" : "bg-content/15"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-4 rounded-full bg-content shadow-sm transition-transform ${
                          value === "true" ? "translate-x-4.5" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  ) : (
                    <>
                      <span className="min-w-0 truncate text-content/55">
                        {settingValueLabel(setting, values)}
                      </span>
                      <ChevronRight
                        className="size-3.5 shrink-0 text-content/45"
                        strokeWidth={1.75}
                      />
                    </>
                  )}
                </button>
              );
            })}
          </Popover>

          {showSubmenu && submenu.kind === "setting" ? (
            <Popover
              key={submenu.setting.id}
              anchor={activeRow}
              side="right"
              gap={SUBMENU_OVERLAP}
              width={SETTING_MENU_WIDTH}
              layer={LAYER.submenu}
              role="menu"
              aria-label={t(submenu.setting.label)}
              onMouseEnter={() => setSubmenu(submenu)}
              data-model-picker
              className="p-1 font-sans"
            >
              {submenu.setting.options.map((option, index) => {
                const selected = option.value === settingValue(submenu.setting, values);
                const highlighted = index === activeSetting;
                const tileTone = effortTileTone(current.harness, submenu.setting, option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    disabled={settingDisabled(submenu.setting)}
                    aria-checked={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSetting(index)}
                    onClick={() => pickSetting(submenu.setting, option.value)}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${
                      highlighted ? "bg-selection text-content" : "text-content hover:bg-content/5"
                    } ${tileTone ? "codex-effort-option" : ""}`}
                    data-effort-tone={tileTone}
                  >
                    {tileTone ? <EffortTileShimmer /> : null}
                    <span className="min-w-0 flex-1 truncate">
                      {submenu.setting.id === "advisor" ? t(option.label) : option.label}
                    </span>
                    {selected ? (
                      <Check className="size-3.5 shrink-0 text-content/50" strokeWidth={2} />
                    ) : null}
                  </button>
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
              currentId={currentChoiceKey}
              active={activeModel}
              query={query}
              favorites={favorites}
              searchRef={search}
              onQuery={setQuery}
              onSelectTab={selectTab}
              onActive={setActiveModel}
              onPick={pickModel}
              onToggleFavorite={toggleFavorite}
            />
          ) : null}
        </>
      ) : null}

      {recentMenu ? (
        <Popover
          anchor={button}
          side="top"
          width={MENU_WIDTH}
          autoFocus
          onDismiss={() => setRecentMenu(null)}
          role="menu"
          aria-label={t("Recently used models")}
          aria-activedescendant={`${recentMenuId}-${recentActive}`}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          data-model-picker
          className="p-1 font-sans"
        >
          {recentMenu.models.map((item, index) => {
            const selected = modelChoiceKey(item) === currentChoiceKey;
            const highlighted = index === recentActive;
            const disabled = !source.available(item.harness);
            return (
              <button
                key={modelChoiceKey(item)}
                id={`${recentMenuId}-${index}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                title={disabled ? harnessUnavailableHint(item.harness) : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setRecentActive(index)}
                onClick={() => pickModel(item)}
                className={`flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left disabled:cursor-not-allowed ${
                  disabled
                    ? "text-content/30"
                    : highlighted
                      ? "bg-selection text-content"
                      : "text-content hover:bg-content/5"
                }`}
              >
                <HarnessIcon harness={item.harness} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-4">{item.name}</span>
                  <span className="block truncate text-[11px] leading-4 text-content/45">
                    {HARNESS_TITLE[item.harness]}
                    {item.provider ? ` · ${item.provider.name}` : ""}
                  </span>
                </span>
                {selected ? (
                  <Check className="size-3.5 shrink-0 text-content/55" strokeWidth={2} />
                ) : null}
              </button>
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
    offeredDelegationSetting(setting, offered, settingValue(setting, values)),
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
    <button
      type="button"
      title={`${setting.label}: ${on ? "On" : "Off"}`}
      aria-label={`${setting.label}: ${on ? "On" : "Off"}`}
      aria-pressed={on}
      data-model-control
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSettingsChange({ ...values, [setting.id]: on ? "false" : "true" })}
      className="flex h-6.5 max-w-28 items-center gap-1 rounded-md bg-selection px-1.5 text-content hover:bg-selection-hover"
    >
      <span className={`min-w-0 truncate text-[11px] ${on ? "" : "text-content/50"}`}>
        {setting.label}
      </span>
    </button>
  );
}

function SelectPill({
  setting,
  values,
  onSettingsChange,
  onClose,
  harness,
  additionalSettings,
}: {
  setting: ModelSetting;
  values: Record<string, string>;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
  harness: HarnessId;
  additionalSettings?: ModelSetting[];
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const value = settingValue(setting, values);
  const valueLabel =
    setting.id === "advisor"
      ? t(settingValueLabel(setting, values))
      : settingValueLabel(setting, values);
  const label = setting.id === "advisor" ? t(settingLabel(setting)) : settingLabel(setting);
  const menuSettings = [setting, ...(additionalSettings ?? [])];
  const grouped = menuSettings.length > 1;
  const menuOptions = menuSettings.flatMap((menuSetting) =>
    menuSetting.options.map((option) => ({ setting: menuSetting, option })),
  );
  const menuLabels = menuSettings.map(settingLabel);
  const menuLabel =
    menuLabels.length < 3
      ? menuLabels.join(" and ")
      : `${menuLabels.slice(0, -1).join(", ")}, and ${menuLabels[menuLabels.length - 1]}`;
  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) onClose?.();
  };
  const openPicker = () => {
    const selectedIndex = menuOptions.findIndex(
      (item) => item.setting.id === setting.id && item.option.value === value,
    );
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };
  const pick = (pickedSetting: ModelSetting, optionValue: string) => {
    onSettingsChange({ ...values, [pickedSetting.id]: optionValue });
    dismiss(true);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        title={
          setting.id === "advisor" && setting.description
            ? t(setting.description)
            : `${label}: ${valueLabel}`
        }
        aria-label={`${label}: ${valueLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-model-control
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? dismiss(true) : openPicker())}
        className={`flex h-6.5 max-w-28 items-center gap-1 rounded-md px-1.5 ${
          open ? "bg-selection text-content" : "bg-selection text-content hover:bg-selection-hover"
        }`}
      >
        {isEffortSetting(setting) ? (
          <Gauge className="size-3.5 shrink-0" strokeWidth={1.75} />
        ) : setting.id === "serviceTier" ? (
          <Zap className="size-3.5 shrink-0" strokeWidth={1.75} />
        ) : null}
        <span className="min-w-0 truncate text-[11px]">
          {setting.id === "advisor" ? `${label}: ${valueLabel}` : valueLabel}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open ? (
        <Popover
          anchor={button}
          side="top"
          width={SETTING_MENU_WIDTH}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="menu"
          aria-label={menuLabel}
          aria-activedescendant={`${menuId}-${active}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActive((index) => (index + direction + menuOptions.length) % menuOptions.length);
              return;
            }
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            const item = menuOptions[active];
            if (item) pick(item.setting, item.option.value);
          }}
          data-model-control
          className="p-1 font-sans"
        >
          {menuSettings.map((menuSetting, groupIndex) => (
            <Fragment key={menuSetting.id}>
              {groupIndex > 0 ? <div role="separator" className="my-1 h-px bg-content/10" /> : null}
              <div
                role={grouped ? "group" : undefined}
                aria-label={grouped ? settingLabel(menuSetting) : undefined}
              >
                {grouped ? (
                  <div className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-content/40">
                    {settingLabel(menuSetting)}
                  </div>
                ) : null}
                {menuSetting.options.map((option) => {
                  const index = menuOptions.findIndex(
                    (item) =>
                      item.setting.id === menuSetting.id && item.option.value === option.value,
                  );
                  const selected = option.value === settingValue(menuSetting, values);
                  const highlighted = index === active;
                  const tileTone = effortTileTone(harness, menuSetting, option.value);
                  return (
                    <button
                      key={option.value}
                      id={`${menuId}-${index}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => pick(menuSetting, option.value)}
                      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-content ${
                        highlighted ? "bg-selection" : "hover:bg-content/5"
                      } ${tileTone ? "codex-effort-option" : ""}`}
                      data-effort-tone={tileTone}
                    >
                      {tileTone ? <EffortTileShimmer /> : null}
                      <span className="min-w-0 flex-1 truncate">
                        {menuSetting.id === "advisor" ? t(option.label) : option.label}
                      </span>
                      {selected ? (
                        <Check className="size-3.5 shrink-0 text-content/50" strokeWidth={2} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </Popover>
      ) : null}
    </>
  );
}
