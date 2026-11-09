import type { MessageQueueStatus, QueuedMessage } from "../model/session";

export type QueueFeedback = { error: boolean; text: string; actionId: string };

export function activeQueueFeedback(
  feedback: QueueFeedback | undefined,
  status: MessageQueueStatus | undefined,
  heldByOtherWindow: boolean,
  messages: QueuedMessage[],
) {
  if (!feedback?.error || feedback.actionId === "admission") return feedback;
  const resolved =
    feedback.actionId === "resume"
      ? status === "active"
      : feedback.actionId === "takeover"
        ? !heldByOtherWindow
        : !messages.some((message) => message.id === feedback.actionId);
  return resolved ? undefined : feedback;
}
