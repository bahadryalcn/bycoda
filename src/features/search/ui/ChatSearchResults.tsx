import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Folder, MessageSquare } from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import {
  formatChatDate,
  highlightRuns,
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

const SELECT_CLASS =
  "h-6 max-w-[9.5rem] rounded-md border border-stroke bg-background-base px-1.5 text-[12px] text-content outline-none focus-visible:border-accent";

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
  return (
    <div
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-3 py-1"
      role="group"
      aria-label={t("Chat search filters")}
    >
      <select
        aria-label={t("Search in")}
        value={filters.scope}
        onChange={(event) => onChange({ ...filters, scope: event.target.value as ChatScope })}
        className={SELECT_CLASS}
      >
        {(Object.keys(SCOPE_LABEL) as ChatScope[]).map((scope) => (
          <option key={scope} value={scope} disabled={scope === "group" && !inGroup}>
            {SCOPE_LABEL[scope]}
          </option>
        ))}
      </select>
      <select
        aria-label={t("Provider")}
        value={filters.harness}
        onChange={(event) =>
          onChange({
            ...filters,
            harness: event.target.value as HarnessId | "any",
          })
        }
        className={SELECT_CLASS}
      >
        <option value="any">{t("Any provider")}</option>
        {HARNESSES.map((harness) => (
          <option key={harness} value={harness}>
            {HARNESS_TITLE[harness]}
          </option>
        ))}
      </select>
      <select
        aria-label={t("Date")}
        value={filters.range}
        onChange={(event) => onChange({ ...filters, range: event.target.value as ChatDateRange })}
        className={SELECT_CLASS}
      >
        {(Object.keys(RANGE_LABEL) as ChatDateRange[]).map((range) => (
          <option key={range} value={range}>
            {RANGE_LABEL[range]}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-[12px] text-content/60">
        <input
          type="checkbox"
          checked={filters.archived}
          onChange={(event) => onChange({ ...filters, archived: event.target.checked })}
          className="size-3"
        />
        {t("Archived")}
      </label>
    </div>
  );
}

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  useLocale();
  return (
    <>
      {highlightRuns(text, ranges).map((run, index) =>
        run.match ? (
          <mark key={index} className="bg-transparent font-medium text-accent">
            {run.text}
          </mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

export function ChatSearchResults({
  groups,
  entries,
  active,
  onActive,
  onOpen,
}: {
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
      role="listbox"
      aria-label={t("Chat search results")}
      onMouseMove={onMouseMove}
      className="pb-2"
    >
      {groups.map((group) => (
        <section key={group.key} aria-label={group.name} className="mb-1.5">
          <h3 className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-medium text-content/45">
            <Folder className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{group.name}</span>
            {group.groupName ? (
              <span className="shrink-0 rounded bg-content/8 px-1 py-px text-[10px] text-content/55">
                {group.groupName}
              </span>
            ) : null}
          </h3>
          {group.sessions.map((session) => {
            const row = rowProps(session.id);
            const more = session.hitCount - session.hits.length;
            return (
              <div key={session.id}>
                <button
                  type="button"
                  {...row.buttonProps}
                  onClick={() => row.entry && onOpen(row.entry)}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-none text-content ${
                    row.highlighted ? "bg-selection" : ""
                  }`}
                >
                  <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    <Marked text={session.title} ranges={session.titleRanges} />
                  </span>
                  {session.archived ? (
                    <span className="shrink-0 rounded bg-content/8 px-1 py-px text-[10px] text-content/55">
                      {t("Archived")}
                    </span>
                  ) : null}
                  {session.hitCount > 0 ? (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-content/45">
                      {session.hitCount === 1
                        ? t("1 match")
                        : t("{p0} matches", { p0: session.hitCount })}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[11px] text-content/35">
                    {formatChatDate(session.updatedAt)}
                  </span>
                </button>
                {session.hits.map((hit) => {
                  const hitRow = rowProps(hit.id);
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      {...hitRow.buttonProps}
                      onClick={() => hitRow.entry && onOpen(hitRow.entry)}
                      className={`ml-5 flex h-7 w-[calc(100%-1.25rem)] items-center gap-2 rounded-md px-2 text-left text-[12px] leading-none ${
                        hitRow.highlighted ? "bg-selection text-content" : "text-content/70"
                      }`}
                    >
                      <MessageSquare
                        className="size-3 shrink-0 text-content/40"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <Marked text={hit.snippet} ranges={hit.ranges} />
                      </span>
                      <span className="shrink-0 text-[10px] text-content/35">
                        {hit.role === "user" ? t("You") : hit.role}
                      </span>
                    </button>
                  );
                })}
                {more > 0 ? (
                  <p className="ml-7 px-2 py-0.5 text-[11px] text-content/40">
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
