import { NotificationRequestCount } from "./NotificationRequestCount";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Switch } from "../../../shared/ui/Switch";
import { Popover } from "../../../shared/ui/Popover";
import { Sheet } from "../../../shared/ui/Sheet";
import { TabStrip } from "../../../shared/ui/Tabs";
import { ToastSlot, useAutoDismiss } from "../../../shared/ui/ToastRegion";
import { useT } from "../../../shared/i18n";
import { BellOff, CircleAlert, MessageMultiple, Settings, X } from "../../../shared/ui/icons";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { allowsProjectNotification } from "../../notifications/model/notificationPreferences";
import { knownNotificationProject } from "../../notifications/model/notificationProjects";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import { LOCKED_NOTIFICATION_TEXT } from "../../notifications/model/attention";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import { useApprovalDecisionControl } from "./useApprovalDecisionControl";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import { LAYER } from "../../../shared/lib/layers";
import { HARNESS_TITLE, sessionDisplayTitle, type Session } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { HistoryItem, NotificationProjectLabel, NotificationTime } from "./NotificationHistoryItem";
import {
  historyEntry,
  historyOccurrenceIds,
  MAX_NOTIFICATION_HISTORY,
  notificationKey,
  NOTIFICATION_HISTORY_KEY,
  readNotificationHistoryStatus,
  appendNotificationHistory,
  mergeNotificationHistory,
  clearNotificationHistory,
  type NotificationHistoryEntry,
} from "../../notifications/model/notificationHistory";
import "./notification-sheet.css";
import {
  LocalHostDownNotice,
  useLocalHostDownNotice,
} from "../../connections/public/LocalHostDownNotice";

type Notice = PendingApprovalNotice & { session: Session };
type Props = {
  notices: Notice[];
  popupNotices?: Notice[];
  onFocusSession: (sessionId: string) => void;
  onApproval: ApprovalDispatch;
  /**
   * Opens a conversation recorded in history, which may no longer be open.
   * `false` or a rejection means it is unavailable. Without it, only history
   * rows whose request is still pending can open their conversation.
   */
  onOpenHistorySession?: (
    sessionId: string,
    cwd: string,
  ) => void | boolean | Promise<void | boolean>;
  /** Opens the full Notifications page in Settings. */
  onOpenSettings?: () => void;
};
const POPUP_PREFERENCE = "bycoda.notifications.agentInput.popups.v1";
const MAX_POPUPS = 3;
const POPUP_DURATION = 12_000;

const noticeKey = notificationKey;
function readPopupsEnabled() {
  try {
    return localStorage.getItem(POPUP_PREFERENCE) !== "false";
  } catch {
    return true;
  }
}

export function ApprovalToasts({
  notices,
  popupNotices = notices,
  onFocusSession,
  onApproval,
  onOpenHistorySession,
  onOpenSettings,
}: Props) {
  const t = useT();
  const localHostNotice = useLocalHostDownNotice();
  useProjectNotificationPreferences();
  const lock = useLockSnapshot();
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState(() => readNotificationHistoryStatus().entries);
  const [historyUnavailable, setHistoryUnavailable] = useState(
    () => readNotificationHistoryStatus().state === "unavailable",
  );
  const [clearError, setClearError] = useState(false);
  const [clearing, setClearing] = useState(false);
  const localHistory = useRef(history);
  const historyMutation = useRef(0);
  const previousRequests = useRef<Set<string> | null>(null);
  const [popupsEnabled, setPopupsEnabled] = useState(readPopupsEnabled);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [occurred, setOccurred] = useState<ReadonlyMap<string, number>>(() => new Map());
  const trigger = useRef<HTMLButtonElement>(null);
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLButtonElement | null>(null);
  const panelId = useId();
  // Keep arrival times while hidden/focused so project mute/resume cannot replay old requests.
  // Synced before paint; a notice without a recorded time yet counts as arriving now.
  useLayoutEffect(() => {
    const now = Date.now();
    setOccurred((previous) => {
      const keys = notices.map(noticeKey);
      const current = new Set(keys);
      if (previous.size === current.size && keys.every((key) => previous.has(key))) {
        return previous;
      }
      const next = new Map<string, number>();
      for (const key of keys) next.set(key, previous.get(key) ?? now);
      return next;
    });
  }, [notices]);
  const open = notices.filter((notice) => !isProjectLockedIn(lock, notice.session.cwd));
  const hasLocked = open.length < notices.length;
  const visibleHistory = history.filter((entry) => !isProjectLockedIn(lock, entry.cwd));
  useEffect(() => {
    const previous = previousRequests.current;
    const arrivals = notices.filter((notice) =>
      previous
        ? !previous.has(noticeKey(notice))
        : !history.some((entry) => entry.key === noticeKey(notice)),
    );
    previousRequests.current = new Set(notices.map(noticeKey));
    if (!arrivals.length) return;
    const additions = arrivals.map(historyEntry).reverse();
    const current = localHistory.current;
    localHistory.current = mergeNotificationHistory(additions, current);
    setHistory(localHistory.current);
    const mutation = ++historyMutation.current;
    // Persistence is an effect, never a React updater: StrictMode may replay
    // updater functions, which would append the same occurrence twice.
    void Promise.resolve(appendNotificationHistory(additions, current))
      .then((next) => {
        if (historyMutation.current !== mutation) return;
        localHistory.current = next;
        setHistory(next);
      })
      .catch(() => {
        /* Keep the local history if optional persistence fails. */
      });
  }, [notices, history]);
  // Dismissals end with their notice, so a notice that returns is shown again.
  const liveKeys = new Set(notices.map(noticeKey));
  if (hasLocked) liveKeys.add("locked");
  if ([...dismissed].some((key) => !liveKeys.has(key))) {
    setDismissed(new Set([...dismissed].filter((key) => liveKeys.has(key))));
  }
  const count = open.length + (hasLocked ? 1 : 0) + (localHostNotice.visible ? 1 : 0);
  const eligible = popupNotices.filter((notice) => {
    if (isProjectLockedIn(lock, notice.session.cwd) || dismissed.has(noticeKey(notice)))
      return false;
    const project = knownNotificationProject(notice.session.cwd);
    return (
      project &&
      allowsProjectNotification({
        projectId: project.id,
        category: "agentInput",
        occurredAt: occurred.get(noticeKey(notice)),
      })
    );
  });
  const dismiss = (key: string) => setDismissed((previous) => new Set([...previous, key]));
  const dismissAll = () =>
    setDismissed(new Set([...dismissed, ...notices.map(noticeKey), "locked"]));
  const closePanel = () => {
    setOptionsAnchor(null);
    setExpanded(false);
    trigger.current?.focus();
  };
  const focusSession = (id: string) => {
    const notice = notices.find((item) => item.sessionId === id);
    if (notice) dismiss(noticeKey(notice));
    setOptionsAnchor(null);
    setExpanded(false);
    onFocusSession(id);
  };
  // An unreadable store must not look like an empty history, and must not
  // erase what this window still holds.
  const reloadHistory = () => {
    const read = readNotificationHistoryStatus();
    setHistoryUnavailable(read.state === "unavailable");
    if (read.state === "ready") {
      localHistory.current = read.entries;
      setHistory(read.entries);
    }
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === POPUP_PREFERENCE || event.key === null)
        setPopupsEnabled(readPopupsEnabled());
      if (event.key === NOTIFICATION_HISTORY_KEY || event.key === null) reloadHistory();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  // The list only empties once the durable clear is confirmed.
  const clearHistory = async () => {
    historyMutation.current += 1;
    setClearing(true);
    let cleared = false;
    try {
      cleared = (await clearNotificationHistory()) !== false;
    } catch {
      cleared = false;
    } finally {
      setClearing(false);
    }
    if (!cleared) {
      setClearError(true);
      reloadHistory();
      throw new Error(t("Request history could not be cleared."));
    }
    setClearError(false);
    setHistoryUnavailable(false);
    localHistory.current = [];
    setHistory([]);
  };
  const livePending = new Set(notices.map((notice) => notice.sessionId));
  const canOpenHistory = (entry: NotificationHistoryEntry) =>
    Boolean(onOpenHistorySession) || livePending.has(entry.sessionId);
  const openHistorySession = async (entry: NotificationHistoryEntry) => {
    if (isProjectLockedIn(getGroupLockView().lock, entry.cwd)) {
      throw new Error(t("This conversation is in a locked group."));
    }
    if (livePending.has(entry.sessionId)) {
      focusSession(entry.sessionId);
      return;
    }
    if (!onOpenHistorySession) throw new Error(t("This conversation is no longer available."));
    const opened = await onOpenHistorySession(entry.sessionId, entry.cwd);
    if (opened === false) throw new Error(t("This conversation is no longer available."));
    setOptionsAnchor(null);
    setExpanded(false);
  };
  const historyIds = historyOccurrenceIds(visibleHistory);
  return (
    <>
      <Button
        iconOnly
        label={t("Notifications")}
        variant="ghost"
        motion="none"
        size="sm"
        className="relative"
        ref={trigger}
        type="button"
        tooltip={t("Notifications")}
        aria-label={t("Notifications")}
        aria-describedby={count > 0 ? `${panelId}-count` : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => {
          setOptionsAnchor(null);
          setExpanded((value) => !value);
        }}
      >
        <span className="relative inline-flex size-4 shrink-0">
          {popupsEnabled ? (
            <MessageMultiple className="icon-md" />
          ) : (
            <BellOff className="icon-md" />
          )}
          {count > 0 ? <NotificationRequestCount id={`${panelId}-count`} count={count} /> : null}
        </span>
      </Button>
      {expanded ? (
        <Sheet
          padding="none"
          modal={false}
          anchor="viewport"
          side="end"
          size="420px"
          inset={{ top: 40, bottom: 32 }}
          layer={LAYER.toast}
          ignore={trigger}
          title={t("Notifications")}
          closeLabel={t("Close")}
          className="notification-sheet"
          initialFocus="button"
          scroll="none"
          onClose={closePanel}
          headerActions={
            <Button
              iconOnly
              size="sm"
              label={t("Notification options")}
              tooltip={t("Notification options")}
              variant="ghost"
              aria-expanded={Boolean(optionsAnchor)}
              aria-controls={optionsAnchor ? `${panelId}-options` : undefined}
              onClick={(event) => setOptionsAnchor(optionsAnchor ? null : event.currentTarget)}
            >
              {popupsEnabled ? <Settings className="icon-sm" /> : <BellOff className="icon-sm" />}
            </Button>
          }
          headerBelow={
            // Counts live on the tabs, once; the title stays a plain title.
            <TabStrip
              id={panelId}
              label={t("Notifications")}
              value={view}
              onValueChange={setView}
              controls={`${panelId}-list`}
              items={[
                { value: "pending", label: t("Pending"), count },
                { value: "history", label: t("Recent requests"), count: visibleHistory.length },
              ]}
            />
          }
        >
          {optionsAnchor ? (
            <Popover
              id={`${panelId}-options`}
              anchor={optionsAnchor}
              layer={LAYER.toastPopover}
              role="region"
              aria-label={t("Notification options")}
              className="notification-options bycoda-arc"
              width={292}
              flow="scroll"
              onDismiss={(reason) => {
                setOptionsAnchor(null);
                if (reason === "escape") optionsAnchor.focus();
              }}
            >
              <Switch
                label={t("Show request popups")}
                checked={popupsEnabled}
                onCheckedChange={(enabled) => {
                  setPopupsEnabled(enabled);
                  try {
                    localStorage.setItem(POPUP_PREFERENCE, String(enabled));
                  } catch {
                    /* Still works for this window. */
                  }
                }}
              />
              <Button variant="item" fullWidth type="button" onClick={dismissAll}>
                {t("Hide all popups")}
              </Button>
              {onOpenSettings ? (
                <Button
                  variant="item"
                  fullWidth
                  type="button"
                  onClick={() => {
                    setOptionsAnchor(null);
                    setExpanded(false);
                    onOpenSettings();
                  }}
                >
                  {t("All notification settings…")}
                </Button>
              ) : null}
              <p className="text-ui-caption leading-relaxed text-(--ui-text-secondary)">
                {view === "pending"
                  ? t("Pending requests stay here until answered.")
                  : t("Only the latest {p0} questions and approvals are kept on this device.", {
                      p0: MAX_NOTIFICATION_HISTORY,
                    })}
              </p>
              <div className="pt-1">
                <ConfirmMorph
                  label={t("Clear recent requests")}
                  prompt={t("Clear history?")}
                  disabled={history.length === 0}
                  onConfirm={clearHistory}
                />
              </div>
            </Popover>
          ) : null}
          <div
            id={`${panelId}-list`}
            role="tabpanel"
            tabIndex={0}
            aria-labelledby={`${panelId}-tab-${view}`}
            className="notification-sheet-list"
          >
            {view === "history" ? (
              <p className="notification-history-note">
                {t(
                  "Questions and approvals this app received, newest first. Finished and error alerts are not listed.",
                )}
              </p>
            ) : null}
            {view === "history" && historyUnavailable ? (
              <div className="notification-history-status">
                <Alert tone="warning">
                  {t("Request history could not be read. Showing what this window has.")}
                </Alert>
                <Button variant="ghost" size="sm" type="button" onClick={reloadHistory}>
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
            {view === "history" && clearError ? (
              <div className="notification-history-status">
                <Alert tone="danger">
                  {t("Request history could not be cleared. Nothing was removed.")}
                </Alert>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  loading={clearing}
                  onClick={() => void clearHistory().catch(() => {})}
                >
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
            {(
              view === "pending" ? count === 0 : visibleHistory.length === 0 && !historyUnavailable
            ) ? (
              <EmptyState
                context="list"
                icon={<MessageMultiple className="size-6" aria-hidden />}
                description={
                  view === "pending" ? t("No pending requests") : t("No recent requests")
                }
                action={
                  view === "pending" && visibleHistory.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setView("history")}
                    >
                      {t("View recent requests")}
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            <div className="notification-sheet-items">
              {view === "pending" && localHostNotice.visible ? (
                <LocalHostDownNotice notice={localHostNotice} />
              ) : null}
              {view === "pending"
                ? open.map((notice) => (
                    <ApprovalToastCard
                      key={noticeKey(notice)}
                      notice={notice}
                      occurredAt={occurred.get(noticeKey(notice))}
                      onFocusSession={focusSession}
                      onApproval={onApproval}
                    />
                  ))
                : visibleHistory.map((entry, index) => (
                    <HistoryItem
                      key={historyIds[index]}
                      entry={entry}
                      canOpen={canOpenHistory(entry)}
                      onOpen={openHistorySession}
                    />
                  ))}
              {(view === "pending" ? hasLocked : visibleHistory.length < history.length) ? (
                <LockedNotice />
              ) : null}
            </div>
          </div>
        </Sheet>
      ) : popupsEnabled && (eligible.length > 0 || (hasLocked && !dismissed.has("locked"))) ? (
        <ToastSlot placement="top-end">
          <div className="flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
            {eligible.slice(0, MAX_POPUPS).map((notice) => (
              <TimedPopup
                key={noticeKey(notice)}
                notice={notice}
                onDismiss={() => dismiss(noticeKey(notice))}
                onFocusSession={focusSession}
                onApproval={onApproval}
              />
            ))}
            {hasLocked && !dismissed.has("locked") ? (
              <LockedNotice onDismiss={() => dismiss("locked")} />
            ) : null}
            {eligible.length > MAX_POPUPS ? (
              <Button
                variant="ghost"
                type="button"

                onClick={() => setExpanded(true)}
              >
                {t("View all pending requests ({p0})", { p0: count })}
              </Button>
            ) : null}
          </div>
        </ToastSlot>
      ) : null}
    </>
  );
}

function LockedNotice({ onDismiss }: { onDismiss?: () => void }) {
  const t = useT();
  const surface = useRef<HTMLElement>(null);
  useAutoDismiss(surface, {
    durationMs: onDismiss ? POPUP_DURATION : null,
    onExpire: () => onDismiss?.(),
  });
  return (
    <article
      ref={surface}
      className="approval-toast pointer-events-auto flex items-center gap-2 rounded-(--ui-radius-popup) border border-dashed border-(--ui-tone-neutral-border) bg-(--ui-surface-floating) px-3.5 py-3 shadow-(--ui-elevation-floating)"
      role="status"
    >
      <CircleAlert className="icon-sm shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={1.75} />
      <span className="flex-1 text-ui-secondary text-(--ui-tone-neutral-fg)">
        {t(LOCKED_NOTIFICATION_TEXT)}
      </span>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"

          onClick={onDismiss}
          tooltip={t("Dismiss notice")}
          aria-label={t("Dismiss notice")}
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
    </article>
  );
}

function TimedPopup(props: {
  notice: Notice;
  onDismiss: () => void;
  onFocusSession: Props["onFocusSession"];
  onApproval: Props["onApproval"];
}) {
  const surface = useRef<HTMLDivElement>(null);
  useAutoDismiss(surface, { durationMs: POPUP_DURATION, onExpire: props.onDismiss });
  return (
    <div ref={surface}>
      <ApprovalToastCard {...props} />
    </div>
  );
}

function ApprovalToastCard({
  notice,
  occurredAt,
  onFocusSession,
  onApproval,
  onDismiss,
}: {
  notice: Notice;
  /** Shown in the sheet's Pending list; floating popups omit it. */
  occurredAt?: number;
  onFocusSession: Props["onFocusSession"];
  onApproval: Props["onApproval"];
  onDismiss?: () => void;
}) {
  const t = useT();
  const { session, label, requestId } = notice;
  const title = sessionDisplayTitle(session.title, session.harness);
  const decision = useApprovalDecisionControl(session, requestId, onApproval);
  return (
    <ActionHost
      as="article"
      className="approval-toast notification-request pointer-events-auto flex-col items-stretch gap-0 overflow-clip rounded-(--ui-radius-popup) border border-(--ui-pane-border) bg-(--ui-surface-floating) shadow-(--ui-elevation-floating)"
      role="status"
    >
      <Button
        fullWidth
        variant="item"
        layout="stacked"
        type="button"
        onClick={() => onFocusSession(session.id)}
        className="notification-request-body"
        tooltip={title}
        tooltipWhen="overflow"
      >
        <span
          className={`notification-request-title text-ui-secondary font-medium leading-snug text-(--ui-tone-neutral-fg) ${onDismiss ? "pe-7" : ""}`}
        >
          {title}
        </span>
        <span className="notification-request-preview text-ui-caption leading-relaxed text-(--ui-text-secondary)">
          {label}
        </span>
        <span className="sr-only">{t("Open session")}</span>
      </Button>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"

          onClick={onDismiss}
          tooltip={t("Dismiss notice")}
          aria-label={t("Dismiss notice")}
          className="notification-popup-dismiss"
          data-no-drag=""
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
      {/* One footer row: source, harness and time on the left, kind and the
          decision on the right. Opening the session is the body's own action. */}
      <div className="notification-request-meta notification-request-footer px-3 pb-2">
        {/* Pointer convenience only: the body button above owns keyboard access. */}
        <span
          className="notification-request-source flex min-w-0 cursor-pointer items-center gap-2"
          onClick={() => onFocusSession(session.id)}
        >
          <NotificationProjectLabel cwd={session.cwd} />
          <span className="flex min-w-0 shrink-0 items-center gap-1.5">
            <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
            <span className="truncate">{HARNESS_TITLE[session.harness]}</span>
          </span>
          {occurredAt != null ? <NotificationTime at={occurredAt} /> : null}
        </span>
        <span
          className="notification-request-actions flex shrink-0 items-center gap-1"
          data-no-drag=""
        >
          <Badge tone="warning">{notice.kind === "question" ? t("Question") : t("Approval")}</Badge>
          {notice.kind === "approval" ? (
            <>
              <Button
                variant="primary"
                size="sm"
                type="button"
                loading={decision.pending && decision.decision === "allow"}
                disabled={decision.blocked}
                onClick={() => void decision.decide("allow")}
              >
                {t("Allow")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                tone="danger"
                type="button"
                loading={decision.pending && decision.decision === "deny"}
                disabled={decision.blocked}
                onClick={() => void decision.decide("deny")}
              >
                {t("Deny")}
              </Button>
            </>
          ) : null}
        </span>
      </div>
      {notice.kind === "approval" && decision.feedback ? (
        decision.danger ? (
          <Alert tone="danger" inline className="px-3 pb-2">
            {decision.feedback}
          </Alert>
        ) : (
          <div role="status" className="px-3 pb-2 text-ui-caption text-(--ui-text-secondary)">
            {decision.feedback}
          </div>
        )
      ) : null}
    </ActionHost>
  );
}
