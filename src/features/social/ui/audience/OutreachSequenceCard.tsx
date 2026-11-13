import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useId } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { Divider } from "../../../../shared/ui/Divider";
import type { Sequence } from "../../model/outreach";
import { ChannelIcon } from "./ChannelIcon";
import { channelLabel } from "./audienceModel";
import "./audience.css";

export function sequenceStatusLabel(status: Sequence["status"]): string {
  switch (status) {
    case "draft":
      return t("Draft");
    case "active":
      return t("Running");
    case "paused":
      return t("Paused");
    case "done":
      return t("Finished");
  }
}

export function sequenceStatusTone(status: Sequence["status"]): BadgeTone {
  switch (status) {
    case "active":
      return "accent";
    case "paused":
      return "warning";
    case "done":
      return "success";
    case "draft":
      return "neutral";
  }
}

export type OutreachSequenceCardProps = {
  sequence: Sequence;
  /** Name of the list the sequence runs for; empty when that list no longer exists. */
  listName: string;
  selected: boolean;
  busy: boolean;
  /** Separate this row from a preceding sequence in the same collection. */
  separated?: boolean;
  /** Why the sequence cannot start yet; undefined means it can. */
  blocked: string | undefined;
  onSelect: () => void;
  onSetRunning: (start: boolean) => void;
  onEdit: () => void;
};

/**
 * One sequence as a row: name and status, the list it runs for, its steps by channel, and
 * Start/Pause and Edit. Choosing the name shows that sequence's results above the list. A sequence
 * that cannot start says why in the row, next to the disabled Start.
 */
export function OutreachSequenceCard({
  sequence,
  listName,
  selected,
  busy,
  separated = false,
  blocked,
  onSelect,
  onSetRunning,
  onEdit,
}: OutreachSequenceCardProps) {
  const reasonId = useId();
  const running = sequence.status === "active";
  const reasonShown = !running && blocked !== undefined;
  return (
    <li
      {...surfaceAttributes(
        {
          variant: selected ? "selected" : "transparent",
          frame: separated ? "pane" : undefined,
          edge: "block-start",
        },
        "audience-seq",
      )}
    >
      <div className="audience-seq-main">
        <div className="audience-seq-head">
          <Button
            variant="link"
            size="sm"
            aria-current={selected ? "true" : undefined}
            onClick={onSelect}
          >
            {sequence.name}
          </Button>
          <Badge size="sm" tone={sequenceStatusTone(sequence.status)}>
            {sequenceStatusLabel(sequence.status)}
          </Badge>
        </div>
        <Text as="span" tone="muted" leading="inherit" truncate>
          {listName
            ? t("Runs for {p0}, {p1} steps", {
                p0: listName,
                p1: formatNumber(sequence.steps.length),
              })
            : t("Its list no longer exists, {p0} steps", {
                p0: formatNumber(sequence.steps.length),
              })}
        </Text>
        {sequence.steps.length ? (
          <ol className="audience-chain" aria-label={t("Steps")}>
            {sequence.steps.map((step, index) => (
              <li key={step.id}>
                {index > 0 ? (
                  <Divider decorative className="mx-1 w-4 shrink-0 self-center" />
                ) : null}
                <Badge size="xs" tone="neutral" icon={<ChannelIcon channel={step.channel} />}>
                  {channelLabel(step.channel)}
                </Badge>
              </li>
            ))}
          </ol>
        ) : null}
        {reasonShown ? (
          <Text as="span" tone="secondary" leading="snug" id={reasonId}>
            {blocked}
          </Text>
        ) : null}
      </div>
      <div className="audience-seq-actions">
        {running ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => onSetRunning(false)}>
            {t("Pause")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            disabled={blocked !== undefined}
            aria-describedby={reasonShown ? reasonId : undefined}
            onClick={() => onSetRunning(true)}
          >
            {t("Start")}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t("Edit")}
        </Button>
      </div>
    </li>
  );
}
