import { Text } from "../../../shared/ui/Text";
import { activeQueueFeedback, type QueueFeedback } from "./queueFeedback";
import { canSendQueueMessage } from "../model/queueAction";
import { useAcceptedQueueDeparture, type MessageQueueProps } from "./useAcceptedQueueDeparture";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { InlineError } from "../../../shared/ui/InlineError";
import {
  DeliveryProgressNotice,
  DeliveryProgressIndicator,
  deliveryIsPending,
  useDeliveryProgress,
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
import "./chat-controls.css";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  CornerDownRight,
  GripVertical,
  ListEnd,
  Pause,
  Pencil,
  Play,
  Trash2,
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
import { moveQueuedMessage, runningTargetOf } from "../model/messageQueue";
import { HarnessIcon } from "./HarnessIcon";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { announceDrag } from "../../../shared/lib/drag";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";
import { Button } from "../../../shared/ui/Button";
import { QueueRemovalNotice } from "./QueueRemovalNotice";
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
      text: t(String(error).replace(/^Error: /, "")),
    });
    return false;
  } finally {
    actionRef.current = false;
    setPendingAction(undefined);
  }
}

type AccountList = { id: string; label: string }[];

export function MessageQueue({
  sessionId,
  parentSessionId,
  messages,
  status,
  onDelete,
  canAttach,
  remote = false,
  busy = false,
  runningTarget,
  steerSupported = false,
  onEdit,
  onEditingChange,
  onReorder,
  onSteer,
  onResume,
}: MessageQueueProps) {
  const t = useT();
  // The account lists live in storage; the string snapshot keeps the subscription value-stable.
  const accountListsJson = useSyncExternalStore(
    subscribeProviderAccounts,
    accountChoicesSnapshot,
    accountChoicesSnapshot,
  );
  const accountLists: [AccountList, AccountList] = JSON.parse(accountListsJson);
  const delivery = useDeliveryProgress(sessionId);
  const pendingDelivery = deliveryIsPending(delivery?.stage);
  const departing = useAcceptedQueueDeparture(messages, delivery);
  const heldByOtherWindow = useSharedQueueLeaseHeld(sessionId ?? "");
  const holdReason = useQueueHoldReason(sessionId ?? "");
  const holdDetail = holdReason && holdReason !== "stopped" ? holdReason : undefined;
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
        text: t(String(error).replace(/^Error: /, "")),
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
      {queueClosed ? (
        <p role="status">{t("Preparing session checkpoint. Your draft is kept.")}</p>
      ) : null}
      <div className="relative z-0 rounded-t-xl px-2 py-1" data-message-queue-card ref={card}>
        {paused ? (
          <Text as="div" size="caption" tone="inherit" className="mb-1 flex h-7 items-center gap-2">
            <Pause className="icon-sm" />
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <Tooltip label={holdDetail} asChild>
              <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                {(delivery && (delivery.stage === "rejected" || delivery.stage === "unknown")) ||
                messages.some((message) => message.deliveryUnknown)
                  ? `${t("Queue")} · ${messages.length}`
                  : hold.kind === "held" && hold.reason === "unknown"
                    ? t("Queue held: delivery is not confirmed")
                    : hold.kind === "held" && hold.reason === "rejected"
                      ? holdDetail?.split(/\r?\n/, 1)[0] ||
                        t("Queue paused: the last message was not accepted")
                      : t("Queue paused because you interrupted")}
              </Text>
            </Tooltip>
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
              loading={pendingAction === "resume"}
              loadingLabel={t("Resuming…")}
              onClick={() => trigger("resume", onResume)}
              className="shrink-0"
            >
              <Play className="icon-sm" />
              {pendingAction === "resume" ? t("Resuming…") : t("Resume")}
            </Button>
          </Text>
        ) : null}
        {leaseHeld && sessionId ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="mb-1 flex h-7 items-center gap-2"
            data-queue-held-elsewhere
          >
            <Pause className="icon-sm" />
            <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
              {activeFeedback && !activeFeedback.error
                ? activeFeedback.text
                : t("Queue held by another window, which sends it")}
            </Text>
            <Button
              variant="ghost"
              type="button"
              disabled={queueClosed || !!pendingAction || pendingDelivery}
              loading={pendingAction === "takeover"}
              loadingLabel={t("Taking over…")}
              onClick={() => trigger("takeover", () => takeOverSharedLocalQueue(sessionId))}
              className="shrink-0"
            >
              {pendingAction === "takeover" ? t("Taking over…") : t("Take over")}
            </Button>
          </Text>
        ) : null}
        {restored ? (
          <Text as="div" size="caption" tone="inherit" className="mb-1 flex h-7 items-center gap-2">
            <Pause className="icon-sm" />
            <DeliveryProgressIndicator sessionId={sessionId} />
            <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
              {messages.length === 1
                ? t("1 queued message restored")
                : t("{p0} queued messages restored", { p0: messages.length })}
            </Text>
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
              loading={pendingAction === "resume"}
              loadingLabel={t("Resuming…")}
              onClick={() =>
                trigger("resume", onResume ?? (onSteer ? () => onSteer(messages[0].id) : undefined))
              }
              className="shrink-0"
            >
              <Play className="icon-sm" />
              {pendingAction === "resume" ? t("Sending…") : t("Send next")}
            </Button>
          </Text>
        ) : null}
        {messages.length > 0 && !paused && !restored && !leaseHeld ? (
          <Text
            as="div"
            size="caption"
            tone="inherit"
            className="flex min-h-7 items-center gap-2 px-1"
            data-queue-summary
          >
            <ListEnd className="icon-sm shrink-0" />
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <span className="shrink-0">
              {t("Queue")} · {messages.length}
            </span>
            {activeFeedback && !activeFeedback.error ? (
              <Text size="inherit" tone="inherit" truncate>
                {activeFeedback.text}
              </Text>
            ) : null}
            {!delivery && busy && !activeFeedback ? (
              <Text size="inherit" tone="muted" truncate className="min-w-0">
                {t("Waiting for the running response to finish")}
              </Text>
            ) : null}
          </Text>
        ) : null}
        <DeliveryProgressNotice sessionId={sessionId} messages={messages} embedded />
        {holdDetail && !delivery && (holdDetail.length > 180 || holdDetail.includes("\n")) ? (
          <Text
            as="p"
            size="inherit"
            tone="muted"
            className="max-h-32 overflow-y-auto px-1 pb-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {holdDetail}
          </Text>
        ) : null}
        <div
          className="max-h-[min(30dvh,15rem)] min-h-0 overflow-y-auto overscroll-contain"
          data-message-queue-rows
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
          {messages.map((message, index) => {
            const attachmentGone = hasMissingAttachment(message);
            const route = attachmentGone ? "join" : steerRoute(message);
            const target = message.modelTarget;
            const summary = target ? targetSummary(target) : undefined;
            const accounts =
              target && supportsProviderAccounts(target.harness)
                ? accountLists[target.harness === "claude" ? 0 : 1]
                : [];
            const account = accounts.find(
              (account) => account.id === (target?.providerAccountId ?? "default"),
            );
            const accountLabel =
              target && supportsProviderAccounts(target.harness)
                ? account
                  ? accountDisplayLabel(accounts, account)
                  : target.providerAccountId &&
                      target.providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID
                    ? t("Removed account")
                    : t("Default account")
                : undefined;
            const targetLabel =
              target && summary
                ? [summary.model, accountLabel, summary.effort && t(summary.effort)]
                    .filter(Boolean)
                    .join(" · ")
                : undefined;
            const routeNote =
              route === "switch"
                ? t("Steer switches provider")
                : route === "restart"
                  ? t("Steer restarts with this model")
                  : undefined;
            const files = message.attachments.length;
            const label =
              message.text.trim() ||
              t(files === 1 ? "1 attachment" : "{p0} attachments", { p0: files });
            return (
              <Text
                key={message.id}
                ref={(node) => sortable.setItemRef(message.id, node)}
                as="div"
                size="caption"
                tone="inherit"
                className="reorder-item grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 data-[dragging]:rounded-md data-[dragging]:bg-(--ui-surface) data-[dragging]:shadow-lg"
              >
                <Button
                  iconOnly
                  label={t("Reorder queued message")}
                  disabled={
                    messages.length < 2 || queueClosed || !!pendingAction || pendingDelivery
                  }
                  variant="ghost"
                  type="button"
                  data-queue-handle={message.id}
                  tooltip={t("Drag to reorder")}
                  shortcut="Alt+↑ / Alt+↓"
                  aria-label={t("Reorder queued message")}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onPointerDown={(event) => {
                    if (messages.length < 2 || event.button !== 0) return;
                    if (dragAdmission.current && !dragAdmission.current.ended) return;
                    const admitted = queueOwner.admit();
                    if (!admitted) return;
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
                    <Tooltip
                      label={t(
                        "An attached file is gone. Edit this message to drop it, or remove the message.",
                      )}
                      asChild
                    >
                      <Text
                        size="inherit"
                        tone="warning"
                        className="block [overflow-wrap:anywhere]"
                      >
                        {t("Attachment missing")}
                      </Text>
                    </Tooltip>
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
                      <Tooltip label={t("Queued for {p0}", { p0: targetLabel })} asChild>
                        <Text size="inherit" tone="inherit" truncate>
                          {targetLabel}
                        </Text>
                      </Tooltip>
                      {routeNote ? <span className="shrink-0">· {routeNote}</span> : null}
                    </Text>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {remote ? null : (
                    <Button
                      iconOnly
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
                      tooltip={
                        busy && (message.intent === "plan" || message.intent === "orchestrate")
                          ? t("New messages wait until this turn finishes. Stop pauses the queue.")
                          : route === "switch"
                            ? t(
                                "Steer stops the running turn, including its background work, and continues this conversation on the saved provider, as switching provider in the composer does.",
                              )
                            : route === "restart"
                              ? t(
                                  "Steer stops the running turn, including its background work, and starts this message as a new turn with its saved model.",
                                )
                              : undefined
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
                      <CornerDownRight className="icon-sm" />
                    </Button>
                  )}
                  <Button
                    iconOnly
                    label={t("Edit queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    variant="ghost"
                    type="button"
                    aria-label={t("Edit queued message")}
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
                    onClick={() => removeMessage(message.id)}
                  >
                    <Trash2 className="icon-sm" />
                  </Button>
                </div>
              </Text>
            );
          })}
        </div>
        {removals.map((entry) => (
          <QueueRemovalNotice
            key={entry.id}
            id={entry.id}
            onUndo={() => perform(`undo:${entry.id}`, entry.undo).then((value) => value === true)}
            onDismiss={dismissRemoval}
            disabled={queueClosed || !!pendingAction || pendingDelivery}
          />
        ))}
        {!delivery && activeFeedback?.error ? (
          <InlineError className="py-1">{activeFeedback.text}</InlineError>
        ) : null}
        {remote ? (
          <Text as="div" size="micro" tone="secondary" className="pt-1">
            {t("Sent one at a time when the host finishes this turn, while {p0} is open.", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
          </Text>
        ) : null}
      </div>
      {editingMessage ? (
        <QueuedMessageEditDialog
          key={editingMessage.id}
          parentSessionId={parentSessionId}
          message={editingMessage}
          canAttach={canAttach}
          onSave={(text, attachments) => {
            if (!queueOwner.canMutate()) return;
            onEdit?.(editingMessage.id, text, attachments);
            setEditingId(undefined);
          }}
          onRemove={() => removeMessage(editingMessage.id)}
          onCancel={cancelEdit}
        />
      ) : null}
    </Text>
  );
}
