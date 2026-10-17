import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Star,
} from "../../../shared/ui/icons";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { type AgentModel, type ModelPickerTab } from "../model/models";

import { harnessUnavailableHint } from "../../../integrations/harness/core/availability";
import { useModelSource } from "./modelSource";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { LAYER } from "../../../shared/lib/layers";
import { HarnessIcon } from "./HarnessIcon";
import { Popover } from "../../../shared/ui/Popover";
import { ModelExtrasPanel, useModelExtrasSummary } from "./ModelExtras";

import "./ModelPicker.css";

import { modelGroups } from "../model/modelPickerData";
import { modelChoiceKey, type AccountModelChoice } from "../model/accountModelChoices";
const MODEL_MENU_WIDTH = 310;
const SUBMENU_OVERLAP = -4;
const PROVIDER_TAB_SIZE = 32;
const PROVIDER_TAB_GAP = 4;
const PROVIDER_RAIL_PADDING = 12;

/** The current selection's extras, editable from the picker's Extras view. */
export type ModelFlyoutExtras = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onSettingsChange: (values: Record<string, string>) => void;
  disabled?: boolean;
};

export function ModelFlyout({
  anchor,
  side = "right",
  autoFocusSearch = false,
  onDismiss,
  harnesses,
  tab,
  models,
  currentId,
  active,
  query,
  favorites,
  searchRef,
  onQuery,
  onSelectTab,
  onActive,
  onPick,
  onToggleFavorite,
  extras,
}: {
  anchor: HTMLButtonElement | { current: HTMLButtonElement | null };
  side?: "right" | "top";
  autoFocusSearch?: boolean;
  onDismiss?: (reason: "outside" | "escape") => void;
  harnesses: HarnessId[];
  tab: ModelPickerTab;
  models: AgentModel[];
  currentId: string;
  active: number;
  query: string;
  favorites: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onSelectTab: (tab: ModelPickerTab) => void;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
  /** Adds an Extras view for the current selection; only where changes are kept. */
  extras?: ModelFlyoutExtras;
}) {
  useLocale();
  const source = useModelSource();
  const [view, setView] = useState<"models" | "extras">("models");
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const groups = modelGroups(tab, models);
  // Reserve room for the visible provider rail and a compact page of model rows.
  const menuHeight = Math.max(
    (harnesses.length + 1) * PROVIDER_TAB_SIZE +
      harnesses.length * PROVIDER_TAB_GAP +
      PROVIDER_RAIL_PADDING,
    300,
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Popover measures its initially hidden frame during layout. Focus only
  // after that measurement, when the browser can focus the visible input.
  useEffect(() => {
    if (!autoFocusSearch) return;
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocusSearch, searchRef]);

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.min(models.length - 1, active + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.max(0, active - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const item = models[active];
      if (item) onPick(item);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.stopPropagation();
    }
  };

  return (
    <Popover
      anchor={anchor}
      side={side}
      gap={side === "right" ? SUBMENU_OVERLAP : undefined}
      width={MODEL_MENU_WIDTH}
      maxHeight={menuHeight + 2}
      layer={LAYER.submenu}
      role="dialog"
      aria-label={t("Models")}
      onDismiss={(reason) => {
        // Escape steps back from Extras before it closes the picker.
        if (reason === "escape" && view === "extras") {
          setView("models");
          return;
        }
        onDismiss?.(reason);
      }}
      onKeyDown={(event) => {
        // Keyboard nav once focus leaves the search field (which stops its
        // own keys). Scoped to the list so provider tabs keep their buttons.
        if (!(event.target instanceof Element) || !event.target.closest('[role="listbox"]')) {
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          onActive(Math.min(models.length - 1, Math.max(0, active + direction)));
          return;
        }
        if (event.key !== "Enter") return;
        // Favorite toggles keep native activation; model rows activate the
        // highlighted option so Enter never fires on a stale focused row.
        if (
          event.target instanceof HTMLButtonElement &&
          event.target.getAttribute("role") !== "option"
        ) {
          return;
        }
        event.preventDefault();
        const item = models[active];
        if (item) onPick(item);
      }}
      data-model-picker
      style={{
        height: menuHeight,
      }}
      className="flex min-h-0 overflow-hidden font-sans"
    >
      {view === "extras" && extras ? (
        <ExtrasView extras={extras} onBack={() => setView("models")} />
      ) : (
        <>
          <nav
            role="tablist"
            aria-label={t("Providers")}
            aria-orientation="vertical"
            className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto overscroll-none border-r border-(--ui-tone-neutral-border) p-1.5"
          >
            <ProviderTabButton
              title={t("Favorites")}
              selected={tab === "favorites"}
              onSelect={() => onSelectTab("favorites")}
            >
              <Star
                className="size-4"
                strokeWidth={1.75}
                fill={tab === "favorites" ? "currentColor" : "none"}
              />
            </ProviderTabButton>
            {harnesses.map((harness) => (
              <ProviderTabButton
                key={harness}
                title={HARNESS_TITLE[harness]}
                selected={tab === harness}
                onSelect={() => onSelectTab(harness)}
              >
                <HarnessIcon harness={harness} className="size-4" />
              </ProviderTabButton>
            ))}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <label className="flex shrink-0 items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2.5 text-(--ui-text-secondary)">
              <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
              <SearchInput
                ref={searchRef}
                type="text"
                value={query}
                placeholder={t("Search models")}
                aria-label={t("Search models")}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-(--ui-tone-neutral-fg) outline-none placeholder:text-(--ui-text-secondary)"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={onSearchKey}
              />
            </label>

            <div
              ref={lockOverscroll}
              role="listbox"
              aria-label={t("Models")}
              className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
            >
              {models.length === 0 ? (
                <div className="px-2 py-3 text-[12px] text-(--ui-text-secondary)">
                  {tab === "favorites" && !query.trim()
                    ? t("No favorite models")
                    : tab !== "favorites" && !source.available(tab)
                      ? harnessUnavailableHint(tab)
                      : tab === "codex" && !query.trim()
                        ? t("Loading Codex models…")
                        : t("No matching models")}
                </div>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    role={group.name ? "group" : undefined}
                    aria-label={group.name}
                  >
                    {group.name ? (
                      <div className="px-2.5 pb-1 pt-2 ui-caption-text font-medium uppercase tracking-wide">
                        {group.name}
                      </div>
                    ) : null}
                    {group.models.map(({ item, index }) => {
                      const accountColor = (item as AccountModelChoice).accountColor;
                      const selected = modelChoiceKey(item) === currentId;
                      const highlighted = index === active;
                      const favorited = favorites.includes(item.id);
                      const disabled = !source.available(item.harness);
                      // Favorites mix harnesses, so every row names its source.
                      // Provider first (OpenCode Go vs OpenCode), else harness.
                      const provenance = item.provider?.name ?? HARNESS_TITLE[item.harness];
                      return (
                        <div
                          key={modelChoiceKey(item)}
                          className={`group flex h-8 items-center rounded-lg px-1 ${
                            disabled
                              ? "text-(--ui-text-secondary)"
                              : highlighted
                                ? "bg-selection text-(--ui-tone-neutral-fg)"
                                : "text-(--ui-tone-neutral-fg) hover:bg-(--ui-surface-raised)"
                          }`}
                          onMouseEnter={() => onActive(index)}
                        >
                          <Button
                            variant="item"
                            ref={highlighted ? activeRef : undefined}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-label={`${item.name}, ${provenance}`}
                            disabled={disabled}
                            title={disabled ? harnessUnavailableHint(item.harness) : undefined}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onPick(item)}
                            className="min-w-0 flex-1 text-left"
                          >
                            {accountColor ? (
                              <span
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: accountColor }}
                                aria-hidden
                              />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          </Button>
                          {tab === "favorites" ? (
                            <span className="max-w-24 shrink-0 truncate ui-caption-text">
                              {provenance}
                            </span>
                          ) : null}
                          <Button
                            className={`shrink-0 ${favorited ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                            iconOnly
                            label={favorited ? t("Remove from favorites") : t("Add to favorites")}
                            variant="ghost"
                            type="button"
                            title={favorited ? t("Remove from favorites") : t("Add to favorites")}
                            aria-label={
                              favorited ? t("Remove from favorites") : t("Add to favorites")
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleFavorite(item.id);
                            }}
                          >
                            <Star
                              className="size-3.5"
                              strokeWidth={1.75}
                              fill={favorited ? "currentColor" : "none"}
                            />
                          </Button>
                          {selected ? (
                            <span
                              aria-hidden="true"
                              className="grid size-6 shrink-0 place-items-center"
                            >
                              <Check
                                className="size-3.5 text-(--ui-text-secondary)"
                                strokeWidth={2}
                              />
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            {extras ? <ExtrasEntry extras={extras} onOpen={() => setView("extras")} /> : null}
          </div>
        </>
      )}
    </Popover>
  );
}

/** Footer row that opens the current selection's extras. */
function ExtrasEntry({ extras, onOpen }: { extras: ModelFlyoutExtras; onOpen: () => void }) {
  useLocale();
  const { available, changed } = useModelExtrasSummary(extras.harness, extras.model, extras.values);
  if (!available) return null;
  return (
    <Button
      variant="ghost"
      type="button"
      data-model-extras-entry
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
      className="shrink-0 text-left"
    >
      <SlidersHorizontal className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{t("Extras")}</span>
      {changed > 0 ? (
        <span className="rounded bg-selection px-1 text-[10px] tabular-nums text-(--ui-tone-neutral-fg)">
          {changed}
        </span>
      ) : null}
      <ChevronRight className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
    </Button>
  );
}

/** The whole flyout given over to the current selection's extras. */
function ExtrasView({ extras, onBack }: { extras: ModelFlyoutExtras; onBack: () => void }) {
  useLocale();
  const source = useModelSource();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const name = source.resolve(extras.harness, extras.model).name;
  return (
    <div
      ref={lockOverscroll}
      role="group"
      aria-label={t("Provider extras")}
      data-model-settings
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
    >
      <ModelExtrasPanel
        harness={extras.harness}
        model={extras.model}
        values={extras.values}
        onSettingsChange={extras.onSettingsChange}
        disabled={extras.disabled}
        title={`${HARNESS_TITLE[extras.harness]} · ${name}`}
        leading={
          <Button
            iconOnly
            label={t("Back")}
            variant="ghost"
            type="button"
            aria-label={t("Back")}
            title={t("Back")}
            onClick={onBack}
            className="-ml-1 shrink-0"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          </Button>
        }
      />
    </div>
  );
}

function ProviderTabButton({
  title,
  selected,
  onSelect,
  children,
}: {
  title: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Button
      className="shrink-0"
      selected={selected}
      iconOnly
      label={title}
      variant="tab"
      type="button"
      role="tab"
      title={title}
      aria-label={title}
      aria-selected={selected}
      onMouseDown={(event) => event.preventDefault()}
      // Only a moving pointer previews a provider: a flyout that opens under a
      // resting pointer must keep its initial tab.
      onMouseMove={
        selected
          ? undefined
          : (event) => {
              if (event.movementX || event.movementY) onSelect();
            }
      }
      onClick={onSelect}
    >
      <span className="shrink-0">{children}</span>
    </Button>
  );
}
