import { isProjectLocked, subscribeGroupLock } from "../../group-lock/public/projectLock";
import type { AttentionRules } from "./attention";
import { loadNotificationEvents, subscribeNotificationEvents } from "./notificationEvents";
import {
  allowsProjectNotificationIndicator,
  subscribeNotificationPreferences,
} from "./notificationPreferences";
import { knownNotificationProject } from "./notificationProjects";
import { loadNotificationsEnabled, subscribeNotificationsEnabled } from "./notifications";

/** Counters that follow the owner's notification preferences. */
export type AttentionSurface = "taskbar" | "dock";

/**
 * Rules for a native counter: the master switch, the surface's event setting,
 * `events.input` and the project's `agentInput` rule. Sessions in a locked group never count.
 * The Dock counts input only; the taskbar adds unseen finished/failed turns.
 */
export function attentionRulesFor(surface: AttentionSurface): AttentionRules {
  const events = loadNotificationEvents();
  const on = loadNotificationsEnabled() && (surface === "dock" || events.taskbar);
  return {
    input: on && events.input,
    unseen: on && surface === "taskbar",
    hidden: (session) => isProjectLocked(session.cwd),
    inputAllowed: (session) => {
      const project = knownNotificationProject(session.cwd);
      return (
        !!project &&
        allowsProjectNotificationIndicator({
          projectId: project.id,
          category: "agentInput",
        })
      );
    },
  };
}

/** Everything that can change `attentionRulesFor` without a session changing. */
export function subscribeAttentionRules(listener: () => void): () => void {
  const off = [
    subscribeNotificationsEnabled(listener),
    subscribeNotificationEvents(listener),
    subscribeNotificationPreferences(listener),
    subscribeGroupLock(listener),
  ];
  return () => off.forEach((fn) => fn());
}
