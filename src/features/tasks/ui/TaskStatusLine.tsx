import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { CheckCircle, CircleAlert, CircleDashed, CircleDot, CircleX } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import type { HostTask, TaskOwnerNotice } from "../model/hostTasks";
import {
  finishedOwnerNotices,
  type TaskStatusLine,
  type TaskStatusTone,
} from "../model/taskStatusLine";

const TONE_TEXT: Record<TaskStatusTone, string> = {
  neutral: "text-(--ui-text-secondary)",
  info: "text-(--ui-tone-info-fg)",
  success: "text-(--ui-tone-success-fg)",
  warning: "text-(--ui-tone-warning-fg)",
  danger: "text-(--ui-tone-danger-fg)",
};
const TONE_ICON = {
  neutral: CircleDashed,
  info: CircleDot,
  success: CheckCircle,
  warning: CircleAlert,
  danger: CircleX,
} as const;

/** The task's one-line state: tone glyph, label and a clamped reason. With
 * `onOpen`, the whole line opens the full details. */
export function TaskStatusText({
  status,
  onOpen,
  className = "",
}: {
  status: TaskStatusLine;
  onOpen?: () => void;
  className?: string;
}) {
  useLocale();
  const Icon = TONE_ICON[status.tone];
  const content = (
    <>
      <Icon aria-hidden="true" className="icon-xs me-1 inline-block shrink-0 align-[-0.125em]" />
      <span className="font-medium">{status.label}</span>
      {status.detail ? (
        <span className="text-(--ui-text-secondary)">
          {" · "}
          {status.detail}
        </span>
      ) : null}
    </>
  );
  const shared = `line-clamp-2 break-words text-start text-ui-micro ${TONE_TEXT[status.tone]} ${className}`;
  return onOpen ? (
    <Button
      variant="link"
      layout="text"
      align="start"
      data-no-drag=""
      data-task-status-line={status.kind}
      title={t("Show details")}
      className={shared}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <span className="line-clamp-2">{content}</span>
    </Button>
  ) : (
    <p data-task-status-line={status.kind} className={shared}>
      {content}
    </p>
  );
}

const NOTICE_GROUPS: readonly { kind: TaskOwnerNotice["kind"]; label: () => string }[] = [
  { kind: "remaining_finding", label: () => t("Open findings") },
  { kind: "external_check", label: () => t("Check yourself") },
  { kind: "auto_continued", label: () => t("Continued automatically") },
  { kind: "info", label: () => t("Notes") },
];

/** What the owner should know once a finished task is handed over. */
export function TaskOwnerNotices({ task }: { task: HostTask }) {
  useLocale();
  const notices = finishedOwnerNotices(task);
  if (notices.length === 0 && !(task.completedWithFindings && ["review", "done"].includes(task.status)))
    return null;
  return (
    <section
      aria-label={t("What you should know")}
      data-task-owner-notices
      className="space-y-1.5 rounded-(--ui-radius-card) bg-(--ui-surface-raised) px-3 py-2 text-ui-caption"
    >
      <h3 className="font-medium text-(--ui-tone-neutral-fg)">{t("What you should know")}</h3>
      {task.completedWithFindings ? (
        <p className="text-(--ui-tone-warning-fg)">
          {t("Completed after automatic correction ran out; the review did not pass.")}
        </p>
      ) : null}
      {NOTICE_GROUPS.map((group) => {
        const rows = notices.filter((notice) => notice.kind === group.kind);
        if (rows.length === 0) return null;
        return (
          <div key={group.kind} className="space-y-0.5">
            <p className="text-ui-micro text-(--ui-text-muted)">{group.label()}</p>
            <ul className="space-y-0.5">
              {rows.map((notice) => (
                <li
                  key={notice.id}
                  title={notice.message}
                  className="line-clamp-2 break-words text-(--ui-text-secondary)"
                >
                  {notice.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** Agent-written markdown, clamped to a few lines with an explicit disclosure. */
export function ClampedMarkdown({
  text,
  extra,
  collapsedExtra,
  long,
}: {
  text: string;
  /** Shown under the markdown while expanded. */
  extra?: ReactNode;
  /** Shown under the markdown while collapsed. */
  collapsedExtra?: ReactNode;
  /** Force the disclosure even when the markdown itself is short. */
  long?: boolean;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const overflows = long || text.length > 280 || text.split("\n").filter(Boolean).length > 4;
  return (
    <div className="min-w-0">
      <div
        data-clamped={(!expanded && overflows) || undefined}
        className={`min-w-0 text-ui-caption text-(--ui-text-secondary) ${!expanded && overflows ? "task-clamped-markdown" : ""}`}
      >
        <AgentMarkdown text={text} allowRemoteMedia={false} className="task-summary-md" />
      </div>
      {expanded ? extra : collapsedExtra}
      {overflows ? (
        <Button
          motion="none"
          variant="ghost"
          size="sm"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("Show less") : t("Show more")}
        </Button>
      ) : null}
    </div>
  );
}

/** The last line of `git diff --stat`, such as "3 files changed, 20 insertions(+)". */
export function diffStatSummary(diffStat: string | undefined): string | undefined {
  const lines = diffStat?.trim().split("\n") ?? [];
  const last = lines[lines.length - 1]?.trim();
  return last && /changed/.test(last) ? last : undefined;
}

/** The latest worker summary, as the "what was done" claim for a finished task. */
export function latestWorkerSummary(task: HostTask): string | undefined {
  const history = task.attemptHistory ?? [];
  for (let index = history.length - 1; index >= 0; index--) {
    const summary = history[index].workerSummary?.trim();
    if (summary) return summary;
  }
  return undefined;
}

export function TaskOutcomeSummary({ task }: { task: HostTask }) {
  useLocale();
  if (task.status !== "review" && task.status !== "done") return null;
  const summary = latestWorkerSummary(task);
  const diff = diffStatSummary(task.diffStat);
  if (!summary && !diff) return null;
  return (
    <section aria-label={t("What was done")} data-task-outcome className="space-y-1">
      <h3 className="text-ui-caption font-medium text-(--ui-tone-neutral-fg)">
        {t("What was done")}
      </h3>
      {summary ? <ClampedMarkdown text={summary} /> : null}
      {diff ? (
        <p className="font-mono text-ui-micro text-(--ui-text-muted)">{diff}</p>
      ) : null}
    </section>
  );
}

