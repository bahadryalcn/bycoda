import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { MatchText } from "../../../shared/ui/MatchText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { NativeSelect } from "../../../shared/ui/Select";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Folder, MessageSquare, SlidersHorizontal } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { DEFAULT_CHAT_FILTERS } from "../model/chatSearch";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import {
  formatChatDate,
  type ChatDateRange,
  type ChatEntry,
  type ChatFilters,
  type ChatProjectGroup,
  type ChatScope,
} from "../model/chatSearch";

const SCOPE_LABEL: Record<ChatScope, string> = {
  everywhere: "Everywhere",
  group: "This group",
  project: "This project",
};

const RANGE_LABEL: Record<ChatDateRange, string> = {
  any: "Any time",
  week: "Past week",
  month: "Past month",
  year: "Past year",
};

export function ChatFilterBar({
  filters,
  inGroup,
  onChange,
}: {
  filters: ChatFilters;
  /** Whether the current project is filed under a rail group. */
  inGroup: boolean;
  onChange: (filters: ChatFilters) => void;
}) {
  useLocale();
  const [filterOpen, setFilterOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = Object.keys(DEFAULT_CHAT_FILTERS).some(
    (key) => filters[key as keyof ChatFilters] !== DEFAULT_CHAT_FILTERS[key as keyof ChatFilters],
  );
  return (
    <div className="flex shrink-0 justify-end px-3 py-1">
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        label={t("Chat search filters")}
        tooltip={t("Chat search filters")}
        selected={active}
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((value) => !value)}
      >
        <SlidersHorizontal className="size-3.5" />
        <span>{t(SCOPE_LABEL[filters.scope])}</span>
      </Button>
      {filterOpen ? (
        <Popover anchor={trigger} align="end" onDismiss={() => setFilterOpen(false)}>
          <div
            className="flex flex-col items-stretch gap-3 p-3"
            role="group"
            aria-label={t("Chat search filters")}
          >
            <NativeSelect
              aria-label={t("Search in")}
              value={filters.scope}
              onChange={(event) => onChange({ ...filters, scope: event.target.value as ChatScope })}
            >
              {(Object.keys(SCOPE_LABEL) as ChatScope[]).map((scope) => (
                <option key={scope} value={scope} disabled={scope === "group" && !inGroup}>
                  {t(SCOPE_LABEL[scope])}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t("Provider")}
              value={filters.harness}
              onChange={(event) =>
                onChange({
                  ...filters,
                  harness: event.target.value as HarnessId | "any",
                })
              }
            >
              <option value="any">{t("Any provider")}</option>
              {HARNESSES.map((harness) => (
                <option key={harness} value={harness}>
                  {HARNESS_TITLE[harness]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t("Date")}
              value={filters.range}
              onChange={(event) =>
                onChange({ ...filters, range: event.target.value as ChatDateRange })
              }
            >
              {(Object.keys(RANGE_LABEL) as ChatDateRange[]).map((range) => (
                <option key={range} value={range}>
                  {t(RANGE_LABEL[range])}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-1.5 text-ui-secondary text-(--ui-text-secondary)">
              <Checkbox
                checked={filters.archived}
                onChange={(event) => onChange({ ...filters, archived: event.target.checked })}
              />
              {t("Archived")}
            </label>
            <Button variant="ghost" size="sm" onClick={() => onChange({ ...DEFAULT_CHAT_FILTERS })}>
              {t("Reset")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  useLocale();
  const positions = ranges.flatMap(([from, to]) =>
    Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index),
  );
  return <MatchText text={text} positions={positions} active={positions.length > 0} />;
}

export function ChatSearchResults({
  listId,
  groups,
  entries,
  active,
  onActive,
  onOpen,
}: {
  listId: string;
  groups: ChatProjectGroup[];
  entries: ChatEntry[];
  active: number;
  onActive: (index: number) => void;
  onOpen: (entry: ChatEntry) => void;
}) {
  useLocale();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);
  const indexOf = new Map(entries.map((entry, index) => [entry.id, index]));

  useEffect(() => {
    pointer.current.allow = false;
  }, [groups]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.clientX === pointer.current.x && event.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY, allow: true };
  };

  const rowProps = (id: string) => {
    const index = indexOf.get(id) ?? -1;
    const highlighted = index === active;
    return {
      highlighted,
      entry: entries[index],
      buttonProps: {
        id: `${listId}-option-${index}`,
        tabIndex: -1,
        ref: highlighted ? activeRef : undefined,
        role: "option" as const,
        "aria-selected": highlighted,
        onMouseDown: (event: ReactMouseEvent) => event.preventDefault(),
        onMouseEnter: () => {
          if (!pointer.current.allow) return;
          fromPointer.current = true;
          onActive(index);
        },
      },
    };
  };

  return (
    <div
      id={listId}
      role="listbox"
      aria-label={t("Chat search results")}
      onMouseMove={onMouseMove}
      className="pb-2"
    >
      {groups.map((group) => (
        <section key={group.key} aria-label={group.name} className="mb-1.5">
          <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-ui-micro font-medium text-(--ui-text-secondary)">
            <Folder className="icon-xs shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 break-words" title={group.cwd}>{group.name}</span>
            {group.groupName ? (
              <Badge size="sm" appearance="subtle" className="shrink-0">
                {group.groupName}
              </Badge>
            ) : null}
          </h3>
          <p className="px-2 pb-1 text-ui-caption text-(--ui-text-muted) [overflow-wrap:anywhere]">{group.cwd}</p>
          {group.sessions.map((session) => {
            const row = rowProps(session.id);
            const more = session.hitCount - session.hits.length;
            return (
              <div key={session.id}>
                <Button
                  variant="item"
                  motion="none"
                  fullWidth
                  selected={row.highlighted}
                  className="app-search-result @max-[560px]/search:flex-wrap"
                  type="button"
                  {...row.buttonProps}
                  title={`${session.title}\n${group.cwd}`}
                  onClick={() => row.entry && onOpen(row.entry)}
                >
                  <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
                  <span className="app-search-result-title min-w-0 flex-1">
                    <Marked text={session.title} ranges={session.titleRanges} />
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 @max-[560px]/search:basis-full @max-[560px]/search:ps-6">
                  {session.archived ? (
                    <Badge size="sm" appearance="subtle" className="shrink-0">
                      {t("Archived")}
                    </Badge>
                  ) : null}
                  {session.hitCount > 0 ? (
                    <span className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                      {session.hitCount === 1
                        ? t("1 match")
                        : t("{p0} matches", { p0: session.hitCount })}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
                    {formatChatDate(session.updatedAt)}
                  </span>
                  </span>
                </Button>
                {session.hits.map((hit) => {
                  const hitRow = rowProps(hit.id);
                  return (
                    <Button
                      variant="item"
                      motion="none"
                      fullWidth
                      selected={hitRow.highlighted}
                      className="app-search-result"
                      key={hit.id}
                      type="button"
                      {...hitRow.buttonProps}
                      title={hit.snippet}
                      onClick={() => hitRow.entry && onOpen(hitRow.entry)}
                    >
                      <MessageSquare
                        className="size-3 shrink-0 text-(--ui-text-secondary)"
                        strokeWidth={1.75}
                      />
                      <span className={`app-search-result-copy ${hitRow.highlighted ? "app-search-result-identity" : "app-search-result-preview"}`}>
                        <Marked text={hit.snippet} ranges={hit.ranges} />
                      </span>
                      <span className="app-search-chat-role shrink-0 text-ui-caption text-(--ui-text-secondary)">
                        {hit.role === "user" ? t("You") : hit.role}
                      </span>
                    </Button>
                  );
                })}
                {more > 0 ? (
                  <p className="ml-7 px-2 py-0.5 text-ui-caption text-(--ui-text-secondary)">
                    {more === 1 ? t("1 more match") : t("{p0} more matches", { p0: more })}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
