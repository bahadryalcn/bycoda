/** Resolves on acceptance or an explicit queue release, never provider completion. */
export type QueueActionResult = boolean | void | { kind: "accepted" | "waiting"; message?: string };
export type QueueAction = QueueActionResult | Promise<QueueActionResult>;
