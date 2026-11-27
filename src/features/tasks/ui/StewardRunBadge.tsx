import { useLocale } from "../../../shared/i18n";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import type { StewardRunStatus } from "../model/hostStewards";
import { stewardStatusLabel } from "../model/statusLabels";

function runTone(status: StewardRunStatus): StatusTextTone {
  if (status === "failed") return "failed";
  if (status === "succeeded") return "done";
  if (status === "running") return "running";
  return "idle";
}

export function StewardRunBadge({ status }: { status: StewardRunStatus }) {
  useLocale();
  return (
    <StatusText tone={runTone(status)} wrap>
      {stewardStatusLabel(status)}
    </StatusText>
  );
}
