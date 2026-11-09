/** Resolves on acceptance or an explicit queue release, never provider completion. */
export type QueueActionResult = boolean | void | { kind: "accepted" | "waiting"; message?: string };
export type QueueAction = QueueActionResult | Promise<QueueActionResult>;

/** Restart/switch starts a distinct turn and does not need mid-turn input support. */
export function canSendQueueMessage(
  message: { intent?: string; deliveryUnknown?: boolean },
  state: {
    blocked: boolean;
    busy: boolean;
    steerSupported: boolean;
    route: "join" | "restart" | "switch";
  },
): boolean {
  if (state.blocked || message.deliveryUnknown) return false;
  if (!state.busy) return true;
  if (message.intent === "plan" || message.intent === "orchestrate") return false;
  return state.steerSupported || state.route !== "join";
}
