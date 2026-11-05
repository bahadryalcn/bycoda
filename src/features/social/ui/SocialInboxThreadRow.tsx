import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useId } from "react";
import { t } from "../../../shared/i18n";
import type { SocialSnapshot, SocialThread } from "../model/social";
import { StatusBadge, time } from "./socialShared";

export function SocialInboxThreadRow({
  item,
  snapshot,
  contactName,
  selected,
  checked,
  showCheckbox,
  disabled,
  onCheckedChange,
  onSelect,
}: {
  item: SocialThread;
  snapshot: SocialSnapshot;
  contactName?: string;
  selected: boolean;
  checked: boolean;
  showCheckbox: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
}) {
  const checkboxId = useId();
  return (
    <div className="social-selection-row">
      {showCheckbox ? (
        <label htmlFor={checkboxId}>
          <Checkbox
            id={checkboxId}
            disabled={disabled}
            aria-label={t("Select conversation with {p0}", {
              p0: contactName ?? t("Contact person"),
            })}
            checked={checked}
            onChange={(event) => onCheckedChange(event.target.checked)}
          />
        </label>
      ) : null}
      <Button
        disabled={disabled}
        type="button"
        variant="tab"
        layout="stacked"
        className="social-row"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="social-row-head">
          <strong>{contactName ?? t("Contact person")}</strong>
          <small>{time(item.lastInboundAt)}</small>
        </span>
        <p className="social-row-preview">
          {item.events[item.events.length - 1]?.text.slice(0, 140)}
        </p>
        <span className="social-row-meta">
          {item.kind === "message" ? t("Message") : t("Comment")} ·{" "}
          {snapshot.accounts.find((account) => account.id === item.accountId)?.name}
        </span>
        {item.reviewReason || !item.projectId ? (
          <StatusBadge status="review" label={t("Project required")} />
        ) : null}
      </Button>
    </div>
  );
}
