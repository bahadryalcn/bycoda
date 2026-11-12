import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Text } from "../../../../shared/ui/Text";
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
    return (
      <EmptyState
        size="inline"
        kind="empty"
        className="social-capability-empty"
        description={t("Nothing reported yet.")}
      />
    );
  return (
    <ul className="social-capability-list" aria-label={t("What this account can do")}>
      {capabilities.map((row) => {
        const available = row.status === "available";
        return (
          <li key={row.operation} className="social-capability-row" data-available={available}>
            <Text
              as="span"
              size="inherit"
              tone={available ? "success" : "muted"}
              leading="inherit"
              className="social-capability-mark"
              role="img"
              aria-label={available ? t("Available") : t("Unavailable")}
            >
              {available ? <Check className="icon-sm" /> : <X className="icon-sm" />}
            </Text>
            <span className="social-capability-name">{operationText(row.operation)}</span>
            {available ? null : (
              <Text
                size="caption"
                tone="secondary"
                leading="inherit"
                className="social-capability-reason"
              >
                {capabilityReasonText(row)}
              </Text>
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
