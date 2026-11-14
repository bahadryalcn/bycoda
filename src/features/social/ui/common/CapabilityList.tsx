import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { Check, X } from "../../../../shared/ui/icons";
import type { Capability } from "../../model/social";
import { capabilityReasonText, needsConnection, operationText } from "./capabilityText";
import "./common.css";

export type CapabilityListProps = {
  capabilities: Pick<Capability, "operation" | "status" | "reasonCode">[];
  /** Opens the connection flow. Shown only on rows whose fix is a connection. */
  onConnect?: () => void;
  /** Compact account overview. Every operation remains available inside its status group. */
  grouped?: boolean;
};

/** What an account can do: a check for each available operation, a cross with the plain reason otherwise. */
export function CapabilityList({ capabilities, onConnect, grouped = false }: CapabilityListProps) {
  if (!capabilities.length)
    return (
      <EmptyState
        size="inline"
        kind="empty"
        className="social-capability-empty"
        description={t("Nothing reported yet.")}
      />
    );
  if (grouped) {
    const groupFor = (row: CapabilityListProps["capabilities"][number]) =>
      row.status === "available"
        ? "available"
        : needsConnection(row)
          ? "connection"
          : row.status === "pending"
            ? "pending"
            : "unavailable";
    const groups = [
      { id: "available", label: t("Available") },
      { id: "connection", label: t("Connection needed") },
      { id: "pending", label: t("Checking…") },
      { id: "unavailable", label: t("Unavailable") },
    ];
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {groups.map((group) => {
          const items = capabilities.filter((row) => groupFor(row) === group.id);
          const reason =
            items.length &&
            items.every(
              (row) =>
                row.status !== "available" &&
                capabilityReasonText(row) === capabilityReasonText(items[0]!),
            )
              ? capabilityReasonText(items[0]!)
              : undefined;
          return items.length ? (
            <Disclosure
              key={group.id}
              summary={group.label}
              count={items.length}
              variant="row"
              size="sm"
            >
              {reason && reason !== group.label ? (
                <Text as="p" size="caption" tone="secondary">
                  {reason}
                </Text>
              ) : null}
              <CapabilityRows capabilities={items} onConnect={onConnect} sharedReason={reason} />
            </Disclosure>
          ) : null;
        })}
      </div>
    );
  }
  return <CapabilityRows capabilities={capabilities} onConnect={onConnect} />;
}

function CapabilityRows({
  capabilities,
  onConnect,
  sharedReason,
}: CapabilityListProps & { sharedReason?: string }) {
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
            <Text as="span" size="secondary" leading="inherit" className="social-capability-name">
              {operationText(row.operation)}
            </Text>
            {available || sharedReason ? null : (
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
