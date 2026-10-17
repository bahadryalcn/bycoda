import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t, useLocale } from "../../../shared/i18n";
import { BellOff, CircleAlert, MessageMultiple, X } from "../../../shared/ui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { allowsProjectNotification } from "../../notifications/model/notificationPreferences";
import { knownNotificationProject } from "../../notifications/model/notificationProjects";
import { useNotificationProjects } from "../../notifications/hooks/useNotificationProjects";
import { pathKey } from "../../../shared/lib/paths";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { LOCKED_NOTIFICATION_TEXT } from "../../notifications/model/attention";
import type { ApprovalDecision } from "../../../integrations/harness";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import { LAYER } from "../../../shared/lib/layers";
import { HARNESS_TITLE, sessionDisplayTitle, type Session } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import {
  historyEntry,
  MAX_NOTIFICATION_HISTORY,
  notificationKey,
  NOTIFICATION_HISTORY_KEY,
  readNotificationHistory,
  writeNotificationHistory,
} from "../../notifications/model/notificationHistory";
import "./notification-sheet.css";
import {
  LocalHostDownNotice,
  useLocalHostDownNotice,
} from "../../connections/ui/LocalHostDownNotice";

type Notice = PendingApprovalNotice & { session: Session };
type Props = {
  notices: Notice[];
  popupNotices?: Notice[];
  topOffset?: number;
  onFocusSession: (sessionId: string) => void;
  onApproval: (sessionId: string, requestId: number, decision: ApprovalDecision) => void;
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
  topOffset = 48,
}: Props) {
  useLocale();
  const localHostNotice = useLocalHostDownNotice();
  useProjectNotificationPreferences();
  const lock = useLockSnapshot();
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState(readNotificationHistory);
  const previousRequests = useRef<Set<string> | null>(null);
  const [popupsEnabled, setPopupsEnabled] = useState(readPopupsEnabled);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const occurred = useRef(new Map<string, number>());
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Keep arrival times while hidden/focused so project mute/resume cannot replay old requests.
  const currentKeys = new Set(notices.map(noticeKey));
  for (const key of occurred.current.keys()) {
    if (!currentKeys.has(key)) occurred.current.delete(key);
  }
  for (const notice of notices) {
    const key = noticeKey(notice);
    if (!occurred.current.has(key)) occurred.current.set(key, Date.now());
  }
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
    setHistory((current) => {
      const next = [...arrivals.map(historyEntry).reverse(), ...current].slice(
        0,
        MAX_NOTIFICATION_HISTORY,
      );
      writeNotificationHistory(next);
      return next;
    });
  }, [notices, history]);
  useEffect(() => {
    const keys = new Set(notices.map(noticeKey));
    if (hasLocked) keys.add("locked");
    setDismissed((previous) => {
      const next = new Set([...previous].filter((key) => keys.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [notices, hasLocked]);
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
        occurredAt: occurred.current.get(noticeKey(notice)),
      })
    );
  });
  const dismiss = (key: string) => setDismissed((previous) => new Set([...previous, key]));
  const dismissAll = () =>
    setDismissed(new Set([...dismissed, ...notices.map(noticeKey), "locked"]));
  const closePanel = () => {
    setExpanded(false);
    trigger.current?.focus();
  };
  const focusSession = (id: string) => {
    const notice = notices.find((item) => item.sessionId === id);
    if (notice) dismiss(noticeKey(notice));
    setExpanded(false);
    onFocusSession(id);
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === POPUP_PREFERENCE || event.key === null)
        setPopupsEnabled(readPopupsEnabled());
      if (event.key === NOTIFICATION_HISTORY_KEY || event.key === null)
        setHistory(readNotificationHistory());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [expanded]);

  return (
    <>
      <Button
        variant="ghost"
        ref={trigger}
        type="button"
        title={t("Notifications")}
        aria-label={t("Notifications")}
        aria-describedby={count > 0 ? `${panelId}-count` : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        {popupsEnabled ? <MessageMultiple className="size-4" /> : <BellOff className="size-4" />}
        {count > 0 ? (
          <span
            id={`${panelId}-count`}
            className="rounded bg-(--ui-tone-warning-subtle) px-1 text-[10px] font-semibold tabular-nums text-(--ui-tone-warning-fg)"
          >
            {count}
          </span>
        ) : null}
      </Button>
      {expanded
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-label={t("Notifications")}
              style={{
                zIndex: LAYER.toast,
              }}
              className="notification-sheet fixed end-0 flex flex-col border-s border-(--ui-tone-neutral-border) bg-(--ui-surface) shadow-xl"
            >
              <div className="flex items-center justify-between gap-2 border-b border-(--ui-tone-neutral-border) px-5 py-4">
                <div className="flex items-center gap-2 text-base font-semibold text-(--ui-tone-neutral-fg)">
                  <MessageMultiple className="size-5 text-(--ui-text-secondary)" />
                  {t("Notifications")}
                  {count > 0 ? <Badge tone="warning">{count}</Badge> : null}
                </div>
                <Button
                  iconOnly
                  label={t("Close")}
                  variant="ghost"
                  type="button"

                  onClick={closePanel}
                  title={t("Close")}
                  aria-label={t("Close")}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div
                className="flex gap-1 border-b border-(--ui-tone-neutral-border) px-5 py-3"
                role="tablist"
                aria-label={t("Notifications")}
              >
                {(["pending", "history"] as const).map((tab) => (
                  <Button
                    variant="tab"
                    key={tab}
                    type="button"
                    role="tab"
                    id={`${panelId}-${tab}`}
                    aria-controls={`${panelId}-list`}
                    aria-selected={view === tab}
                    tabIndex={view === tab ? 0 : -1}
                    onClick={() => setView(tab)}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "pending"
                          : event.key === "End"
                            ? "history"
                            : view === "pending"
                              ? "history"
                              : "pending";
                      setView(next);
                      document.getElementById(`${panelId}-${next}`)?.focus();
                    }}
                  >
                    {tab === "pending" ? t("Pending") : t("Notification history")}
                    <span className="ps-2 tabular-nums text-(--ui-text-secondary)">
                      {tab === "pending" ? count : visibleHistory.length}
                    </span>
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--ui-tone-neutral-border) px-5 py-3 text-xs text-(--ui-text-secondary)">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={popupsEnabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setPopupsEnabled(enabled);
                      try {
                        localStorage.setItem(POPUP_PREFERENCE, String(enabled));
                      } catch {
                        /* Still works for this window. */
                      }
                    }}
                  />
                  {t("Show request popups")}
                </label>
                <Button variant="ghost" type="button" onClick={dismissAll}>
                  {t("Hide all popups")}
                </Button>
              </div>
              <p className="px-5 py-3 text-xs leading-relaxed text-(--ui-text-secondary)">
                {view === "pending"
                  ? t("Pending requests stay here until answered.")
                  : t("Recent requests are kept on this device.")}
              </p>
              <div
                id={`${panelId}-list`}
                role="tabpanel"
                tabIndex={0}
                aria-labelledby={`${panelId}-${view}`}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
              >
                {(view === "pending" ? count === 0 : visibleHistory.length === 0) ? (
                  <div className="flex flex-col items-center gap-3 px-5 py-12 text-center text-(--ui-text-secondary)">
                    <MessageMultiple className="size-8 text-(--ui-text-secondary)" />
                    <p className="text-sm">
                      {view === "pending" ? t("No pending requests") : t("No notification history")}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  {view === "pending" && localHostNotice.visible ? (
                    <LocalHostDownNotice notice={localHostNotice} />
                  ) : null}
                  {view === "pending"
                    ? open.map((notice) => (
                        <ApprovalToastCard
                          key={noticeKey(notice)}
                          notice={notice}
                          onFocusSession={focusSession}
                          onApproval={onApproval}
                        />
                      ))
                    : visibleHistory.map((entry, index) => (
                        <article
                          key={`${entry.key}:${entry.occurredAt}:${index}`}
                          className="rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-3.5"
                        >
                          <NotificationProjectLabel cwd={entry.cwd} />
                          <div className="mbs-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-(--ui-text-secondary)">
                            <span>{entry.kind === "question" ? t("Question") : t("Approval")}</span>
                            <time
                              className="tabular-nums"
                              dateTime={new Date(entry.occurredAt).toISOString()}
                            >
                              {new Date(entry.occurredAt).toLocaleString()}
                            </time>
                          </div>
                          <details className="notification-history-details">
                            <summary className="cursor-pointer rounded text-[13px] font-semibold leading-relaxed text-(--ui-tone-neutral-fg)">
                              {entry.title || t("Untitled")}
                              <span className="notification-history-preview mbs-2 whitespace-pre-wrap text-xs font-normal leading-relaxed text-(--ui-text-secondary)">
                                {entry.label}
                              </span>
                            </summary>
                            <p className="notification-history-label mbs-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-(--ui-text-secondary)">
                              {entry.label}
                            </p>
                          </details>
                        </article>
                      ))}
                  {(view === "pending" ? hasLocked : visibleHistory.length < history.length) ? (
                    <LockedNotice />
                  ) : null}
                </div>
              </div>
              {view === "history" && history.length > 0 ? (
                <div className="border-t border-(--ui-tone-neutral-border) px-5 py-3">
                  <Button
                    variant="ghost"
                    type="button"

                    onClick={() => {
                      setHistory([]);
                      writeNotificationHistory([]);
                    }}
                  >
                    {t("Clear notification history")}
                  </Button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : popupsEnabled
          ? createPortal(
              <div
                aria-live="polite"
                style={{
                  zIndex: LAYER.toast,
                  insetBlockStart: topOffset,
                  maxHeight: `calc(100dvh - ${topOffset + 12}px)`,
                }}
                className="pointer-events-none fixed end-3 flex max-h-[calc(100dvh-64px)] w-[min(360px,calc(100vw-24px))] flex-col gap-2 overflow-y-auto overscroll-contain"
              >
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
              </div>,
              document.body,
            )
          : null}
    </>
  );
}

function LockedNotice({ onDismiss }: { onDismiss?: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const timed = Boolean(onDismiss);
  useEffect(() => {
    if (!timed) return;
    const timer = setTimeout(() => dismissRef.current?.(), POPUP_DURATION);
    return () => clearTimeout(timer);
  }, [timed]);
  return (
    <article
      className="approval-toast pointer-events-auto flex items-center gap-2 rounded-xl border border-dashed border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-3.5 py-3 shadow-xl backdrop-blur-xl"
      role="status"
    >
      <CircleAlert className="size-3.5 shrink-0 text-(--ui-tone-warning-fg)" strokeWidth={1.75} />
      <span className="flex-1 text-[13px] text-(--ui-tone-neutral-fg)">
        {LOCKED_NOTIFICATION_TEXT}
      </span>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"

          onClick={onDismiss}
          title={t("Dismiss notice")}
          aria-label={t("Dismiss notice")}
        >
          <X className="size-3.5" />
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
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(props.onDismiss);
  dismissRef.current = props.onDismiss;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissRef.current(), POPUP_DURATION);
    return () => clearTimeout(timer);
  }, [paused]);
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <ApprovalToastCard {...props} />
    </div>
  );
}

function NotificationProjectLabel({ cwd }: { cwd: string }) {
  const project = useNotificationProjects([cwd]).projects.find((project) =>
    project.paths.some((path) => pathKey(path) === pathKey(cwd)),
  );
  return (
    <span className="notification-project flex min-w-0 w-full flex-col gap-1 text-start">
      <span className="text-[11px] font-medium text-(--ui-text-secondary)">{t("Project")}</span>
      <span className="notification-project-name text-xs font-semibold text-(--ui-tone-neutral-fg)">
        {project?.name || projectName(cwd)}
      </span>
      <span
        className="notification-project-path text-[11px] text-(--ui-text-secondary)"
        title={cwd}
      >
        {prettyCwd(cwd)}
      </span>
    </span>
  );
}

function ApprovalToastCard({
  notice,
  onFocusSession,
  onApproval,
  onDismiss,
}: {
  notice: Notice;
  onFocusSession: Props["onFocusSession"];
  onApproval: Props["onApproval"];
  onDismiss?: () => void;
}) {
  const { session, label, requestId } = notice;
  const title = sessionDisplayTitle(session.title, session.harness);
  return (
    <article
      className="approval-toast pointer-events-auto relative overflow-clip rounded-xl border border-dashed border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) shadow-xl backdrop-blur-xl"
      role="status"
    >
      <Button
        fullWidth
        variant="item"
        type="button"
        onClick={() => onFocusSession(session.id)}
        className="w-full flex-col"
      >
        <span className={`min-w-0 w-full ${onDismiss ? "pe-7" : ""}`}>
          <NotificationProjectLabel cwd={session.cwd} />
        </span>
        <span className={`flex w-full items-center gap-2 ${onDismiss ? "pe-7" : ""}`}>
          <HarnessIcon harness={session.harness} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug text-(--ui-tone-neutral-fg)">
            {title}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-(--ui-tone-warning-fg)">
            <CircleAlert className="size-3.5" strokeWidth={1.75} />
            {notice.kind === "question" ? t("Question") : t("Approval")}
          </span>
        </span>
        <span className="line-clamp-3 w-full whitespace-pre-wrap break-words text-xs leading-relaxed text-(--ui-text-secondary)">
          {label}
        </span>
        <span className="ui-caption-text">{HARNESS_TITLE[session.harness]}</span>
      </Button>
      {onDismiss ? (
        <Button
          iconOnly
          label={t("Dismiss notice")}
          variant="ghost"
          type="button"

          onClick={onDismiss}
          title={t("Dismiss notice")}
          aria-label={t("Dismiss notice")}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
      {notice.kind === "approval" ? (
        <div className="flex gap-2 border-t border-(--ui-tone-neutral-border) px-3.5 py-2.5">
          <Button
            variant="ghost"
            type="button"
            className="flex-1"
            onClick={() => onApproval(session.id, requestId, "allow")}
          >
            {t("Allow")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="flex-1"
            onClick={() => onApproval(session.id, requestId, "deny")}
          >
            {t("Deny")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
