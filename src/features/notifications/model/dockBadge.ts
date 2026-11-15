import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../../sessions/model/session";
import { sessionsNeedingAttention } from "./attention";
import { attentionRulesFor } from "./attentionRules";
import { socialWaitingCount } from "./socialWaiting";

let lastCount = -1;

/** Push the count of sessions and Social items waiting on the owner to the macOS Dock badge. */
export function syncDockBadge(sessions: Session[]): void {
  const rules = attentionRulesFor("dock");
  const count =
    sessionsNeedingAttention(sessions, new Set(), rules).input.length +
    (rules.input ? socialWaitingCount() : 0);
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}
