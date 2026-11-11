export type AssistantPresenceState = "present" | "away" | "idle" | "dnd" | "locked" | "offline";
export type AssistantPresenceTone = "success" | "warning" | "danger" | "neutral";

const presentations = {
  present: { label: "Here", tone: "success" },
  away: { label: "Away", tone: "warning" },
  idle: { label: "Idle", tone: "warning" },
  dnd: { label: "Do not disturb", tone: "danger" },
  locked: { label: "Locked", tone: "danger" },
  offline: { label: "Offline", tone: "neutral" },
} as const satisfies Record<AssistantPresenceState, { label: string; tone: AssistantPresenceTone }>;

/** Presentation only. No status from the Host means it is unreachable: offline. */
export function assistantPresencePresentation(value: unknown) {
  const state: AssistantPresenceState =
    typeof value === "string" && Object.prototype.hasOwnProperty.call(presentations, value)
      ? (value as AssistantPresenceState)
      : "offline";
  return { state, ...presentations[state] };
}
