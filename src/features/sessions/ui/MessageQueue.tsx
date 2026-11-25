import { catalogText } from "../model/catalogText";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { flushSync } from "react-dom";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { actionDragAttributes } from "../../../shared/ui/ActionHost";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { activeQueueFeedback, type QueueFeedback } from "./queueFeedback";
import { canSendQueueMessage } from "../model/queueAction";
import { useAcceptedQueueDeparture, type MessageQueueProps } from "./useAcceptedQueueDeparture";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { chatCitationPreview, extractChatCitations } from "../model/chatCitation";
import { findCitationTokens } from "../model/citationTokens";
import { rewriteTokenMatches } from "../model/attachmentTokens";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import {
  DeliveryNoticeReopen,
  DeliveryProgressNotice,
  DeliveryProgressIndicator,
  deliveryIsPending,
  useDeliveryProgress,
  useQueueDeliveryMessage,
} from "./DeliveryProgressNotice";
import { queueState } from "../../connections/public/queueState";
import { useQueueHoldReason } from "../model/deliveryReview";
import {
  takeOverSharedLocalQueue,
  useSharedQueueLeaseHeld,
} from "../../connections/public/useSharedLocalQueues";
import {
  useParentInputClosure,
  useParentInputsClosed,
  canMutateParentInputs,
  mutateParentInput,
  type ParentAdmission,
} from "../data/parentInputClosure";
import { useT } from "../../../shared/i18n";
import type { QueueAction } from "../model/queueAction";
import type { Attachment } from "../model/session";
import "./chat-controls.css";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  GripVertical,
  Pause,
  Pencil,
  Play,
  Trash2,
  ArrowLeftRight,
} from "../../../shared/ui/icons";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { QueuedMessage } from "../model/session";
import { steerAppliesModelSettings } from "../../../integrations/harness/core/registry";
import { accountChoicesSnapshot, accountDisplayLabel } from "../model/accountModelChoices";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { hasMissingAttachment } from "../model/queuePersistence";
import { useQueuedSteerRoute, useQueuedTargetSummary } from "../model/reactiveReads";
import { moveQueuedMessage, ownerQueueRows, runningTargetOf } from "../model/messageQueue";
import { HarnessIcon } from "./HarnessIcon";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { announceDrag } from "../../../shared/lib/drag";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";
import { Button } from "../../../shared/ui/Button";
import { QueueRemovalNotice } from "./QueueRemovalNotice";
import { QueuedDelegationRow } from "./QueuedDelegationRow";
type QueueActionContext = {
  actionRef: { current: boolean };
  setPendingAction: (id: string | undefined) => void;
  setFeedback: (feedback: QueueFeedback) => void;
  t: ReturnType<typeof useT>;
};

// Module level: React Compiler cannot lower try/finally inside a component.
async function runQueueAction(
  id: string,
  action: (() => QueueAction) | undefined,
  { actionRef, setPendingAction, setFeedback, t }: QueueActionContext,
): Promise<boolean> {
  try {
    if (!action)
      throw new Error(
        t("This queue action is unavailable. Reopen the conversation and try again."),
      );
    const result = await action();
    if (result === false) return false;
    if (id === "takeover" && typeof result === "object" && result?.message)
      setFeedback({ error: false, actionId: id, text: t(result.message) });
    return true;
  } catch (error) {
    setFeedback({
      error: true,
      actionId: id,
      text: presentRemoteError(error, { explicit: true }),
    });
    return false;
  } finally {
    actionRef.current = false;
    setPendingAction(undefined);
  }
}

type AccountList = { id: string; label: string }[];
// Even compact rows fill the capped viewport well before the end of one page.
const QUEUE_PAGE_SIZE = 12;

export function MessageQueue({
  sessionId,
  parentSessionId,
  messages: queued,
  status,
  onDelete,
  canAttach,
  references,
  suggestions,
  remote = false,
  busy = false,
  waitingOnSubagents = false,
  runningTarget,
  steerSupported = false,
  account: conversationAccount,
  onEdit,
  onEditingChange,
  onReorder,
  onSteer,
  onResume,
}: Omit<MessageQueueProps, "onEdit"> & {
  onEdit?: (messageId: string, text: string, attachments: Attachment[]) => boolean | void;
}) {
  const t = useT();
  // The account lists live in storage; the string snapshot keeps the subscription value-stable.
  const accountListsJson = useSyncExternalStore(
    subscribeProviderAccounts,
    accountChoicesSnapshot,
    accountChoicesSnapshot,
  );
  const accountLists: Partial<Record<string, AccountList>> = JSON.parse(accountListsJson);
  const delivery = useDeliveryProgress(sessionId);
  const queueDelivery = useQueueDeliveryMessage(sessionId, delivery);
  const pendingDelivery = deliveryIsPending(delivery?.stage);
  const heldByOtherWindow = useSharedQueueLeaseHeld(sessionId ?? "");
  const holdReason = useQueueHoldReason(sessionId ?? "");
  const holdDetail = holdReason && holdReason !== "stopped" ? holdReason : undefined;
  const messages = ownerQueueRows(queued, {
    status,
    held: heldByOtherWindow || !!holdDetail,
    deliveryProblem:
      delivery?.stage === "rejected" || delivery?.stage === "unknown"
        ? delivery.messageId
        : undefined,
  });
  const departing = useAcceptedQueueDeparture(messages, delivery);
  const reviewRow = messages.find((row) => row.deliveryUnknown);
  const [visibleCount, setVisibleCount] = useState(QUEUE_PAGE_SIZE);
  // An uncertain delivery must be reachable immediately, including in a deep queue.
  const hasMoreRows = !reviewRow && visibleCount < messages.length;
  const visibleMessages = hasMoreRows ? messages.slice(0, visibleCount) : messages;
  const showMoreRows = () => setVisibleCount(visibleCount + QUEUE_PAGE_SIZE);
  const actionRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<string>();
  const dragAdmission = useRef<{
    admission: ParentAdmission;
    identity: object | null;
    committed: boolean;
    ended: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      const drag = dragAdmission.current;
      drag?.admission.finish();
      dragAdmission.current = null;
    },
    [],
  );
  const [feedback, setFeedback] = useState<QueueFeedback>();
  const [removals, setRemovals] = useState<
    { id: string; undo: () => QueueAction; dispose?: () => void }[]
  >([]);
  const removalsRef = useRef(removals);
  useLayoutEffect(() => {
    removalsRef.current = removals;
  }, [removals]);
  useEffect(
    () => () => {
      for (const entry of removalsRef.current) entry.dispose?.();
    },
    [],
  );
  const dismissRemoval = useCallback((id: string) => {
    removalsRef.current.find((entry) => entry.id === id)?.dispose?.();
    setRemovals((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const queueClosed = useParentInputsClosed(parentSessionId);
  const queueOwner = useParentInputClosure({
    kind: "queue-edit",
    sessionId: parentSessionId,
    snapshot: () => ({
      source: "message-queue",
      messages,
      editingId,
      pendingAction,
      feedback,
      actionPending: actionRef.current,
    }),
  });
  const activeFeedback = activeQueueFeedback(feedback, status, heldByOtherWindow, messages);
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const perform = async (id: string, action: (() => QueueAction) | undefined) => {
    if (actionRef.current) return false;
    const admitted = queueOwner.admit();
    if (!admitted) return false;
    return admitted.run(async () => {
      actionRef.current = true;
      setPendingAction(id);
      setFeedback(undefined);
      return runQueueAction(id, action, { actionRef, setPendingAction, setFeedback, t });
    });
  };
  const trigger = (id: string, action: (() => QueueAction) | undefined) => {
    void perform(id, action).catch((error: unknown) =>
      setFeedback({
        error: true,
        actionId: "admission",
        text: presentRemoteError(error, { explicit: true }),
      }),
    );
  };
  const removeMessage = (id: string) =>
    trigger(
      `remove:${id}`,
      onDelete
        ? () => {
            const result = onDelete(id);
            if (result === false) return false;
            if (result && typeof result === "object") {
              setRemovals((current) => [
                ...current,
                { id: crypto.randomUUID(), undo: result.undo, dispose: result.dispose },
              ]);
            }
            return true;
          }
        : undefined,
    );
  const sortable = useAnimatedReorder(
    messages.map((message) => message.id),
    (ids) => {
      if (actionRef.current) return;
      const drag = dragAdmission.current;
      if (drag && !drag.admission.settled) {
        try {
          if (queueOwner.identity() !== drag.identity) return;
          drag.admission.apply(() =>
            canMutateParentInputs(parentSessionId)
              ? onReorder?.(ids)
              : onReorder?.(ids, drag.admission),
          );
          drag.committed = true;
        } catch {
          queueOwner();
        }
      } else mutateParentInput(queueOwner, () => onReorder?.(ids));
    },
    "y",
    undefined,
    {
      label: () => t("Queued message"),
      onEnd: () => {
        const drag = dragAdmission.current;
        if (!drag) return;
        drag.ended = true;
        // reset() precedes the shared hook's synchronous order callback. Keep
        // the original ticket until that callback, including its settling timer.
        queueMicrotask(() => {
          if (!drag.committed && queueOwner.identity() === drag.identity) queueOwner();
          drag.admission.finish();
          if (dragAdmission.current === drag) dragAdmission.current = null;
        });
      },
    },
  );
  const card = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | undefined>(undefined);
  // Moving a focused row in the DOM drops its focus; give it back after a keyboard move.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    card.current?.querySelector<HTMLElement>(`[data-queue-handle="${refocus.current}"]`)?.focus();
    refocus.current = undefined;
  }, [messages]);
  const moveByKey = (event: KeyboardEvent, id: string, index: number) => {
    if (!queueOwner.canMutate()) return;
    if (
      actionRef.current ||
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    )
      return;
    event.preventDefault();
    const next = moveQueuedMessage(messages, id, index + (event.key === "ArrowUp" ? -1 : 1));
    if (next === messages) return;
    if (hasMoreRows && index + 1 === visibleCount && event.key === "ArrowDown") showMoreRows();
    refocus.current = id;
    onReorder?.(next.map((message) => message.id));
    announceDrag(
      t("Moved {p0} to position {p1} of {p2}", {
        p0: t("Queued message"),
        p1: next.findIndex((message) => message.id === id) + 1,
        p2: next.length,
      }),
    );
  };
  const [editingId, setEditingId] = useState<string>();
  const onEditingChangeRef = useRef(onEditingChange);
  const editingIdRef = useRef(editingId);
  useLayoutEffect(() => {
    onEditingChangeRef.current = onEditingChange;
    editingIdRef.current = editingId;
  }, [onEditingChange, editingId]);
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.();
    };
  }, []);
  const editingMessage = messages.find((message) => message.id === editingId);
  useEffect(() => {
    if (editingId && !editingMessage) {
      // oxlint-disable-next-line react-hooks-js/set-state-in-effect -- Leave edit mode once the edited row is removed from the queue.
      setEditingId(undefined);
      onEditingChangeRef.current?.();
    }
  }, [editingId, editingMessage]);
  const targetSummary = useQueuedTargetSummary();
  const steerRoute = useQueuedSteerRoute(
    runningTarget ? { ...runningTarget, busy } : undefined,
    runningTarget ? steerAppliesModelSettings(runningTargetOf(runningTarget).harness) : false,
  );
  if (messages.length === 0 && !pendingAction && !activeFeedback && !departing && !removals.length)
    return null;
  const paused = (status === "paused" || status === "resuming") && messages.length > 0;
  const hold = queueState({
    status,
    messages,
    unknownDelivery: delivery?.stage === "unknown",
    rejected:
      (delivery?.stage === "rejected" && delivery.messageId === messages[0]?.id) || !!holdDetail,
    leaseHeld: heldByOtherWindow,
  });
  const leaseHeld = !paused && hold.kind === "held" && hold.reason === "lease";
  const restored = status === "restored" && messages.length > 0;
  // The reopen button sits in the first header that shows, so it never appears twice.
  const reopenIn = paused
    ? "paused"
    : leaseHeld && sessionId
      ? "lease"
      : restored
        ? "restored"
        : "summary";
  // Why a queue action is off while a send or a session checkpoint is in progress. Only
  // `disabledReason` uses these; every `disabled` condition below is unchanged.
  const sendingReason =
    pendingAction || pendingDelivery ? t("Unavailable while the queue is sending") : undefined;
  const busyReason = queueClosed
    ? t("Unavailable while the session checkpoint is prepared")
    : sendingReason;
  const canSend = (message: QueuedMessage) =>
    canSendQueueMessage(message, {
      blocked:
        queueClosed ||
        !!pendingAction ||
        pendingDelivery ||
        (delivery?.messageId === message.id && delivery.stage === "unknown") ||
        hasMissingAttachment(message),
      busy,
      steerSupported,
      route: runningTarget ? steerRoute(message) : "join",
    });
  const startEdit = (message: QueuedMessage) => {
    if (!queueOwner.canMutate()) return;
    setEditingId(message.id);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    queueOwner();
    setEditingId(undefined);
    onEditingChange?.();
  };
  return (
    <Text as="div" size="inherit" tone="secondary" data-message-queue data-usage-guide="queue">
      <div
        {...surfaceAttributes(
          { radius: "popup", variant: "floating", material: "glass" },
          "relative z-0 mb-2 px-2 pt-2 pb-1.5",
        )}
        data-message-queue-card
        ref={card}
      >
        {paused ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="mb-1 flex min-h-(--ui-control-height-compact) flex-wrap items-center gap-x-2 gap-y-1"
          >
            <Pause className="icon-sm shrink-0" />
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <Text
              size="inherit"
              tone="inherit"
              className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]"
            >
              {(delivery &&
                (delivery.stage === "rejected" ||
                  delivery.stage === "unknown" ||
                  delivery.stage === "waiting")) ||
              messages.some((message) => message.deliveryUnknown)
                ? `${t("Queue")} · ${messages.length}`
                : hold.kind === "held" && hold.reason === "unknown"
                  ? t("Queue held: delivery is not confirmed")
                  : hold.kind === "held" && hold.reason === "rejected"
                    ? t("Queue paused: the last message was not accepted")
                    : // A failed turn or an unsynced hold also pauses: blame a Stop only when it was one.
                      holdReason === "stopped"
                      ? t("Queue paused because you interrupted")
                      : t("Queue paused")}
            </Text>
            {reopenIn === "paused" && !reviewRow ? (
              <DeliveryNoticeReopen sessionId={sessionId} messages={messages} />
            ) : null}
            {!reviewRow ? (
              <Button
                variant="ghost"
                type="button"
                disabled={
                  !onResume ||
                  !!pendingAction ||
                  pendingDelivery ||
                  // An unconfirmed delivery is settled in the delivery notice, never by a blind resend.
                  (hold.kind === "held" && hold.reason === "unknown") ||
                  hasMissingAttachment(messages[0])
                }
                disabledReason={
                  sendingReason ??
                  // An unconfirmed delivery is settled in the delivery notice, never by a blind resend.
                  (hold.kind === "held" && hold.reason === "unknown"
                    ? t("Delivery is not confirmed. Automatic resend is held.")
                    : hasMissingAttachment(messages[0])
                      ? t("Attachment missing")
                      : !onResume
                        ? t(
                            "This queue action is unavailable. Reopen the conversation and try again.",
                          )
                        : undefined)
                }
                loading={pendingAction === "resume"}
                loadingLabel={t("Resuming…")}
                onClick={() => trigger("resume", onResume)}
                startIcon={<Play className="icon-sm" />}
                className="shrink-0"
              >
                {t("Resume")}
              </Button>
            ) : null}
          </Text>
        ) : null}
        {leaseHeld && sessionId ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="mb-1 flex min-h-(--ui-control-height-compact) flex-wrap items-center gap-x-2 gap-y-1"
            data-queue-held-elsewhere
          >
            <Pause className="icon-sm shrink-0" />
            <Text
              size="inherit"
              tone="inherit"
              className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]"
            >
              {activeFeedback && !activeFeedback.error
                ? activeFeedback.text
                : t("Queue held by another window, which sends it")}
            </Text>
            {reopenIn === "lease" ? (
              <DeliveryNoticeReopen sessionId={sessionId} messages={messages} />
            ) : null}
            <Button
              variant="ghost"
              type="button"
              disabled={queueClosed || !!pendingAction || pendingDelivery}
              disabledReason={busyReason}
              loading={pendingAction === "takeover"}
              loadingLabel={t("Taking over…")}
              onClick={() => trigger("takeover", () => takeOverSharedLocalQueue(sessionId))}
              className="shrink-0"
            >
              {t("Take over")}
            </Button>
          </Text>
        ) : null}
        {restored ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="mb-1 flex min-h-(--ui-control-height-compact) flex-wrap items-center gap-x-2 gap-y-1"
          >
            <Pause className="icon-sm shrink-0" />
            <DeliveryProgressIndicator sessionId={sessionId} />
            <Text
              size="inherit"
              tone="inherit"
              className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]"
            >
              {messages.length === 1
                ? t("1 queued message restored")
                : t("{p0} queued messages restored", { p0: messages.length })}
            </Text>
            {reopenIn === "restored" ? (
              <DeliveryNoticeReopen sessionId={sessionId} messages={messages} />
            ) : null}
            <Button
              variant="ghost"
              type="button"
              disabled={
                !!pendingAction ||
                pendingDelivery ||
                messages.some((message) => message.deliveryUnknown) ||
                delivery?.stage === "unknown" ||
                hasMissingAttachment(messages[0]) ||
                (!onResume && !canSend(messages[0]))
              }
              disabledReason={
                sendingReason ??
                (messages.some((message) => message.deliveryUnknown) ||
                delivery?.stage === "unknown"
                  ? t("Delivery is not confirmed. Automatic resend is held.")
                  : hasMissingAttachment(messages[0])
                    ? t("Attachment missing")
                    : !onResume && !canSend(messages[0])
                      ? (busyReason ?? t("Queue is waiting for the current turn to finish."))
                      : undefined)
              }
              loading={pendingAction === "resume"}
              loadingLabel={t("Sending…")}
              onClick={() =>
                trigger("resume", onResume ?? (onSteer ? () => onSteer(messages[0].id) : undefined))
              }
              startIcon={<Play className="icon-sm" />}
              className="shrink-0"
            >
              {t("Send next")}
            </Button>
          </Text>
        ) : null}
        {messages.length > 0 && !paused && !restored && !leaseHeld ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="flex min-h-6 items-center gap-2 px-1.5 text-(--transcript-ink-chrome)"
            data-queue-summary
          >
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <Text size="inherit" tone="primary" weight="medium" className="shrink-0">
              {t("{p0} queued", { p0: messages.length })}
            </Text>
            {activeFeedback && !activeFeedback.error ? (
              <OverflowTooltip label={activeFeedback.text}>
                <Text size="inherit" tone="inherit" truncate tabIndex={0}>
                  {activeFeedback.text}
                </Text>
              </OverflowTooltip>
            ) : waitingOnSubagents ? (
              <OverflowTooltip label={t("Sends when the subagents finish")}>
                <Text size="inherit" tone="inherit" truncate tabIndex={0}>
                  {t("Sends when the subagents finish")}
                </Text>
              </OverflowTooltip>
            ) : null}
            {reopenIn === "summary" ? (
              <DeliveryNoticeReopen sessionId={sessionId} messages={messages} />
            ) : null}
          </Text>
        ) : null}
        {queueDelivery?.detail && messages.some((row) => row.id === queueDelivery.messageId) ? (
          <LiveText
            className="px-1 pb-1"
            size="caption"
            tone="secondary"
            text={catalogText(t, queueDelivery.detail)}
          />
        ) : null}
        <div
          className="max-h-[min(30dvh,15rem)] min-h-0 overflow-y-auto overscroll-contain"
          data-message-queue-rows
          onScroll={
            hasMoreRows
              ? (event) => {
                  const list = event.currentTarget;
                  if (list.scrollHeight - list.scrollTop - list.clientHeight < list.clientHeight)
                    showMoreRows();
                }
              : undefined
          }
        >
          {departing ? (
            <div className="queue-departure" data-queue-departure={departing.id} aria-hidden="true">
              <Text
                as="div"
                size="caption"
                tone="inherit"
                truncate
                className="min-w-0 overflow-hidden"
              >
                {departing.text || t("Queued message")}
              </Text>
            </div>
          ) : null}
          {visibleMessages.map((message, index) => {
            if (message.author?.kind === "delegation")
              return (
                <QueuedDelegationRow
                  key={message.id}
                  message={message}
                  itemRef={(node) => sortable.setItemRef(message.id, node)}
                  disabled={queueClosed || !!pendingAction || pendingDelivery}
                  disabledReason={busyReason}
                  onRemove={() => removeMessage(message.id)}
                />
              );
            const attachmentGone = hasMissingAttachment(message);
            const route = attachmentGone ? "join" : steerRoute(message);
            const target = message.modelTarget;
            const summary = target ? targetSummary(target) : undefined;
            const accounts =
              target && supportsProviderAccounts(target.harness)
                ? (accountLists[target.harness] ?? [])
                : [];
            // A row for the conversation's provider runs on its current account, not the
            // one it was queued with (the owner may have switched after a usage limit).
            const accountId =
              target && conversationAccount && target.harness === conversationAccount.harness
                ? conversationAccount.providerAccountId
                : target?.providerAccountId;
            const account = accounts.find((account) => account.id === (accountId ?? "default"));
            const accountLabel =
              target && supportsProviderAccounts(target.harness)
                ? account
                  ? accountDisplayLabel(accounts, account)
                  : accountId && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID
                    ? t("Removed account")
                    : t("Default account")
                : undefined;
            const targetLabel =
              target && summary
                ? [summary.model, accountLabel, summary.effort && catalogText(t, summary.effort)]
                    .filter(Boolean)
                    .join(" · ")
                : undefined;
            const routeNote =
              route === "switch"
                ? t(
                    "Steer stops the running turn, including its background work, and continues this conversation on the saved provider, as switching provider in the composer does.",
                  )
                : route === "restart"
                  ? t(
                      "Steer stops the running turn, including its background work, and starts this message as a new turn with its saved model.",
                    )
                  : undefined;
            const files = message.attachments.length;
            const { text, citations } = extractChatCitations(message.text);
            const label =
              rewriteTokenMatches(
                text,
                findCitationTokens(text, citations.length),
                () => "",
              ).trim() ||
              citations.map(chatCitationPreview).filter(Boolean).join(" · ") ||
              (files === 1 ? t("1 attachment") : t("{p0} attachments", { p0: files }));
            return (
              <Text
                key={message.id}
                ref={(node) => sortable.setItemRef(message.id, node)}
                as="div"
                size="caption"
                tone="inherit"
                {...actionDragAttributes(
                  { appearance: "lifted" },
                  "reorder-item grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 ps-1",
                )}
              >
                <Button
                  iconOnly
                  label={t("Reorder queued message")}
                  disabled={
                    messages.length < 2 || queueClosed || !!pendingAction || pendingDelivery
                  }
                  disabledReason={messages.length < 2 ? undefined : busyReason}
                  variant="ghost"
                  type="button"
                  data-queue-handle={message.id}
                  tooltip={t("Drag to reorder")}
                  shortcut="Alt+↑ / Alt+↓"
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onPointerDown={(event) => {
                    if (messages.length < 2 || event.button !== 0) return;
                    if (dragAdmission.current && !dragAdmission.current.ended) return;
                    const admitted = queueOwner.admit();
                    if (!admitted) return;
                    // Pointer reordering measures every row once at drag start.
                    if (hasMoreRows) flushSync(() => setVisibleCount(messages.length));
                    // This may synchronously finish the previous settling
                    // drag. Its callback must still see its original ticket.
                    if (sortable.onItemPointerDown(message.id, event) !== true) {
                      admitted.finish();
                      return;
                    }
                    dragAdmission.current = {
                      admission: admitted,
                      identity: queueOwner.identity(),
                      committed: false,
                      ended: false,
                    };
                  }}
                  onKeyDown={(event) => moveByKey(event, message.id, index)}
                  className="shrink-0"
                >
                  <GripVertical className="icon-sm" />
                </Button>
                <div className="min-w-0 py-1">
                  <OverflowTooltip label={label}>
                    <Text as="div" size="inherit" tone="secondary" truncate>
                      {label}
                    </Text>
                  </OverflowTooltip>
                  {attachmentGone ? (
                    <Text
                      size="inherit"
                      tone="warning"
                      className="block [overflow-wrap:anywhere]"
                      data-queue-attachment-missing
                    >
                      {t("Attachment missing")} · {t("Edit to drop it, or remove the message.")}
                    </Text>
                  ) : null}
                  {target && targetLabel ? (
                    <Text
                      size="micro"
                      tone="secondary"
                      className="flex min-w-0 items-center gap-1"
                      data-queue-target
                    >
                      <HarnessIcon harness={target.harness} className="size-3 shrink-0" />
                      <span aria-hidden="true">·</span>
                      <OverflowTooltip label={targetLabel}>
                        <Text size="inherit" tone="inherit" truncate>
                          {targetLabel}
                        </Text>
                      </OverflowTooltip>
                      {routeNote ? (
                        <InfoTooltip
                          label={
                            route === "switch"
                              ? t("Steer switches provider")
                              : t("Steer restarts with this model")
                          }
                          icon={<ArrowLeftRight className="icon-sm" aria-hidden="true" />}
                          className="shrink-0"
                        >
                          {routeNote}
                        </InfoTooltip>
                      ) : null}
                    </Text>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {message.id === reviewRow?.id ? (
                    <DeliveryProgressNotice
                      sessionId={sessionId}
                      messages={queued}
                      inlineRowId={message.id}
                      retryDisabled={
                        queueClosed ||
                        !!pendingAction ||
                        pendingDelivery ||
                        attachmentGone ||
                        heldByOtherWindow
                      }
                    />
                  ) : remote ? null : (
                    // A worded action: the row's one way to send now reads as such, not as an arrow.
                    <Button
                      size="sm"
                      label={
                        pendingAction === message.id ||
                        (pendingDelivery && delivery?.messageId === message.id)
                          ? t("Sending…")
                          : t("Steer")
                      }
                      variant="ghost"
                      type="button"
                      disabled={!canSend(message)}
                      disabledReason={
                        busyReason ??
                        (message.deliveryUnknown ||
                        (delivery?.messageId === message.id && delivery.stage === "unknown")
                          ? t("Delivery is not confirmed. Automatic resend is held.")
                          : attachmentGone
                            ? t("Attachment missing")
                            : busy &&
                                (message.intent === "plan" || message.intent === "orchestrate")
                              ? t(
                                  "New messages wait until this turn finishes. Stop pauses the queue.",
                                )
                              : busy && !steerSupported && route === "join"
                                ? t(
                                    "This host cannot steer the active turn. The message remains queued.",
                                  )
                                : undefined)
                      }
                      loading={
                        pendingAction === message.id ||
                        (pendingDelivery && delivery?.messageId === message.id)
                      }
                      loadingLabel={t("Sending…")}
                      onClick={() =>
                        trigger(message.id, onSteer ? () => onSteer(message.id) : undefined)
                      }
                      className="shrink-0"
                    >
                      {t("Steer")}
                    </Button>
                  )}
                  <Button
                    iconOnly
                    label={t("Edit queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    disabledReason={busyReason}
                    variant="ghost"
                    type="button"
                    onClick={() => startEdit(message)}
                    className="shrink-0"
                  >
                    <Pencil className="icon-sm" />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    label={t("Remove queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    disabledReason={busyReason}
                    onClick={() => removeMessage(message.id)}
                  >
                    <Trash2 className="icon-sm" />
                  </Button>
                </div>
              </Text>
            );
          })}
          {hasMoreRows ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = visibleMessages.length;
                flushSync(showMoreRows);
                card.current
                  ?.querySelectorAll<HTMLElement>("[data-queue-handle], [data-queue-notice] button")
                  [next]?.focus();
              }}
            >
              {t("Show more")}
            </Button>
          ) : null}
        </div>
        {removals.map((entry) => (
          <QueueRemovalNotice
            key={entry.id}
            id={entry.id}
            onUndo={() => perform(`undo:${entry.id}`, entry.undo).then((value) => value === true)}
            onDismiss={dismissRemoval}
            disabled={queueClosed || !!pendingAction || pendingDelivery}
            disabledReason={busyReason}
          />
        ))}
        {!delivery && activeFeedback?.error ? (
          <InlineError inset="row">{activeFeedback.text}</InlineError>
        ) : null}
        {remote ? (
          <InfoTooltip>
            {t("Sent one at a time when the host finishes this turn, while {p0} is open.", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
          </InfoTooltip>
        ) : null}
      </div>
      {editingMessage ? (
        <QueuedMessageEditDialog
          key={editingMessage.id}
          parentSessionId={parentSessionId}
          message={editingMessage}
          canAttach={canAttach}
          references={references}
          suggestions={suggestions}
          onSave={(text, attachments) => {
            if (!queueOwner.canMutate() || !onEdit) return false;
            const result = onEdit(editingMessage.id, text, attachments);
            if (result === false) return false;
            setEditingId(undefined);
            return true;
          }}
          onRemove={() => removeMessage(editingMessage.id)}
          onCancel={cancelEdit}
        />
      ) : null}
    </Text>
  );
}
