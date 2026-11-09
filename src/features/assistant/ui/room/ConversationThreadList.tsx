import { formatDate, t } from "../../../../shared/i18n";
import { formatRelativeTime } from "../../../../shared/i18n/format";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Plus } from "../../../../shared/ui/icons";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { Skeleton } from "../../../../shared/ui/Skeleton";
import { Select } from "../../../../shared/ui/Select";
import { useAssistantRoom } from "./assistantRoomContext";
import styles from "./Conversation.module.css";
import type { ConversationContext } from "./ConversationTypes";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Relative for the last week ("5 min. ago"), a short date after that. */
function threadTime(at: number) {
  return Date.now() - at < WEEK
    ? formatRelativeTime(at, { style: "short" })
    : formatDate(at, { dateStyle: "medium" });
}

export function ConversationThreadList({
  c,
  onFailure,
}: {
  c: ConversationContext;
  onFailure: (cause: unknown) => void;
}) {
  const { setQuery } = useAssistantRoom();
  const {
    snapshot,
    projects,
    scope,
    setScope,
    project,
    setProject,
    threadId,
    setThreadId,
    clearing,
    pending,
    summaryRefreshing,
    sessionId,
    query,
    open,
  } = c;
  const threads = [...snapshot.threads].sort(
    (a, b) =>
      Number(Boolean(a.projectId)) - Number(Boolean(b.projectId)) || b.updatedAt - a.updatedAt,
  );
  return (
    <aside className={styles.threadList} aria-label={t("Conversations")}>
      <div className={styles.listTools}>
        <Select
          hideLabel
          label={t("Scope")}
          value={scope}
          disabled={clearing}
          options={[
            ["global", "Global"],
            ["project", "Project"],
            ["session", "Session focus"],
          ].map(([value, label]) => ({ value, label: t(label) }))}
          onValueChange={setScope}
        />
        {scope !== "global" && (
          <SearchableSelect
            hideLabel
            label={t("Project")}
            value={projects.some((item) => (item.id ?? item.path) === project) ? project : ""}
            disabled={clearing || summaryRefreshing}
            options={projects.map((item) => ({
              value: item.id ?? item.path,
              label: item.name,
              description: item.path,
            }))}
            onChange={setProject}
          />
        )}
        <div className={styles.listSearch}>
          <SearchInput
            type="search"
            appearance="field"
            value={query}
            aria-label={t("Search this section")}
            placeholder={t("Search")}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button
            iconOnly
            label={t("Open conversation")}
            disabled={
              pending ||
              clearing ||
              summaryRefreshing ||
              (scope !== "global" && !project) ||
              (scope === "session" && !sessionId)
            }
            onClick={() => void open().catch(onFailure)}
          >
            <Plus className="icon-sm" />
          </Button>
        </div>
      </div>
      <div className={styles.threads}>
        {!threads.length && pending && (
          <div className={styles.threadSkeleton}>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className={styles.threadSkeletonRow}>
                <Skeleton inline width="100%" aria-hidden />
                <Skeleton inline width="2.25rem" aria-hidden />
              </div>
            ))}
          </div>
        )}
        {threads.map((thread) => {
          const projectName = thread.projectId
            ? (projects.find((item) => (item.id ?? item.path) === thread.projectId)?.name ??
              thread.projectId)
            : "";
          return (
            <Button
              key={thread.id}
              variant="item"
              selected={threadId === thread.id}
              disabled={clearing || summaryRefreshing}
              onClick={() => setThreadId(thread.id)}
            >
              <span className={styles.threadRow}>
                <span className={styles.threadTop}>
                  <span className={styles.threadName}>{projectName || t("Global")}</span>
                  {thread.projectId && <Badge size="xs">{t("Project")}</Badge>}
                  <span className={styles.threadTime}>{threadTime(thread.updatedAt)}</span>
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
