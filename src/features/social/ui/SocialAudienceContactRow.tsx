import type { HostProject } from "../../connections/public/protocol";
import type { SocialContact, SocialSnapshot } from "../model/social";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useId } from "react";
import { t } from "../../../shared/i18n";
import { StatusBadge } from "./socialShared";

export function SocialAudienceContactRow({
  contact,
  snapshot,
  projects,
  selected,
  checked,
  disabled,
  onCheckedChange,
  onSelect,
}: {
  contact: SocialContact;
  snapshot: SocialSnapshot;
  projects: HostProject[];
  selected: boolean;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
}) {
  const checkboxId = useId();
  const account = snapshot.accounts.find((item) => item.id === contact.accountId);
  return (
    <div className="social-selection-row">
      <label htmlFor={checkboxId}>
        <Checkbox
          id={checkboxId}
          disabled={disabled}
          aria-label={t("Select contact {p0}", { p0: contact.name })}
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      </label>
      <Button
        disabled={disabled}
        type="button"
        variant="tab"
        layout="stacked"
        className="social-row"
        aria-label={contact.name}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <strong>{contact.name}</strong>
        <span>
          {account?.name ?? t("Account not found")} · {contact.platformId}
        </span>
        <span>
          {contact.projectIds
            .map(
              (id) =>
                projects.find((project) => project.id === id)?.name ?? t("Inaccessible project"),
            )
            .join(", ")}
          {contact.tags.length ? ` · ${contact.tags.join(", ")}` : ""}
        </span>
        <StatusBadge
          status={
            contact.optedOut ? "cancelled" : contact.consent?.allowed ? "available" : "review"
          }
          label={
            contact.optedOut
              ? t("Contact closed")
              : contact.consent?.allowed
                ? t("Messaging allowed")
                : t("No messaging consent")
          }
        />
      </Button>
    </div>
  );
}
