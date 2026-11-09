import { useT } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import type { RecoveryStatus } from "../model/sessionRecovery";

const labels: Record<RecoveryStatus, string> = {
  working: "Working",
  input: "Needs input",
  interrupted: "Interrupted",
  done: "Done",
  idle: "Idle",
  unknown: "Status not verified",
  unavailable: "Session unavailable",
  failed: "Failed",
  retrying: "Retrying",
};

const tones: Record<RecoveryStatus, BadgeTone> = {
  working: "accent",
  input: "warning",
  interrupted: "warning",
  done: "success",
  idle: "neutral",
  unknown: "neutral",
  unavailable: "neutral",
  failed: "danger",
  retrying: "warning",
};

export function RecoveryStatusBadge({ status }: { status: RecoveryStatus }) {
  const label = useT()(labels[status]);
  return (
    <Badge
      size="xs"
      appearance="subtle"
      tone={tones[status]}
      icon={<StatusDot label={label} aria-hidden tone={tones[status]} />}
    >
      {label}
    </Badge>
  );
}
