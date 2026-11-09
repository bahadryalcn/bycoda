import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Check, X } from "../../../../shared/ui/icons";
import type { Capability } from "../../model/social";
import { capabilityReasonText, needsConnection, operationText } from "./capabilityText";
import "./common.css";

export type CapabilityListProps = {
  capabilities: Pick<Capability, "operation" | "status" | "reasonCode">[];
  /** Opens the connection flow. Shown only on rows whose fix is a connection. */
  onConnect?: () => void;
};

/** What an account can do: a check for each available operation, a cross with the plain reason otherwise. */
export function CapabilityList({ capabilities, onConnect }: CapabilityListProps) {
  if (!capabilities.length)
    return <p className="social-capability-empty">{t("Nothing reported yet.")}</p>;
  return (
    <ul className="social-capability-list" aria-label={t("What this account can do")}>
      {capabilities.map((row) => {
        const available = row.status === "available";
        return (
          <li key={row.operation} className="social-capability-row" data-available={available}>
            <span
              className="social-capability-mark"
              role="img"
              aria-label={available ? t("Available") : t("Unavailable")}
            >
              {available ? <Check className="icon-sm" /> : <X className="icon-sm" />}
            </span>
            <span className="social-capability-name">{operationText(row.operation)}</span>
            {available ? null : (
              <span className="social-capability-reason">{capabilityReasonText(row)}</span>
            )}
            {!available && onConnect && needsConnection(row) ? (
              <Button variant="secondary" size="sm" onClick={onConnect}>
                {t("Connect")}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
