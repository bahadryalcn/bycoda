import { currentExecutionTools } from "../../sessions/public/commandInspection";
import type { Session } from "../../sessions/public/session";
import type { VoiceToolActivityEntry } from "./voiceToolActivity";

export type VoiceWorkspaceTool = "changes" | "browser" | "devices" | "logs";

export function voiceLiveWorkSuggestion(
  session: Pick<Session, "id" | "busy" | "blocks"> | undefined,
  activities: readonly VoiceToolActivityEntry[],
) {
  if (session?.busy) {
    const { turnId, tools } = currentExecutionTools(session.blocks);
    if (turnId && tools.length) return `turn:${session.id}:${turnId}`;
  }
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index];
    if (activity.state === "running" || activity.state === "waiting-owner")
      return `activity:${activity.id}`;
  }
  return undefined;
}
