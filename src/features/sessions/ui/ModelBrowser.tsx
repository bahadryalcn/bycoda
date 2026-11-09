import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useLocale, useT } from "../../../shared/i18n";
import { Check, Home, Star } from "../../../shared/ui/icons";
import { StatusDot } from "../../../shared/ui/StatusDot";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { type AgentModel, type ModelPickerTab } from "../model/models";
import { harnessUnavailableHint } from "../../../integrations/harness/core/availability";
import { useModelSource } from "./modelSource";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import { modelGroups } from "../model/modelPickerData";
import {
  modelChoiceBaseName,
  modelChoiceKey,
  type AccountModelChoice,
} from "../model/accountModelChoices";

/** Where new conversations start, marked on the rail and the rows. */
export type ModelDefaultMark = {
  harness: HarnessId;
  isDefault: (item: AgentModel) => boolean;
  /** The project pins it, rather than following the global choice. */
  pinned: boolean;
  /** Provider › account › model, for the rail tooltip. */
  path: string;
  /** Pins a row as the project's default, or unpins the pinned one. */
  onPin: (item: AgentModel) => void;
};

export type ModelBrowserProps = {
  harnesses: HarnessId[];
  tab: ModelPickerTab;
  models: AgentModel[];
  currentId: string;
  active: number;
  query: string;
  favorites: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  autoFocusSearch?: boolean;
  onQuery: (query: string) => void;
  onSelectTab: (tab: ModelPickerTab) => void;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
  defaultMark?: ModelDefaultMark;
  /** Between the search field and the list, e.g. the provider title and account control. */
  header?: ReactNode;
  /** First row of the list, e.g. an inherit choice. */
  leading?: ReactNode;
  /** Replaces the model list, e.g. while the account list is open. */
  body?: ReactNode;
  footer?: ReactNode;
};

/** Provider rail, model search and model list, shared by the model flyout and panel. */
export function ModelBrowser({
  harnesses,
  tab,
  models,
  currentId,
  active,
  query,
  favorites,
  searchRef,
  autoFocusSearch = false,
  onQuery,
  onSelectTab,
  onActive,
  onPick,
  onToggleFavorite,
  defaultMark,
  header,
  leading,
  body,
  footer,
}: ModelBrowserProps) {
  const t = useT();
  const listId = useId();
  const source = useModelSource();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const groups = modelGroups(tab, models);

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

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keyboard nav once focus leaves the search field (which stops its own keys).
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
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <Tabs
        value={tab}
        onValueChange={onSelectTab}
        orientation="vertical"
        variant="tab"
        panels="none"
      >
        <TabList
          label={t("Providers")}
          // Width follows the tab button size (density-aware) plus padding and the 1px
          // divider, so the rail is never narrower than its buttons. Horizontal overflow is
          // clipped, never scrolled; only the vertical axis scrolls.
          className="flex w-[max(2.75rem,calc(var(--ui-control-height-compact)+0.75rem+1px))] shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto overscroll-none border-r border-(--ui-tone-neutral-border) p-1.5"
        >
          <ProviderTabButton
            value="favorites"
            title={t("Favorites")}
            onSelect={() => onSelectTab("favorites")}
            selected={tab === "favorites"}
          >
            <Star
              className="icon-md"
              strokeWidth={1.75}
              fill={tab === "favorites" ? "currentColor" : "none"}
            />
          </ProviderTabButton>
          {harnesses.map((harness) => (
            <ProviderTabButton
              key={harness}
              value={harness}
              title={
                defaultMark?.harness === harness
                  ? `${HARNESS_TITLE[harness]} · ${t("Default: {p0}", { p0: defaultMark.path })}`
                  : HARNESS_TITLE[harness]
              }
              selected={tab === harness}
              onSelect={() => onSelectTab(harness)}
            >
              <span className="relative block">
                <HarnessIcon harness={harness} className="size-4" />
                {defaultMark?.harness === harness ? (
                  <StatusDot data-model-default-provider className="absolute -top-0.5 -right-1" />
                ) : null}
              </span>
            </ProviderTabButton>
          ))}
        </TabList>
      </Tabs>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PopoverSearchHeader
          ref={searchRef}
          size="md"
          label={t("Search models")}
          value={query}
          autoFocus={false}
          listId={listId}
          activeOptionId={models[active] ? `${listId}-${active}` : undefined}
          onValueChange={onQuery}
          onKeyDown={onSearchKey}
        />
        {header}
        {body ?? (
          <div
            ref={lockOverscroll}
            id={listId}
            role="listbox"
            aria-label={t("Models")}
            onKeyDown={onListKey}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
          >
            {leading}
            {models.length === 0 ? (
              <div className="px-2 py-3 text-ui-caption text-(--ui-text-secondary)">
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
                <div key={group.id} role={group.name ? "group" : undefined} aria-label={group.name}>
                  {group.name ? (
                    <SectionLabel as="div" className="px-2.5">
                      {group.name}
                    </SectionLabel>
                  ) : null}
                  {group.models.map(({ item, index }) => (
                    <ModelRow
                      key={modelChoiceKey(item)}
                      item={item}
                      id={`${listId}-${index}`}
                      tab={tab}
                      selected={modelChoiceKey(item) === currentId}
                      highlighted={index === active}
                      favorited={favorites.includes(item.id)}
                      defaultMark={defaultMark}
                      activeRef={index === active ? activeRef : undefined}
                      onActive={() => onActive(index)}
                      onPick={() => onPick(item)}
                      onToggleFavorite={() => onToggleFavorite(item.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}

function ModelRow({
  item,
  id,
  tab,
  selected,
  highlighted,
  favorited,
  defaultMark,
  activeRef,
  onActive,
  onPick,
  onToggleFavorite,
}: {
  item: AgentModel;
  id: string;
  tab: ModelPickerTab;
  selected: boolean;
  highlighted: boolean;
  favorited: boolean;
  defaultMark?: ModelDefaultMark;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
  onActive: () => void;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  const t = useT();
  const source = useModelSource();
  const { accountColor, accountLabel } = item as AccountModelChoice;
  const disabled = !source.available(item.harness);
  // Favorites mix harnesses, so every row names its source.
  // Provider first (OpenCode Go vs OpenCode), else harness.
  const provenance = item.provider?.name ?? HARNESS_TITLE[item.harness];
  const isDefault = defaultMark?.isDefault(item) === true;
  const pinned = isDefault && defaultMark?.pinned === true;
  return (
    <ActionHost
      selected={highlighted && !disabled}
      className={`h-(--ui-control-height-compact) rounded-lg px-1 ${
        disabled ? "text-(--ui-text-secondary)" : "text-(--ui-tone-neutral-fg)"
      }`}
      onMouseEnter={onActive}
    >
      <Button
        variant="item"
        ref={activeRef}
        id={id}
        type="button"
        role="option"
        aria-selected={selected}
        aria-label={`${item.name}, ${provenance}${isDefault ? `, ${t("Default")}` : ""}`}
        disabled={disabled}
        // The row truncates long names; the full name (and why a row is unavailable) stays in
        // the tooltip, and the accessible name above always carries it.
        tooltip={disabled ? `${item.name} · ${harnessUnavailableHint(item.harness)}` : item.name}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPick}
        className="min-w-0 flex-1 text-left"
      >
        {accountColor ? (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accountColor }}
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {modelChoiceBaseName(item as AccountModelChoice)}
        </span>
        {accountLabel ? (
          <>
            {" "}
            <span className="max-w-[45%] shrink-0 truncate ui-caption-text">{accountLabel}</span>
          </>
        ) : null}
      </Button>
      {tab === "favorites" ? (
        <OverflowTooltip label={provenance}>
          <span className="max-w-24 shrink-0 truncate ui-caption-text">{provenance}</span>
        </OverflowTooltip>
      ) : null}
      {isDefault ? (
        <span data-model-default className="shrink-0 ui-caption-text" aria-hidden>
          {t("Default")}
        </span>
      ) : null}
      {defaultMark ? (
        <InlineAction
          className="shrink-0"
          data-model-pin-default
          reveal={isDefault ? "always" : "interaction"}
          label={pinned ? t("Remove project default") : t("Make default for this project")}
          aria-pressed={pinned}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => defaultMark.onPin(item)}
        >
          <Home
            className={`icon-sm ${pinned ? "text-(--ui-tone-accent-fg)" : ""}`}
            strokeWidth={pinned ? 2.25 : 1.75}
          />
        </InlineAction>
      ) : null}
      <InlineAction
        className="shrink-0"
        reveal={favorited ? "always" : "interaction"}
        label={favorited ? t("Remove from favorites") : t("Add to favorites")}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleFavorite}
      >
        <Star className="icon-sm" strokeWidth={1.75} fill={favorited ? "currentColor" : "none"} />
      </InlineAction>
      {selected ? (
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center">
          <Check className="icon-sm text-(--ui-text-secondary)" strokeWidth={2} />
        </span>
      ) : null}
    </ActionHost>
  );
}

function ProviderTabButton({
  value,
  title,
  selected,
  onSelect,
  children,
}: {
  value: string;
  title: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <Tab
      // max-w-full: if a vertical scrollbar takes width from the rail, the tab narrows with
      // it instead of overflowing, so its selected/hover fill stays inside the rail.
      className="max-w-full shrink-0"
      value={value}
      iconOnly
      label={title}
      type="button"
      tooltip={title}
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
    >
      <span className="shrink-0">{children}</span>
    </Tab>
  );
}
