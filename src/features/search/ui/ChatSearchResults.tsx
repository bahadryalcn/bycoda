import { surfaceAttributes } from "../../../shared/ui/Surface";
import {
  actionContentAttributes,
  actionContentScopeAttributes,
} from "../../../shared/ui/ActionHost";
import { PickerListRoot } from "../../../shared/ui/picker/PickerList";
import { Text } from "../../../shared/ui/Text";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { terminalText } from "../../../shared/lib/terminalText";
import { MatchText, MAX_MATCH_POSITIONS } from "../../../shared/ui/MatchText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { ListRow } from "../../../shared/ui/ListRow";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Archive, Folder, MessageSquare, SlidersHorizontal } from "../../../shared/ui/icons";
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

const SCOPES: ChatScope[] = ["everywhere", "group", "project"];
function scopeLabel(scope: ChatScope): string {
  switch (scope) {
    case "everywhere":
      return t("Everywhere");
    case "group":
      return t("This group");
    case "project":
      return t("This project");
  }
}

const RANGES: ChatDateRange[] = ["any", "week", "month", "year"];
function rangeLabel(range: ChatDateRange): string {
  switch (range) {
    case "any":
      return t("Any time");
    case "week":
      return t("Past week");
    case "month":
      return t("Past month");
    case "year":
      return t("Past year");
  }
}

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
    <div className="app-search-filters">
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        tone="accent"
        label={t("Chat search filters")}
        selected={active}
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((value) => !value)}
      >
        <SlidersHorizontal className="icon-sm" />
        <span>{scopeLabel(filters.scope)}</span>
        {active ? <Badge variant="dot" tone="info" label={t("Filters active")} /> : null}
      </Button>
      {filterOpen ? (
        <Popover anchor={trigger} align="end" onDismiss={() => setFilterOpen(false)}>
          <div
            className="flex flex-col items-stretch gap-3 p-3"
            role="group"
            aria-label={t("Chat search filters")}
          >
            <Select
              label={t("Search in")}
              hideLabel
              fieldSize="sm"
              value={filters.scope}
              onValueChange={(scope) => onChange({ ...filters, scope: scope as ChatScope })}
              options={SCOPES.map((scope) => ({
                value: scope,
                label: scopeLabel(scope),
                disabled: scope === "group" && !inGroup,
              }))}
            />
            <Select
              label={t("Provider")}
              hideLabel
              fieldSize="sm"
              value={filters.harness}
              onValueChange={(harness) =>
                onChange({ ...filters, harness: harness as HarnessId | "any" })
              }
              options={[
                { value: "any", label: t("Any provider") },
                ...HARNESSES.map((harness) => ({
                  value: harness,
                  label: HARNESS_TITLE[harness],
                })),
              ]}
            />
            <Select
              label={t("Date")}
              hideLabel
              fieldSize="sm"
              value={filters.range}
              onValueChange={(range) => onChange({ ...filters, range: range as ChatDateRange })}
              options={RANGES.map((range) => ({
                value: range,
                label: rangeLabel(range),
              }))}
            />
            <Checkbox
              checked={filters.archived}
              onChange={(event) => onChange({ ...filters, archived: event.target.checked })}
              label={t("Archived")}
              size="secondary"
              tone="secondary"
              className="flex items-center gap-1.5"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={!active}
              disabledReason={t("No filters are set.")}
              onClick={() => onChange({ ...DEFAULT_CHAT_FILTERS })}
            >
              {t("Reset")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/** Searchable message roles only (`isSearchableRole`); each gets its translated name. */
function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return t("You");
    case "assistant":
      return t("Assistant");
    case "tool":
      return t("Tool");
    case "tasks":
      return t("Tasks");
    case "plan":
      return t("Plan");
    case "image":
      return t("Image");
    default:
      return role;
  }
}

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  useLocale();
  const positions: number[] = [];
  for (const [from, to] of ranges) {
    for (
      let index = Math.max(0, from);
      index < Math.min(to, text.length) && positions.length < MAX_MATCH_POSITIONS;
      index++
    ) {
      positions.push(index);
    }
    if (positions.length === MAX_MATCH_POSITIONS) break;
  }
  const clean = terminalText(text, positions);
  return <MatchText {...clean} active={clean.positions.length > 0} />;
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
    <PickerListRoot
      id={listId}
      label={t("Chat search results")}
      onMouseMove={onMouseMove}
      className="pb-2"
    >
      {groups.map((group, groupIndex) => (
        <section
          key={group.key}
          aria-label={group.name}
          {...surfaceAttributes(
            groupIndex > 0 ? { frame: "pane", edge: "block-start" } : {},
            "app-search-project",
          )}
        >
          <SectionLabel
            as="h3"
            className="app-search-project-heading"
            classNames={{ label: "app-search-project-label" }}
          >
            <Folder className="icon-xs shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 break-words">{group.name}</span>
            {group.groupName ? (
              <Badge size="sm" appearance="subtle" className="shrink-0">
                {group.groupName}
              </Badge>
            ) : null}
          </SectionLabel>
          <Text
            as="p"
            size="caption"
            tone="muted"
            leading="inherit"
            truncate
            className="app-search-project-path"
          >
            {group.cwd}
          </Text>
          {group.sessions.map((session, sessionIndex) => {
            const row = rowProps(session.id);
            const more = session.hitCount - session.hits.length;
            return (
              <div
                key={session.id}
                {...surfaceAttributes(
                  sessionIndex > 0 ? { frame: "pane", edge: "block-start" } : {},
                  "app-search-conversation",
                )}
              >
                <ListRow
                  selected={row.highlighted}
                  {...actionContentScopeAttributes()}
                  className="app-search-result app-search-conversation-row @max-[560px]/search:flex-wrap"
                  {...row.buttonProps}
                  onClick={() => row.entry && onOpen(row.entry)}
                >
                  <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
                  <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="medium"
                    leading="inherit"
                    truncate
                    {...actionContentAttributes(
                      { phase: "always", reveal: "wrap" },
                      "app-search-result-title min-w-0 flex-1",
                    )}
                  >
                    <Marked text={session.title} ranges={session.titleRanges} />
                  </Text>
                  <span className="flex flex-wrap items-center gap-1.5 @max-[560px]/search:basis-full @max-[560px]/search:ps-6">
                    {session.archived ? (
                      <Tooltip asChild label={t("Archived")}>
                        <span
                          role="img"
                          aria-label={t("Archived conversation")}
                          className="shrink-0"
                        >
                          <Archive className="icon-sm" />
                        </span>
                      </Tooltip>
                    ) : null}
                    {session.hitCount > 0 ? (
                      <Text size="caption" tone="secondary" className="shrink-0 tabular-nums">
                        {session.hitCount === 1
                          ? t("1 match")
                          : t("{p0} matches", { p0: session.hitCount })}
                      </Text>
                    ) : null}
                    <Text size="caption" tone="secondary" className="shrink-0">
                      {formatChatDate(session.updatedAt)}
                    </Text>
                  </span>
                </ListRow>
                {session.hits.map((hit) => {
                  const hitRow = rowProps(hit.id);
                  return (
                    <ListRow
                      selected={hitRow.highlighted}
                      {...actionContentScopeAttributes()}
                      className="app-search-result app-search-match"
                      key={hit.id}
                      {...hitRow.buttonProps}
                      onClick={() => hitRow.entry && onOpen(hitRow.entry)}
                    >
                      <MessageSquare
                        className="icon-xs shrink-0"
                        tone="secondary"
                        strokeWidth={1.75}
                      />
                      <Text
                        size="caption"
                        tone="secondary"
                        leading="inherit"
                        {...actionContentAttributes({
                          phase: "always",
                          reveal: "preview",
                        })}
                        {...motionAttributes(
                          { transition: "size", duration: "standard" },
                          actionContentAttributes(
                            { phase: "always", reveal: "preview" },
                            "app-search-match-excerpt",
                          ).className,
                        )}
                      >
                        <Marked text={hit.snippet} ranges={hit.ranges} />
                      </Text>
                      <Text size="micro" tone="muted" className="shrink-0">
                        {roleLabel(hit.role)}
                      </Text>
                    </ListRow>
                  );
                })}
                {more > 0 ? (
                  <Text
                    as="p"
                    size="caption"
                    tone="muted"
                    leading="inherit"
                    className="app-search-more"
                  >
                    {more === 1 ? t("1 more match") : t("{p0} more matches", { p0: more })}
                  </Text>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </PickerListRoot>
  );
}
