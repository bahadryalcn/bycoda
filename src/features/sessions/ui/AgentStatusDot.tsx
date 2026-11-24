import { useLocale } from "../../../shared/i18n";
import { Check, CircleAlert, Square, X } from "../../../shared/ui/icons";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import type { DockAgentStatus } from "../model/activityDock";

export function AgentStatusDot({
  status,
  size = "xs",
}: {
  status: DockAgentStatus;
  size?: "xs" | "md";
}) {
  useLocale();
  if (status === "running") return <WorkingIndicator size={size} />;
  const className = `${size === "md" ? "icon-md" : "icon-xs"} shrink-0`;
  if (status === "done") return <Check className={className} tone="success" strokeWidth={2} />;
  if (status === "failed") {
    return <X className={className} tone="danger" strokeWidth={2} />;
  }
  if (status === "stopped") {
    return <Square className={className} tone="warning" strokeWidth={2} />;
  }
  if (status === "interrupted") {
    return <CircleAlert className={className} tone="warning" strokeWidth={2} />;
  }
  return null;
}
