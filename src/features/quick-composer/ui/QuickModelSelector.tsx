import { Text } from "../../../shared/ui/Text";
import { ModelExtrasPanel } from "../../sessions/ui/ModelExtras";
import { Button } from "../../../shared/ui/Button";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, RotateCcw, Star, ChevronDown } from "../../../shared/ui/icons";
import {
  findModel,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  isModelEnabled,
  loadFavoriteModels,
  modelsFor,
  saveFavoriteModels,
  showProviderInModelPicker,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
} from "../../sessions/model/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import {
  isProviderHidden,
  projectProvidersRevision,
  subscribeProjectProviders,
} from "../../sessions/model/projectProviders";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  modelKeyIndex,
  modelRowKey,
  resolveActiveModelKey,
  stepActiveModelKey,
} from "../../sessions/model/modelListReconcile";
import { filterQuickModels, requestQuickCatalog } from "../model/quickComposer";
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
  useSyncExternalStore(subscribeModels, getModelSnapshot);
  useSyncExternalStore(subscribePickerVisibility, getPickerVisibilitySnapshot);
  useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  const [showModels, setShowModels] = useState(true);
  const modelRowRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<ModelPickerTab>(model.harness);
  const [query, setQuery] = useState("");
  // The keyboard row is owned by provider/model identity. `scope` ties it to the
  // tab and query it was chosen in, so changing either (a user reset) drops it,
  // while catalog or favorites refreshes keep it.
  const [activeChoice, setActiveChoice] = useState<{ key: string; scope: string } | null>(null);
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Providers the project hides stay out of the browser, as in the shared picker.
  const providers = HARNESSES.filter(
    (id) =>
      !isProviderHidden(cwd, id) &&
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
  const enabled = (item: AgentModel) => availableHarnesses?.includes(item.harness) ?? false;
  const activeScope = `${visibleTab}\u0000${query}`;
  const activeKey = resolveActiveModelKey({
    models,
    activeKey: activeChoice?.scope === activeScope ? activeChoice.key : null,
    selected: model,
    isEligible: enabled,
  });
  const active = modelKeyIndex(models, activeKey);
  const setActive = (item: AgentModel) =>
    setActiveChoice({ key: modelRowKey(item), scope: activeScope });
  const resetSettings = () =>
    onSettingsChange({ ...values, ...quickSessionModelSettings(model, cwd) });

  useEffect(() => {
    if (showModels) searchRef.current?.focus({ preventScroll: true });
    else modelRowRef.current?.focus({ preventScroll: true });
  }, [showModels]);
  useEffect(() => {
    if (visibleTab !== "favorites") requestQuickCatalog(visibleTab);
  }, [visibleTab]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [active, activeKey, visibleTab, query]);

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setQuery("");
    setActiveChoice(null);
  };
  const pick = (item: AgentModel) => {
    if (!enabled(item)) return;
    onChange(item);
    setShowModels(false);
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
      <ModelExtrasPanel
        compact
        harness={model.harness}
        model={model.id}
        values={values}
        onSettingsChange={onSettingsChange}
      />
      <Button variant="ghost" size="sm" onClick={resetSettings}>
        <RotateCcw className="icon-md" />
        {t("Reset to saved defaults")}
      </Button>
      {showModels ? (
        <>
          <Tabs value={visibleTab} onValueChange={selectTab} fill panels="none">
            <TabList
              label={t("Providers")}
              className="h-11 shrink-0 items-center gap-1 border-b border-stroke px-2"
            >
              {tabs.map((id) => {
                const title = id === "favorites" ? t("Favorites") : HARNESS_TITLE[id];
                return (
                  <Tab key={id} value={id} aria-label={title} tooltip={title}>
                    {id === "favorites" ? (
                      <Star
                        className="icon-md"
                        fill={visibleTab === id ? "currentColor" : "none"}
                      />
                    ) : (
                      <HarnessIcon harness={id} className="icon-md" />
                    )}
                  </Tab>
                );
              })}
            </TabList>
          </Tabs>
          <div className="flex min-h-0">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PopoverSearchHeader
                ref={searchRef}
                size="md"
                label={t("Search models")}
                placeholder={t("Search models…")}
                value={query}
                autoFocus={false}
                listId={listId}
                activeOptionId={active >= 0 ? `${listId}-${active}` : undefined}
                onValueChange={(value) => {
                  setQuery(value);
                  setActiveChoice(null);
                }}
                onKeyDown={(event) => {
                  if (
                    event.nativeEvent.isComposing ||
                    event.key === "Process" ||
                    event.keyCode === 229
                  )
                    return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const key = stepActiveModelKey({
                      models,
                      activeKey,
                      delta: event.key === "ArrowDown" ? 1 : -1,
                      isEligible: enabled,
                    });
                    if (key) setActiveChoice({ key, scope: activeScope });
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const selected = models[active];
                    if (selected) pick(selected);
                  }
                }}
              />
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
                      onMouseEnter={() => {
                        if (enabled(item)) setActive(item);
                      }}
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
                        <Text size="inherit" tone="inherit" truncate>
                          {item.name}
                        </Text>
                        {item.provider ? (
                          <Text size="micro" tone="muted" truncate className="ml-auto">
                            {item.provider.name}
                          </Text>
                        ) : null}
                        {item.id === model.id ? (
                          <Check className="ml-auto icon-sm shrink-0" tone="accent" />
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
                        tooltip={
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
                          className="icon-sm"
                          fill={favorites.includes(item.id) ? "currentColor" : "none"}
                        />
                      </Button>
                    </div>
                  ))
                ) : (
                  <Text as="p" size="caption" tone="muted" className="px-2 py-6 text-center">
                    {query
                      ? t("No matching models")
                      : visibleTab === "favorites"
                        ? t("No favorite models")
                        : t("Loading models…")}
                  </Text>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
      <Button
        ref={modelRowRef}
        variant="item"
        fullWidth
        aria-expanded={showModels}
        aria-label={t("Model")}
        onClick={() => {
          setTab(model.harness);
          setQuery("");
          setActiveChoice(null);
          setShowModels((value) => !value);
        }}
      >
        <span>{t("Model")}</span>
        <Text size="inherit" tone="inherit" truncate className="ml-auto">
          {model.name}
        </Text>
        <ChevronDown className="icon-md shrink-0" />
      </Button>
    </section>
  );
}
