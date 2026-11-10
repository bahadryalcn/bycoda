import { activeQueueFeedback, type QueueFeedback } from "./queueFeedback";
import { canSendQueueMessage } from "../model/queueAction";
import { useAcceptedQueueDeparture, type MessageQueueProps } from "./useAcceptedQueueDeparture";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { QueuedMessage } from "../model/session";
import { steerAppliesModelSettings } from "../../../integrations/harness/core/registry";
import { HARNESS_TITLE } from "../model/session";
import { hasMissingAttachment } from "../model/queuePersistence";
import { useQueuedSteerRoute, useQueuedTargetSummary } from "../model/reactiveReads";
import { moveQueuedMessage, runningTargetOf } from "../model/messageQueue";
import { HarnessIcon } from "./HarnessIcon";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import { announceDrag } from "../../../shared/lib/drag";
import { QueuedMessageEditDialog } from "./QueuedMessageEditDialog";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
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
    if (actionRef.current) return;
    const admitted = queueOwner.admit();
    if (!admitted) return;
    return admitted.run(async () => {
      actionRef.current = true;
      setPendingAction(id);
      setFeedback(undefined);
      try {
        if (!action)
          throw new Error(
            t("This queue action is unavailable. Reopen the conversation and try again."),
          );
        const result = await action();
        if (result === false) return;
        if (id === "takeover" && typeof result === "object" && result?.message)
          setFeedback({ error: false, actionId: id, text: t(result.message) });
      } catch (error) {
        setFeedback({
          error: true,
          actionId: id,
          text: t(String(error).replace(/^Error: /, "")),
        });
      } finally {
        actionRef.current = false;
        setPendingAction(undefined);
      }
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
  if (messages.length === 0 && !pendingAction && !activeFeedback && !departing) return null;
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
    <div className="text-(--ui-text-secondary)" data-message-queue data-usage-guide="queue">
      {queueClosed ? (
        <p role="status">{t("Preparing session checkpoint. Your draft is kept.")}</p>
      ) : null}
      <div className="relative z-0 rounded-t-xl px-2 py-1" data-message-queue-card ref={card}>
        {paused ? (
          <div className="mb-1 flex h-7 items-center gap-2 text-ui-caption">
            <Pause className="icon-sm" />
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <span className="min-w-0 flex-1 truncate" title={holdDetail}>
              {(delivery && (delivery.stage === "rejected" || delivery.stage === "unknown")) ||
              messages.some((message) => message.deliveryUnknown)
                ? `${t("Queue")} · ${messages.length}`
                : hold.kind === "held" && hold.reason === "unknown"
                  ? t("Queue held: delivery is not confirmed")
                  : hold.kind === "held" && hold.reason === "rejected"
                    ? holdDetail?.split(/\r?\n/, 1)[0] ||
                      t("Queue paused: the last message was not accepted")
                    : t("Queue paused because you interrupted")}
            </span>
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
          </div>
        ) : null}
        {leaseHeld && sessionId ? (
          <div
            className="mb-1 flex h-7 items-center gap-2 text-ui-caption"
            data-queue-held-elsewhere
          >
            <Pause className="icon-sm" />
            <span className="min-w-0 flex-1 truncate">
              {activeFeedback && !activeFeedback.error
                ? activeFeedback.text
                : t("Queue held by another window, which sends it")}
            </span>
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
          </div>
        ) : null}
        {restored ? (
          <div className="mb-1 flex h-7 items-center gap-2 text-ui-caption">
            <Pause className="icon-sm" />
            <DeliveryProgressIndicator sessionId={sessionId} />
            <span className="min-w-0 flex-1 truncate">
              {messages.length === 1
                ? t("1 queued message restored")
                : t("{p0} queued messages restored", { p0: messages.length })}
            </span>
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
          </div>
        ) : null}
        {!paused && !restored && !leaseHeld ? (
          <div className="flex min-h-7 items-center gap-2 px-1 text-ui-caption" data-queue-summary>
            <ListEnd className="icon-sm shrink-0" />
            {messages.length > 0 ? <DeliveryProgressIndicator sessionId={sessionId} /> : null}
            <span className="shrink-0">
              {t("Queue")} · {messages.length}
            </span>
            {activeFeedback && !activeFeedback.error ? (
              <span className="truncate">{activeFeedback.text}</span>
            ) : null}
            {!delivery && busy && !activeFeedback ? (
              <span className="min-w-0 truncate text-(--ui-text-muted)">
                {t("Waiting for the running response to finish")}
              </span>
            ) : null}
          </div>
        ) : null}
        <DeliveryProgressNotice sessionId={sessionId} messages={messages} embedded />
        {holdDetail && !delivery && (holdDetail.length > 180 || holdDetail.includes("\n")) ? (
          <Disclosure size="sm" summary={t("Details")} className="px-1 pb-1">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{holdDetail}</p>
          </Disclosure>
        ) : null}
        <div
          className="max-h-[min(30dvh,15rem)] min-h-0 overflow-y-auto overscroll-contain"
          data-message-queue-rows
        >
          {departing ? (
            <div className="queue-departure" data-queue-departure={departing.id} aria-hidden="true">
              <div className="min-w-0 overflow-hidden truncate text-ui-caption">
                {departing.text || t("Queued message")}
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => {
            const attachmentGone = hasMissingAttachment(message);
            const route = attachmentGone ? "join" : steerRoute(message);
            const target = message.modelTarget;
            const summary = target ? targetSummary(target) : undefined;
            const targetLabel =
              target && summary
                ? [
                    HARNESS_TITLE[target.harness],
                    summary.model,
                    summary.effort && t(summary.effort),
                  ]
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
              <div
                key={message.id}
                ref={(node) => sortable.setItemRef(message.id, node)}
                className="reorder-item grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ui-caption data-[dragging]:rounded-md data-[dragging]:bg-(--ui-surface) data-[dragging]:shadow-lg"
              >
                {messages.length > 1 ? (
                  <Button
                    iconOnly
                    label={t("Reorder queued message")}
                    disabled={queueClosed || !!pendingAction || pendingDelivery}
                    variant="ghost"
                    type="button"
                    data-queue-handle={message.id}
                    tooltip={t("Drag to reorder")}
                    shortcut="Alt+↑ / Alt+↓"
                    aria-label={t("Reorder queued message")}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
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
                ) : (
                  <ListEnd className="icon-sm shrink-0" />
                )}
                <div className="min-w-0 py-1">
                  <OverflowTooltip label={label}>
                    <div className="truncate text-(--ui-text-secondary)">{label}</div>
                  </OverflowTooltip>
                  {attachmentGone ? (
                    <span
                      className="block [overflow-wrap:anywhere] text-(--ui-tone-warning-fg)"
                      title={t(
                        "An attached file is gone. Edit this message to drop it, or remove the message.",
                      )}
                    >
                      {t("Attachment missing")}
                    </span>
                  ) : null}
                  {target && targetLabel ? (
                    <span
                      className="flex min-w-0 items-center gap-1 text-ui-micro text-(--ui-text-secondary)"
                      data-queue-target
                    >
                      <HarnessIcon harness={target.harness} className="size-3 shrink-0" />
                      <span className="truncate" title={t("Queued for {p0}", { p0: targetLabel })}>
                        {targetLabel}
                      </span>
                      {routeNote ? <span className="shrink-0">· {routeNote}</span> : null}
                    </span>
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
                    tooltip={t("Edit queued message")}
                    aria-label={t("Edit queued message")}
                    onClick={() => startEdit(message)}
                    className="shrink-0"
                  >
                    <Pencil className="icon-sm" />
                  </Button>
                  <Tooltip label={t("Remove queued message")}>
                    <ConfirmMorph
                      label={<span className="sr-only">{t("Remove")}</span>}
                      icon={<Trash2 className="icon-sm" />}
                      prompt={t("Remove queued message")}
                      disabled={queueClosed || !!pendingAction || pendingDelivery}
                      onConfirm={() => {
                        mutateParentInput(queueOwner, () => onDelete?.(message.id));
                      }}
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
        {!delivery && activeFeedback?.error ? (
          <InlineError className="py-1">{activeFeedback.text}</InlineError>
        ) : null}
        {remote ? (
          <div className="pt-1 text-ui-micro text-(--ui-text-secondary)">
            {t("Sent one at a time when the host finishes this turn, while {p0} is open.", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
          </div>
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
          onRemove={() => mutateParentInput(queueOwner, () => onDelete?.(editingMessage.id))}
          onCancel={cancelEdit}
        />
      ) : null}
    </div>
  );
}
