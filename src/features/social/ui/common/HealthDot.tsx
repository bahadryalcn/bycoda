import { StatusDot } from "../../../../shared/ui/StatusDot";
import type { BadgeTone } from "../../../../shared/ui/Badge";

export type HealthStatus = "ok" | "warn" | "error";

const TONE: Record<HealthStatus, BadgeTone> = {
  ok: "success",
  warn: "warning",
  error: "danger",
};

/** Connection or capability health as one colored dot. `label` is the spoken and hover meaning. */
export function HealthDot({ status, label }: { status: HealthStatus; label: string }) {
  return <StatusDot tone={TONE[status]} label={label} />;
}
