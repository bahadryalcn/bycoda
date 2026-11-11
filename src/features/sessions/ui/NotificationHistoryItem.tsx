import { Timestamp } from "../../../shared/ui/Timestamp";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text } from "../../../shared/ui/Text";
import {
  CheckCircle,
  CheckList,
  CircleX,
  Clock,
  ExternalLink,
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

/** Date and time of a pending request; log rows show a relative time instead. */
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

type HistoryActionContext = {
  onOpen: (entry: NotificationHistoryEntry) => Promise<void>;
  onRemove: (entry: NotificationHistoryEntry) => Promise<boolean>;
  inFlight: { current: boolean };
  setBusy: (busy: "open" | "remove" | null) => void;
  setError: (error: string | null) => void;
  t: (key: string) => string;
};

async function runHistoryAction(
  action: "open" | "remove",
  entry: NotificationHistoryEntry,
  { onOpen, onRemove, inFlight, setBusy, setError, t }: HistoryActionContext,
) {
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
}

/**
 * A recorded arrival. It is never a live approval: the row expands to open its
 * conversation, and can be removed from the list on its own. `isNew` marks an
 * arrival the owner has not looked at yet.
 */
export function HistoryItem({
  entry,
  isNew = false,
  canOpen,
  onOpen,
  onRemove,
}: {
  entry: NotificationHistoryEntry;
  isNew?: boolean;
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
  const run = (action: "open" | "remove") =>
    runHistoryAction(action, entry, { onOpen, onRemove, inFlight, setBusy, setError, t });
  const kind = historyKindMeta(entry.kind, t);
  return (
    <ActionHost as="article" className="notification-history-item" data-new={isNew || undefined}>
      <Button
        fullWidth
        variant="item"
        type="button"
        aria-expanded={expanded}
        className="notification-row-toggle"
        onClick={() => setExpanded((value) => !value)}
      >
        <Badge
          className="notification-history-icon"
          tone={kind.tone}
          size="md"
          icon={<kind.Icon className="icon-sm" strokeWidth={1.75} aria-hidden />}
          data-tone={kind.tone}
          aria-hidden
        />
        <span className="notification-history-text">
          <span className="notification-history-head">
            <Text
              className="notification-history-title"
              size="inherit"
              tone="inherit"
              weight="medium"
              truncate
            >
              {historyTitle(entry) || t("Untitled")}
            </Text>
            {isNew ? (
              <>
                <StatusDot className="notification-new-dot" tone="accent" />
                <span className="sr-only">{t("New")}</span>
              </>
            ) : null}
          </span>
          {/* Expanded, the same line shows the whole text instead of repeating it below. */}
          <Text
            className={expanded ? "notification-history-label" : "notification-history-preview"}
            leading="normal"
          >
            {entry.label}
          </Text>
          <Text className="notification-history-meta">
            {entry.cwd ? (
              <NotificationProjectLabel cwd={entry.cwd} />
            ) : (
              <span className="notification-project" />
            )}
            <span aria-hidden>·</span>
            <span className="notification-history-kind" data-tone={kind.tone}>
              {kind.label}
            </span>
          </Text>
        </span>
        <Text className="notification-history-time" tone="muted">
          <Timestamp value={entry.occurredAt} format="relative" relativeStyle="narrow" />
        </Text>
      </Button>
      {expanded ? (
        <div className="notification-history-details" data-no-drag="">
          {entry.cwd ? (
            <Text as="p" className="notification-history-path" leading="normal" title={entry.cwd}>
              {prettyCwd(entry.cwd)}
            </Text>
          ) : null}
          <div className="notification-history-actions">
            {canOpen ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                startIcon={<ExternalLink className="icon-sm" strokeWidth={1.75} aria-hidden />}
                loading={busy === "open"}
                onClick={() => void run("open")}
              >
                {entry.target ? t("Open") : t("Open conversation")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              startIcon={<X className="icon-sm" strokeWidth={1.75} aria-hidden />}
              loading={busy === "remove"}
              onClick={() => void run("remove")}
            >
              {t("Remove")}
            </Button>
          </div>
          {error ? <Alert tone="warning">{error}</Alert> : null}
        </div>
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
