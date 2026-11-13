import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ClampText } from "../../../shared/ui/ClampText";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { Search } from "../../../shared/ui/icons";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewRunView } from "../model/crewClient";
import { crewRunTitle } from "../model/crewRoster";
import { CrewWorkStatusText, CrewWorkUpdated, crewQuietProgress } from "./CrewWorkState";

export type CrewWorkView = "ongoing" | "finished";

/**
 * Searchable list of one crew's work. It filters only the loaded runs and shows
 * their count; older finished runs are loaded explicitly. Selection and filter belong to the owner so a
 * poll never resets them.
 */
export function CrewWorkList({
  view,
  ongoingCount,
  runs,
  listedCount,
  query,
  selectedId,
  disabled,
  onViewChange,
  onQueryChange,
  onSelect,
  hasMoreHistory,
  historyLoading,
  historyError,
  onLoadMore,
}: {
  view: CrewWorkView;
  ongoingCount: number;
  /** Runs of the current view that match the filter. */
  runs: CrewRunView[];
  /** Runs of the current view before filtering. */
  listedCount: number;
  query: string;
  selectedId?: string;
  disabled: boolean;
  onViewChange: (view: CrewWorkView) => void;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  hasMoreHistory?: boolean;
  historyLoading?: boolean;
  historyError?: string;
  onLoadMore?: () => void;
}) {
  useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  // Opening a work that sits below the fold keeps it visible in the list.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-crew-work-choice="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  // Selection resolves from the unfiltered view, so the detail can show work the
  // search hides; say so instead of leaving an unexplained gap.
  const selectedHidden =
    !!selectedId && !!query.trim() && !runs.some((run) => run.id === selectedId);
  return (
    <nav
      aria-label={t("Crew work")}
      {...surfaceAttributes({ variant: "transparent" }, "flex min-w-0 flex-col")}
    >
      <div className="flex flex-col gap-2 px-3 pb-2 pt-3">
        <SegmentedControl
          label={t("Crew work view")}
          value={view}
          options={[
            { value: "ongoing", label: t("Ongoing ({p0})", { p0: ongoingCount }) },
            { value: "finished", label: t("Finished") },
          ]}
          onValueChange={(value) => onViewChange(value === "finished" ? "finished" : "ongoing")}
        />
        <SearchInputGroup appearance="field">
          <Search className="icon-sm shrink-0" aria-hidden="true" />
          <SearchInput
            focusOwner="group"
            aria-label={t("Search crew work")}
            placeholder={t("Search crew work")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </SearchInputGroup>
        {selectedHidden ? (
          <Text as="p" className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
            <span className="min-w-0">{t("The selected work is hidden by the search.")}</span>
            <Button variant="ghost" size="sm" onClick={() => onQueryChange("")}>
              {t("Clear search")}
            </Button>
          </Text>
        ) : null}
      </div>
      <div
        ref={listRef}
        className="overflow-y-auto px-2 pb-2 @min-[640px]/crew-management:max-h-[55vh]"
        role="list"
        aria-label={t("Work list")}
      >
        {runs.map((run) => (
          <div key={run.id} role="listitem">
            <Button
              variant="item"
              data-crew-work-choice={run.id}
              selected={selectedId === run.id}
              motion="none"
              className="w-full min-w-0"
              aria-pressed={selectedId === run.id}
              disabled={disabled}
              onClick={() => onSelect(run.id)}
              tooltip={crewRunTitle(run)}
              tooltipWhen="overflow"
            >
              <span className="min-w-0 flex-1 text-start">
                <ClampText
                  as="span"
                  lines={2}
                  expandable={false}
                  size="inherit"
                  tone="inherit"
                  weight="medium"
                  className="block break-words"
                >
                  {crewRunTitle(run)}
                </ClampText>
                <Text className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <CrewWorkStatusText run={run} />
                  {crewQuietProgress(run) ? (
                    <span className="tabular-nums">{crewQuietProgress(run)}</span>
                  ) : null}
                  <CrewWorkUpdated value={run.updatedAt} />
                </Text>
              </span>
            </Button>
          </div>
        ))}
        {!runs.length ? (
          <Text as="p" className="px-2 py-3">
            {query.trim() && listedCount
              ? t("No matching crew work.")
              : view === "ongoing"
                ? t("No ongoing crew work.")
                : t("No finished crew work.")}
          </Text>
        ) : null}
        {view === "finished" && hasMoreHistory ? (
          <CollectionFooter
            standalone
            hasMore
            onLoadMore={onLoadMore}
            loadMoreButtonProps={{ disabled: disabled || historyLoading }}
            loadMoreLabel={
              historyLoading
                ? t("Loading…")
                : historyError
                  ? t("Retry loading older work")
                  : t("Load older work")
            }
          />
        ) : null}
      </div>
    </nav>
  );
}
