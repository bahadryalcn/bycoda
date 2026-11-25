import { t } from "../../../shared/i18n";

export type AssistantPresenceState = "present" | "away" | "idle" | "dnd" | "locked" | "offline";
export type AssistantPresenceTone = "success" | "warning" | "danger" | "neutral";

const presentations = {
  present: { tone: "success" },
  away: { tone: "warning" },
  idle: { tone: "warning" },
  dnd: { tone: "danger" },
  locked: { tone: "danger" },
  offline: { tone: "neutral" },
} as const satisfies Record<AssistantPresenceState, { tone: AssistantPresenceTone }>;

/** The translated availability label; call it while rendering so it follows the language. */
export function assistantPresenceLabel(state: AssistantPresenceState): string {
  switch (state) {
    case "present":
      return t("Here");
    case "away":
      return t("Away");
    case "idle":
      return t("Idle");
    case "dnd":
      return t("Do not disturb");
    case "locked":
      return t("Locked");
    case "offline":
      return t("Offline");
  }
}

/** Presentation only. No status from the Host means it is unreachable: offline. */
export function assistantPresencePresentation(value: unknown) {
  const state: AssistantPresenceState =
    typeof value === "string" && Object.prototype.hasOwnProperty.call(presentations, value)
      ? (value as AssistantPresenceState)
      : "offline";
  return { state, ...presentations[state] };
}
