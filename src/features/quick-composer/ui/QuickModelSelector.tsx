import { Slider } from "../../../shared/ui/Slider";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { emit } from "@tauri-apps/api/event";
import { Check, RotateCcw, Search, Star, Zap } from "../../../shared/ui/icons";
import {
  findModel,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  isModelEnabled,
  loadFavoriteModels,
  modelEffortSetting,
  modelsFor,
  saveFavoriteModels,
  showProviderInModelPicker,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
} from "../../sessions/model/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { filterQuickModels, QUICK_COMPOSER_CATALOG_REQUEST_EVENT } from "../model/quickComposer";
import { quickSessionModelSettings } from "../model/quickSessionDefaults";

type Props = {
  cwd?: string;
  model: AgentModel;
  values: Record<string, string>;
  availableHarnesses: HarnessId[] | null;
  onChange: (model: AgentModel) => void;
  onSettingsChange: (values: Record<string, string>) => void;
  onClose: () => void;
};

/** Inline model browser: providers share the full width above search/results. */
export function QuickModelSelector({
  cwd,
  model,
  values,
  availableHarnesses,
  onChange,
  onSettingsChange,
  onClose,
}: Props) {
  useLocale();
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot);
  useSyncExternalStore(subscribePickerVisibility, getPickerVisibilitySnapshot);
  const [tab, setTab] = useState<ModelPickerTab>(model.harness);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const providers = HARNESSES.filter((id) =>
    showProviderInModelPicker(
      id,
      availableHarnesses?.includes(id) ?? false,
      availableHarnesses != null,
    ),
  );
  const tabs: ModelPickerTab[] = ["favorites", ...providers];
  const visibleTab = tabs.includes(tab) ? tab : "favorites";
  const pool =
    visibleTab === "favorites"
      ? favorites
          .map(findModel)
          .filter(
            (item): item is AgentModel =>
              !!item && providers.includes(item.harness) && isModelEnabled(item.id),
          )
      : modelsFor(visibleTab);
  const models = filterQuickModels(pool, query);
  const effort =
    modelEffortSetting(model) ??
    model.settings?.find(
      (setting) =>
        setting.kind === "select" && /^(effort|reasoning effort|reasoning)$/i.test(setting.label),
    );
  const valueFor = (id: string, fallback: string) => values[id] ?? fallback;
  const changeSetting = (id: string, value: string) => onSettingsChange({ ...values, [id]: value });
  const effortIndex = Math.max(
    0,
    effort?.options.findIndex((option) => option.value === valueFor(effort.id, effort.value)) ?? 0,
  );
  const fast = model.settings?.find(
    (setting) =>
      setting.id === "fast" ||
      setting.id === "serviceTier" ||
      /^fast( mode)?$/i.test(setting.label),
  );
  const fastOn = fast?.options.find(
    (option) => /^(true|fast|priority)$/i.test(option.value) || /^(on|fast)$/i.test(option.label),
  )?.value;
  const fastOff = fast?.options.find(
    (option) =>
      /^(false|default|standard|normal)$/i.test(option.value) ||
      /^(off|standard|normal)$/i.test(option.label),
  )?.value;
  const canToggleFast = fast != null && fastOn != null && fastOff != null;
  const fastEnabled = canToggleFast && valueFor(fast.id, fast.value) === fastOn;
  const resetSettings = () => {
    const defaults = quickSessionModelSettings(model, cwd);
    onSettingsChange({
      ...values,
      ...(effort ? { [effort.id]: defaults[effort.id] } : {}),
      ...(canToggleFast ? { [fast.id]: defaults[fast.id] } : {}),
    });
  };
  const enabled = (item: AgentModel) => availableHarnesses?.includes(item.harness) ?? false;

  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (visibleTab !== "favorites") void emit(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, visibleTab);
  }, [visibleTab]);

  useLayoutEffect(() => {
    const selected = models.findIndex((item) => item.id === model.id);
    setActive(selected >= 0 ? selected : 0);
  }, [visibleTab, query, catalogVersion, model.id, favorites]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [active, visibleTab, query, catalogVersion, favorites]);

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setQuery("");
    setActive(0);
  };
  const pick = (item: AgentModel) => {
    if (enabled(item)) onChange(item);
  };

  return (
    <section
      aria-label={t("Model selector")}
      className="flex min-h-0 flex-col border-t border-stroke"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <nav
        role="tablist"
        aria-label={t("Providers")}
        className="grid h-11 shrink-0 grid-flow-col auto-cols-fr items-center gap-1 border-b border-stroke px-2"
      >
        {tabs.map((id, index) => {
          const title = id === "favorites" ? "Favorites" : HARNESS_TITLE[id];
          return (
            <Button
              variant="tab"
              motion="none"
              key={id}
              type="button"
              role="tab"
              title={title}
              aria-label={title}
              aria-selected={visibleTab === id}
              tabIndex={visibleTab === id ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else return;
                event.preventDefault();
                selectTab(tabs[next]);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next]?.focus({ preventScroll: true });
              }}
              className={`flex w-full min-w-0 items-center justify-center `}
            >
              {id === "favorites" ? (
                <Star className="size-4" fill={visibleTab === id ? "currentColor" : "none"} />
              ) : (
                <HarnessIcon harness={id} className="size-4" />
              )}
            </Button>
          );
        })}
      </nav>
      <div className="flex min-h-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <label className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke px-4 text-(--ui-text-muted)">
            <Search className="size-3.5 shrink-0" />
            <SearchInput
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              role="combobox"
              aria-label={t("Search models")}
              aria-controls={listId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={models[active] ? `${listId}-${active}` : undefined}
              placeholder={t("Search models…")}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.key === "Process" ||
                  event.keyCode === 229
                )
                  return;
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (models.length)
                    setActive(
                      (index) =>
                        (index + (event.key === "ArrowDown" ? 1 : -1) + models.length) %
                        models.length,
                    );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const selected = models[active];
                  if (selected) pick(selected);
                }
              }}
            />
          </label>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t("Models")}
            className="h-60 min-h-0 overflow-y-auto overscroll-none p-2"
          >
            {models.length ? (
              models.map((item, index) => (
                <div
                  key={`${item.harness}:${item.id}`}
                  data-index={index}
                  className="flex items-center"
                  onMouseEnter={() => setActive(index)}
                >
                  <Button
                    fullWidth
                    selected={index === active}
                    variant="item"
                    motion="none"
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={item.id === model.id}
                    disabled={!enabled(item)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(item)}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    {visibleTab === "favorites" ? (
                      <HarnessIcon harness={item.harness} className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="truncate">{item.name}</span>
                    {item.provider ? (
                      <span className="ml-auto truncate text-ui-micro text-(--ui-text-muted)">
                        {item.provider.name}
                      </span>
                    ) : null}
                    {item.id === model.id ? (
                      <Check className="ml-auto size-3.5 shrink-0 text-accent" />
                    ) : null}
                  </Button>
                  <Button
                    iconOnly
                    label={t(
                      favorites.includes(item.id)
                        ? "Remove {p1} from favorites"
                        : "Add {p1} to favorites",
                      { p1: item.name },
                    )}
                    variant="ghost"
                    motion="none"
                    type="button"
                    title={
                      favorites.includes(item.id)
                        ? t("Remove from favorites")
                        : t("Add to favorites")
                    }
                    aria-label={t(
                      favorites.includes(item.id)
                        ? "Remove {p1} from favorites"
                        : "Add {p1} to favorites",
                      { p1: item.name },
                    )}
                    onClick={() => {
                      const next = favorites.includes(item.id)
                        ? favorites.filter((id) => id !== item.id)
                        : [...favorites, item.id];
                      setFavorites(next);
                      saveFavoriteModels(next);
                    }}
                    className="grid shrink-0 place-items-center"
                  >
                    <Star
                      className="size-3.5"
                      fill={favorites.includes(item.id) ? "currentColor" : "none"}
                    />
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-2 py-6 text-center text-ui-caption text-(--ui-text-muted)">
                {query
                  ? t("No matching models")
                  : visibleTab === "favorites"
                    ? t("No favorite models")
                    : t("Loading models…")}
              </p>
            )}
          </div>
          {effort && effort.options.length > 0 ? (
            <div className="shrink-0 border-t border-stroke px-4 pb-3 pt-2">
              <div className="mb-1 grid grid-cols-[28px_1fr_28px] items-center">
                {canToggleFast ? (
                  <Button
                    iconOnly
                    label={t("Fast mode")}
                    variant="ghost"
                    motion="none"
                    type="button"
                    aria-label={t("Fast mode")}
                    aria-pressed={fastEnabled}
                    title={fastEnabled ? t("Turn off fast mode") : t("Turn on fast mode")}
                    onClick={() => changeSetting(fast.id, fastEnabled ? fastOff : fastOn)}
                    className={`grid place-items-center `}
                  >
                    <Zap className="size-4" fill={fastEnabled ? "currentColor" : "none"} />
                  </Button>
                ) : (
                  <span />
                )}
                <span className="text-center text-[13px] font-medium text-accent">
                  {effort.options[effortIndex]?.label}
                </span>
                <Button
                  iconOnly
                  label={t("Reset to saved defaults")}
                  variant="ghost"
                  motion="none"
                  type="button"
                  aria-label={t("Reset to saved defaults")}
                  title={t("Reset to saved defaults")}
                  onClick={resetSettings}
                  className="grid place-items-center"
                >
                  <RotateCcw className="size-4" />
                </Button>
              </div>
              <Slider
                hideLabel
                label={effort.label}
                value={effortIndex}
                min={0}
                max={effort.options.length - 1}
                step={1}
                marks={effort.options.map((_, index) => index)}
                format={(index) => effort.options[index]?.label ?? ""}
                onValueChange={(index) => changeSetting(effort.id, effort.options[index].value)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
