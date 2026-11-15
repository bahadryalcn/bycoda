import { useT } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import type { StewardRunStatus } from "../model/hostStewards";
import { STEWARD_STATUS_LABELS } from "../model/stewardClient";

function runTone(status: StewardRunStatus): StatusTextTone {
  if (status === "failed") return "failed";
  if (status === "succeeded") return "done";
  if (status === "running") return "running";
  return "idle";
}

export function StewardRunBadge({ status }: { status: StewardRunStatus }) {
  const t = useT();
  return <StatusText tone={runTone(status)}>{t(STEWARD_STATUS_LABELS[status])}</StatusText>;
}
