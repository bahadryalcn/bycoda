import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { ClampText } from "../../../shared/ui/ClampText";
import { Surface } from "../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import type { HostTask, TaskOwnerNotice } from "../model/hostTasks";
import { finishedOwnerNotices, type TaskStatusLine } from "../model/taskStatusLine";

/** The task's one-line state: tone glyph, label and a clamped reason. With
 * `onOpen`, the whole line opens the full details. */
export function TaskStatusText({
  status,
  onOpen,
}: {
  status: TaskStatusLine;
  onOpen?: () => void;
}) {
  useLocale();
  const content = (
    <>
      <StatusDot tone={status.tone} label={status.label} className="me-1 inline-block" />
      <Text weight="medium" size="inherit" tone="inherit">
        {status.label}
      </Text>
      {status.detail ? (
        <Text tone="secondary" size="inherit">
          {" · "}
          {status.detail}
        </Text>
      ) : null}
    </>
  );
  return onOpen ? (
    <Button
      variant="link"
      layout="text"
      align="start"
      data-no-drag=""
      data-task-status-line={status.kind}
      tooltip={t("Show details")}
      lines={2}
      className="break-words text-start"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <ClampText as="span" lines={2} expandable={false} size="micro" tone="secondary">
        {content}
      </ClampText>
    </Button>
  ) : (
    <ClampText
      as="p"
      lines={2}
      expandable={false}
      size="micro"
      tone="secondary"
      data-task-status-line={status.kind}
      className="break-words text-start"
    >
      {content}
    </ClampText>
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
  if (
    notices.length === 0 &&
    !(task.completedWithFindings && ["review", "done"].includes(task.status))
  )
    return null;
  return (
    <Surface
      as="section"
      variant="card"
      padding="md"
      aria-label={t("What you should know")}
      data-task-owner-notices
    >
      <Text as="div" size="caption" tone="inherit" className="space-y-1.5">
        <Heading size="item">{t("What you should know")}</Heading>
        {task.completedWithFindings ? (
          <Text as="p" tone="warning" size="inherit">
            {t("Completed after automatic correction ran out; the review did not pass.")}
          </Text>
        ) : null}
        {NOTICE_GROUPS.map((group) => {
          const rows = notices.filter((notice) => notice.kind === group.kind);
          if (rows.length === 0) return null;
          return (
            <div key={group.kind} className="space-y-0.5">
              <Text as="p" size="micro" tone="muted">
                {group.label()}
              </Text>
              <ul className="space-y-0.5">
                {rows.map((notice) => (
                  <Text as="li" key={notice.id} size="inherit" tone="secondary" leading="inherit">
                    <OverflowTooltip label={notice.message}>
                      <ClampText as="span" lines={2} expandable={false} className="break-words">
                        {notice.message}
                      </ClampText>
                    </OverflowTooltip>
                  </Text>
                ))}
              </ul>
            </div>
          );
        })}
      </Text>
    </Surface>
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
      <Text
        as="div"
        size="caption"
        tone="secondary"
        data-clamped={(!expanded && overflows) || undefined}
        className={`min-w-0 ${!expanded && overflows ? "task-clamped-markdown" : ""}`}
      >
        <AgentMarkdown text={text} allowRemoteMedia={false} className="task-summary-md" />
      </Text>
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
      <SectionLabel as="h3">{t("What was done")}</SectionLabel>
      {summary ? <ClampedMarkdown text={summary} /> : null}
      {diff ? (
        <Text as="p" size="micro" tone="muted" className="font-mono">
          {diff}
        </Text>
      ) : null}
    </section>
  );
}
