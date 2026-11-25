import { useT } from "../../../shared/i18n";
import type { BackgroundOwner } from "../../../shared/model/host-contracts/delegation";
import { Bot } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";

/** Row mark for a session that background work opened; shown only while such sessions are listed. */
export function BackgroundSessionMark({ owner }: { owner?: BackgroundOwner }) {
  const t = useT();
  if (!owner) return null;
  const label = backgroundOwnerLabel(owner, t);
  return (
    // ui-drift-ignore: tooltip-repeats-label -- icon-only mark: the tooltip is its only visible text
    <Tooltip label={label} asChild>
      <span role="img" aria-label={label} className="inline-flex shrink-0 items-center">
        <Bot className="icon-xs" tone="secondary" strokeWidth={1.75} />
      </span>
    </Tooltip>
  );
}

/** What the session was opened for, so the icon adds the reason rather than repeating the row. */
export function backgroundOwnerLabel(owner: BackgroundOwner, t: ReturnType<typeof useT>): string {
  switch (owner.kind) {
    case "task":
      return owner.role === "reviewer" ? t("Task review session") : t("Task worker session");
    case "goal":
      return owner.role === "finalReview"
        ? t("Goal final review session")
        : t("Goal planning session");
    case "automation":
      return t("Automation session");
    case "steward":
      return t("Steward session");
    case "crew":
      return t("Crew session");
  }
}
