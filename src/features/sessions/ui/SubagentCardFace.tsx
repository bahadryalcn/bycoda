import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
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
 * title (two lines at most, in full on hover and focus), the provider and model, the state line
 * and the progress bar each line up across the cards, and the cards are equally tall. The title
 * is the run's work disclosure; its trail opens under the card grid, not in the card.
 */
export function SubagentCardFace({
  name,
  active,
  failed,
  lifecycle,
  harness,
  model,
  account,
  details,
  status,
  description,
  toggleLabel,
  open,
  onToggle,
  reason,
  footer,
}: {
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
  const t = useT();
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
      {toggleLabel ? (
        <Button
          variant="item"
          type="button"
          controlHeight="content"
          className={styles.cardTitle}
          label={toggleLabel}
          aria-description={description}
          aria-expanded={open}
          tooltip={name}
          tooltipWhen="overflow"
          onClick={onToggle}
        >
          {titleText}
        </Button>
      ) : (
        <span className={styles.cardTitle} aria-description={description}>
          {titleText}
        </span>
      )}
      <span className={styles.cardModel} data-subagent-identity>
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
        {reason ? (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <Text size="micro" tone="danger">
              {t("Subagent failed")}
            </Text>
            <ErrorDetails title={t("Subagent failed")} detail={reason} />
          </span>
        ) : null}
      </div>
      {status}
      <span className={styles.cardFooter}>{footer}</span>
    </div>
  );
}
