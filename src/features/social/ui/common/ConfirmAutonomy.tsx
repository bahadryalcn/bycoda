import { t } from "../../../../shared/i18n";
import type { AutonomyAction, AutonomyLevel } from "../../model/autonomy";
import "./common.css";

export type ConfirmAutonomyProps = {
  accountName: string;
  action: AutonomyAction;
  /** The level the owner is switching to. */
  level: AutonomyLevel;
  /** Per-day limit for this action, when one is set. */
  dailyLimit?: number;
};

/** Plain name of an autonomy action, used inside the confirmation sentence. */
export function autonomyActionText(action: AutonomyAction): string {
  switch (action) {
    case "publish":
      return t("publish posts");
    case "reply":
      return t("reply to people");
    case "comment":
      return t("comment");
    case "message":
      return t("send direct messages");
    case "email":
      return t("send email");
    case "outreach":
      return t("start outreach");
    case "audience":
      return t("collect audience data");
    case "contacts":
      return t("update contacts");
  }
}

/**
 * Body of the dialog that confirms a change to an autonomy level. It states what AI will do
 * without asking and what still applies, so the owner decides with the consequence in view.
 */
export function ConfirmAutonomy({ accountName, action, level, dailyLimit }: ConfirmAutonomyProps) {
  const actionText = autonomyActionText(action);
  const sentence =
    level === "autonomous"
      ? t("AI will {p1} on {p2} without asking you first.", { p1: actionText, p2: accountName })
      : level === "approve"
        ? t("AI will prepare {p1} on {p2} and wait for your approval.", {
            p1: actionText,
            p2: accountName,
          })
        : t("AI will only suggest {p1} on {p2}. Nothing is sent without you.", {
            p1: actionText,
            p2: accountName,
          });
  return (
    <div className="social-confirm-autonomy">
      <p>{sentence}</p>
      <ul>
        <li>{t("Platform limits, opt-outs, working hours and the global AI stop still apply.")}</li>
        {dailyLimit !== undefined ? <li>{t("Up to {p1} per day.", { p1: dailyLimit })}</li> : null}
      </ul>
    </div>
  );
}
