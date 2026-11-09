export type AssistantPresenceState = "present" | "away" | "idle" | "dnd" | "locked" | "unknown";
export type AssistantPresenceTone = "success" | "warning" | "danger" | "neutral";

const presentations = {
  present: { label: "Here", tone: "success" },
  away: { label: "Away", tone: "warning" },
  idle: { label: "Idle", tone: "warning" },
  dnd: { label: "Do not disturb", tone: "danger" },
  locked: { label: "Locked", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
} as const satisfies Record<AssistantPresenceState, { label: string; tone: AssistantPresenceTone }>;

/** Presentation only. A pending or failed observation cannot certify Here. */
export function assistantPresencePresentation(value: unknown, unconfirmed = false) {
  const state: AssistantPresenceState =
    !unconfirmed &&
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(presentations, value)
      ? (value as AssistantPresenceState)
      : "unknown";
  return { state, ...presentations[state] };
}
