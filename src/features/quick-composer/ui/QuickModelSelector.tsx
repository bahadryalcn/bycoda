import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Text } from "../../../shared/ui/Text";
import { ModelExtrasPanel } from "../../sessions/ui/ModelExtras";
import { Button } from "../../../shared/ui/Button";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw, Star, ChevronDown } from "../../../shared/ui/icons";
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
import { modelRowKey, resolveActiveModelKey } from "../../sessions/model/modelListReconcile";
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
  const resetSettings = () =>
    onSettingsChange({ ...values, ...quickSessionModelSettings(model, cwd) });

  useEffect(() => {
    if (showModels) searchRef.current?.focus({ preventScroll: true });
    else modelRowRef.current?.focus({ preventScroll: true });
  }, [showModels]);
  useEffect(() => {
    if (visibleTab !== "favorites") requestQuickCatalog(visibleTab);
  }, [visibleTab]);

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

  const list = usePickerList({
    id: listId,
    options: models.map((item) => ({
      value: modelRowKey(item),
      title: item.name,
      icon: <HarnessIcon harness={item.harness} className="icon-sm" />,
      meta: item.provider?.name,
      disabled: !enabled(item),
    })),
    value: modelRowKey(model),
    activeValue: activeKey,
    onActiveValueChange: (key) => {
      if (key) setActiveChoice({ key, scope: activeScope });
    },
    inputRef: searchRef,
    onChange: (key) => {
      const item = models.find((item) => modelRowKey(item) === key);
      if (item) pick(item);
    },
  });

  return (
    <section
      aria-label={t("Model selector")}
      className="flex min-h-0 flex-col"
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
            <TabList label={t("Providers")} className="shrink-0 items-center gap-1">
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
                {...list.searchProps}
                size="md"
                label={t("Search models")}
                placeholder={t("Search models…")}
                value={query}
                autoFocus={false}
                onValueChange={(value) => {
                  setQuery(value);
                  setActiveChoice(null);
                }}
              />
              <PickerList
                label={t("Models")}
                controller={list}
                query={query}
                className="h-60 min-h-0 overflow-y-auto overscroll-none"
                emptyLabel={
                  query
                    ? t("No matching models")
                    : visibleTab === "favorites"
                      ? t("No favorite models")
                      : t("Loading models…")
                }
                renderOptionActions={(option) => {
                  const item = models.find((item) => modelRowKey(item) === option.value)!;
                  const favorited = favorites.includes(item.id);
                  return (
                    <InlineAction
                      reveal={favorited ? "always" : "interaction"}
                      label={t(favorited ? "Remove {p1} from favorites" : "Add {p1} to favorites", {
                        p1: item.name,
                      })}
                      onClick={() => {
                        const next = favorited
                          ? favorites.filter((id) => id !== item.id)
                          : [...favorites, item.id];
                        setFavorites(next);
                        saveFavoriteModels(next);
                      }}
                    >
                      <Star className="icon-sm" fill={favorited ? "currentColor" : "none"} />
                    </InlineAction>
                  );
                }}
              />
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
