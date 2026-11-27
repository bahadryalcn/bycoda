import type { ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { DockAgentStatus } from "../model/activityDock";
import type { HarnessId } from "../model/session";
import type { ModelAccountIdentity } from "./ModelAccountIdentity";
import { SubagentMarks } from "./SubagentAnatomy";
import styles from "./SubagentRow.module.css";

/**
 * One delegated run as a card. Cards of a group sit in one grid row and share its tracks: the
 * title (two lines at most), the provider and model, the state line and the progress bar each
 * line up across the cards, and the cards are equally tall. The whole card is one button: it
 * opens the run's work under the card grid, or the run's own panel while there is no work to show
 * yet. The footer's actions sit above it and keep their own clicks.
 */
export function SubagentCardFace({
  name,
  active,
  failed,
  lifecycle,
  harness,
  model,
  account,
  badge,
  details,
  status,
  description,
  toggleLabel,
  open,
  onToggle,
  openLabel,
  onOpen,
  reason,
  footer,
}: {
  /** A role mark before the model, such as the advisor's. */
  badge?: ReactNode;
  /** The card's action while it has no work to show: open the run in its own panel. */
  openLabel: string;
  onOpen: () => void;
  name: string;
  active: boolean;
  failed: boolean;
  lifecycle: DockAgentStatus;
  harness?: HarnessId;
  /** Model id; names the provider when `harness` is not known. */
  model?: string;
  account?: ModelAccountIdentity;
  details: readonly (string | undefined)[];
  /** A `SubagentRunStatus` in its card layout: the state line and the progress bar. */
  status: ReactNode;
  description: string;
  /** "Show X's work" / "Hide X's work"; absent when the run has nothing to open. */
  toggleLabel?: string;
  open: boolean;
  onToggle: () => void;
  /** A failed run's reason, on the card; every card keeps its track, so they stay aligned. */
  reason?: string;
  /** Actions in the last track; every card has one. */
  footer: ReactNode;
}) {
  const detail = details.filter(Boolean).join(" · ");
  const titleClass = "min-w-0 text-start font-sans";
  // ui-drift-ignore: text-truncation -- WorkingIndicator only offers one-line truncate; the working title keeps the two lines its idle Text has.
  const workingTitleClass = `${titleClass} line-clamp-2`;
  const titleText = active ? (
    <WorkingIndicator
      glyph={false}
      className={workingTitleClass}
      text={{ size: "body", weight: "medium" }}
    >
      {name}
    </WorkingIndicator>
  ) : (
    <Text
      size="body"
      weight="medium"
      tone={failed ? "danger" : "secondary"}
      lines={2}
      className={titleClass}
    >
      {name}
    </Text>
  );
  return (
    <div
      {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.card)}
      data-subagent-card
      data-subagent-lifecycle={lifecycle}
    >
      <Button
        variant="item"
        type="button"
        controlHeight="fill"
        className={styles.cardAction}
        label={toggleLabel ?? openLabel}
        aria-description={description}
        aria-expanded={toggleLabel ? open : undefined}
        data-subagent-card-action
        onClick={toggleLabel ? onToggle : onOpen}
      />
      <span className={styles.cardTitle}>{titleText}</span>
      <span className={styles.cardModel} data-subagent-identity>
        {badge}
        <SubagentMarks
          className={styles.cardMark}
          harness={harness}
          model={model}
          account={account}
        />
        {detail ? (
          <Text size="micro" tone="muted" truncate className="min-w-0">
            {detail}
          </Text>
        ) : null}
      </span>
      <div className={styles.cardReason} data-subagent-reason>
        {/* The state line already says Failed: a short reason shows as written, a long one as its first line with Details. */}
        {reason ? <InlineError live="off" details={reason} /> : null}
      </div>
      {status}
      <span className={styles.cardFooter}>{footer}</span>
    </div>
  );
}
