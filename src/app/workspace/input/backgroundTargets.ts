import { BACKGROUND_NOTIFICATION_TARGETS } from "../../../features/notifications/model/notifications";
import {
  requestSocialScreen,
  SOCIAL_PANEL_EVENT,
} from "../../../features/social/model/socialNavigation";
import { requestSummaryPanel } from "../../../features/tasks/model/dailySummaryClient";

/** Window event that asks the workspace to open a background notification target. */
export const OPEN_BACKGROUND_TARGET_EVENT = "bycoda:open-background-target";

export function requestBackgroundTarget(target: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_BACKGROUND_TARGET_EVENT, { detail: target }));
}

export type BackgroundTargetActions = {
  onOpenTasks: () => void;
  onOpenAutomations: () => void;
  openSettings: (section: "account") => void;
};

/**
 * The view a `background:*` target opens, shared by OS banner clicks and the
 * notification history, or `null` when the target is a conversation.
 */
export function backgroundTargetAction(
  target: string,
  actions: BackgroundTargetActions,
): (() => void) | null {
  const openAssistant = () =>
    window.dispatchEvent(new CustomEvent("bycoda:open-assistant", { detail: { tab: "today" } }));
  const accountPrefix = `${BACKGROUND_NOTIFICATION_TARGETS.socialAccounts}:`;
  if (
    target === BACKGROUND_NOTIFICATION_TARGETS.socialAccounts ||
    target.startsWith(accountPrefix)
  ) {
    // Accounts opens that account; a target without one shows the list.
    const accountId = target.slice(accountPrefix.length);
    return () => {
      window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd: "" } }));
      requestSocialScreen("accounts", accountId ? { accountId } : undefined);
    };
  }
  switch (target) {
    case BACKGROUND_NOTIFICATION_TARGETS.tasks:
      return actions.onOpenTasks;
    case BACKGROUND_NOTIFICATION_TARGETS.automations:
      return actions.onOpenAutomations;
    case BACKGROUND_NOTIFICATION_TARGETS.summary:
      return () => {
        requestSummaryPanel();
        actions.onOpenTasks();
      };
    case BACKGROUND_NOTIFICATION_TARGETS.assistant:
    case "": // Rust assistant banners carry no session.
      return openAssistant;
    case BACKGROUND_NOTIFICATION_TARGETS.social:
      // Command lists the waiting account requests and browser tasks.
      return () => {
        window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd: "" } }));
        requestSocialScreen("command");
      };
    case BACKGROUND_NOTIFICATION_TARGETS.account:
      return () => actions.openSettings("account");
    default:
      return null;
  }
}
