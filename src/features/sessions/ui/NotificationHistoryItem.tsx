import { Tooltip } from "../../../shared/ui/Tooltip";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { ActionHost, InlineAction, actionContentAttributes } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text } from "../../../shared/ui/Text";
import { Check, ExternalLink, X } from "../../../shared/ui/icons";
import { NoticeGlyph } from "../../../shared/ui/Notice";
import { useNotificationProjects } from "../../notifications/hooks/useNotificationProjects";
import { historyTone, type NotificationHistoryEntry } from "../../notifications";
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

/** The feature a `background:*` entry points at, or nothing when the row names no feature. */
function featureLabel(target: string | undefined, t: (text: string) => string): string {
  switch (target) {
    case "background:tasks":
      return t("Tasks");
    case "background:automations":
      return t("Automations");
    case "background:summary":
      return t("Daily summary");
    case "background:account":
      return t("Account");
    case "background:assistant":
      return t("Assistant");
    default:
      return "";
  }
}

/** The registered project name of a path, or its folder name. Empty without a path. */
function useNotificationProjectName(cwd: string): string {
  const project = useNotificationProjects(cwd ? [cwd] : []).projects.find((item) =>
    item.paths.some((path) => pathKey(path) === pathKey(cwd)),
  );
  return cwd ? project?.name || projectName(cwd) : "";
}

type HistoryActionContext = {
  onOpen: (entry: NotificationHistoryEntry) => Promise<void>;
  onRemove: (entry: NotificationHistoryEntry) => Promise<boolean>;
  onMarkRead: (entry: NotificationHistoryEntry) => Promise<boolean>;
  inFlight: { current: boolean };
  setBusy: (busy: "open" | null) => void;
  setError: (error: string | null) => void;
  t: (key: string) => string;
};

async function runHistoryAction(
  action: "open" | "remove" | "read",
  entry: NotificationHistoryEntry,
  { onOpen, onRemove, onMarkRead, inFlight, setBusy, setError, t }: HistoryActionContext,
) {
  if (inFlight.current) return;
  inFlight.current = true;
  setBusy(action === "open" ? "open" : null);
  setError(null);
  try {
    if (action === "open") await onOpen(entry);
    else if (action === "read") {
      if (!(await onMarkRead(entry))) setError(t("This notification could not be updated."));
    } else if (!(await onRemove(entry))) setError(t("This notification could not be removed."));
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
 * conversation, and can be marked read or dismissed on its own. A repeated arrival
 * is one row with a count whose expansion lists each time.
 */
export function HistoryItem({
  entry,
  unread = false,
  canOpen,
  onOpen,
  onRemove,
  onMarkRead,
}: {
  entry: NotificationHistoryEntry;
  unread?: boolean;
  canOpen: boolean;
  onOpen: (entry: NotificationHistoryEntry) => Promise<void>;
  /** Resolves `false` when the entry could not be removed. */
  onRemove: (entry: NotificationHistoryEntry) => Promise<boolean>;
  /** Resolves `false` when the entry could not be marked read. */
  onMarkRead: (entry: NotificationHistoryEntry) => Promise<boolean>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const project = useNotificationProjectName(entry.cwd);
  const run = (action: "open" | "remove" | "read") =>
    runHistoryAction(action, entry, {
      onOpen,
      onRemove,
      onMarkRead,
      inFlight,
      setBusy,
      setError,
      t,
    });
  const tone = historyTone(entry);
  const count = entry.count ?? 1;
  const arrivals = [entry.occurredAt, ...(entry.earlier ?? [])];
  // A conversation row reads as its event, with "project · session" beneath; any other row is its own title.
  const isSession = Boolean(entry.sessionId);
  const title = isSession
    ? entry.label || historyTitle(entry) || t("Untitled")
    : entry.title || entry.label || t("Untitled");
  const detail = isSession ? "" : entry.title ? entry.label : "";
  const context = [
    isSession ? project : featureLabel(entry.target, t),
    isSession && entry.label ? historyTitle(entry) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ActionHost
      as="article"
      variant="row"
      className="notification-history-item"
      data-unread={unread || undefined}
      data-tone={tone}
    >
      <Button
        fullWidth
        variant="item"
        type="button"
        aria-expanded={expanded}
        className="notification-row-toggle"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="notification-history-icon" data-tone={tone ?? "none"}>
          {tone === "danger" || tone === "warning" ? (
            <NoticeGlyph tone={tone} size="inline" />
          ) : unread ? (
            <StatusDot tone="neutral" />
          ) : null}
        </span>
        <span className="notification-history-text">
          {/* The title shortens; the ×N counter keeps its own fixed slot on the same line. */}
          <span className="notification-history-titleline">
            <Text
              as="span"
              className="notification-history-title"
              size="secondary"
              tone={unread ? "primary" : "secondary"}
              weight={unread ? "medium" : "regular"}
              truncate={!expanded}
            >
              {title}
              {unread ? <span className="sr-only">{`, ${t("Unread")}`}</span> : null}
            </Text>
            {count > 1 ? (
              <Text
                as="span"
                className="notification-history-count"
                size="caption"
                tone="muted"
                weight="regular"
              >
                {t("×{p0}", { p0: count })}
              </Text>
            ) : null}
          </span>
          {detail ? (
            <Text
              className={expanded ? "notification-history-label" : "notification-history-preview"}
              lines={expanded ? undefined : 2}
              size="caption"
              tone="muted"
              weight="regular"
              leading="normal"
            >
              {detail}
            </Text>
          ) : null}
          {context ? (
            <Text
              className="notification-history-meta"
              size="caption"
              tone="muted"
              weight="regular"
              truncate
            >
              {context}
            </Text>
          ) : null}
        </span>
        <Text
          as="span"
          size="micro"
          tone="muted"
          weight="regular"
          {...actionContentAttributes(
            { phase: "rest", hide: "opacity", display: "block" },
            "notification-history-time",
          )}
        >
          <Timestamp value={entry.occurredAt} format="relative" relativeStyle="narrow" />
        </Text>
      </Button>
      <span className="notification-history-actions-inline" data-no-drag="">
        {unread ? (
          <InlineAction label={t("Mark read")} onClick={() => void run("read")}>
            <Check className="icon-sm" strokeWidth={1.75} aria-hidden />
          </InlineAction>
        ) : null}
        <InlineAction label={t("Dismiss")} onClick={() => void run("remove")}>
          <X className="icon-sm" strokeWidth={1.75} aria-hidden />
        </InlineAction>
      </span>
      {expanded ? (
        <div className="notification-history-details" data-no-drag="">
          {count > 1 ? (
            <ul className="notification-history-arrivals">
              {arrivals.map((at, index) => (
                <li key={`${at}:${index}`}>
                  <Text size="caption" tone="muted" weight="regular">
                    <Timestamp value={at} format="relative" relativeStyle="narrow" />
                  </Text>
                </li>
              ))}
            </ul>
          ) : null}
          {entry.cwd ? (
            <Tooltip label={entry.cwd} asChild>
              <Text as="p" className="notification-history-path" leading="normal">
                {prettyCwd(entry.cwd)}
              </Text>
            </Tooltip>
          ) : null}
          {canOpen ? (
            <div className="notification-history-actions">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                startIcon={<ExternalLink className="icon-sm" strokeWidth={1.75} aria-hidden />}
                loading={busy === "open"}
                onClick={() => void run("open")}
              >
                {entry.target ? t("Open") : t("Open session")}
              </Button>
            </div>
          ) : null}
          {error ? <Alert tone="warning">{error}</Alert> : null}
        </div>
      ) : null}
      {!expanded && error ? (
        <div className="notification-history-details" data-no-drag="">
          <Alert tone="warning">{error}</Alert>
        </div>
      ) : null}
    </ActionHost>
  );
}

export function NotificationProjectLabel({ cwd }: { cwd: string }) {
  const name = useNotificationProjectName(cwd);
  return (
    <Tooltip label={cwd} asChild>
      <Text
        as="span"
        size="caption"
        tone="secondary"
        weight="regular"
        leading="inherit"
        className="notification-project"
      >
        <Text
          as="span"
          size="inherit"
          tone="inherit"
          truncate
          className="notification-project-name"
        >
          {name}
        </Text>
        <span className="notification-project-path sr-only">{prettyCwd(cwd)}</span>
      </Text>
    </Tooltip>
  );
}
