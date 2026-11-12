import { NotificationRequestCount } from "./NotificationRequestCount";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Surface } from "../../../shared/ui/Surface";
import { Divider } from "../../../shared/ui/Divider";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { Popover } from "../../../shared/ui/Popover";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Sheet } from "../../../shared/ui/Sheet";
import { LiveText } from "../../../shared/ui/LiveText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Badge } from "../../../shared/ui/Badge";
import { ToastCard, ToastSlot, useAutoDismiss } from "../../../shared/ui/ToastRegion";
import { useT } from "../../../shared/i18n";
import { Bell, BellOff, Settings } from "../../../shared/ui/icons";
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
import { useProjectNotificationPreferences } from "../../notifications/hooks/useProjectNotificationPreferences";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import { LOCKED_NOTIFICATION_TEXT } from "../../notifications/model/attention";
import type { ApprovalDispatch } from "./ApprovalDecisionContext";
import type { PendingApprovalNotice } from "../../notifications/model/approvalToast";
import { LAYER } from "../../../shared/lib/layers";
import type { Session } from "../model/session";
import { HistoryItem } from "./NotificationHistoryItem";
import { NotificationRequestCard } from "./NotificationRequestCard";
import {
  historyOccurrenceIds,
  MAX_NOTIFICATION_HISTORY,
  countUnseenNotifications,
  markNotificationsSeen,
  notificationKey,
  useNotificationHistory,
  useNotificationSeenAt,
  type NotificationHistoryEntry,
} from "../../notifications";
import "./notification-sheet.css";
import {
  LocalHostDownNotice,
  useLocalHostDownNotice,
} from "../../connections/public/LocalHostDownNotice";

export type Notice = PendingApprovalNotice & { session: Session };
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
  notices,
  popupNotices = notices,
  onFocusSession,
  onApproval,
  onOpenHistorySession,
  onOpenBackground,
  onOpenSettings,
}: Props) {
  const t = useT();
  const localHostNotice = useLocalHostDownNotice();
  useProjectNotificationPreferences();
  const lock = useLockSnapshot();
  const [expanded, setExpanded] = useState(false);
  const seenAt = useNotificationSeenAt();
  // The marker from before the sheet opened: rows newer than it show "New" while the sheet stays open.
  const [newSince, setNewSince] = useState<number | null>(null);
  const {
    history,
    unavailable: historyUnavailable,
    clearError,
    clearing,
    reload: reloadHistory,
    clear,
    remove: removeHistoryEntry,
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
  const count = open.length + (hasLocked ? 1 : 0) + (localHostNotice.visible ? 1 : 0);
  const liveRequests = new Set(notices.map(noticeKey));
  const historyIds = historyOccurrenceIds(visibleHistory);
  // A request that is still pending is answered in the pending card, so Recent skips it.
  const recent = visibleHistory
    .map((entry, index) => ({ entry, id: historyIds[index] }))
    .filter(({ entry }) => !liveRequests.has(entry.key));
  const unseen = expanded
    ? 0
    : countUnseenNotifications(
        recent.map(({ entry }) => entry),
        seenAt,
      );
  const badgeCount = count + unseen;
  const newCount =
    newSince === null ? 0 : recent.filter(({ entry }) => entry.occurredAt > newSince).length;
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
  const openPanel = () => {
    setNewSince(seenAt);
    markNotificationsSeen();
    setExpanded(true);
  };
  // Arrivals watched while the sheet was open must not badge once it closes.
  const hidePanel = () => {
    markNotificationsSeen();
    setOptionsAnchor(null);
    setExpanded(false);
  };
  const closePanel = () => {
    hidePanel();
    trigger.current?.focus();
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
    entry.target
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
        aria-label={t("Notifications")}
        aria-describedby={badgeCount > 0 ? `${panelId}-count` : undefined}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => {
          setOptionsAnchor(null);
          if (expanded) hidePanel();
          else openPanel();
        }}
      >
        <span className="relative inline-flex size-4 shrink-0">
          {popupsEnabled ? <Bell className="icon-md" /> : <BellOff className="icon-md" />}
          {badgeCount > 0 ? (
            <NotificationRequestCount
              id={`${panelId}-count`}
              count={badgeCount}
              tone={count > 0 ? "warning" : "accent"}
            />
          ) : null}
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
              variant="ghost"
              aria-expanded={Boolean(optionsAnchor)}
              aria-controls={optionsAnchor ? `${panelId}-options` : undefined}
              onClick={(event) => setOptionsAnchor(optionsAnchor ? null : event.currentTarget)}
            >
              {popupsEnabled ? <Settings className="icon-sm" /> : <BellOff className="icon-sm" />}
            </Button>
          }
          headerBelow={
            <div className="notification-history-toolbar">
              <Text className="notification-summary" truncate>
                <LiveText
                  text={
                    count > 0
                      ? t("{p0} waiting for your answer", { p0: count })
                      : newCount > 0
                        ? t("{p0} new", { p0: newCount })
                        : t("You're all caught up")
                  }
                />
              </Text>
              {history.length > 0 ? (
                <ConfirmMorph
                  label={t("Clear all")}
                  prompt={t("Clear history?")}
                  confirmLabel={t("Clear")}
                  onConfirm={clearHistory}
                />
              ) : null}
            </div>
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
                    hidePanel();
                    onOpenSettings();
                  }}
                >
                  {t("All notification settings…")}
                </Button>
              ) : null}
              <Text as="p" size="caption" tone="secondary" leading="relaxed">
                {t("Only the latest {p0} notifications are kept on this device.", {
                  p0: MAX_NOTIFICATION_HISTORY,
                })}
              </Text>
            </Popover>
          ) : null}
          <ScrollArea
            as="section"
            gutter="stable"
            aria-label={t("Notifications")}
            className="notification-sheet-list"
          >
            {historyUnavailable ? (
              <div className="notification-history-status">
                <Alert tone="warning">
                  {t("Notification history could not be read. Showing what this window has.")}
                </Alert>
                <Button variant="ghost" size="sm" type="button" onClick={reloadHistory}>
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
            {clearError ? (
              <div className="notification-history-status">
                <Alert tone="danger">
                  {t("Notification history could not be cleared. Nothing was removed.")}
                </Alert>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  loading={clearing}
                  onClick={() => void clear()}
                >
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
            {count > 0 ? (
              <>
                <SectionLabel
                  className="notification-section-label"
                  actions={
                    <Badge variant="count" tone="warning" size="xs">
                      {count}
                    </Badge>
                  }
                >
                  {t("Waiting for you")}
                </SectionLabel>
                <Surface variant="outline" padding="none" className="notification-pending-card">
                  {pendingRows.map((row, index) => (
                    <Fragment key={row.key}>
                      {index > 0 ? <Divider decorative /> : null}
                      {row.node}
                    </Fragment>
                  ))}
                </Surface>
              </>
            ) : null}
            {count > 0 && recent.length > 0 ? (
              <SectionLabel className="notification-section-label">{t("Recent")}</SectionLabel>
            ) : null}
            <div className="notification-sheet-items">
              {recent.map(({ entry, id }) => (
                <HistoryItem
                  key={id}
                  entry={entry}
                  isNew={newSince !== null && entry.occurredAt > newSince}
                  canOpen={canOpenHistory(entry)}
                  onOpen={openHistorySession}
                  onRemove={removeHistoryEntry}
                />
              ))}
              {visibleHistory.length < history.length ? <LockedNotice /> : null}
            </div>
            {count === 0 && recent.length === 0 && !historyUnavailable ? (
              <EmptyState
                context="list"
                icon={<Bell className="size-6" aria-hidden />}
                title={t("All clear")}
                description={t("New notifications will appear here.")}
              />
            ) : null}
          </ScrollArea>
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
    <ToastCard
      className="approval-toast"
      tone="warning"
      message={t(LOCKED_NOTIFICATION_TEXT)}
      durationMs={onDismiss ? POPUP_DURATION : null}
      onDismiss={onDismiss}
    />
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
