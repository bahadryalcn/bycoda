import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DeliveryProgress } from "../model/deliveryProgress";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  ModelTarget,
  QueuedMessage,
} from "../model/session";
import type { ParentAdmission } from "../data/parentInputClosure";
import type { QueueAction } from "../model/queueAction";

/** Only animate a row when this mounted queue observed its authoritative acceptance. */
export function useAcceptedQueueDeparture(messages: QueuedMessage[], delivery?: DeliveryProgress) {
  const previous = useRef(delivery);
  const knownRows = useRef(new Map<string, QueuedMessage>());
  const armed = useRef<{ id: string; operationId: number } | undefined>(undefined);
  const [departing, setDeparting] = useState<QueuedMessage>();
  useLayoutEffect(() => {
    const previousRows = knownRows.current;
    knownRows.current = new Map(messages.map((row) => [row.id, row]));
    const prior = previous.current;
    if (
      delivery?.stage === "accepted" &&
      !delivery.noticeOnly &&
      prior?.operationId === delivery.operationId &&
      prior.stage !== "accepted"
    ) {
      armed.current = { id: delivery.messageId, operationId: delivery.operationId };
    }
    previous.current = delivery;
    const candidate = armed.current;
    if (!candidate || messages.some((row) => row.id === candidate.id)) return;
    armed.current = undefined;
    const row = previousRows.get(candidate.id);
    if (!row || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setDeparting(row);
  }, [messages, delivery]);
  useEffect(() => {
    if (!departing) return;
    const timer = window.setTimeout(() => setDeparting(undefined), 220);
    return () => window.clearTimeout(timer);
  }, [departing]);
  return departing;
}

export type MessageQueueProps = {
  sessionId?: string;
  parentSessionId?: string;
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  canAttach: boolean;
  /** The turn runs on another machine: it cannot be steered, and the queue is this app's. */
  remote?: boolean;
  busy?: boolean;
  /** The running turn's model and settings, for rows that must wait for their own turn. */
  runningTarget?: {
    harness: HarnessId;
    model: string;
    modelSettings: Record<string, string>;
    runningModelTarget?: ModelTarget;
  };
  steerSupported?: boolean;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onEditingChange?: (messageId?: string) => void;
  onReorder?: (messageIds: string[], parentAdmission?: ParentAdmission) => void;
  onSteer?: (messageId: string) => QueueAction;
  onResume?: () => QueueAction;
};
