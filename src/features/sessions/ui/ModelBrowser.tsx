import { surfaceAttributes } from "../../../shared/ui/Surface";
import { PickerList, usePickerList } from "../../../shared/ui/picker";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { useLocale, useT } from "../../../shared/i18n";
import { Home, Star } from "../../../shared/ui/icons";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { useEffect, useId, type ReactNode } from "react";
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
  const groups = modelGroups(tab, models);

  // Popover measures its initially hidden frame during layout. Focus only
  // after that measurement, when the browser can focus the visible input.
  useEffect(() => {
    if (!autoFocusSearch) return;
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocusSearch, searchRef]);

  const options = groups.flatMap((group) =>
    group.models.map(({ item }) => ({
      value: modelChoiceKey(item),
      title: modelChoiceBaseName(item as AccountModelChoice),
      icon: <HarnessIcon harness={item.harness} className="icon-sm" />,
      meta: (item as AccountModelChoice).accountLabel ? (
        <span className="inline-flex items-center gap-1">
          {" "}
          {(item as AccountModelChoice).accountColor ? (
            <span
              {...surfaceAttributes({ radius: "pill" }, "size-1.5 shrink-0")}
              style={{ backgroundColor: (item as AccountModelChoice).accountColor }}
              aria-hidden
            />
          ) : null}
          {(item as AccountModelChoice).accountLabel}
        </span>
      ) : undefined,
      group: group.name,
      disabled: !source.available(item.harness),
      disabledReason: !source.available(item.harness)
        ? harnessUnavailableHint(item.harness)
        : undefined,
      trailing: (
        <>
          {tab === "favorites" ? " " : null}
          {tab === "favorites" ? (item.provider?.name ?? HARNESS_TITLE[item.harness]) : null}
          {defaultMark?.isDefault(item) ? <span data-model-default>{t("Default")}</span> : null}
        </>
      ),
    })),
  );
  const list = usePickerList({
    id: listId,
    options,
    value: currentId,
    activeValue: models[active] ? modelChoiceKey(models[active]!) : null,
    onActiveValueChange: (value) =>
      onActive(models.findIndex((item) => modelChoiceKey(item) === value)),
    onChange: (value) => {
      const item = models.find((item) => modelChoiceKey(item) === value);
      if (item) onPick(item);
    },
    inputRef: searchRef,
  });

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
          className="flex w-[max(2.75rem,calc(var(--ui-control-height-compact)+0.75rem+1px))] shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto overscroll-none"
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
          {...list.searchProps}
          size="md"
          label={t("Search models")}
          value={query}
          autoFocus={false}
          onValueChange={onQuery}
        />
        {header}
        {body ?? (
          <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
            {leading}
            <PickerList
              label={t("Models")}
              controller={list}
              query={query}
              emptyLabel={
                tab === "favorites" && !query.trim()
                  ? t("No favorite models")
                  : tab !== "favorites" && !source.available(tab)
                    ? harnessUnavailableHint(tab)
                    : tab === "codex" && !query.trim()
                      ? t("Loading Codex models…")
                      : t("No matching models")
              }
              renderOptionActions={(option) => {
                const item = models.find((item) => modelChoiceKey(item) === option.value)!;
                return (
                  <ModelActions
                    item={item}
                    favorited={favorites.includes(item.id)}
                    defaultMark={defaultMark}
                    onToggleFavorite={() => onToggleFavorite(item.id)}
                  />
                );
              }}
            />
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}

/** Model persistence actions stay siblings of the shared option button. */
function ModelActions({
  item,
  favorited,
  defaultMark,
  onToggleFavorite,
}: {
  item: AgentModel;
  favorited: boolean;
  defaultMark?: ModelDefaultMark;
  onToggleFavorite: () => void;
}) {
  const t = useT();
  const isDefault = defaultMark?.isDefault(item) === true;
  const pinned = isDefault && defaultMark?.pinned === true;
  return (
    <>
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
            className="icon-sm"
            tone={pinned ? "accent" : undefined}
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
    </>
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
