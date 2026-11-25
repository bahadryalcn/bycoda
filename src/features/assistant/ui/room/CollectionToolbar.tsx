import { Heading } from "../../../../shared/ui/Heading";
import { Text } from "../../../../shared/ui/Text";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Select } from "../../../../shared/ui/Select";
import { Popover } from "../../../../shared/ui/Popover";
import { FilterTrigger } from "../../../../shared/ui/FilterTrigger";
import { Plus, Sparkles, Trash2 } from "../../../../shared/ui/icons";
import styles from "../AssistantView.module.css";
import toolbar from "./CollectionToolbar.module.css";
import { assistantActivityLabel } from "../AssistantHistory";
import { statusLabel, matches } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";

export function CollectionToolbar({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    projects,
    privacy,
    visibility,
    view,
    query,
    setQuery,
    filter,
    setFilter,
    jobProjectFilter,
    setJobProjectFilter,
    jobDateFilter,
    setJobDateFilter,
    setDailySummary,
    filterAnchor,
    setFilterAnchor,
    pending,
    setNoteEdit,
    run,
    allJobs,
    clearHistory,
  } = room;

  // Only the statuses this tab can show: Sessions lists jobs that started sessions, Jobs lists all.
  const statusValues = [
    ...new Set(
      view === "History"
        ? snapshot.activity.map((item) => item.kind as string)
        : (view === "Sessions"
            ? snapshot.jobs.filter((job) => job.sessionIds.length)
            : snapshot.jobs
          ).map((job) => job.status as string),
    ),
  ];
  if (
    filter &&
    !statusValues.includes(filter) &&
    !(view === "Jobs" && (filter === "working" || filter === "doneToday"))
  )
    statusValues.push(filter);
  const activeFilters =
    (filter ? 1 : 0) +
    (view === "Jobs" ? (jobProjectFilter ? 1 : 0) + (jobDateFilter !== "all" ? 1 : 0) : 0);

  // One title row for every collection tab: name and count left, tools right.
  const count =
    view === "Notes"
      ? snapshot.notes.filter((note) => matches(query, note.title, note.body)).length
      : view === "Jobs"
        ? allJobs.length
        : view === "History"
          ? snapshot.activity.length
          : undefined;

  return (
    <>
      {view !== "Today" && view !== "Memory" && view !== "Conversations" && (
        <div className={styles.collectionTools}>
          <Heading size="page" level={2} className={styles.pageTitle}>
            {view === "History"
              ? t("History")
              : view === "Notes"
                ? t("Notes")
                : view === "Sessions"
                  ? t("Sessions")
                  : t("Jobs")}
            {count !== undefined && (
              <span className={styles.collectionCount}>
                <Text weight="regular" tone="muted" leading="inherit">
                  {count}
                </Text>
              </span>
            )}
          </Heading>
          <SearchInput
            type="search"
            value={query}
            aria-label={t("Search this section")}
            placeholder={view === "Sessions" ? t("Search sessions") : t("Search")}
            appearance="field"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {view === "Notes" && (
            <>
              <Button
                startIcon={<Sparkles className="icon-sm" />}
                loading={pending?.key === "notes.summary"}
                disabled={Boolean(pending) || !environmentId}
                disabledReason={
                  pending
                    ? t("Wait for the current action to finish.")
                    : !environmentId
                      ? t("The assistant's computer is not connected.")
                      : undefined
                }
                onClick={() => {
                  const sourceEnvironment = environmentId,
                    scopeKey = privacy.key;
                  const now = new Date(),
                    day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                  run("notes.summary", t("Preparing briefing…"), async () => {
                    if (!sourceEnvironment)
                      throw new Error(
                        t(
                          "The original computer could not be verified. Keep this draft and reconnect that computer.",
                        ),
                      );
                    const response = await assistantRequest(
                      { op: "briefing.daily", day },
                      sourceEnvironment,
                    );
                    if (scopeKey !== visibility.current.privacy.key) return;
                    if (!response.snapshot)
                      throw new Error(
                        t("Daily summary could not be confirmed. Retry on its original computer."),
                      );
                    setDailySummary({
                      snapshot: response.snapshot,
                      environmentId: sourceEnvironment,
                      scopeKey,
                      day,
                    });
                  });
                }}
              >
                {t("Summarize today")}
              </Button>
              <Button
                variant="primary"
                startIcon={<Plus className="icon-sm" />}
                disabled={!snapshot.capabilities.notes}
                disabledReason={
                  snapshot.capabilities.notes
                    ? undefined
                    : t("Notes are not available on this computer.")
                }
                onClick={() => setNoteEdit("new")}
              >
                {t("New note")}
              </Button>
            </>
          )}
          {view === "History" && (
            <Button
              iconOnly
              variant="ghost"
              label={t("Clear history")}
              disabled={!snapshot.activity.length}
              onClick={clearHistory}
            >
              <Trash2 className="icon-sm" />
            </Button>
          )}
          {["Jobs", "History", "Sessions"].includes(view) && (
            <FilterTrigger
              label={t("Filter")}
              activeCount={activeFilters}
              aria-haspopup="dialog"
              aria-expanded={Boolean(filterAnchor)}
              onReset={() => {
                setFilter("");
                if (view === "Jobs") {
                  setJobProjectFilter("");
                  setJobDateFilter("all");
                }
              }}
              onClick={(event) => setFilterAnchor(event.currentTarget)}
            />
          )}
        </div>
      )}
      {filterAnchor && (
        <Popover
          anchor={filterAnchor}
          onDismiss={() => setFilterAnchor(null)}
          kind="dialog"
          flow="scroll"
          aria-label={t("Filter")}
          variant="panel"
        >
          <div className={toolbar.panel}>
            <div className={toolbar.fields}>
              <Select
                label={view === "History" ? t("Type") : t("Status")}
                value={filter}
                options={[
                  { value: "", label: t("All") },
                  ...(view === "Jobs"
                    ? [
                        { value: "working", label: t("Working") },
                        { value: "doneToday", label: t("Done today") },
                      ]
                    : []),
                  ...statusValues.map((value) => ({
                    value,
                    label:
                      view === "History"
                        ? assistantActivityLabel(value)
                        : statusLabel(value as Parameters<typeof statusLabel>[0]),
                  })),
                ]}
                onValueChange={setFilter}
              />
              {view === "Jobs" && (
                <>
                  <SearchableSelect
                    label={t("Project")}
                    value={jobProjectFilter}
                    options={[
                      { value: "", label: t("All projects") },
                      ...projects.map((project) => ({
                        value: project.id ?? project.path,
                        label: project.name,
                      })),
                    ]}
                    onChange={setJobProjectFilter}
                  />
                  <Select
                    label={t("Created")}
                    value={jobDateFilter}
                    options={[
                      { value: "all", label: t("All dates") },
                      { value: "today", label: t("Today") },
                      { value: "week", label: t("Last 7 days") },
                    ]}
                    onValueChange={setJobDateFilter}
                  />
                </>
              )}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
