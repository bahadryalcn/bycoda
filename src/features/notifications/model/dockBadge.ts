import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../../sessions/model/session";
import { sessionsNeedingAttention } from "./attention";
import { attentionRulesFor } from "./attentionRules";

let lastCount = -1;

/** Push the count of sessions waiting on the owner to the macOS Dock badge. */
export function syncDockBadge(sessions: Session[]): void {
  const count = sessionsNeedingAttention(sessions, new Set(), attentionRulesFor("dock")).input
    .length;
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}
