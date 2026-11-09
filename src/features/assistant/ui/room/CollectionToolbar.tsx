import noteStyles from "../AssistantNoteCard.module.css";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Select } from "../../../../shared/ui/Select";
import { Popover } from "../../../../shared/ui/Popover";
import { FilterTrigger } from "../../../../shared/ui/FilterTrigger";
import { Plus } from "../../../../shared/ui/icons";
import styles from "../AssistantView.module.css";
import toolbar from "./CollectionToolbar.module.css";
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
  if (filter && !statusValues.includes(filter)) statusValues.push(filter);
  const activeFilters =
    (filter ? 1 : 0) +
    (view === "Jobs" ? (jobProjectFilter ? 1 : 0) + (jobDateFilter !== "all" ? 1 : 0) : 0);

  return (
    <>
      {view !== "Today" && view !== "Memory" && view !== "Conversations" && (
        <div className={`${styles.collectionTools} ${view === "Notes" ? noteStyles.toolbar : ""}`}>
          {view === "Notes" && (
            <h2>
              {t("Notes")}{" "}
              <span>
                {snapshot.notes.filter((note) => matches(query, note.title, note.body)).length}
              </span>
            </h2>
          )}
          {view === "Jobs" && (
            <h2 className={styles.jobsTitle}>
              {t("Jobs")} <span>{allJobs.length}</span>
            </h2>
          )}
          <SearchInput
            type="search"
            value={query}
            aria-label={t("Search this section")}
            placeholder={t(view === "Sessions" ? "Search sessions" : "Search")}
            appearance="field"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {view === "Notes" && (
            <>
              <Button
                loading={pending?.key === "notes.summary"}
                disabled={Boolean(pending) || !environmentId}
                onClick={() => {
                  const sourceEnvironment = environmentId,
                    scopeKey = privacy.key;
                  const now = new Date(),
                    day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                  run("notes.summary", t("Preparing briefing..."), async () => {
                    if (!sourceEnvironment)
                      throw new Error(
                        "The original Host could not be verified. Keep this draft and reconnect its original computer.",
                      );
                    const response = await assistantRequest(
                      { op: "briefing.daily", day },
                      sourceEnvironment,
                    );
                    if (scopeKey !== visibility.current.privacy.key) return;
                    if (!response.snapshot)
                      throw new Error(
                        "Daily summary was not confirmed. Retry on its original computer.",
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
                onClick={() => setNoteEdit("new")}
              >
                {t("New note")}
              </Button>
            </>
          )}
          {view === "History" && (
            <Button disabled={!snapshot.activity.length} onClick={clearHistory}>
              {t("Clear history")}
            </Button>
          )}
          {["Jobs", "History", "Sessions"].includes(view) && (
            <FilterTrigger
              label={t("Filter")}
              activeCount={activeFilters}
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
          aria-label={t("Filter")}
        >
          <div className={toolbar.panel}>
            <div className={toolbar.fields}>
              <Select
                label={t(view === "History" ? "Type" : "Status")}
                value={filter}
                options={[
                  { value: "", label: t("All") },
                  ...statusValues.map((value) => ({
                    value,
                    label:
                      view === "History"
                        ? t(value)
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
            <div className={toolbar.footer}>
              <Button
                variant="ghost"
                disabled={!activeFilters}
                onClick={() => {
                  setFilter("");
                  if (view === "Jobs") {
                    setJobProjectFilter("");
                    setJobDateFilter("all");
                  }
                  setFilterAnchor(null);
                }}
              >
                {t("Reset")}
              </Button>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
