import { Timestamp } from "../../../shared/ui/Timestamp";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { ActionHost, InlineAction, InlineTextAction } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Badge, StatusBadge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import {
  CheckCircle,
  CheckList,
  CircleX,
  Clock,
  MessageSquare,
  Shield,
  Sparkles,
  UserRound,
  X,
} from "../../../shared/ui/icons";
import { useNotificationProjects } from "../../notifications/hooks/useNotificationProjects";
import type {
  NotificationHistoryEntry,
  NotificationHistoryKind,
} from "../../notifications/model/notificationHistory";
import { HARNESS_LABEL, sessionDisplayTitle, type HarnessId } from "../model/session";

/** Same date-and-time wording in Pending rows and History rows. */
export function NotificationTime({ at }: { at: number }) {
  return (
    <>
      <Timestamp value={at} format="date" />
      {" · "}
      <Timestamp value={at} format="time" />
    </>
  );
}

/** The conversation title without the provider prefix stored for the tab strip. */
function historyTitle(entry: NotificationHistoryEntry): string {
  const harnesses = entry.harness ? [entry.harness] : (Object.keys(HARNESS_LABEL) as HarnessId[]);
  for (const harness of harnesses) {
    if (!HARNESS_LABEL[harness]) continue;
    const title = sessionDisplayTitle(entry.title, harness);
    if (title !== entry.title) return title;
  }
  return entry.title;
}

/** The kind label and icon shown on every row of the notification log. */
export function historyKindMeta(
  kind: NotificationHistoryKind,
  t: (text: string) => string,
): { label: string; Icon: typeof Shield; tone: BadgeTone } {
  switch (kind) {
    case "question":
      return { label: t("Question"), Icon: MessageSquare, tone: "warning" };
    case "finished":
      return { label: t("Finished"), Icon: CheckCircle, tone: "success" };
    case "failed":
      return { label: t("Failed"), Icon: CircleX, tone: "danger" };
    case "reminder":
      return { label: t("Reminder"), Icon: Clock, tone: "warning" };
    case "assistant":
      return { label: t("Assistant"), Icon: Sparkles, tone: "accent" };
    case "background":
      return { label: t("Background"), Icon: CheckList, tone: "info" };
    case "account":
      return { label: t("Account"), Icon: UserRound, tone: "neutral" };
    default:
      return { label: t("Approval"), Icon: Shield, tone: "warning" };
  }
}

/** Longer or multi-line requests get a "Show more" toggle; shorter ones fit the clamp. */
const LONG_REQUEST = 140;

/**
 * A recorded arrival. It is never a live approval: the row opens its
 * conversation, and can be removed from the list on its own. `pending` marks a
 * request that is still waiting, which the Pending tab is the place to answer.
 */
export function HistoryItem({
  entry,
  pending = false,
  canOpen,
  onOpen,
  onRemove,
}: {
  entry: NotificationHistoryEntry;
  pending?: boolean;
  canOpen: boolean;
  onOpen: (entry: NotificationHistoryEntry) => Promise<void>;
  /** Resolves `false` when the entry could not be removed. */
  onRemove: (entry: NotificationHistoryEntry) => Promise<boolean>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"open" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run = async (action: "open" | "remove") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      if (action === "open") await onOpen(entry);
      else if (!(await onRemove(entry))) setError(t("This notification could not be removed."));
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t("This conversation is no longer available."),
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  const kind = historyKindMeta(entry.kind, t);
  const long = entry.label.length > LONG_REQUEST || /\n/.test(entry.label);
  const content = (
    <>
      <span className="notification-history-head">
        <span className="notification-history-title">{historyTitle(entry) || t("Untitled")}</span>
        <span className="notification-history-time">
          <NotificationTime at={entry.occurredAt} />
        </span>
      </span>
      <span className={expanded ? "notification-history-label" : "notification-history-preview"}>
        {entry.label}
      </span>
      {canOpen ? (
        <span className="sr-only">{entry.target ? t("Open") : t("Open session")}</span>
      ) : null}
    </>
  );
  return (
    <ActionHost as="article" className="notification-history-item flex-col items-stretch gap-0">
      {canOpen ? (
        <Button
          fullWidth
          variant="item"
          layout="stacked"
          type="button"
          aria-busy={busy === "open"}
          className="notification-request-body"
          onClick={() => void run("open")}
        >
          {content}
        </Button>
      ) : (
        <div className="notification-history-static">{content}</div>
      )}
      <div className="notification-history-meta" data-no-drag="">
        {entry.cwd ? (
          <NotificationProjectLabel cwd={entry.cwd} />
        ) : (
          <span className="notification-project" />
        )}
        {entry.kind === "failed" || entry.kind === "finished" ? (
          <StatusBadge
            className="notification-history-kind"
            size="xs"
            status={entry.kind === "failed" ? "failed" : "done"}
          >
            {kind.label}
          </StatusBadge>
        ) : (
          <Badge
            className="notification-history-kind"
            size="xs"
            tone={kind.tone}
            icon={<kind.Icon className="icon-sm" strokeWidth={1.75} aria-hidden />}
          >
            {kind.label}
          </Badge>
        )}
        {pending ? <Badge tone="warning">{t("Waiting for you")}</Badge> : null}
        <span className="notification-history-actions">
          {long ? (
            <InlineTextAction aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
              {expanded ? t("Show less") : t("Show more")}
            </InlineTextAction>
          ) : null}
          <InlineAction
            label={t("Remove")}
            reveal="always"
            loading={busy === "remove"}
            onClick={() => void run("remove")}
          >
            <X className="icon-sm" strokeWidth={1.75} aria-hidden />
          </InlineAction>
        </span>
      </div>
      {expanded && entry.cwd ? (
        <p className="notification-history-path" title={entry.cwd}>
          {prettyCwd(entry.cwd)}
        </p>
      ) : null}
      {error ? (
        <Alert tone="warning" className="mx-3 mb-2">
          {error}
        </Alert>
      ) : null}
    </ActionHost>
  );
}

export function NotificationProjectLabel({ cwd }: { cwd: string }) {
  const project = useNotificationProjects([cwd]).projects.find((project) =>
    project.paths.some((path) => pathKey(path) === pathKey(cwd)),
  );
  return (
    <span className="notification-project" title={cwd}>
      <span className="notification-project-name">{project?.name || projectName(cwd)}</span>
      <span className="notification-project-path sr-only">{prettyCwd(cwd)}</span>
    </span>
  );
}
