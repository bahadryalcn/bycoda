import { formatNumber, t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import type { OutreachChannel, Sequence } from "../../model/outreach";
import { DisabledReason } from "../common/DisabledReason";
import { PlatformIcon } from "../common/PlatformIcon";
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

/** Channels that have their own platform glyph; the others (direct message, comment, mention) show only text. */
function glyphChannel(channel: OutreachChannel) {
  return channel === "email" || channel === "whatsapp" || channel === "telegram"
    ? channel
    : undefined;
}

export type OutreachSequenceCardProps = {
  sequence: Sequence;
  selected: boolean;
  busy: boolean;
  /** Why the sequence cannot start yet; undefined means it can. */
  blocked: string | undefined;
  onSelect: () => void;
  onSetRunning: (start: boolean) => void;
  onEdit: () => void;
};

/** One sequence as a framed row: name, status, the channel chain of its steps, and Start/Pause/Edit. */
export function OutreachSequenceCard({
  sequence,
  selected,
  busy,
  blocked,
  onSelect,
  onSetRunning,
  onEdit,
}: OutreachSequenceCardProps) {
  return (
    <li className="audience-seq" data-selected={selected || undefined}>
      <div className="audience-seq-head">
        <Button variant="link" size="sm" onClick={onSelect}>
          {sequence.name}
        </Button>
        <Badge size="sm" tone={sequenceStatusTone(sequence.status)}>
          {sequenceStatusLabel(sequence.status)}
        </Badge>
        <Text as="span" tone="muted" leading="inherit">
          {t("{p0} steps", { p0: formatNumber(sequence.steps.length) })}
        </Text>
      </div>
      {sequence.steps.length ? (
        <ol className="audience-chain" aria-label={t("Steps")}>
          {sequence.steps.map((step) => {
            const glyph = glyphChannel(step.channel);
            return (
              <li key={step.id}>
                <Badge
                  size="xs"
                  tone="neutral"
                  icon={glyph ? <PlatformIcon platform={glyph} /> : undefined}
                >
                  {channelLabel(step.channel)}
                </Badge>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="audience-row">
        {sequence.status === "active" ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => onSetRunning(false)}>
            {t("Pause")}
          </Button>
        ) : (
          <DisabledReason
            variant="secondary"
            size="sm"
            loading={busy}
            {...(blocked
              ? { disabled: true as const, reason: blocked }
              : { disabled: false as const })}
            onClick={() => onSetRunning(true)}
          >
            {t("Start")}
          </DisabledReason>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t("Edit")}
        </Button>
      </div>
    </li>
  );
}
