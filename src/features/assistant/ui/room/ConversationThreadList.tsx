import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { formatRelativeTime } from "../../../../shared/i18n/format";
import { Button } from "../../../../shared/ui/Button";
import { Plus } from "../../../../shared/ui/icons";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { SkeletonList } from "../../../../shared/ui/SkeletonList";
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
  onShowTranscript,
}: {
  c: ConversationContext;
  onFailure: (cause: unknown) => void;
  onShowTranscript: () => void;
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
  const openDisabledReason =
    scope !== "global" && !project
      ? t("Select a project to open a conversation.")
      : scope === "session" && !sessionId
        ? t("Select a session to open a conversation.")
        : undefined;
  return (
    <aside
      {...surfaceAttributes({ frame: "pane", edge: "inline-end" }, styles.threadList)}
      aria-label={t("Conversations")}
    >
      <div className={styles.listTools}>
        <Select
          hideLabel
          label={t("Scope")}
          value={scope}
          disabled={clearing}
          options={[
            { value: "global", label: t("Global") },
            { value: "project", label: t("Project") },
            { value: "session", label: t("Session focus") },
          ]}
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
            disabled={pending || clearing || summaryRefreshing || !!openDisabledReason}
            disabledReason={openDisabledReason}
            onClick={() => void open(onShowTranscript).catch(onFailure)}
          >
            <Plus className="icon-sm" />
          </Button>
        </div>
        {query.trim() && (
          <div className={styles.narrowAction}>
            <Button variant="secondary" onClick={onShowTranscript}>
              {t("Show search results")}
            </Button>
          </div>
        )}
      </div>
      <div className={styles.threads}>
        {!threads.length && pending && (
          <div className={styles.threadSkeleton}>
            <SkeletonList rows={4} lines={1} trailing="text" density="compact" seed={3} />
          </div>
        )}
        {!threads.length && !pending && (
          <EmptyState size="inline" description={t("No conversations yet.")} />
        )}
        {threads.map((thread) => {
          const projectName = thread.projectId
            ? (projects.find((item) => (item.id ?? item.path) === thread.projectId)?.name ??
              thread.projectId)
            : "";
          const scopeName = projectName || t("Global");
          return (
            <Button
              key={thread.id}
              variant="item"
              selected={threadId === thread.id}
              disabled={clearing || summaryRefreshing}
              disabledReason={t("Wait for the current action to finish.")}
              onClick={() => {
                setThreadId(thread.id);
                onShowTranscript();
              }}
            >
              <span className={styles.threadTop}>
                <Text
                  as="span"
                  size="body"
                  tone="inherit"
                  weight="medium"
                  leading="inherit"
                  truncate
                  className={styles.threadName}
                >
                  {thread.purpose === "job-planning"
                    ? t("Job planning · {p0}", { p0: scopeName })
                    : scopeName}
                </Text>
                <Text size="micro" tone="muted" leading="inherit" className={styles.threadTime}>
                  {threadTime(thread.updatedAt)}
                </Text>
              </span>
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
