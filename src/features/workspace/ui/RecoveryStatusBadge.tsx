import { useT } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
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

const tones: Record<RecoveryStatus, StatusTextTone> = {
  working: "running",
  input: "needs-you",
  interrupted: "needs-you",
  done: "done",
  idle: "idle",
  unknown: "idle",
  unavailable: "idle",
  failed: "failed",
  retrying: "needs-you",
};

export function RecoveryStatusBadge({ status }: { status: RecoveryStatus }) {
  return <StatusText tone={tones[status]}>{useT()(labels[status])}</StatusText>;
}
