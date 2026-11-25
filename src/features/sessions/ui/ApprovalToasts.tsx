import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { NotificationBell } from "../../../shared/ui/NotificationBell";
import { Portal } from "../../../shared/ui/Portal";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Motion } from "../../../shared/ui/Motion";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Surface } from "../../../shared/ui/Surface";
import { Divider } from "../../../shared/ui/Divider";
import { Switch } from "../../../shared/ui/Switch";
import { Popover } from "../../../shared/ui/Popover";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Sheet } from "../../../shared/ui/Sheet";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { ToastCard, ToastSlot, useAutoDismiss } from "../../../shared/ui/ToastRegion";
import { useT } from "../../../shared/i18n";
import { useToday } from "../../../shared/ui/useToday";
import { CheckCheck, Settings } from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  allowsProjectNotification,
  subscribeNotificationPreferences,
} from "../../notifications/model/notificationPreferences";
import {
  knownNotificationProject,
  subscribeNotificationProjects,
} from "../../notifications/model/notificationProjects";
import { reopenOwnerApproval } from "../../notifications/model/ownerApprovals";
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import { LAYER } from "../../../shared/lib/layers";
import type { Session } from "../model/session";
import { HistoryItem } from "./NotificationHistoryItem";
import { NotificationRequestCard } from "./NotificationRequestCard";
import { OwnerRequestRow } from "./OwnerRequestRow";
import { useOwnerNotifications, type OwnerRequestRow as OwnerRow } from "./useOwnerNotifications";
import {
  historyOccurrenceIds,
  MAX_NOTIFICATION_HISTORY,
  groupHistoryByDay,
  isHistoryUnread,
  markNotificationsSeen,
  notificationKey,
  useNotificationHistory,
  useNotificationSeenAt,
  type NotificationHistoryEntry,
} from "../../notifications";
import "./notification-sheet.css";
import {
  LocalHostDownNotice,
  LocalHostRevokedNotice,
  useLocalHostDownNotice,
} from "../../connections/public/LocalHostDownNotice";
import { useRevokedLocalMachine } from "../../connections/public/localHostService";

export type Notice = PendingApprovalNotice & { session: Session };
type Props = {
  triggerTarget?: HTMLElement | null;
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
  /** Opens the view a `background:*` history entry points at (tasks, assistant, account...). */
  onOpenBackground?: (target: string) => void;
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

function subscribeEligibility(onChange: () => void): () => void {
  const offPreferences = subscribeNotificationPreferences(onChange);
  const offProjects = subscribeNotificationProjects(onChange);
  return () => {
    offPreferences();
    offProjects();
  };
}

/** Keys of the popup notices whose project is known and allows an agent-input notification. */
function eligibleNoticeKeys(
  popupNotices: Notice[],
  lock: Parameters<typeof isProjectLockedIn>[0],
  dismissed: ReadonlySet<string>,
  occurred: ReadonlyMap<string, number>,
): string {
  return JSON.stringify(
    popupNotices
      .filter((notice) => {
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
      })
      .map(noticeKey),
  );
}

export function ApprovalToasts({
  triggerTarget,
  notices,
  popupNotices = notices,
  onFocusSession,
  onApproval,
  onOpenHistorySession,
  onOpenBackground,
  onOpenSettings,
}: Props) {
  const t = useT();
  const currentDay = useToday();
  const localHostNotice = useLocalHostDownNotice();
  const revokedLocalMachine = useRevokedLocalMachine();
  useProjectNotificationPreferences();
  const lock = useLockSnapshot();
  const ownerRequests = useOwnerNotifications();
  const [expanded, setExpanded] = useState(false);
  const seenAt = useNotificationSeenAt();
  const {
    history,
    unavailable: historyUnavailable,
    clearError,
    clearing,
    reload: reloadHistory,
    clear,
    remove: removeHistoryEntry,
    markRead: markHistoryRead,
  } = useNotificationHistory(notices);
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
  // Dismissals end with their notice, so a notice that returns is shown again.
  const liveKeys = new Set(notices.map(noticeKey));
  if (hasLocked) liveKeys.add("locked");
  if ([...dismissed].some((key) => !liveKeys.has(key))) {
    setDismissed(new Set([...dismissed].filter((key) => liveKeys.has(key))));
  }
  const count =
    open.length +
    ownerRequests.length +
    (hasLocked ? 1 : 0) +
    (localHostNotice.visible ? 1 : 0) +
    (revokedLocalMachine ? 1 : 0);
  const liveRequests = new Set(notices.map(noticeKey));
  const historyIds = historyOccurrenceIds(visibleHistory);
  // A request that is still pending is answered in the pending card, so Recent skips it.
  const recent = visibleHistory
    .map((entry, index) => ({ entry, id: historyIds[index] }))
    .filter(({ entry }) => !liveRequests.has(entry.key));
  // Rows stay unread until the owner marks them read; looking at the sheet does not.
  const unreadCount = recent.filter(({ entry }) => isHistoryUnread(entry, seenAt)).length;
  const badgeCount = count + unreadCount;
  // Today follows the local midnight through the shared clock store, not a render-time read.
  const { today, earlier } = groupHistoryByDay(
    recent,
    ({ entry }) => entry.occurredAt,
    currentDay?.getTime() ?? 0,
  );
  // Project preferences and the project catalog live in browser storage, so React reads them
  // through their stores.
  const eligibleKeys: string[] = JSON.parse(
    useSyncExternalStore(
      subscribeEligibility,
      () => eligibleNoticeKeys(popupNotices, lock, dismissed, occurred),
      () => eligibleNoticeKeys(popupNotices, lock, dismissed, occurred),
    ),
  );
  const eligible = popupNotices.filter((notice) => eligibleKeys.includes(noticeKey(notice)));
  const dismiss = (key: string) => setDismissed((previous) => new Set([...previous, key]));
  const dismissAll = () =>
    setDismissed(new Set([...dismissed, ...notices.map(noticeKey), "locked"]));
  const openPanel = () => setExpanded(true);
  const hidePanel = () => {
    setOptionsAnchor(null);
    setExpanded(false);
  };
  const closePanel = () => {
    hidePanel();
    trigger.current?.focus();
  };
  // A conversation answers its own request; otherwise the shared confirmation is already open.
  const openOwnerRequest = (row: OwnerRow) => {
    hidePanel();
    if (row.sessionId) onFocusSession(row.sessionId);
    // A deferred request without a conversation returns to the shared dialog.
    else if (row.key.startsWith("owner:")) reopenOwnerApproval(row.key.slice("owner:".length));
  };
  const focusSession = (id: string) => {
    const notice = notices.find((item) => item.sessionId === id);
    if (notice) dismiss(noticeKey(notice));
    hidePanel();
    onFocusSession(id);
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === POPUP_PREFERENCE || event.key === null)
        setPopupsEnabled(readPopupsEnabled());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  // ConfirmMorph shows its error state when the confirmation rejects.
  const clearHistory = async () => {
    if (!(await clear())) throw new Error(t("Notification history could not be cleared."));
  };
  const livePending = new Set(notices.map((notice) => notice.sessionId));
  const canOpenHistory = (entry: NotificationHistoryEntry) =>
    entry.kind === "owner"
      ? false
      : entry.target
        ? Boolean(onOpenBackground)
        : Boolean(onOpenHistorySession) || livePending.has(entry.sessionId);
  const openHistorySession = async (entry: NotificationHistoryEntry) => {
    if (entry.target) {
      onOpenBackground?.(entry.target);
      closePanel();
      return;
    }
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
    hidePanel();
  };
  // One card holds everything that waits for the owner, separated by dividers.
  const pendingRows = [
    ...(localHostNotice.visible
      ? [{ key: "local-host", node: <LocalHostDownNotice notice={localHostNotice} /> }]
      : []),
    ...(revokedLocalMachine
      ? [
          {
            key: "local-host-revoked",
            node: <LocalHostRevokedNotice machine={revokedLocalMachine} />,
          },
        ]
      : []),
    ...ownerRequests.map((row) => ({
      key: row.key,
      node: <OwnerRequestRow row={row} onOpen={openOwnerRequest} />,
    })),
    ...open.map((notice) => ({
      key: noticeKey(notice),
      node: (
        <NotificationRequestCard
          notice={notice}
          occurredAt={occurred.get(noticeKey(notice))}
          onFocusSession={focusSession}
          onApproval={onApproval}
        />
      ),
    })),
    ...(hasLocked ? [{ key: "locked", node: <LockedNotice /> }] : []),
  ];
  const bell = (
    <NotificationBell
      label={t("Notifications")}
      muted={!popupsEnabled}
      iconSize={triggerTarget ? "md" : "sm"}
      count={badgeCount}
      tone={count > 0 ? "warning" : "accent"}
      countId={`${panelId}-count`}
      ref={trigger}
      aria-expanded={expanded}
      aria-controls={expanded ? panelId : undefined}
      onClick={() => {
        setOptionsAnchor(null);
        if (expanded) hidePanel();
        else openPanel();
      }}
    />
  );
  return (
    <>
      {triggerTarget ? <Portal target={triggerTarget}>{bell}</Portal> : bell}
      {expanded ? (
        <Sheet
          padding="none"
          modal={false}
          anchor="viewport"
          side="end"
          size="sm"
          inset={{ top: 40, bottom: 32 }}
          layer={LAYER.toast}
          ignore={trigger}
          title={t("Notifications")}
          closeLabel={t("Close")}
          initialFocus="button"
          scroll="none"
          onClose={closePanel}
          headerActions={
            <>
              {unreadCount > 0 ? (
                <Button
                  iconOnly
                  label={t("Mark all read")}
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => markNotificationsSeen()}
                >
                  <CheckCheck aria-hidden className="icon-sm" />
                </Button>
              ) : null}
              <Button
                iconOnly
                size="sm"
                label={t("Notification options")}
                variant="ghost"
                aria-expanded={Boolean(optionsAnchor)}
                aria-controls={optionsAnchor ? `${panelId}-options` : undefined}
                onClick={(event) => setOptionsAnchor(optionsAnchor ? null : event.currentTarget)}
              >
                <Settings className="icon-sm" />
              </Button>
            </>
          }
        >
          {optionsAnchor ? (
            <Popover
              id={`${panelId}-options`}
              anchor={optionsAnchor}
              role="region"
              aria-label={t("Notification options")}
              variant="panel"
              className="flex flex-col gap-2"
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
                    hidePanel();
                    onOpenSettings();
                  }}
                >
                  {t("All notification settings…")}
                </Button>
              ) : null}
              {history.length > 0 ? (
                <ConfirmMorph
                  label={t("Clear all")}
                  prompt={t("Clear history?")}
                  confirmLabel={t("Clear")}
                  onConfirm={clearHistory}
                />
              ) : null}
              <InfoTooltip>
                {t("Only the latest {p0} notifications are kept on this device.", {
                  p0: MAX_NOTIFICATION_HISTORY,
                })}
              </InfoTooltip>
            </Popover>
          ) : null}
          <ScrollArea
            as="section"
            gutter="stable"
            aria-label={t("Notifications")}
            className="notification-sheet-list"
          >
            {historyUnavailable ? (
              <Alert tone="warning" action={{ label: t("Retry"), onClick: reloadHistory }}>
                {t("Notification history could not be read. Showing what this window has.")}
              </Alert>
            ) : null}
            {clearError ? (
              <Alert
                tone="danger"
                action={{ label: t("Retry"), onClick: () => void clear(), pending: clearing }}
              >
                {t("Notification history could not be cleared. Nothing was removed.")}
              </Alert>
            ) : null}
            {count > 0 ? (
              <>
                <SectionLabel className="notification-section-label">
                  {t("Waiting for you")}
                </SectionLabel>
                <Surface variant="card" padding="none" className="notification-pending-card">
                  {pendingRows.map((row, index) => (
                    <Fragment key={row.key}>
                      {index > 0 ? <Divider decorative /> : null}
                      {row.node}
                    </Fragment>
                  ))}
                </Surface>
              </>
            ) : null}
            {[
              { key: "today", label: t("Today"), rows: today },
              { key: "earlier", label: t("Earlier"), rows: earlier },
            ].map((group) =>
              group.rows.length > 0 ? (
                <Fragment key={group.key}>
                  <SectionLabel className="notification-section-label">{group.label}</SectionLabel>
                  <div className="notification-sheet-items">
                    {group.rows.map(({ entry, id }) => (
                      <HistoryItem
                        key={id}
                        entry={entry}
                        unread={isHistoryUnread(entry, seenAt)}
                        canOpen={canOpenHistory(entry)}
                        onOpen={openHistorySession}
                        onRemove={removeHistoryEntry}
                        onMarkRead={markHistoryRead}
                      />
                    ))}
                  </div>
                </Fragment>
              ) : null,
            )}
            {visibleHistory.length < history.length ? <LockedNotice /> : null}
            {count === 0 && recent.length === 0 && !historyUnavailable ? (
              <EmptyState size="inline" context="list" description={t("All clear")} />
            ) : null}
          </ScrollArea>
        </Sheet>
      ) : popupsEnabled && (eligible.length > 0 || (hasLocked && !dismissed.has("locked"))) ? (
        <ToastSlot>
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
              <Button variant="ghost" type="button" onClick={openPanel}>
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
  return (
    <Motion enter="down" duration="standard">
      <ToastCard
        className="approval-toast"
        tone="warning"
        message={t("A session in a locked group needs attention")}
        durationMs={onDismiss ? POPUP_DURATION : null}
        onDismiss={onDismiss}
      />
    </Motion>
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
      <NotificationRequestCard {...props} />
    </div>
  );
}
